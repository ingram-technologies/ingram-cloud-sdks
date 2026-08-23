import {
	defineMcpClientConnection,
	type McpClientConnectionDefinition,
} from "eve/connections";

import {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	type IngramMcpSettings,
	ingramMcpUrl,
} from "./types.js";

/**
 * Define an eve MCP connection backed by an Ingram Cloud deployment of
 * `kind: "mcp"`. eve discovers the deployment's tools and hands them to the
 * model; the token and headers never reach the model.
 *
 * `export default` it from a connection file — the filename is the connection
 * name (`agent/connections/ingram.ts` registers as `"ingram"`):
 *
 * ```ts
 * // agent/connections/ingram.ts
 * import { defineIngramMcpConnection } from "@ingram-cloud/eve";
 *
 * export default defineIngramMcpConnection({
 *   apiKey: process.env.IC_SMITH_TOKEN!,
 *   deploymentId: "dep_…",
 *   description: "Ingram-hosted tools for this smith.",
 * });
 * ```
 *
 * This is distinct from {@link ingramCloudModel}: there a *smith* runs its own
 * server-side tools as the model; here an eve agent calls Ingram-hosted tools
 * directly over MCP. The token rides eve's standard `Authorization: Bearer …`
 * auth; `IC-Api-Version` (and `IC-Smith-Id`, with a tenant-admin token) ride the
 * connection headers.
 */
export function defineIngramMcpConnection(
	settings: IngramMcpSettings,
): McpClientConnectionDefinition {
	const baseURL = settings.baseURL ?? DEFAULT_BASE_URL;
	const headers: Record<string, string> = {
		"IC-Api-Version": settings.apiVersion ?? DEFAULT_API_VERSION,
		...(settings.smithId ? { "IC-Smith-Id": settings.smithId } : {}),
		...settings.headers,
	};

	return defineMcpClientConnection({
		url: ingramMcpUrl(baseURL, settings.deploymentId),
		description: settings.description,
		auth: { getToken: async () => ({ token: settings.apiKey }) },
		headers,
		...(settings.approval ? { approval: settings.approval } : {}),
		...(settings.tools ? { tools: settings.tools } : {}),
	});
}
