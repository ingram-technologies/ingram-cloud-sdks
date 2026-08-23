/**
 * Human-in-the-loop approvals for a smith's **server-side** tools, transport-
 * level. When a smith tool is marked `destructiveHint`, the run pauses and
 * Ingram Cloud projects the pause onto the **standard Responses approval
 * channel**: the turn's content carries a `tool-approval-request` part whose
 * `approvalId` encodes both the run and the underlying call as
 * `"<run_id>::<tool_call_id>"`. You resume by sending the decision back as a
 * `tool-approval-response` message ({@link approvalResponseMessage}).
 *
 * The helpers are `@ingram-cloud/ai-sdk`'s (this package builds its model
 * seam on the adapter), re-exported here so eve users import one package. They
 * are **distinct** from eve's own per-connection `approval` gate (`never()` /
 * `once()` / `always()`), which governs tools an eve agent calls directly over a
 * connection.
 */
export {
	approvalResponseMessage,
	approvalWireItem,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
	type ApprovalDecision,
	type IngramApprovalRequest,
} from "@ingram-cloud/ai-sdk";
