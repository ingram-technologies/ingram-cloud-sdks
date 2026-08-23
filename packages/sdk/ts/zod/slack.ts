/**
 * Hand-authored Zod schemas for the `slack` channel-config resource — the
 * wire's source of truth for `PUT/GET /v1/tenant/slack`.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * type is `z.infer`red here and re-exported by `../responses`. No Zod is pulled
 * into a type-only consumer — `responses.ts` re-exports this as `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";

// ── Config status (GET/PUT response) ─────────────────────────────────────────

/** App factory posture: whether the tenant has minted-app credentials stored. */
export const SlackFactoryStatus = z
	.object({ configured: z.boolean() })
	.meta({ id: "SlackFactoryStatus" });

/**
 * The tenant's Slack posture, as `tenantStatus` builds it. `configured`,
 * `factory`, and `oauth_redirect_url` are always emitted; the shared-app
 * details (`bot_user_id`, `team_id`, `events_url`, `oauth_ready`) only appear
 * once a shared app is configured, and `return_url` only when one is set.
 */
export const SlackAppOut = z
	.object({
		configured: z.boolean(),
		bot_user_id: z.string().optional(),
		team_id: z.string().optional(),
		events_url: z.string().optional(),
		/** Shared app's OAuth client is set — "Add to Slack" installs work. */
		oauth_ready: z.boolean().optional(),
		oauth_redirect_url: z.string().optional(),
		/** Where the OAuth redirect sends installers back (?slack=… appended). */
		return_url: z.string().optional(),
		/** App factory: mints per-smith Slack apps from the manifest template. */
		factory: SlackFactoryStatus.optional(),
	})
	.meta({ id: "SlackAppOut" });

// ── Request bodies (PUT /v1/tenant/slack) ────────────────────────────────────

/**
 * The app-factory block: a delegated app-config token pair plus the Slack app
 * manifest template that minted per-smith apps are instantiated from.
 */
export const SlackFactoryIn = z
	.object({
		config_token: z.string(),
		config_refresh_token: z.string().nullish(),
		manifest_template: z.record(z.string(), z.unknown()),
	})
	.meta({ id: "SlackFactoryIn" });

/**
 * Register or rotate the tenant's Slack posture: a shared app (bot_token +
 * signing_secret, optionally the OAuth client fields), a factory block, and/or
 * the return_url. Every field is optional — the handler applies whichever
 * blocks are present.
 */
export const SlackAppIn = z
	.object({
		bot_token: z.string().nullish(),
		signing_secret: z.string().nullish(),
		client_id: z.string().nullish(),
		client_secret: z.string().nullish(),
		oauth_scopes: z.string().nullish(),
		oauth_user_scopes: z.string().nullish(),
		return_url: z.string().nullish(),
		factory: SlackFactoryIn.nullish(),
	})
	.meta({ id: "SlackAppIn" });

// ── Inferred consumer-facing type (re-exported by ../responses) ──────────────

export type ICSlackApp = z.infer<typeof SlackAppOut>;
