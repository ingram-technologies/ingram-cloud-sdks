/**
 * Hand-authored Zod schemas for the `smith-revisions` resource — the wire's
 * source of truth for `/v1/smiths/{id}/revisions`.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * type is `z.infer`red from them here and re-exported by `../responses`. No Zod
 * is pulled into a type-only consumer — `responses.ts` re-exports as types.
 *
 * A smith's behaviour config (instructions / model / hosted tools / auto-memory)
 * is mutable; every change is snapshotted as an immutable *revision* and an
 * operator can roll back. History is append-only — a *restore* re-applies an old
 * snapshot as a brand-new revision.
 *
 * `snapshot` must carry every key the API snapshots, or Zod strips the missing
 * one from the response: it is stored and re-applied on restore, but invisible
 * to the operator deciding whether to roll back. `skills` was absent here and
 * did exactly that.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";
import { SkillRef } from "./skills.js";

/** An immutable snapshot of a smith's effective behaviour config at one revision. */
export const SmithRevisionOut = z
	.object({
		version: z.number().int(),
		snapshot: z.object({
			instructions: z.string().nullish(),
			model: z.string().nullish(),
			enabled_hosted_tools: z.array(z.string()).optional(),
			vector_store_ids: z.array(z.string()).optional(),
			mcp_servers: z.array(z.string()).nullish(),
			/** Skills the smith carried at this revision. */
			skills: z.array(SkillRef).nullish(),
			// Nullish: a snapshot taken while the smith inherited a sparse agent
			// version carries null (= the default) for these.
			auto_memory: z.boolean().nullish(),
			memory_consolidation: z.boolean().nullish(),
		}),
		created_by: z.string().nullish(),
		note: z.string().nullish(),
		created_at: z.string().nullish(),
	})
	.meta({ id: "SmithRevisionOut" });

export const RevisionListOut = pageOut(SmithRevisionOut, "RevisionListOut");

// ── Request bodies ──────────────────────────────────────────────────────────

export const RestoreIn = z
	.object({ note: z.string().nullish() })
	.meta({ id: "RestoreIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICSmithRevision = z.infer<typeof SmithRevisionOut>;
