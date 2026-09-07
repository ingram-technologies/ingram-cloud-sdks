import { createInterface } from "node:readline/promises";

import { buildCommand } from "@stricli/core";
import type { Command, CommandContext } from "@stricli/core";

import type { Session } from "../client.js";
import { openSession } from "../client.js";
import { reportError } from "../errors.js";
import { resolveRef } from "../ids.js";
import type { RenderResult } from "../render.js";
import { renderFrames } from "../render.js";
import { loadSpec, operations } from "../spec.js";
import type { Operation } from "../spec.js";
import { readSse } from "./runs.js";

/**
 * `ic chat` — a terminal REPL against one smith, reusing `readSse` (`./runs`)
 * for the transport and `renderFrames` (`../render`) for turning frames into
 * text plus an outcome. Everything below is the loop that outcome drives:
 * prompting an approval/elicitation, resuming via `/submit` (never streamed —
 * see `submitDecision`), and Ctrl-C.
 *
 * Wire contracts verified against the real API
 * (`cloud.ingram.tech/api/src/routes/{smiths,run-create,run-submit}.ts`,
 * `runtime/{persistence,turn,envelope}.ts`), not assumed from the plan:
 *
 *  - `POST /v1/smiths` upserts on `(external_id, agent_id)` — a duplicate
 *    pair answers the existing smith (200), never a 409. So `--external-id`
 *    with `--agent` is always safe to call.
 *  - There is no thread resource. `thread_id` is a field on the run-create
 *    body and the `run.started` frame; "mint one" means the first turn omits
 *    it and this loop remembers whatever the server assigns.
 *  - `/submit`'s body schema (`packages/sdk/ts/zod/runs.ts` `Submit`) carries
 *    a `stream` field, but `routes/run-submit.ts`'s handler never reads it —
 *    every submission answers a JSON `RunOut` (or the cancel ack), so this
 *    loop never sends `stream: true` there.
 *  - A rejected approval's `reason` is accepted by the schema but
 *    `submitApproval` (`runtime/turn.ts`) never forwards it anywhere — sent
 *    here for forward compatibility, not because it does anything today.
 *  - A run still paused after a resume (another gated call in the same turn)
 *    reports it on `RunOut.output.tool_calls[0]` in the same pending-call
 *    shape (`runtime/persistence.ts` `PendingCall`) `approval.required`
 *    carries — so the prompt loop re-enters on that rather than re-polling.
 */

const COMMON_FLAGS = {
	profile: {
		kind: "parsed" as const,
		parse: String,
		brief: "Which stored login to use",
		optional: true,
	},
	"api-version": {
		kind: "parsed" as const,
		parse: String,
		brief: "Override the pinned IC-Api-Version",
		optional: true,
	},
};

let specOps: Operation[] | null = null;

/** An `Operation` off the bundled spec, for `resolveRef` — chat resolves
 *  `--smith`/`--agent` refs the same way every generic command does, without
 *  itself being one. */
function opFor(id: string): Operation {
	specOps ??= operations(loadSpec());
	const op = specOps.find((o) => o.id === id);
	if (!op) throw new Error(`ic's bundled spec has no ${id} operation.`);
	return op;
}

interface Elicitation {
	key: string;
	message: string;
	requested_schema: {
		properties?: Record<string, { type?: string; description?: string }>;
		required?: string[];
	};
	request_state?: string;
	task_id?: string;
}

type Approval = Extract<RenderResult, { kind: "approval" }>;

const dimSpinner = ["-", "\\", "|", "/"];

/** A `\r`-driven spinner on stderr, since `/submit`'s resume answers only
 *  once the paused run finishes driving — which can be seconds. No-ops on a
 *  non-TTY stderr (a pipe/log file gains nothing from `\r`). */
function spinner(label: string, tty: boolean): () => void {
	if (!tty) return () => {};
	let i = 0;
	const timer = setInterval(() => {
		process.stderr.write(`\r${dimSpinner[i++ % dimSpinner.length]} ${label}`);
	}, 100);
	return () => {
		clearInterval(timer);
		process.stderr.write(`\r${" ".repeat(label.length + 2)}\r`);
	};
}

/** One property per line, typed off `requested_schema`. Only `string`,
 *  `number`/`integer` and `boolean` are given real coercion — anything else
 *  (an object, an enum) is read as the literal typed text, which is what a
 *  human at a prompt can produce anyway. */
