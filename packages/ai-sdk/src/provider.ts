import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import {
	DEFAULT_API_VERSION,
	DEFAULT_BASE_URL,
	type IngramCloudSettings,
} from "./types.js";

/**
 * `ai` accepts a tool call for a tool the caller never declared only when it is
 * `providerExecuted` AND `dynamic`; otherwise it raises `NoSuchToolError`.
 * Ingram Cloud runs the agent's hosted tools (e.g. `file_search`) server-side,
 * so the caller declares none and `@ai-sdk/openai` omits `dynamic`.
 */
const markDynamic = <T extends { type: string; providerExecuted?: boolean }>(
	part: T,
): T =>
	(part.type === "tool-call" || part.type === "tool-result") && part.providerExecuted
		? { ...part, dynamic: true }
		: part;

/**
 * Create an Ingram Cloud provider for the Vercel AI SDK.
 *
 * Under the hood this is `@ai-sdk/openai`'s **Responses API** model pointed at
 * Ingram Cloud's `/v1/responses` with the right defaults wired in: the
 * API-version header, smith identity, and — when you ask for it — server-side
 * memory via a thread id. The Responses dialect carries the full agentic turn
 * as standard stream parts: the agent's server-executed tool calls arrive as
 * `tool-call`/`tool-result` (so a multi-step turn renders as steps, not one
 * unbroken text run), and approval pauses arrive as `tool-approval-request`.
 * The returned provider is a plain AI SDK model factory, so it composes with
 * `streamText`, `generateText`, agents, and `useChat` server routes exactly
 * like any other model.
 *
 * The agent is the one the smith runs (resolved from the token/`smithId`), never
 * from the model id. The model id is the upstream inference LLM: pass `""` to use
 * the agent's configured model, or a model id like `gpt-6.1-sol` to override the LLM
 * for that call.
 *
 * ```ts
 * const ingram = createIngramCloud({ apiKey: SMITH_TOKEN, threadId: chatId });
 * const result = streamText({ model: ingram(""), messages });
 * ```
 *
 * Provider creation is cheap — make one per request so `threadId`/`smithId` track
 * the current conversation and caller.
 */
export function createIngramCloud(settings: IngramCloudSettings) {
	const baseURL = (settings.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	const headers: Record<string, string> = {
		"IC-Api-Version": settings.apiVersion ?? DEFAULT_API_VERSION,
		...(settings.smithId ? { "IC-Smith-Id": settings.smithId } : {}),
		...(settings.threadId ? { "IC-Thread-Id": settings.threadId } : {}),
		...settings.headers,
	};

	const openai = createOpenAI({
		name: settings.name ?? "ingram-cloud",
		baseURL,
		apiKey: settings.apiKey,
		headers,
		fetch: settings.fetch as NonNullable<
			Parameters<typeof createOpenAI>[0]
		>["fetch"],
	});
	return (modelId = "") =>
		wrapLanguageModel({
			model: openai.responses(modelId),
			middleware: {
				specificationVersion: "v4",
				wrapGenerate: async ({ doGenerate }) => {
					const result = await doGenerate();
					return { ...result, content: result.content.map(markDynamic) };
				},
				wrapStream: async ({ doStream }) => {
					const result = await doStream();
					return {
						...result,
						stream: result.stream.pipeThrough(
							new TransformStream({
								transform: (part, controller) =>
									controller.enqueue(markDynamic(part)),
							}),
						),
					};
				},
			},
		});
}
