import { createIngramCloud, type IngramCloudSettings } from "@ingram-cloud/ai-sdk";
import type { LanguageModel } from "ai";

export interface IngramCloudModelSettings extends IngramCloudSettings {
	/**
	 * The upstream LLM the smith runs this turn. Empty (the default) uses the
	 * smith's own configured model; a model id like `"gpt-5.6-sol"` overrides the LLM
	 * for that turn. Either way the **agent** — instructions, tools, memory — is
	 * the one the smith runs, resolved from the token/`smithId`, never the model id.
	 */
	modelId?: string;
}

/**
 * Build an eve `model` backed by an Ingram Cloud smith.
 *
 * The returned value is a plain AI SDK `LanguageModel` — eve's `model` field
 * takes one directly — pointed at Ingram Cloud's Responses surface
 * (`POST /v1/responses`) with the API-version header and smith identity wired
 * in. eve routes it as an external provider (it bypasses the AI Gateway and
 * talks to Ingram Cloud), while the smith runs the agent loop server-side: its
 * instructions, tools, memory, approvals, and isolation — and the smith's
 * server-executed tool calls reach the stream as standard
 * `tool-call`/`tool-result` parts.
 *
 * Author it in `agent/agent.ts`:
 *
 * ```ts
 * import { defineAgent } from "eve";
 * import { ingramCloudModel } from "@ingram-cloud/eve";
 *
 * export default defineAgent({
 *   model: ingramCloudModel({ apiKey: process.env.IC_SMITH_TOKEN! }),
 * });
 * ```
 *
 * Built on {@link https://www.npmjs.com/package/@ingram-cloud/ai-sdk | `@ingram-cloud/ai-sdk`};
 * pass `threadId` to opt into Ingram Cloud's server-side memory.
 */
export function ingramCloudModel(settings: IngramCloudModelSettings): LanguageModel {
	const { modelId, ...providerSettings } = settings;
	return createIngramCloud(providerSettings)(modelId ?? "");
}
