/**
 * Human-in-the-loop approvals, transport-level. When a smith's tool is marked
 * `destructiveHint`, the run pauses and Ingram Cloud projects the pause onto the
 * **standard tool-call channel**: the assistant turn carries a tool call whose id
 * encodes both the run and the underlying call as `"<run_id>::<tool_call_id>"`,
 * and the turn ends with `finish_reason: "tool_calls"`.
 *
 * These helpers are pure string/shape utilities (no `@flue/runtime` import), so
 * they work whether you read the model response through Flue or call
 * `/v1/chat/completions` directly. You resume by sending a `tool` message that
 * echoes the composite id with the decision as its content.
 */

/** A pending approval surfaced by Ingram Cloud over the tool-call channel. */
export interface IngramApprovalRequest {
	/** The composite tool-call id: `"<run_id>::<tool_call_id>"`. */
	id: string;
	/** The Ingram Cloud run that is paused. */
	runId: string;
	/** The underlying tool call awaiting a decision. */
	toolCallId: string;
	/** The real tool the agent wants to run. */
	toolName: string;
	/** The arguments the agent proposed. */
	args: unknown;
}

export type ApprovalDecision = "approve" | "reject";

/** Split a composite approval id into its run id and tool-call id. */
export function parseApprovalId(id: string): {
	runId: string;
	toolCallId: string;
} {
	const sep = id.indexOf("::");
	if (sep === -1) return { runId: "", toolCallId: id };
	return { runId: id.slice(0, sep), toolCallId: id.slice(sep + 2) };
}

/** Build the composite approval id Ingram Cloud expects on resume. */
export function buildApprovalId(runId: string, toolCallId: string): string {
	return `${runId}::${toolCallId}`;
}

/** A tool call as it appears across the OpenAI/Flue surfaces — fields are probed leniently. */
type ToolCallLike = {
	id?: string;
	toolCallId?: string;
	name?: string;
	toolName?: string;
	arguments?: unknown;
	input?: unknown;
	args?: unknown;
};

/**
 * Pull the pending approvals out of a model response's tool calls. Any tool call
 * whose id is composite (`run::tc`) is an Ingram Cloud approval request; plain
 * ids (your own client-side tools) are skipped.
 */
export function getApprovalRequests(
	toolCalls: readonly ToolCallLike[] | undefined,
): IngramApprovalRequest[] {
	if (!toolCalls) return [];
	const out: IngramApprovalRequest[] = [];
	for (const tc of toolCalls) {
		const id = tc.id ?? tc.toolCallId;
		if (!id || !id.includes("::")) continue;
		const { runId, toolCallId } = parseApprovalId(id);
		out.push({
			id,
			runId,
			toolCallId,
			toolName: tc.toolName ?? tc.name ?? "",
			args: tc.input ?? tc.args ?? tc.arguments,
		});
	}
	return out;
}

/**
 * The OpenAI-shaped `tool` message to send as the next turn so Ingram Cloud
 * resumes the paused run. The content is the decision (`approve` / `reject`).
 */
export function approvalWireMessage(
	approval: IngramApprovalRequest | string,
	decision: ApprovalDecision,
): { role: "tool"; tool_call_id: string; content: ApprovalDecision } {
	const id = typeof approval === "string" ? approval : approval.id;
	return { role: "tool", tool_call_id: id, content: decision };
}
