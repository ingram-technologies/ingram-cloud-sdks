/**
 * Client-side conveniences for `useChat`. These are thin wrappers over the AI
 * SDK's own primitives — the recommended shape is a proxy route (your server
 * holds the Ingram Cloud token and runs {@link createIngramCloud}); the browser
 * just points `useChat` at that route.
 */
import {
	DefaultChatTransport,
	lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";

export interface IngramCloudTransportOptions {
	/** Your proxy route that talks to Ingram Cloud. Defaults to `"/api/chat"`. */
	api?: string;
	/** Extra headers, or a function returning them per request. */
	headers?: Record<string, string> | (() => Record<string, string>);
	/** Extra body fields merged into every request. */
	body?: Record<string, unknown>;
}

/**
 * A `DefaultChatTransport` pre-pointed at your Ingram Cloud proxy route. Use it
 * as `useChat({ transport: ingramCloudTransport() })`.
 */
export function ingramCloudTransport(options: IngramCloudTransportOptions = {}) {
	return new DefaultChatTransport({
		api: options.api ?? "/api/chat",
		headers: options.headers,
		body: options.body,
	});
}

/**
 * Predicate for `useChat({ sendAutomaticallyWhen })`: auto-resume the turn once
 * every surfaced approval has a decision. Re-exported from the AI SDK under a
 * shorter name.
 */
export const approvalsSettled = lastAssistantMessageIsCompleteWithApprovalResponses;
