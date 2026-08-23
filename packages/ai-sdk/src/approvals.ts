import type { ModelMessage } from "ai";

/**
 * A pending human-in-the-loop approval surfaced by Ingram Cloud.
 *
 * On the Responses surface a `destructiveHint` tool pauses the run and is
 * projected as a standard `mcp_approval_request` item, which the AI SDK
 * surfaces as a `tool-approval-request` content part. Its `approvalId` encodes
 * both the run and the underlying call as `"<run_id>::<tool_call_id>"`. You
 * resume by sending a decision back ({@link approvalResponseMessage}).
 */
export interface IngramApprovalRequest {
	/** The composite approval id: `"<run_id>::<tool_call_id>"`. */
	id: string;
	/** The Ingram Cloud run that is paused. */
	runId: string;
	/** The underlying tool call awaiting a decision. */
	toolCallId: string;
	/** The real tool the agent wants to run. */
	toolName: string;
	/** The arguments the agent proposed. */
	args: unknown;
	/** The `apr_…` id, when known (present on the native surface). */
	approvalId?: string;
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

type ContentPartLike = {
	type: string;
	approvalId?: string;
	toolCall?: { toolCallId?: string; toolName?: string; input?: unknown };
};

/** The AI SDK names the agent's tools `mcp.<name>` on the wire; recover `<name>`. */
function realToolName(name: string | undefined): string {
	if (!name) return "";
	return name.startsWith("mcp.") ? name.slice(4) : name;
}

/**
 * Pull the pending approvals out of a finished `streamText`/`generateText`
 * result. Pass `result.content` (for `streamText`, `await result.content`);
 * every `tool-approval-request` part whose id is composite (`run::tc`) is an
 * Ingram Cloud approval request.
 */
export function getApprovalRequests(
	content: readonly ContentPartLike[] | undefined,
): IngramApprovalRequest[] {
	if (!content) return [];
	const out: IngramApprovalRequest[] = [];
	for (const part of content) {
		if (part.type !== "tool-approval-request") continue;
		const id = part.approvalId ?? "";
		if (!id.includes("::")) continue;
		const { runId, toolCallId } = parseApprovalId(id);
		out.push({
			id,
			runId,
			toolCallId,
			toolName: realToolName(part.toolCall?.toolName),
			args: part.toolCall?.input,
		});
	}
	return out;
}

/**
 * Build the `tool` message to append to `messages` so the next
 * `streamText`/`generateText` call resumes the paused run with your decision.
 */
export function approvalResponseMessage(
	approval: IngramApprovalRequest | string,
	decision: ApprovalDecision,
): ModelMessage {
	const id = typeof approval === "string" ? approval : approval.id;
	return {
		role: "tool",
		content: [
			{
				type: "tool-approval-response",
				approvalId: id,
				approved: decision === "approve",
				// Required: the AI SDK only forwards provider-executed approval
				// responses to the provider.
				providerExecuted: true,
			},
		],
	};
}

/**
 * The raw Responses `mcp_approval_response` input item, for when you call
 * `/v1/responses` directly (no AI SDK message conversion in between). Send it
 * in `input` as the next turn.
 */
export function approvalWireItem(
	approval: IngramApprovalRequest | string,
	decision: ApprovalDecision,
): { type: "mcp_approval_response"; approval_request_id: string; approve: boolean } {
	const id = typeof approval === "string" ? approval : approval.id;
	return {
		type: "mcp_approval_response",
		approval_request_id: id,
		approve: decision === "approve",
	};
}
