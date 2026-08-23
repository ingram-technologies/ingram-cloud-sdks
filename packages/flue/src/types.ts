/**
 * Shared configuration shapes, defaults, and pure helpers for the Ingram Cloud
 * Flue adapter. This module imports nothing from `@flue/runtime`, so the model-
 * spec and MCP-URL builders (and the approval helpers in `./approvals`) can be
 * used — and unit-tested — without loading the runtime.
 */

/** Ingram Cloud's `/v1` API base — the root the OpenAI-compatible and MCP URLs hang off. */
export const DEFAULT_BASE_URL = "https://api.cloud.ingram.tech/v1";

/** Pinned `IC-Api-Version` sent with every request unless overridden. */
export const DEFAULT_API_VERSION = "2026-05-01";

/** Default provider ID used in Flue model specifiers (`ingram/<model>`). */
export const DEFAULT_PROVIDER_ID = "ingram";

export interface IngramProviderSettings {
	/**
	 * A **smith token** (`sub = "<tenant>:<smith>"`) — already names exactly one
	 * smith, so every call runs as that smith. The browser-safe option.
	 *
	 * A **tenant-admin token** also works server-side, but then you must name the
	 * smith with {@link IngramProviderSettings.smithId}. Never ship a tenant-admin
	 * token to the browser.
	 */
	apiKey: string;

	/**
	 * The smith to act as, sent as `IC-Smith-Id`. Required only when `apiKey` is a
	 * tenant-admin token; a smith token already names its smith.
	 */
	smithId?: string;

	/** Provider ID used in model specifiers. Defaults to {@link DEFAULT_PROVIDER_ID}. */
	providerId?: string;

	/** Override the API base. Defaults to {@link DEFAULT_BASE_URL}. */
	baseURL?: string;

	/** Override the `IC-Api-Version` header. Defaults to {@link DEFAULT_API_VERSION}. */
	apiVersion?: string;

	/** Extra headers merged onto every request (these win on conflict). */
	headers?: Record<string, string>;

	/** Default context window (tokens) for models that don't declare their own. */
	contextWindow?: number;

	/** Default max output tokens for models that don't declare their own. */
	maxTokens?: number;

	/**
	 * The upstream LLMs you will name in model specifiers, keyed by model id.
	 * Required: Flue 2 resolves specifiers against the provider's declared model
	 * list, so an undeclared id fails fast. `{}` per model is enough —
	 * `contextWindow`/`maxTokens` are optional metadata (unset = unknown).
	 */
	models: Record<string, IngramModelSettings>;
}

/** Optional metadata for one declared model. */
export interface IngramModelSettings {
	/** Context window (tokens). Unset = unknown (threshold compaction stays off). */
	contextWindow?: number;

	/** Max output tokens. Unset = no `max_tokens` sent. */
	maxTokens?: number;
}

export interface IngramMcpSettings {
	/** A smith or tenant-admin token, sent as `Authorization: Bearer …`. */
	apiKey: string;

	/** The Ingram Cloud deployment (`kind: "mcp"`) to expose, e.g. `dep_…`. */
	deploymentId: string;

	/** The smith to act as, sent as `IC-Smith-Id`. Needed with a tenant-admin token. */
	smithId?: string;

	/** MCP server name; tools are exposed as `mcp__<name>__<tool>`. Defaults to {@link DEFAULT_PROVIDER_ID}. */
	name?: string;

	/** Override the API base. Defaults to {@link DEFAULT_BASE_URL}. */
	baseURL?: string;

	/** Override the `IC-Api-Version` header. Defaults to {@link DEFAULT_API_VERSION}. */
	apiVersion?: string;

	/** Extra headers merged into the MCP transport requests. */
	headers?: Record<string, string>;
}

/**
 * Build a Flue model specifier (`<provider>/<model>`).
 *
 * `modelId` is the **upstream LLM** the smith runs for the turn — its agent
 * (instructions, tools, memory) is unchanged. Unlike the OpenAI-compatible
 * surface, Flue rejects an empty model id, so there is no "use the agent's
 * configured model" form here: name the model you want, e.g. `ingram/gpt-5.6-sol`.
 */
export function ingramModelSpec(providerId: string, modelId: string): string {
	if (!modelId) {
		throw new Error(
			`[ingram] A model id is required: Flue rejects "${providerId}/". Name the upstream LLM to run, e.g. "${providerId}/gpt-5.6-sol".`,
		);
	}
	return `${providerId}/${modelId}`;
}

/** The inbound MCP endpoint for an Ingram Cloud deployment of `kind: "mcp"`. */
export function ingramMcpUrl(baseURL: string, deploymentId: string): string {
	return `${baseURL.replace(/\/+$/, "")}/deployments/${deploymentId}/mcp`;
}
