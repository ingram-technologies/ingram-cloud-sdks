import { readFileSync } from "node:fs";

import { buildCommand } from "@stricli/core";
import type { Command, CommandContext } from "@stricli/core";

import { openSession } from "../client";
import { reportError } from "../errors";
import { proposeIdCompletions, resolveRef, resourceForParam } from "../ids";
import { print } from "../output";
import { bodyFromFlags, fillPath, flagsForOperation } from "../params";
import type { Operation } from "../spec";

/**
 * The five operations whose 200 is `text/event-stream` as often as it is
 * JSON: a run's own turn (create/replay, gated by the body's `stream`), its
 * recorded feed (`events`, always SSE), and the two OpenAI-compatible
 * surfaces (`stream` again). One SSE reader and two small renderers — the
 * native `{v:1}` envelope (`docs/architecture.md`, `api/src/runtime/
 * run-stream.ts`) and the OpenAI chunk dialects — cover all five.
 */

const COMMON_FLAGS = {
	json: {
		kind: "boolean" as const,
		brief: "Print the raw response, even on a terminal (NDJSON for a stream)",
		optional: true,
	},
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
	body: {
		kind: "parsed" as const,
		parse: String,
		brief: "Read the request body from a JSON file, or - for stdin",
		optional: true,
	},
};

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const dim = (s: string, tty: boolean) => (tty ? `${DIM}${s}${RESET}` : s);

/** One SSE frame, transport-level: `chat.ts` reuses this reader against the
 *  same `text/event-stream` bodies rather than re-parsing them; `render.ts`'s
 *  `RenderFrame` is the structural subset it actually needs. */
export interface SseFrame {
	id?: string;
	event: string;
	data: string;
}

/** One `id:`/`event:`/`data:` block, parsed. */
function parseSseBlock(raw: string): SseFrame | null {
	let id: string | undefined;
	let event = "message";
	let data = "";
	for (const line of raw.split("\n")) {
		if (line.startsWith("id:")) id = line.slice(3).trim();
		else if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:"))
			data += (data ? "\n" : "") + line.slice(5).trim();
	}
	return data ? { id, event, data } : null;
}

/** One block per yield, read as the body arrives — never buffered whole, so
 *  `message.delta` prints as it lands rather than only once the run finishes. */
export async function* readSse(res: Response): AsyncGenerator<SseFrame> {
	const body = res.body;
	if (!body) return;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		buf = buf.replace(/\r\n/g, "\n");
		let idx = buf.indexOf("\n\n");
		while (idx !== -1) {
			const frame = parseSseBlock(buf.slice(0, idx));
			buf = buf.slice(idx + 2);
			if (frame) yield frame;
			idx = buf.indexOf("\n\n");
		}
	}
	const rest = parseSseBlock(buf.trim());
	if (rest) yield rest;
}

// `run.started` opens every stream, not closes one — it must not print the
// same dimmed banner a real terminal frame gets.
const isTerminalRunEvent = (event: string) =>
	(event.startsWith("run.") && event !== "run.started") ||
	event === "approval.required";

/**
 * Pump the native `{v:1}` envelope — `smiths.runs.create`/`.replay` (live) and
 * `smiths.runs.events` (recorded) all use it. `message.delta` writes as it
 * arrives; `tool.executing` and every terminal (`run.*`, `approval.required`)
 * frame print dimmed. `--json` prints one NDJSON line per frame instead.
 */
async function pumpRunStream(
	res: Response,
	opts: { tty: boolean; json: boolean; write: (s: string) => void },
): Promise<Record<string, unknown> | null> {
	let final: Record<string, unknown> | null = null;
	let wroteText = false;
	for await (const frame of readSse(res)) {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(frame.data) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (opts.json) {
			opts.write(`${JSON.stringify({ event: frame.event, ...data })}\n`);
			continue;
		}
		if (frame.event === "message.delta" && typeof data.delta === "string") {
			opts.write(data.delta);
			wroteText = true;
		} else if (frame.event === "tool.executing") {
			opts.write(dim(`\n[tool: ${String(data.tool ?? "?")}]\n`, opts.tty));
		} else if (isTerminalRunEvent(frame.event)) {
			final = data;
			const usage = data.usage ? ` ${JSON.stringify(data.usage)}` : "";
			opts.write(dim(`\n[${frame.event}${usage}]\n`, opts.tty));
		}
	}
	if (wroteText && !opts.json) opts.write("\n");
	return final;
}

/** Chat Completions and Responses chunk deltas — `choices[0].delta.content`
 *  for the former, `data.delta` on a `*.delta` event for the latter; both
 *  dialects share this reader rather than branching on which operation it is. */
