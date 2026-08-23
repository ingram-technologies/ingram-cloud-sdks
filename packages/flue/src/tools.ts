import { createMcpConnection, defineMcpConnection } from "@flue/runtime";
import type { McpConnection, McpConnectionDefinition } from "@flue/runtime";

import {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	DEFAULT_PROVIDER_ID,
	type IngramMcpSettings,
	ingramMcpUrl,
} from "./types.js";

/**
 * Describe an Ingram Cloud deployment exposed as an MCP server (`kind: "mcp"`)
 * as a Flue MCP connection definition — the shape `useMcpConnection()` mounts
 * in an agent render:
 *
 * ```ts
 * const ingram = defineIngramMcp({
 *   apiKey: process.env.IC_SMITH_TOKEN!,
 *   deploymentId: "dep_…",
 * });
 * export function Assistant() {
 *   useModel("…");
 *   useMcpConnection(ingram);
 *   return instructions;
 * }
 * ```
 *
 * The runtime connects at submission initialization and mounts the server's
 * tools as `mcp__<name>__<tool>`.
 */
export function defineIngramMcp(settings: IngramMcpSettings): McpConnectionDefinition {
	const baseURL = settings.baseURL ?? DEFAULT_BASE_URL;
	return defineMcpConnection({
		name: settings.name ?? DEFAULT_PROVIDER_ID,
		url: ingramMcpUrl(baseURL, settings.deploymentId),
		auth: settings.apiKey,
		headers: {
			"IC-Api-Version": settings.apiVersion ?? DEFAULT_API_VERSION,
			...(settings.smithId ? { "IC-Smith-Id": settings.smithId } : {}),
			...settings.headers,
		},
	});
}

/**
 * Connect to an Ingram Cloud deployment's MCP server now and adapt its tools
 * into ordinary Flue tool definitions — the imperative form of
 * {@link defineIngramMcp}, for trusted application code outside an agent render
 * (Node target only). Mount the returned `tools` with `useTool()`; close the
 * connection when the tools are no longer needed.
 *
 * This is distinct from {@link registerIngramCloud}: there a *smith* runs its own
 * server-side tools as the model; here a Flue agent calls Ingram-hosted tools
 * directly over MCP.
 */
export function connectIngramMcp(settings: IngramMcpSettings): Promise<McpConnection> {
	return createMcpConnection(defineIngramMcp(settings));
}
