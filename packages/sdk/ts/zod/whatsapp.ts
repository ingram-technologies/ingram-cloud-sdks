/**
 * Hand-authored Zod schemas for the `whatsapp` channel-config resource — the
 * wire's source of truth, replacing the loose generated shapes for this
 * resource.
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

/**
 * A tenant's WhatsApp number as hosted under Ingram Cloud's shared Meta app.
 * Secrets are never returned; the optional fields are present only once
 * `configured` is true. `display_phone_number` is the E.164 number Meta has on
 * file for the registered `phone_number_id`, and can be null until Meta reports
 * it. `webhook_url` is IC's single app-level webhook (informational — IC
 * subscribes the number to it for you).
 */
export const WhatsAppConfigOut = z
	.object({
		configured: z.boolean(),
		phone_number_id: z.string().optional(),
		display_phone_number: z.string().nullable().optional(),
		waba_id: z.string().nullable().optional(),
		webhook_url: z.string().optional(),
	})
	.meta({ id: "WhatsAppConfigOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

/**
 * Register (or rotate) a tenant's WhatsApp number. IC validates the token,
 * subscribes its shared app to the WABA so inbound flows to the app-level
 * webhook, and stores the mapping. All three fields are required; they're
 * optional at the shape layer so the handler returns its specific
 * `empty_config` code rather than a pre-handler `invalid_request`.
 */
export const WhatsAppConfigIn = z
	.object({
		phone_number_id: z.string().optional(),
		access_token: z.string().optional(),
		waba_id: z.string().optional(),
	})
	.meta({ id: "WhatsAppConfigIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICWhatsAppConfig = z.infer<typeof WhatsAppConfigOut>;
