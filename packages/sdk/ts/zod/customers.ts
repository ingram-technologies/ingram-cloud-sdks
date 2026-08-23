/**
 * Hand-authored Zod schemas for the `customers` resource — the wire's source of
 * truth, replacing the loose generated shapes for this resource.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * A customer is the *tenant's* billable party for its smiths (never ours); many
 * smiths roll up to one customer, so `smith_count` is a correlated count.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";

export const CustomerOut = z
	.object({
		id: z.string(),
		name: z.string(),
		/** Opaque external system → id map (e.g. CRM/billing keys). */
		external_ids: z.record(z.string(), z.string()),
		/** Free-form tenant annotations. */
		metadata: z.record(z.string(), z.unknown()),
		/** Active smiths rolling up to this customer; present on single-customer reads. */
		smith_count: z.number().int().optional(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "CustomerOut" });

/** Paginated list envelope: keyset cursor over `created_at, id` (desc). */
export const CustomerListOut = z
	.object({
		data: z.array(CustomerOut),
		next_cursor: z.string().nullable(),
		has_more: z.boolean(),
	})
	.meta({ id: "CustomerListOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const CustomerCreate = z
	.object({
		name: z.string(),
		external_ids: z.record(z.string(), z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.meta({ id: "CustomerCreate" });

export const CustomerPatch = z
	.object({
		name: z.string().nullish(),
		external_ids: z.record(z.string(), z.string()).nullish(),
		metadata: z.record(z.string(), z.unknown()).nullish(),
	})
	.meta({ id: "CustomerPatch" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICCustomer = z.infer<typeof CustomerOut>;