async function pumpCompatStream(
	res: Response,
	opts: { tty: boolean; json: boolean; write: (s: string) => void },
): Promise<void> {
	let wroteText = false;
	for await (const frame of readSse(res)) {
		if (frame.data === "[DONE]") break;
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(frame.data) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (opts.json) {
			opts.write(`${JSON.stringify(data)}\n`);
			continue;
		}
		if (data.error) {
			// Chat Completions' error shape: { error: {...} } nested under the
			// frame's data.
			opts.write(dim(`\n[error: ${JSON.stringify(data.error)}]\n`, opts.tty));
			continue;
		}
		if (frame.event === "error") {
			// The Responses API's own error frame is flat — { type, code,
			// message, param } — not nested under an `error` key, so it never
			// hits the branch above; without this it streamed silently.
			opts.write(dim(`\n[error: ${JSON.stringify(data)}]\n`, opts.tty));
			continue;
		}
		const choices = data.choices as
			| Array<{ delta?: { content?: string } }>
			| undefined;
		const chatDelta = choices?.[0]?.delta?.content;
		if (typeof chatDelta === "string") {
			opts.write(chatDelta);
			wroteText = true;
			continue;
		}
		if (frame.event.endsWith(".delta") && typeof data.delta === "string") {
			opts.write(data.delta);
			wroteText = true;
			continue;
		}
		if (
			frame.event === "response.completed" ||
			frame.event === "response.incomplete" ||
			frame.event === "response.failed"
		)
			opts.write(dim(`\n[${frame.event}]\n`, opts.tty));
	}
	if (wroteText && !opts.json) opts.write("\n");
}

function positionalsFor(op: Operation) {
	return op.pathParams.map((p) => ({
		brief: p.description ?? p.name,
		parse: String,
		placeholder: p.name,
		proposeCompletions: (partial: string) =>
			proposeIdCompletions(resourceForParam(op, p.name), partial),
	}));
}

/**
 * `smiths.runs.create` and `smiths.runs.replay` — a turn's own body decides
 * whether the 200 is a stream (`stream: true`, sent by the same `--stream`
 * flag `RunIn`/`RunReplayIn` already contribute via `flagsForOperation`) or
 * the finished `RunOut`.
 */
export function runStreamCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	const flags = { ...flagsForOperation(op), ...COMMON_FLAGS };
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			...args: string[]
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;

				const ids: string[] = [];
				for (const [i] of op.pathParams.entries())
					ids.push(
						await resolveRef(
							{ session, profile, op, paramIndex: i, resolvedIds: ids },
							args[i] ?? "",
						),
					);

				const fileBody = values.body
					? (JSON.parse(
							readFileSync(
								values.body === "-" ? 0 : (values.body as string),
								"utf8",
							),
						) as Record<string, unknown>)
					: {};
				const body = bodyFromFlags(op, values, fileBody);
				const path = fillPath(op, ids).replace(/^\/v1/, "");
				const token = session.token(path);

				if (body.stream !== true) {
					const res = await session.ic.request(
						op.method.toUpperCase(),
						path,
						{
							token,
							body,
						},
					);
					print(await res.json(), {
						json: values.json === true,
						tty,
						profile,
					});
					return;
				}

				const res = await session.ic.request(op.method.toUpperCase(), path, {
					token,
					body,
					headers: { accept: "text/event-stream" },
				});
				await pumpRunStream(res, {
					tty,
					json: values.json === true,
					write: (s) => process.stdout.write(s),
				});
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: { kind: "tuple", parameters: positionalsFor(op) } as never,
			flags: flags as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/** `smiths.runs.events` — always a stream, the run's recorded feed replayed. */
export function runEventsCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			...args: string[]
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;

				const ids: string[] = [];
				for (const [i] of op.pathParams.entries())
					ids.push(
						await resolveRef(
							{ session, profile, op, paramIndex: i, resolvedIds: ids },
							args[i] ?? "",
						),
					);
				const path = fillPath(op, ids).replace(/^\/v1/, "");
				const res = await session.ic.request("GET", path, {
					token: session.token(path),
					headers: { accept: "text/event-stream" },
				});
				await pumpRunStream(res, {
					tty,
					json: values.json === true,
					write: (s) => process.stdout.write(s),
				});
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: { kind: "tuple", parameters: positionalsFor(op) } as never,
			flags: COMMON_FLAGS as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/**
 * `completions.create` and `responses.create` — the OpenAI-compatible
 * surfaces. Both take a whole request body (`--body`, same file/stdin
 * convention as the generic command's `-f`) since their shapes are too rich
 * for a flag per property, plus `--stream`.
 */
export function compatStreamCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (this: CommandContext, values: Record<string, unknown>) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;

				const fileBody = values.body
					? (JSON.parse(
							readFileSync(
								values.body === "-" ? 0 : (values.body as string),
								"utf8",
							),
						) as Record<string, unknown>)
					: {};
				const body = {
					...fileBody,
					...(values.stream !== undefined
						? { stream: values.stream === true }
						: {}),
				};
				const stream = body.stream === true;
				const path = op.path.replace(/^\/v1/, "");
				const token = session.token(path);

				if (!stream) {
					const res = await session.ic.request(
						op.method.toUpperCase(),
						path,
						{
							token,
							body,
						},
					);
					print(await res.json(), {
						json: values.json === true,
						tty,
						profile,
					});
					return;
				}

				const res = await session.ic.request(op.method.toUpperCase(), path, {
					token,
					body: { ...body, stream: true },
					headers: { accept: "text/event-stream" },
				});
				await pumpCompatStream(res, {
					tty,
					json: values.json === true,
					write: (s) => process.stdout.write(s),
				});
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			flags: {
				...COMMON_FLAGS,
				stream: {
					kind: "boolean",
					brief: "Stream the response as SSE chunks",
					optional: true,
				},
			} as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}
