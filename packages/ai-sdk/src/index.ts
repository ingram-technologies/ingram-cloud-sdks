/**
 * `@ingram-cloud/ai-sdk` — drive an Ingram Cloud smith from the Vercel
 * AI SDK.
 *
 * The main entry point is built entirely on industry-standard surfaces: the
 * provider is `@ai-sdk/openai`'s Responses model over Ingram Cloud's
 * `/v1/responses`, server-executed tool calls arrive as standard
 * `tool-call`/`tool-result` parts, and approvals ride the AI SDK's
 * `tool-approval-request`/`tool-approval-response` channel. Client helpers live
 * in `@ingram-cloud/ai-sdk/react`; the opt-in (non-standard) native-envelope
 * helpers live in `@ingram-cloud/ai-sdk/native`.
 */
export { createIngramCloud } from "./provider.js";
export {
	approvalResponseMessages,
	approvalWireItem,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
	type ApprovalDecision,
	type IngramApprovalRequest,
} from "./approvals.js";
export { getRenderApps, RENDER_APP_TOOL, type IngramRenderApp } from "./render.js";
export {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	type IngramCloudSettings,
} from "./types.js";
