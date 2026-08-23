/**
 * MCP Apps (SEP-1865) render intent, projected for an app-embedded chat.
 *
 * An agent asks for a UI panel by calling the hosted `render_app` tool. Ingram
 * Cloud runs it server-side and projects it onto the Responses surface as a
 * standard `mcp_call`, which the AI SDK in turn surfaces as an ordinary
 * `tool-call` part. Nothing proprietary rides the wire — so a chat UI only needs
 * to recognize the call and read `{ template, data }` off it. That's what this
 * is: a projection, not a protocol.
 *
 * The panel's HTML lives with the agent. Fetch it server-side with
 * `ic.agents.ui.content(agentId, template)` (`@ingram-cloud/sdk`) and hand the
 * bytes to an MCP Apps host — see the recipe in the `ai-sdk` docs.
 */

/** The hosted tool an agent calls to ask for a panel. */
export const RENDER_APP_TOOL = "render_app";

/** One panel an agent asked to render. */
export interface IngramRenderApp {
	/** The tool call this intent came from — a stable key for the panel. */
	toolCallId: string;
	/** The template name, as uploaded to `/v1/agents/{aid}/ui`. */
	template: string;
	/** The template's props, verbatim as the agent passed them. */
	data: unknown;
}

/** A `tool-call` content part (`result.content`) or a `tool-<name>` UI message
 *  part (`useChat`), narrowed to what a render intent needs. */
type PartLike = {
	type?: string;
	toolName?: string;
	toolCallId?: string;
	input?: unknown;
	args?: unknown;
};

type Source = readonly PartLike[] | { parts?: readonly PartLike[] } | undefined | null;

/** The AI SDK names server-executed tools `mcp.<name>` on the wire. */
const isRenderPart = (part: PartLike): boolean => {
	// `result.content` / `ModelMessage`: { type: "tool-call", toolName }.
	if (part.type === "tool-call")
		return (part.toolName ?? "").replace(/^mcp\./, "") === RENDER_APP_TOOL;
	// `useChat` UI messages: the tool name is fused into the part type.
	if (typeof part.type === "string" && part.type.startsWith("tool-"))
		return part.type.slice(5).replace(/^mcp\./, "") === RENDER_APP_TOOL;
	return false;
};

/** Tool input arrives parsed, but a raw `mcp_call` carries a JSON string. */
function asObject(input: unknown): Record<string, unknown> | null {
	if (typeof input === "string") {
		try {
			return asObject(JSON.parse(input));
		} catch {
			return null;
		}
	}
	return typeof input === "object" && input !== null && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: null;
}

/**
 * Pull the render intents out of an assistant turn.
 *
 * Pass `result.content` (for `streamText`, `await result.content`) or a
 * `useChat` message. Panels come back in call order; render the last one when
 * your surface shows a single panel.
 *
 * ```ts
 * for (const panel of getRenderApps(message)) {
 *   // panel.template -> fetch the bundle; panel.data -> the props
 * }
 * ```
 */
export function getRenderApps(source: Source): IngramRenderApp[] {
	const parts = Array.isArray(source)
		? source
		: ((source as { parts?: readonly PartLike[] })?.parts ?? []);
	const out: IngramRenderApp[] = [];
	for (const part of parts) {
		if (!isRenderPart(part)) continue;
		const input = asObject(part.input ?? part.args);
		const template = typeof input?.template === "string" ? input.template : "";
		// The agent can call `render_app` with a template that doesn't exist; the
		// tool answers `error: unknown template "…"` and there's no panel to show.
		// A nameless intent is likewise unrenderable — drop both rather than hand
		// the host an intent it can only fail on.
		if (!template) continue;
		out.push({ toolCallId: part.toolCallId ?? "", template, data: input?.data });
	}
	return out;
}
