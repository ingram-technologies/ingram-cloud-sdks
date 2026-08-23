/**
 * `@ingram-cloud/flue` — drive an Ingram Cloud smith from a
 * [Flue](https://flueframework.com) agent.
 *
 * Three standards-first seams, no proprietary protocol:
 *  - {@link registerIngramCloud} — register a smith as a Flue model provider over
 *    the OpenAI-compatible API.
 *  - {@link defineIngramMcp} / {@link connectIngramMcp} — attach an
 *    Ingram-hosted deployment's tools over MCP.
 *  - the approval helpers — resolve human-in-the-loop pauses on the standard
 *    tool-call channel (also at `@ingram-cloud/flue/approvals`).
 */
export { registerIngramCloud, type IngramProvider } from "./provider.js";
export { connectIngramMcp, defineIngramMcp } from "./tools.js";
export {
	approvalWireMessage,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
	type ApprovalDecision,
	type IngramApprovalRequest,
} from "./approvals.js";
export {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	DEFAULT_PROVIDER_ID,
	ingramMcpUrl,
	ingramModelSpec,
	type IngramMcpSettings,
	type IngramModelSettings,
	type IngramProviderSettings,
} from "./types.js";
