/**
 * Hand-authored Zod schemas for the `whatsapp` number resource — the wire's
 * source of truth, replacing the loose generated shapes for this resource.
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

/**
 * One of a tenant's WhatsApp numbers, hosted under Ingram Cloud's shared Meta
 * app and keyed by Meta's `phone_number_id`. Secrets are never returned.
 * `display_phone_number` is the number Meta has on file, null until Meta
 * reports it. `webhook_url` is IC's single app-level webhook (informational —
 * IC subscribes the number to it for you).
 */
export const WhatsAppNumberOut = z
	.object({
		phone_number_id: z.string(),
		display_phone_number: z.string().nullable(),
		waba_id: z.string(),
		webhook_url: z.string(),
		created_at: z.string(),
	})
	.meta({ id: "WhatsAppNumberOut" });

export const WhatsAppNumberListOut = pageOut(
	WhatsAppNumberOut,
	"WhatsAppNumberListOut",
);

// ── Request bodies ──────────────────────────────────────────────────────────

/**
 * Register (or rotate the token of) a WhatsApp number; the path carries its
 * `phone_number_id`. IC validates the token can read the number, subscribes its
 * shared app to the WABA so inbound flows to the app-level webhook, and stores
 * the mapping.
 */
export const WhatsAppNumberIn = z
	.object({
		access_token: z.string().min(1),
		waba_id: z.string().min(1),
	})
	.meta({ id: "WhatsAppNumberIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICWhatsAppNumber = z.infer<typeof WhatsAppNumberOut>;
