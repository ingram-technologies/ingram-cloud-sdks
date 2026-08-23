/**
 * Hand-authored Zod schemas for the `projects` resource — the org control-plane
 * surface (`/v1/organization/projects`). A project's `id` is the `tenant` that
 * scopes all of its runtime data.
 *
 * Source of truth is the handler (`api/src/routes/projects.ts`): `serialize`
 * emits the project shape, and minting (`api/src/tokens.ts::mintToken`) returns
 * the token shape. The relic `sdk/openapi.json` supplied field/required hints
 * only.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

export const ProjectOut = z
	.object({
		id: z.string(),
		organization: z.string(),
		name: z.string(),
		metadata: z.record(z.string(), z.unknown()),
		/** ISO timestamp; null only if the row predates the column being set. */
		created_at: z.string().nullable(),
		/** Set when the project is archived (soft-deleted); null while live. */
		archived_at: z.string().nullable(),
	})
	.meta({ id: "ProjectOut" });

export const ProjectListOut = pageOut(ProjectOut, "ProjectListOut");

/**
 * The secret minted when an org mints a project (tenant-admin) token. Shape
 * matches `mintToken`'s return; the `tenant` module owns the canonical
 * `ICMintedToken` re-export, so this stays project-named and project-scoped.
 */
export const ProjectTokenOut = z
	.object({
		id: z.string(),
		/** The branded secret handle (`tha_live_…`). Shown once. */
		token: z.string(),
		scope: z.string(),
		sub: z.string(),
		scopes: z.array(z.string()),
		expires_at: z.string().nullable(),
	})
	.meta({ id: "ProjectTokenOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const ProjectIn = z
	.object({
		name: z.string(),
		metadata: z.record(z.string(), z.unknown()).nullish(),
	})
	.meta({ id: "ProjectIn" });

export const ProjectTokenIn = z
	.object({
		// Same bounds as `TokenIn.ttl_seconds` — this mints a `tenant:*` token too.
		ttl_seconds: z.number().int().positive().max(315_360_000).nullish(),
		name: z.string().nullish(),
	})
	.meta({ id: "ProjectTokenIn" });

// ── Inferred consumer-facing type ────────────────────────────────────────────

export type ICProject = z.infer<typeof ProjectOut>;
