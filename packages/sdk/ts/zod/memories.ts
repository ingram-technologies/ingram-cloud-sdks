/**
 * Hand-authored Zod schemas for the `memory` resource — the wire's source of
 * truth, imported by the API's `createRoute` definitions (validation + emitted
 * OpenAPI) and `z.infer`red into the consumer-facing `IC*` types re-exported by
 * `../responses`.
 *
 * Memory is Mastra-native (workstream #65): a smith has one **working-memory**
 * doc (structured, auto-maintained) plus automatic **semantic recall** over its
 * past messages. There is no standalone "file a fact" CRUD — recall is over the
 * conversation history the smith already produced.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>`.
 */
import { z } from "zod";

/** A smith's working-memory doc — the structured text the agent maintains about
 *  its end user, shared across the smith's threads (resource-scoped). */
export const WorkingMemoryOut = z
	.object({ content: z.string() })
	.meta({ id: "WorkingMemoryOut" });

/** Replace a smith's working-memory doc. */
export const WorkingMemorySet = z
	.object({ content: z.string() })
	.meta({ id: "WorkingMemorySet" });

/** Recall query over a smith's past messages. */
export const RecallBody = z
	.object({
		query: z.string(),
		limit: z.number().int().default(10),
	})
	.meta({ id: "RecallBody" });

/** One recall hit — a relevant past message range with its similarity `score`. */
export const RecallHit = z
	.object({
		thread_id: z.string(),
		content: z.string(),
		score: z.number(),
	})
	.meta({ id: "RecallHit" });

/** Recall response envelope — ranked hits. */
export const RecallOut = z
	.object({ data: z.array(RecallHit) })
	.meta({ id: "RecallOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICWorkingMemory = z.infer<typeof WorkingMemoryOut>;
export type ICRecallHit = z.infer<typeof RecallHit>;