async function promptElicitation(
	rl: ReturnType<typeof createInterface>,
	elicitation: Elicitation,
): Promise<Record<string, unknown>> {
	process.stderr.write(`\n${elicitation.message}\n`);
	const props = elicitation.requested_schema.properties ?? {};
	const required = new Set(elicitation.requested_schema.required ?? []);
	const content: Record<string, unknown> = {};
	for (const [name, schema] of Object.entries(props)) {
		const brief = schema.description ? ` (${schema.description})` : "";
		const tag = required.has(name) ? "" : " [optional]";
		const raw = (await rl.question(`  ${name}${brief}${tag}: `)).trim();
		if (!raw) {
			if (required.has(name)) throw new Error(`${name} is required.`);
			continue;
		}
		if (schema.type === "number" || schema.type === "integer") {
			const n = Number(raw);
			if (Number.isNaN(n)) throw new Error(`${name}: "${raw}" is not a number.`);
			content[name] = n;
		} else if (schema.type === "boolean") {
			content[name] = /^(y|yes|true)$/i.test(raw);
		} else {
			content[name] = raw;
		}
	}
	return content;
}

/** `POST /v1/smiths/{sid}/runs`, streamed — the turn this REPL line (or the
 *  one-shot positional) sends. `onRunId` fires as soon as the id is known
 *  (off `run.started`, whose payload carries `run_id` at the frame's top
 *  level like every `{v:1}` frame does), so Ctrl-C can cancel a turn that
 *  hasn't finished announcing itself yet. */
async function streamTurn(
	session: Session,
	sid: string,
	threadId: string | null,
	text: string,
	io: { write: (s: string) => void; tty: boolean; json: boolean },
	onRunId: (rid: string) => void,
): Promise<{ result: RenderResult; threadId: string | null }> {
	const path = `/smiths/${encodeURIComponent(sid)}/runs`;
	const body: Record<string, unknown> = {
		input: [{ role: "user", content: text }],
		stream: true,
		...(threadId ? { thread_id: threadId } : {}),
	};
	const res = await session.ic.request("POST", path, {
		token: session.token(path),
		body,
		headers: { accept: "text/event-stream" },
	});
	let capturedThread = threadId;
	async function* tap() {
		for await (const frame of readSse(res)) {
			try {
				const data = JSON.parse(frame.data) as Record<string, unknown>;
				if (typeof data.run_id === "string") onRunId(data.run_id);
				if (frame.event === "run.started" && typeof data.thread_id === "string")
					capturedThread = data.thread_id;
			} catch {
				// unparsable frame: renderFrames drops it too
			}
			yield frame;
		}
	}
	const result = await renderFrames(tap(), io);
	return { result, threadId: capturedThread };
}

/** `POST /v1/smiths/{sid}/runs/{rid}/submit` — never streamed (see the
 *  module doc): one JSON `RunOut`, or the cancel ack. */
async function submitDecision(
	session: Session,
	sid: string,
	rid: string,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const path = `/smiths/${encodeURIComponent(sid)}/runs/${encodeURIComponent(rid)}/submit`;
	const res = await session.ic.request("POST", path, {
		token: session.token(path),
		body,
	});
	return (await res.json()) as Record<string, unknown>;
}

/** The next pending call off a still-paused resume's `RunOut`, in the same
 *  shape `approval.required` carries — so a second gated call in one turn
 *  re-enters this loop instead of falling out of it silently. */
function nextApproval(run: Record<string, unknown>): Approval | null {
	if (run.status !== "paused_for_approval") return null;
	const output = run.output as { tool_calls?: Array<Record<string, unknown>> } | null;
	const call = output?.tool_calls?.[0];
	if (!call?.approval_id) return null;
	return {
		kind: "approval",
		approvalId: String(call.approval_id),
		tool: String(call.tool ?? ""),
		args: call.args,
		...(call.elicitation
			? { elicitation: call.elicitation as Record<string, unknown> }
			: {}),
	};
}

/** Prompt approve/reject (and an elicitation's answer on approve), submit,
 *  and print the run's `output` — looping while the resume immediately
 *  re-pauses on another gated call. `setLive` keeps Ctrl-C's cancel target
 *  current for the run id this decision is against. */
