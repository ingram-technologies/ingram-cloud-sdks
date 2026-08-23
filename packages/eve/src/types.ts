/**
 * Shared configuration shapes, defaults, and pure helpers for the Ingram Cloud
 * eve adapter. The only `eve` import here is a **type** (erased at build), so the
 * MCP-URL builder — and the approval helpers in `./approvals` — can be used, and
 * unit-tested, without loading the eve runtime.
 */
import type { McpClientConnectionDefinition } from "eve/connections";

// The defaults are the adapter's (this package builds on it) — one source.
export { DEFAULT_API_VERSION, DEFAULT_BASE_URL } from "@ingram-cloud/ai-sdk";

export interface IngramMcpSettings {
	/** A smith or tenant-admin token; eve sends it as `Authorization: Bearer …`. */
	apiKey: string;

	/** The Ingram Cloud deployment (`kind: "mcp"`) to expose, e.g. `dep_…`. */
	deploymentId: string;

	/**
	 * Human-readable summary of the connection and its tools. eve requires it: the
	 * system prompt and `connection_search` use it to describe the connection to
	 * the model.
	 */
	description: string;

	/** The smith to act as, sent as `IC-Smith-Id`. Needed with a tenant-admin token. */
	smithId?: string;

	/** Override the API base. Defaults to {@link DEFAULT_BASE_URL}. */
	baseURL?: string;

	/** Override the `IC-Api-Version` header. Defaults to {@link DEFAULT_API_VERSION}. */
	apiVersion?: string;

	/** Extra headers merged onto every request to the MCP server (these win on conflict). */
	headers?: Record<string, string>;

	/**
	 * Per-connection approval gate for these tools — eve's own `never()` / `once()`
	 * / `always()` from `eve/tools/approval`. Distinct from the smith's server-side
	 * approvals (see `./approvals`).
	 */
	approval?: McpClientConnectionDefinition["approval"];

	/** Client-side tool filter (`allow` or `block`), passed straight to eve. */
	tools?: McpClientConnectionDefinition["tools"];
}

/** The inbound MCP endpoint for an Ingram Cloud deployment of `kind: "mcp"`. */
export function ingramMcpUrl(baseURL: string, deploymentId: string): string {
	return `${baseURL.replace(/\/+$/, "")}/deployments/${deploymentId}/mcp`;
}
