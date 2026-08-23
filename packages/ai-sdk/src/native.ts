/**
 * Optional, **non-standard** helpers for Ingram Cloud's native run envelope
 * (`POST /v1/smiths/{sid}/runs` with `stream: true`).
 *
 * Prefer the standard surface ({@link createIngramCloud} from the main entry
 * point) — it covers text, approvals, and server-executed tool calls (as
 * `tool-call`/`tool-result` parts once each call completes). Reach for this
 * module only when you need the native envelope's extras the standard parts
 * don't carry, notably the in-flight `tool.executing` callback the moment a
 * tool starts. Everything here is additive: it streams text deltas to a UI
 * message stream and hands structured events to callbacks.
 */
import type { UIMessageStreamWriter } from "ai";
import { buildApprovalId, type IngramApprovalRequest } from "./approvals.js";

/** A decoded native SSE event. Always carries `{ v, run_id }` plus event fields. */
export interface IngramCloudEvent {
	/** The SSE `event:` name, e.g. `"message.delta"`, `"run.completed"`. */
	event: string;
	v?: number;
	run_id?: string;
	[key: string]: unknown;
}

/**
 * Parse Ingram Cloud's native SSE stream into decoded events. Standalone and
 * dependency-free; use it directly if you want to drive the envelope yourself.
 */
export async function* parseIngramCloudSSE(
	body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<IngramCloudEvent> {
	if (!body) return;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			// Normalize CRLF so frames split cleanly on a blank line.
			buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const event = parseFrame(frame);
				if (event) yield event;
				boundary = buffer.indexOf("\n\n");
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseFrame(frame: string): IngramCloudEvent | null {
	let name = "message";
	const dataLines: string[] = [];
	for (const line of frame.split("\n")) {
		if (line.startsWith(":")) continue; // comment / keep-alive
		if (line.startsWith("event:")) name = line.slice(6).trim();
		else if (line.startsWith("data:"))
			dataLines.push(line.slice(5).replace(/^ /, ""));
	}
	if (dataLines.length === 0) return null;
	try {
		const data = JSON.parse(dataLines.join("\n"));
		return data && typeof data === "object"
			? { event: name, ...data }
			: { event: name, value: data };
	} catch {
		return null;
	}
}

export interface NativeTurnHandlers {
	/** Live tool progress — the reason this module exists. Live-only; not replayed. */
	onToolActivity?: (info: { tool: string; phase: "executing" | "completed" }) => void;
	/** Called once per pending approval as the run pauses. */
	onApproval?: (request: IngramApprovalRequest) => void;
}

export interface NativeTurnResult {
	runId: string | null;
	/** How the run ended, or `"unknown"` when the stream closed without saying — a
	 *  connection cut mid-turn, or a server that never sent a terminal frame. Never
	 *  read an absent ending as a good one: `"unknown"` means the answer may be
	 *  partial, and the run record is the authority. */
	status: "completed" | "paused" | "failed" | "cancelled" | "unknown";
	stopReason?: string;
	error?: string;
	/** What this run answered *without* — a tool source or skill it could not reach.
	 *  Present on a `completed` turn that carries them: the answer is shaped exactly
	 *  like a healthy one, so this is the only way to tell. */
	warnings?: Array<{ code: string; message: string }>;
	/** Why the run was cancelled, when the cancelling caller gave a reason. */
	reason?: string;
	/** Pending approvals when `status === "paused"`. */
	approvals: IngramApprovalRequest[];
	/** The assistant text accumulated this turn. */
	text: string;
}

/**
 * Pump a native run response into an AI SDK UI message stream: text deltas are
 * written to `writer` as `text-*` chunks; tool progress and approvals go to
 * {@link NativeTurnHandlers}. Returns the terminal state so the caller can decide
 * what to do next (resume an approval, surface an error, …).
 */
export async function pipeIngramCloudRun(
	response: Response,
	writer: UIMessageStreamWriter,
	handlers: NativeTurnHandlers = {},
): Promise<NativeTurnResult> {
	let runId: string | null = null;
	let textId: string | null = null;
	let text = "";
	const approvals: IngramApprovalRequest[] = [];
	// Not "completed": a stream that ends without a terminal frame — a cut connection,
	// or a server that never sent one — would otherwise be reported as a clean answer,
	// which is the one thing a caller must never be told wrongly.
	let status: NativeTurnResult["status"] = "unknown";
	let stopReason: string | undefined;
	let error: string | undefined;
	let warnings: NativeTurnResult["warnings"];
	let reason: string | undefined;

	const endText = () => {
		if (textId !== null) {
			writer.write({ type: "text-end", id: textId });
			textId = null;
		}
	};

	for await (const ev of parseIngramCloudSSE(response.body)) {
		if (typeof ev.run_id === "string") runId = ev.run_id;
		switch (ev.event) {
			case "message.delta": {
				const delta = typeof ev.delta === "string" ? ev.delta : "";
				if (!delta) break;
				if (textId === null) {
					textId = globalThis.crypto.randomUUID();
					writer.write({ type: "text-start", id: textId });
				}
				writer.write({ type: "text-delta", id: textId, delta });
				text += delta;
				break;
			}
			case "tool.executing":
			case "tool.completed":
				handlers.onToolActivity?.({
					tool: typeof ev.tool === "string" ? ev.tool : "",
					phase: ev.event === "tool.executing" ? "executing" : "completed",
				});
				break;
			case "approval.required": {
				const toolCallId = String(ev.tool_call_id ?? "");
				const request: IngramApprovalRequest = {
					id: buildApprovalId(runId ?? "", toolCallId),
					runId: runId ?? "",
					toolCallId,
					toolName: String(ev.tool ?? ""),
					args: ev.args,
					approvalId:
						typeof ev.approval_id === "string" ? ev.approval_id : undefined,
				};
				approvals.push(request);
				handlers.onApproval?.(request);
				break;
			}
			case "run.paused":
				endText();
				status = "paused";
				break;
			case "run.completed":
				endText();
				status = "completed";
				stopReason =
					typeof ev.stop_reason === "string" ? ev.stop_reason : undefined;
				// A degraded answer is shaped exactly like a healthy one, so carry the
				// list up rather than letting the caller read `completed` and stop.
				if (Array.isArray(ev.warnings) && ev.warnings.length > 0)
					warnings = ev.warnings as NativeTurnResult["warnings"];
				break;
			case "run.failed":
				endText();
				status = "failed";
				error = typeof ev.error === "string" ? ev.error : "run failed";
				break;
			case "run.cancelled":
				endText();
				status = "cancelled";
				reason = typeof ev.reason === "string" ? ev.reason : undefined;
				break;
			default:
				break;
		}
	}
	endText();
	return { runId, status, stopReason, error, warnings, reason, approvals, text };
}
