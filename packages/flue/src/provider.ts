import { createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { setProvider } from "@flue/runtime";

import {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	DEFAULT_PROVIDER_ID,
	type IngramProviderSettings,
	ingramModelSpec,
} from "./types.js";

export interface IngramProvider {
	/** The provider ID registered with Flue (default `"ingram"`). */
	providerId: string;
	/**
	 * Build a model specifier for `useModel()`. `modelId` is the upstream LLM the
	 * smith runs this turn — e.g. `provider.model("gpt-5.6-sol")` — and must be
	 * one of the ids declared in {@link IngramProviderSettings.models}.
	 */
	model(modelId: string): string;
}

/**
 * Register Ingram Cloud as a Flue model provider, so a Flue agent's model
 * runs through one of your smiths.
 *
 * Under the hood this builds a [Pi](https://pi.dev) provider with the
 * `openai-completions` wire protocol pointed at Ingram Cloud's OpenAI-compatible
 * surface (`POST /v1/chat/completions`), with the API-version header and smith
 * identity wired in, and registers it with Flue's `setProvider()`. The smith
 * runs the agent loop server-side — its instructions, tools, memory, approvals,
 * and isolation — while to Flue it looks like any model.
 *
 * The agent is the one the smith runs (resolved from the token / `smithId`),
 * never from the model id. The model id is the upstream inference LLM for the
 * turn. Flue 2 resolves model ids against the provider's declared list — an
 * undeclared id fails fast — so every model you plan to name must appear in
 * `models`.
 *
 * Call this once in `src/app.ts`, before routing, like any other provider:
 *
 * ```ts
 * import { registerIngramCloud } from "@ingram-cloud/flue";
 *
 * const ingram = registerIngramCloud({
 *   apiKey: process.env.IC_SMITH_TOKEN!,
 *   models: { "gpt-5.6-sol": {} },
 * });
 * // …then in agents/triage.ts:
 * export function Triage() {
 *   useModel(ingram.model("gpt-5.6-sol"));
 *   return instructions;
 * }
 * ```
 *
 * `@flue/runtime` is a peer dependency on purpose: `setProvider` mutates a
 * module-scoped registry, so the adapter and your app must share one instance.
 */
export function registerIngramCloud(settings: IngramProviderSettings): IngramProvider {
	const providerId = settings.providerId ?? DEFAULT_PROVIDER_ID;
	const baseUrl = (settings.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	const headers: Record<string, string> = {
		"IC-Api-Version": settings.apiVersion ?? DEFAULT_API_VERSION,
		...(settings.smithId ? { "IC-Smith-Id": settings.smithId } : {}),
		...settings.headers,
	};

	const models: Model<"openai-completions">[] = Object.entries(settings.models).map(
		([id, model]) => ({
			id,
			name: id,
			api: "openai-completions",
			provider: providerId,
			baseUrl,
			headers,
			// The smith runs the reasoning loop server-side; Flue-side thinking
			// levels don't apply, so the model is declared non-reasoning.
			reasoning: false,
			input: ["text"],
			// Billing happens on the platform, not per token here.
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			// 0 = unknown to Pi (threshold compaction stays off).
			contextWindow: model.contextWindow ?? settings.contextWindow ?? 0,
			// 0 = no max_tokens sent.
			maxTokens: model.maxTokens ?? settings.maxTokens ?? 0,
		}),
	);

	setProvider(
		createProvider({
			id: providerId,
			name: "Ingram Cloud",
			baseUrl,
			auth: {
				apiKey: {
					name: "Ingram Cloud token",
					resolve: async () => ({ auth: { apiKey: settings.apiKey } }),
				},
			},
			models,
			api: openAICompletionsApi(),
		}),
	);

	return {
		providerId,
		model: (modelId: string) => ingramModelSpec(providerId, modelId),
	};
}
