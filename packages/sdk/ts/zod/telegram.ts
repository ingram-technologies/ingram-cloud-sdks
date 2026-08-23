/**
 * Hand-authored Zod schemas for the `telegram` channel-config resource — the
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
 * The tenant's Telegram bot config status. The token itself is never returned;
 * the optional fields are present only once `configured` is true (`has_token`
 * appears on the read path, not the just-configured write response).
 */
export const TelegramBotOut = z
	.object({
		configured: z.boolean(),
		bot_username: z.string().optional(),
		bot_id: z.number().int().optional(),
		has_token: z.boolean().optional(),
		webhook_url: z.string().optional(),
	})
	.meta({ id: "TelegramBotOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const TelegramBotIn = z
	.object({
		bot_token: z.string(),
		webhook_secret: z.string().nullish(),
	})
	.meta({ id: "TelegramBotIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICTelegramBot = z.infer<typeof TelegramBotOut>;
