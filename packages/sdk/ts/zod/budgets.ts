/**
 * Hand-authored Zod schemas for the `budgets` resource — the wire's source of
 * truth, replacing the loose generated `schemas.ts` shapes for this resource.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

/** What a budget caps; `agent`/`smith`/`customer` budgets carry the id in
 *  `scope_id` (an agent design, a single smith, or one of your customers). */
export const BudgetScope = z.enum(["tenant", "agent", "smith", "customer"]);

/** Whether crossing the cap warns or blocks new runs. */
export const BudgetAction = z.enum(["warn", "block"]);

/** A monthly spend cap on a scope. `limit` is in `currency` — the platform billing
 *  currency (EUR by default), not necessarily USD; the field is currency-agnostic. */
export const BudgetOut = z
	.object({
		id: z.string(),
		scope: BudgetScope,
		scope_id: z.string().nullish(),
		period: z.string(),
		limit: z.number(),
		// ISO-4217, lower-case. The denomination of `limit` and `/status`'s `spent`.
		currency: z.string(),
		action: BudgetAction,
		created_at: z.string().nullish(),
	})
	.meta({ id: "BudgetOut" });

/** A budget plus its month-to-date spend, computed by `/status`. */
export const BudgetStatusOut = BudgetOut.extend({
	period_start: z.string(),
	period_key: z.string(),
	spent: z.number(),
	pct: z.number(),
	over: z.boolean(),
}).meta({ id: "BudgetStatusOut" });

export const BudgetListOut = pageOut(BudgetOut, "BudgetListOut");

// ── Request bodies ──────────────────────────────────────────────────────────

export const BudgetIn = z
	.object({
		scope: z.string(),
		scope_id: z.string().nullish(),
		// The cap, in the platform billing currency (EUR by default).
		limit: z.number(),
		action: z.string().default("warn"),
		period: z.string().default("monthly"),
	})
	.meta({ id: "BudgetIn" });

export const BudgetPatch = z
	.object({
		limit: z.number().nullish(),
		action: z.string().nullish(),
	})
	.meta({ id: "BudgetPatch" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICBudget = z.infer<typeof BudgetOut>;
export type ICBudgetStatus = z.infer<typeof BudgetStatusOut>;
