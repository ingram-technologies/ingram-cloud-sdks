/**
 * Hand-authored Zod schemas for platform credits — the org wallet the tenant
 * funds to pay *Ingram* (`/v1/organization/billing/*`). One wallet pools across
 * all of the org's projects; every endpoint needs an organization-scoped token.
 *
 * Source of truth is the handler (`api/src/routes/billing.ts`), which imports
 * these for request validation and response typing. Amounts are always integer
 * **minor units** (cents) of `currency` (ISO-4217, lower-case) — never floats.
 *
 * The per-endpoint query schemas stay in the handler: they carry OpenAPI
 * `param` metadata, and the client types query args as plain TS.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";

// ── Balance + ledger ────────────────────────────────────────────────────────

export const BalanceOut = z
	.object({
		/** ISO-4217, lower-case. Clients format `balance_cents` in this currency. */
		currency: z.string(),
		balance_cents: z.number().int(),
		/** Whether the org has a Stripe Customer yet (materialized on first payment). */
		stripe_customer: z.boolean(),
	})
	.meta({ id: "BalanceOut" });

/** One credit-ledger row. `amount_cents` is positive for money in (top-ups,
 *  grants, redeemed codes) and negative for usage debits. */
export const LedgerEntryOut = z
	.object({
		id: z.string(),
		amount_cents: z.number().int(),
		currency: z.string(),
		kind: z.string(),
		description: z.string(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "LedgerEntryOut" });

/** A page of ledger rows (keyset pagination). */
export const LedgerListOut = z
	.object({
		data: z.array(LedgerEntryOut),
		next_cursor: z.string().nullable(),
		has_more: z.boolean(),
	})
	.meta({ id: "LedgerListOut" });

// ── Per-project draw from the wallet ────────────────────────────────────────

/** One project's draw for a calendar month — which project is spending the
 *  shared funds, and against what cap. */
export const OrgUsageProject = z
	.object({
		project_id: z.string(),
		name: z.string(),
		/** Credits drawn this period (sum of the project's debit rows). */
		drawn_cents: z.number().int(),
		/** Tokens the project's runs consumed this period (priced daily rollup). */
		tokens: z.number().int(),
		/** The project's tenant-scope budget limit (billing currency, major units),
		 *  or null when it draws freely from the org wallet. */
		budget_limit: z.number().nullable(),
		budget_action: z.string().nullable(),
	})
	.meta({ id: "OrgUsageProject" });

export const OrgUsageOut = z
	.object({
		period: z.string(),
		currency: z.string(),
		total_drawn_cents: z.number().int(),
		total_tokens: z.number().int(),
		projects: z.array(OrgUsageProject),
	})
	.meta({ id: "OrgUsageOut" });

/** One day/project draw. Points are sparse — a day with no draw is absent, and
 *  the client fills the gaps with zero. */
export const OrgUsageSeriesPoint = z
	.object({
		day: z.string(),
		project_id: z.string(),
		drawn_cents: z.number().int(),
	})
	.meta({ id: "OrgUsageSeriesPoint" });

export const OrgUsageSeriesOut = z
	.object({
		currency: z.string(),
		from: z.string(),
		to: z.string(),
		/** Projects with any draw in the window, ranked by total draw. */
		projects: z.array(z.object({ project_id: z.string(), name: z.string() })),
		points: z.array(OrgUsageSeriesPoint),
	})
	.meta({ id: "OrgUsageSeriesOut" });

// ── Money movement ──────────────────────────────────────────────────────────

export const CheckoutIn = z
	.object({
		amount_cents: z.number().int(),
		/** The console's own origin URL to return to; must carry the Stripe session
		 *  template so the page can reflect the result. */
		return_url: z.string(),
	})
	.meta({ id: "CheckoutIn" });

export const CheckoutOut = z.object({ url: z.string() }).meta({ id: "CheckoutOut" });

export const ConfirmIn = z.object({ session_id: z.string() }).meta({ id: "ConfirmIn" });

export const ConfirmOut = z
	.object({ credited: z.boolean(), payment_status: z.string() })
	.meta({ id: "ConfirmOut" });

/** Add a card with no charge (Stripe setup-mode Checkout); on success it unlocks
 *  the one-time welcome credit. Same return-url contract as checkout. */
export const SetupIn = z.object({ return_url: z.string() }).meta({ id: "SetupIn" });

export const SetupOut = z.object({ url: z.string() }).meta({ id: "SetupOut" });

/** Redeem a one-time credit code, matched case-insensitively. */
export const RedeemIn = z.object({ code: z.string() }).meta({ id: "RedeemIn" });

export const RedeemOut = z
	.object({
		amount_cents: z.number().int(),
		currency: z.string(),
	})
	.meta({ id: "RedeemOut" });

export const AutoreloadOut = z
	.object({
		enabled: z.boolean(),
		/** When the balance drops below `threshold_cents`, the saved card is charged
		 *  for `amount_cents`. Both are integer minor units of the billing currency. */
		threshold_cents: z.number().int(),
		amount_cents: z.number().int(),
	})
	.meta({ id: "AutoreloadOut" });

/** Set the same shape you read back. */
export const AutoreloadIn = AutoreloadOut;

/** `amount_cents` is optional — it defaults to the configured auto-reload amount. */
export const ReloadIn = z
	.object({ amount_cents: z.number().int().optional() })
	.meta({ id: "ReloadIn" });

export const ReloadOut = z
	.object({ credited: z.boolean(), payment_status: z.string() })
	.meta({ id: "ReloadOut" });

export const PortalOut = z.object({ url: z.string() }).meta({ id: "PortalOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICBalance = z.infer<typeof BalanceOut>;
export type ICLedgerEntry = z.infer<typeof LedgerEntryOut>;
export type ICOrgUsage = z.infer<typeof OrgUsageOut>;
export type ICOrgUsageProject = z.infer<typeof OrgUsageProject>;
export type ICOrgUsageSeries = z.infer<typeof OrgUsageSeriesOut>;
export type ICAutoreload = z.infer<typeof AutoreloadOut>;
