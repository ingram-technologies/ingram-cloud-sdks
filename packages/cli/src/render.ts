/**
 * The pure half of `ic chat`: fold the native `{v:1}` envelope into what a
 * turn ended in, writing text as it streams.
 *
 * A frame here is the same `{event, data}` shape `readSse` (`commands/
 * runs.ts`) already yields — `data` still a JSON string, unparsed, so this
 * has no HTTP/SSE-transport knowledge of its own and tests with a plain
 * in-memory iterable. `chat.ts` is the only caller that hands it real
 * frames, straight off `readSse`.
 *
 * The event vocabulary and payload shapes are pinned against the real API
 * (`cloud.ingram.tech/api/src/runtime/persistence.ts` `terminalData` +
 * `announcePause`, `runtime/envelope.ts` `Elicitation`): `message.delta`
 * carries `delta`; `tool.executing`/`tool.completed` carry `tool`;
 * `approval.required` carries `approval_id`, `tool`, `args`,
 * `tool_call_id` and, when a remote tool relayed a question rather than a
 * gate pausing before it ran, `elicitation` (`{key, message,
 * requested_schema, request_state?, task_id?}`); `run.completed` carries
 * `stop_reason` and `usage`; `run.failed` carries `error`. `run.paused`
 * carries no more than `approval.required` already announced, so it is not
 * its own outcome branch here.
 */

export interface RenderFrame {
	event: string;
	/** JSON-encoded payload, same as `SseFrame.data` in `commands/runs.ts`. */
	data: string;
}

export type RenderResult =
	| { kind: "completed"; stopReason: string | null; usage?: Record<string, unknown> }
	| {
			kind: "approval";
			approvalId: string;
			tool: string;
			args: unknown;
			elicitation?: Record<string, unknown>;
	  }
	| { kind: "failed"; message: string };

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const dim = (s: string, tty: boolean) => (tty ? `${DIM}${s}${RESET}` : s);

export interface RenderIo {
	write: (s: string) => void;
	tty: boolean;
	/** Print one NDJSON line per frame instead of rendering it, same
	 *  convention as `pumpRunStream`'s `--json`. */
	json?: boolean;
}

/**
 * Consume one turn's frames and return what it ended in. `message.delta`
 * writes as it arrives; `tool.executing`/`tool.completed` print dimmed. The
 * turn's outcome is whichever of `approval.required` / `run.completed` /
 * `run.failed` the stream actually carries — at most one, since a run stops
 * streaming the moment it pauses or ends.
 */
export async function renderFrames(
	frames: AsyncIterable<RenderFrame>,
	io: RenderIo,
): Promise<RenderResult> {
	let wroteText = false;
	let result: RenderResult = { kind: "completed", stopReason: null };
	for await (const frame of frames) {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(frame.data) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (io.json) {
			io.write(`${JSON.stringify({ event: frame.event, ...data })}\n`);
			continue;
		}
		switch (frame.event) {
			case "message.delta":
				if (typeof data.delta === "string") {
					io.write(data.delta);
					wroteText = true;
				}
				break;
			case "tool.executing":
				io.write(dim(`\n[tool: ${String(data.tool ?? "?")}]\n`, io.tty));
				break;
			case "tool.completed":
				io.write(dim(`\n[tool done: ${String(data.tool ?? "?")}]\n`, io.tty));
				break;
			case "approval.required":
				result = {
					kind: "approval",
					approvalId: String(data.approval_id ?? ""),
					tool: String(data.tool ?? ""),
					args: data.args,
					...(data.elicitation
						? { elicitation: data.elicitation as Record<string, unknown> }
						: {}),
				};
				io.write(
					dim(`\n[approval required: ${String(data.tool ?? "?")}]\n`, io.tty),
				);
				break;
			case "run.completed":
				result = {
					kind: "completed",
					stopReason: (data.stop_reason as string | null | undefined) ?? null,
					...(data.usage
						? { usage: data.usage as Record<string, unknown> }
						: {}),
				};
				break;
			case "run.failed":
				result = {
					kind: "failed",
					message: String(data.error ?? "run failed"),
				};
				break;
			default:
				// `run.started`, `run.paused`, `run.cancelled`, `run.duplicate` — no
				// outcome of their own; `run.paused` never arrives without the
				// `approval.required` that already set `result`.
				break;
		}
	}
	if (wroteText && !io.json) io.write("\n");
	return result;
}
