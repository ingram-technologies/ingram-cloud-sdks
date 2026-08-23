/**
 * Hand-authored Zod schemas for the `email` channel-config resource — the
 * wire's source of truth for the tenant Cloudflare sending config.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * type is `z.infer`red from `EmailConfigOut` here and re-exported by
 * `../responses` as `export type` — no Zod is pulled into a type-only consumer.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 *
 * The out shape is the union of two builders in `api/src/routes/email.ts`
 * (via `runtime/email.ts`):
 *  - GET `/v1/tenant/email` (`configStatus`) — `{ configured: false }`, or
 *    `{ configured: true, from_domain, display_name, has_token, inbound_url }`.
 *  - PUT `/v1/tenant/email` (`configureEmail`) — `{ configured: true,
 *    from_domain, display_name, inbound_url, inbound_secret }`.
 * Hence `configured` is the only required field; everything else is optional,
 * and `inbound_secret` is present only on the PUT response (shown once).
 */
import { z } from "zod";

export const EmailConfigOut = z
	.object({
		/** False when the tenant has no email config; true otherwise. */
		configured: z.boolean(),
		from_domain: z.string().optional(),
		display_name: z.string().nullish(),
		/** Present on GET when configured — the API token is never returned. */
		has_token: z.boolean().optional(),
		inbound_url: z.string().optional(),
		/** Only present on PUT (shown once) — wire it into the inbound worker. */
		inbound_secret: z.string().optional(),
	})
	.meta({ id: "EmailConfigOut" });

// ── Request body ─────────────────────────────────────────────────────────────

export const EmailConfigIn = z
	.object({
		cloudflare_account_id: z.string(),
		cloudflare_api_token: z.string(),
		from_domain: z.string(),
		display_name: z.string().nullish(),
		inbound_secret: z.string().nullish(),
	})
	.meta({ id: "EmailConfigIn" });

// ── Inferred consumer-facing type (re-exported by ../responses) ──────────────

export type ICEmailConfig = z.infer<typeof EmailConfigOut>;
