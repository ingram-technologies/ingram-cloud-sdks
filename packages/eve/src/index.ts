/**
 * `@ingram-cloud/eve` — wire an Ingram Cloud smith into an
 * [eve](https://vercel.com/eve) agent.
 *
 * Three standards-first seams, no proprietary protocol:
 *  - {@link ingramCloudModel} — run a smith as the agent's `model` over the
 *    OpenAI Responses API (author it in `agent/agent.ts`).
 *  - {@link defineIngramMcpConnection} — attach an Ingram-hosted deployment's
 *    tools as an eve MCP connection (author it in `agent/connections/*.ts`).
 *  - the approval helpers — resolve a smith's server-side human-in-the-loop
 *    pauses on the standard approval channel (also at
 *    `@ingram-cloud/eve/approvals`).
 */
export { ingramCloudModel, type IngramCloudModelSettings } from "./model.js";
export { defineIngramMcpConnection } from "./connection.js";
export {
	approvalResponseMessages,
	approvalWireItem,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
	type ApprovalDecision,
	type IngramApprovalRequest,
} from "./approvals.js";
export {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	ingramMcpUrl,
	type IngramMcpSettings,
} from "./types.js";