async function resolveApprovals(
	session: Session,
	sid: string,
	rid: string,
	first: Approval,
	rl: ReturnType<typeof createInterface>,
	io: { tty: boolean; json: boolean },
	setLive: (rid: string | null) => void,
): Promise<void> {
	let pending: Approval | null = first;
	while (pending) {
		const current = pending;
		process.stderr.write(
			`\nApproval needed: ${current.tool}(${JSON.stringify(current.args ?? {})})\n`,
		);
		let decision: "approve" | "reject" | null = null;
		while (!decision) {
			const answer = (await rl.question("approve or reject? "))
				.trim()
				.toLowerCase();
			if (["approve", "a", "y", "yes"].includes(answer)) decision = "approve";
			else if (["reject", "r", "n", "no"].includes(answer)) decision = "reject";
			else process.stderr.write('Type "approve" or "reject".\n');
		}
		let reason: string | undefined;
		let content: Record<string, unknown> | undefined;
		if (decision === "reject") {
			const r = (await rl.question("reason (optional): ")).trim();
			if (r) reason = r;
		} else if (current.elicitation) {
			try {
				content = await promptElicitation(
					rl,
					current.elicitation as unknown as Elicitation,
				);
			} catch (error) {
				// A bad answer (blank required field, an unparsable number) leaves
				// the run paused server-side with nothing local tracking it once
				// this throws — say how to resume it by hand, the same way
				// oneShotTurn does for a pause it can't handle interactively.
				process.stderr.write(
					`Run ${rid} is still paused for approval ${current.approvalId}. Resolve with: ic api post smiths/${sid}/runs/${rid}/submit -f -\n`,
				);
				throw error;
			}
		}
		setLive(rid);
		const stop = spinner("resuming…", io.tty);
		let run: Record<string, unknown>;
		try {
			run = await submitDecision(session, sid, rid, {
				kind: "approval_decision",
				approval_id: current.approvalId,
				decision,
				...(reason ? { reason } : {}),
				...(content ? { content } : {}),
			});
		} finally {
			stop();
			setLive(null);
		}
		if (io.json) {
			process.stdout.write(`${JSON.stringify(run)}\n`);
		} else {
			const output = run.output as { content?: string } | null;
			if (output?.content) process.stdout.write(`${output.content}\n`);
		}
		pending = nextApproval(run);
	}
}

/** One non-interactive turn: `ic chat --smith x "text"`, or any turn run with
 *  no TTY to prompt in. A pause here has no interactive path to resolve it —
 *  reported, not silently dropped, so a script sees the approval id to act
 *  on (`ic api post smiths/{sid}/runs/{rid}/submit -f -`). */
async function oneShotTurn(
	session: Session,
	sid: string,
	threadId: string | null,
	text: string,
	io: { tty: boolean; json: boolean },
): Promise<void> {
	let runId: string | null = null;
	const { result, threadId: minted } = await streamTurn(
		session,
		sid,
		threadId,
		text,
		{ write: (s) => process.stdout.write(s), tty: io.tty, json: io.json },
		(rid) => {
			runId = rid;
		},
	);
	if (!threadId && minted) process.stderr.write(`Thread: ${minted}\n`);
	if (result.kind === "approval") {
		process.stderr.write(
			`\nPaused for approval ${result.approvalId} (${result.tool}); no TTY to resolve it here.\n` +
				(runId
					? `Resolve with: ic api post smiths/${sid}/runs/${runId}/submit -f -\n`
					: ""),
		);
		process.exitCode = 1;
	} else if (result.kind === "failed") {
		process.stderr.write(`\nRun failed: ${result.message}\n`);
		process.exitCode = 1;
	}
}

