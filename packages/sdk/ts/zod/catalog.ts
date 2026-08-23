/**
 * Hand-authored Zod schemas for the `catalog` resource — the Ingram-curated MCP
 * integration presets exposed at `GET /v1/catalog`.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * type is `z.infer`red from them here and re-exported by `../responses`. No Zod
 * is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";

/**
 * The approval-rule shape a catalog entry carries as its `default_approval_policy`.
 *
 * Defined inline (not imported from `./mcp`) to keep this module independent of
 * the parallel mcp authoring. It mirrors the canonical mcp `ApprovalRule`:
 * a tool-name `match` glob and an optional `require` mode.
 */
const ApprovalRule = z.object({
	match: z.string(),
	require: z.string().optional(),
});

/** How a catalog integration authenticates; surfaced flattened on the wire. */
const CatalogAuth = z.object({
	kind: z.string(),
	provider: z.string().nullable(),
	client_mode: z.string(),
});

export const CatalogEntryOut = z
	.object({
		slug: z.string(),
		display_name: z.string(),
		description: z.string(),
		mcp_url: z.string(),
		auth: CatalogAuth,
		scopes: z.array(z.string()),
		/** null = expose all discovered tools; otherwise the default-deny set. */
		default_allowlist: z.array(z.string()).nullable(),
		default_approval_policy: z.array(ApprovalRule),
		logo_url: z.string().nullable(),
		docs_url: z.string().nullable(),
	})
	.meta({ id: "CatalogEntryOut" });

export const CatalogListOut = z
	.object({ data: z.array(CatalogEntryOut) })
	.meta({ id: "CatalogListOut" });

// ── Inferred consumer-facing type (re-exported by ../responses) ──────────────

export type ICCatalogEntry = z.infer<typeof CatalogEntryOut>;
