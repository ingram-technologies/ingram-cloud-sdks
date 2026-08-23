/**
 * Shared configuration shapes and defaults for the Ingram Cloud AI SDK adapter.
 */

/** The public API base for Ingram Cloud's `/v1` surface. */
export const DEFAULT_BASE_URL = "https://api.cloud.ingram.tech/v1";

/** Pinned `IC-Api-Version` sent with every request unless overridden. */
export const DEFAULT_API_VERSION = "2026-05-01";

export interface IngramCloudSettings {
	/**
	 * A **smith token** (`sub = "<tenant>:<smith>"`) — already names exactly one
	 * smith, so the call runs as that smith. This is the browser-safe option.
	 *
	 * A **tenant-admin token** also works server-side, but then you must name the
	 * smith with {@link IngramCloudSettings.smithId}. Never ship a tenant-admin
	 * token to the browser.
	 */
	apiKey: string;

	/** Override the API base. Defaults to {@link DEFAULT_BASE_URL}. */
	baseURL?: string;

	/** Override the `IC-Api-Version` header. Defaults to {@link DEFAULT_API_VERSION}. */
	apiVersion?: string;

	/**
	 * The smith to act as, sent as `IC-Smith-Id`. Required only when `apiKey` is a
	 * tenant-admin token; a smith token already names its smith.
	 */
	smithId?: string;

	/**
	 * Opt into Ingram Cloud's server-side memory by naming a conversation thread
	 * (`IC-Thread-Id`). When set, Ingram Cloud owns the history and you send only
	 * the new turn; when omitted, each call is stateless and the `messages` you
	 * pass are the whole context.
	 */
	threadId?: string;

	/** Provider name used by the AI SDK. Defaults to `"ingram-cloud"`. */
	name?: string;

	/** Extra headers merged onto every request (lowest precedence wins last). */
	headers?: Record<string, string>;

	/** Custom `fetch` implementation (proxies, logging, retries). */
	fetch?: typeof globalThis.fetch;
}