export function chatCommand(apiVersion: string): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			...words: string[]
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const jsonMode = values.json === true;
				const tty =
					process.stdout.isTTY === true && process.stdin.isTTY === true;

				const smithRaw = values.smith as string | undefined;
				const externalId = values["external-id"] as string | undefined;
				const agentRaw = values.agent as string | undefined;

				let sid: string;
				if (smithRaw) {
					sid = await resolveRef(
						{
							session,
							profile,
							op: opFor("smiths.get"),
							paramIndex: 0,
							resolvedIds: [],
						},
						smithRaw,
					);
				} else if (externalId) {
					if (!agentRaw)
						throw new Error(
							"--external-id needs --agent too, to name which agent.",
						);
					const agentId = await resolveRef(
						{
							session,
							profile,
							op: opFor("agents.get"),
							paramIndex: 0,
							resolvedIds: [],
						},
						agentRaw,
					);
					const path = "/smiths";
					const res = await session.ic.request("POST", path, {
						token: session.token(path),
						body: { external_id: externalId, agent_id: agentId },
					});
					const smith = (await res.json()) as { id: string };
					sid = smith.id;
				} else {
					throw new Error(
						"Pass --smith <ref>, or --external-id with --agent.",
					);
				}

				let threadId = (values.thread as string | undefined) ?? null;
				const io = { tty, json: jsonMode };

				const text = words.join(" ").trim();
				if (text) {
					await oneShotTurn(session, sid, threadId, text, io);
					return;
				}
				if (!tty)
					throw new Error(
						'Not a terminal: pass the message, e.g. ic chat --smith x "text".',
					);

				const rl = createInterface({
					input: process.stdin,
					output: process.stdout,
					terminal: true,
				});
				let live: { sid: string; rid: string } | null = null;
				let lastRunId: string | null = null;
				let sigints = 0;
				// rl.close() restores the terminal's raw mode before exit — skipping
				// it leaves the parent shell reading a raw, no-echo tty until the
				// user runs `stty sane`.
				const exit = (code: number) => {
					rl.close();
					process.exit(code);
				};
				const onSigint = () => {
					sigints += 1;
					if (sigints === 1 && live) {
						const target = live;
						submitDecision(session, target.sid, target.rid, {
							kind: "cancel",
						})
							.catch(() => {})
							.finally(() => exit(130));
						setTimeout(() => exit(130), 3000).unref();
					} else {
						exit(130);
					}
				};
				process.on("SIGINT", onSigint);

				if (threadId) process.stderr.write(`Thread: ${threadId}\n`);
				process.stderr.write('Type your message, or "exit" to quit.\n');
				rl.setPrompt("> ");
				rl.prompt();
				for await (const line of rl) {
					const msg = line.trim();
					if (!msg) {
						rl.prompt();
						continue;
					}
					if (msg === "exit" || msg === "quit") break;

					// A failed turn (a network blip, the API refusing) ends that turn,
					// not the session — the same bargain a real chat client makes.
					// Only the outer catch (setup, or a SIGINT racing shutdown) ends
					// the process.
					try {
						const hadThread = threadId !== null;
						const { result, threadId: newThread } = await streamTurn(
							session,
							sid,
							threadId,
							msg,
							{
								write: (s) => process.stdout.write(s),
								tty,
								json: jsonMode,
							},
							(rid) => {
								live = { sid, rid };
								lastRunId = rid;
							},
						);
						live = null;
						threadId = newThread;
						if (!hadThread && threadId)
							process.stderr.write(`Thread: ${threadId}\n`);

						if (result.kind === "approval") {
							if (lastRunId) {
								await resolveApprovals(
									session,
									sid,
									lastRunId,
									result,
									rl,
									{ tty, json: jsonMode },
									(rid) => {
										live = rid ? { sid, rid } : null;
									},
								);
							} else {
								process.stderr.write(
									"\nApproval required, but the run never announced its id.\n",
								);
							}
						} else if (result.kind === "failed") {
							process.stderr.write(`\nRun failed: ${result.message}\n`);
						}
					} catch (turnError) {
						live = null;
						reportError(turnError);
					}
					rl.prompt();
				}
				process.off("SIGINT", onSigint);
				rl.close();
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: {
				kind: "array",
				parameter: {
					brief: "The message to send (omit for the interactive prompt)",
					parse: String,
					placeholder: "text",
				},
			} as never,
			flags: {
				smith: {
					kind: "parsed",
					parse: String,
					brief: "The smith to talk to",
					optional: true,
				},
				"external-id": {
					kind: "parsed",
					parse: String,
					brief: "Upsert a smith by external id (needs --agent)",
					optional: true,
				},
				agent: {
					kind: "parsed",
					parse: String,
					brief: "The agent to clone, with --external-id",
					optional: true,
				},
				thread: {
					kind: "parsed",
					parse: String,
					brief: "Continue this thread instead of minting one",
					optional: true,
				},
				json: {
					kind: "boolean",
					brief: "Print each frame as NDJSON instead of rendering it",
					optional: true,
				},
				...COMMON_FLAGS,
			} as never,
		},
		docs: {
			brief: "Talk to a smith from the terminal",
			fullDescription:
				"Starts a run per line, streamed. An approval prompts approve/reject " +
				"(and, on an elicitation, each of its fields), then resumes via " +
				"/submit — which never streams, so the resumed reply prints once it " +
				"lands. Ctrl-C cancels the live run and exits; a second Ctrl-C exits " +
				"at once.",
		},
	});
}
