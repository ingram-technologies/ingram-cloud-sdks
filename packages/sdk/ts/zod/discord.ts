/**
 * Hand-authored Zod schemas for the `discord` channel-config resource — the wire's
 * source of truth, mirroring `telegram.ts`.
 *
 * Discord is delivered over its HTTP Interactions endpoint: the tenant registers one
 * Discord application (its public key + a bot token) and Ingram Cloud verifies every
 * inbound interaction's Ed25519 signature with that public key, so there is no shared
 * webhook secret. Secrets are never returned.
 */
import { z } from "zod";

/**
 * The tenant's Discord app config status. The bot token is never returned; the
 * optional fields are present once `configured` is true. `webhook_url` is the
 * Interactions Endpoint URL to register in the Discord Developer Portal.
 */
export const DiscordAppOut = z
	.object({
		configured: z.boolean(),
		application_id: z.string().optional(),
		public_key: z.string().optional(),
		has_bot_token: z.boolean().optional(),
		webhook_url: z.string().optional(),
	})
	.meta({ id: "DiscordAppOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const DiscordAppIn = z
	.object({
		application_id: z.string(),
		public_key: z.string(),
		bot_token: z.string(),
	})
	.meta({ id: "DiscordAppIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICDiscordApp = z.infer<typeof DiscordAppOut>;
