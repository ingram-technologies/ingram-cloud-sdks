/**
 * Hand-authored Zod schemas for the `tenant` config plane — the grab-bag router
 * (`api/src/routes/tenant.ts`) serving the events feed, hosted-tool catalog,
 * BYOK model keys, the model catalog, OAuth client providers, minted tokens, the
 * usage summary, and webhooks.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";
import { Actor } from "./_actor.js";
import { pageOut } from "./_page.js";

// ── Events (poll mirror of the webhook firehose) ─────────────────────────────

/** One event in the `/v1/events` feed — the `{v:1}` envelope (sans `tenant_id`,
 *  which the feed omits since the tenant is implicit in the token). */
export const EventOut = z
	.object({
		/** Envelope schema version (always `1` today). */
		v: z.number().int(),
		id: z.string(),
		type: z.string(),
		smith_id: z.string().nullable(),
		data: z.record(z.string(), z.unknown()),
		/** Who acted. Null on events recorded before attribution shipped. */
		actor: Actor.nullable(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "EventOut" });

export const EventListOut = pageOut(EventOut, "EventListOut");

// ── Webhooks ─────────────────────────────────────────────────────────────────

export const WebhookOut = z
	.object({
		id: z.string(),
		url: z.string(),
		events: z.array(z.string()),
		active: z.boolean(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "WebhookOut" });

export const WebhookListOut = pageOut(WebhookOut, "WebhookListOut");

/** The create response — the signing `secret` is returned EXACTLY ONCE, here. */
export const WebhookCreateOut = z
	.object({
		id: z.string(),
		url: z.string(),
		events: z.array(z.string()),
		active: z.boolean(),
		secret: z.string(),
	})
	.meta({ id: "WebhookCreateOut" });

/** The patch/delete-adjacent ack shape (just the id). */
export const WebhookIdOut = z.object({ id: z.string() }).meta({ id: "WebhookIdOut" });

export const WebhookIn = z
	.object({
		url: z.string(),
		events: z.array(z.string()).default([]),
		active: z.boolean().default(true),
	})
	.meta({ id: "WebhookIn" });

export const WebhookPatch = z
	.object({
		url: z.string().nullish(),
		events: z.array(z.string()).nullish(),
		active: z.boolean().nullish(),
	})
	.meta({ id: "WebhookPatch" });

/** Rotate a webhook's signing secret. `grace_seconds` keeps the outgoing secret
 *  valid for an overlap window (default 24h, 0 = cut over immediately, max 7d);
 *  during it every delivery is signed with both the new and old secret. */
export const WebhookRotateIn = z
	.object({
		grace_seconds: z.number().int().min(0).max(604800).default(86400),
	})
	.meta({ id: "WebhookRotateIn" });

/** The rotate response — the new signing `secret` is returned EXACTLY ONCE, here.
 *  `previous_secret_expires_at` is when the old secret stops being accepted. */
export const WebhookRotateOut = z
	.object({
		id: z.string(),
		secret: z.string(),
		previous_secret_expires_at: z.string().nullable(),
	})
	.meta({ id: "WebhookRotateOut" });

/** One persisted delivery attempt record for a webhook — the audit trail behind
 *  durable, retried delivery. `status` is `pending` | `succeeded` | `dead`. */
export const WebhookDeliveryOut = z
	.object({
		id: z.string(),
		event_id: z.string(),
		event_type: z.string(),
		url: z.string(),
		status: z.string(),
		attempts: z.number(),
		last_status: z.number().nullable(),
		last_error: z.string(),
		next_attempt_at: z.string().nullable(),
		delivered_at: z.string().nullable(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "WebhookDeliveryOut" });

export const WebhookDeliveryListOut = pageOut(
	WebhookDeliveryOut,
	"WebhookDeliveryListOut",
);

/** The redeliver ack — the outcome of the forced re-attempt. */
export const WebhookRedeliverOut = z
	.object({
		delivery_id: z.string(),
		delivered: z.boolean(),
		status: z.number().nullable(),
	})
	.meta({ id: "WebhookRedeliverOut" });

// ── Tokens (mint / list / revoke RS256 JWTs) ─────────────────────────────────

/** A minted-token *summary* — the list/listing shape. The secret `token` is
 *  NEVER echoed here; it only appears in {@link MintedTokenOut} on create. */
export const TokenOut = z
	.object({
		id: z.string(),
		name: z.string().nullable(),
		sub: z.string(),
		scopes: z.array(z.string()),
		prefix: z.string().nullable(),
		created_at: z.string().nullable(),
		expires_at: z.string().nullable(),
		revoked_at: z.string().nullable(),
	})
	.meta({ id: "TokenOut" });

export const TokenListOut = pageOut(TokenOut, "TokenListOut");

/** The create response — carries the secret `token` exactly once. */
export const MintedTokenOut = z
	.object({
		id: z.string(),
		token: z.string(),
		scope: z.string(),
		sub: z.string(),
		scopes: z.array(z.string()),
		expires_at: z.string().nullable(),
	})
	.meta({ id: "MintedTokenOut" });

export const TokenIn = z
	.object({
		scope: z.string().default("smith"),
		smith_id: z.string().nullish(),
		permissions: z.array(z.string()).nullish(),
		// Positive and bounded: `0` used to read as "no expiry" and mint a permanent
		// admin token, and a ttl past year 275760 overflows the `Date` we serialize.
		ttl_seconds: z.number().int().positive().max(315_360_000).nullish(),
		name: z.string().nullish(),
	})
	.meta({ id: "TokenIn" });

// ── Usage (aggregated token usage across the tenant's runs, by day) ──────────

export const UsageOut = z
	.object({
		totals: z.object({
			runs: z.number().int(),
			input_tokens: z.number().int(),
			output_tokens: z.number().int(),
			total_tokens: z.number().int(),
		}),
		series: z.array(
			z.object({
				date: z.string(),
				runs: z.number().int(),
				total_tokens: z.number().int(),
			}),
		),
	})
	.meta({ id: "UsageOut" });

// ── Model catalog + BYOK keys ────────────────────────────────────────────────

/** One selectable model in the `/v1/tenant/models` catalog. */
export const ModelOut = z
	.object({
		id: z.string(),
		provider: z.string(),
		label: z.string(),
		available: z.boolean(),
		/** Whose key a run would use: the tenant's ("byok") or Ingram-hosted ("hosted"). */
		source: z.enum(["byok", "hosted"]).nullish(),
	})
	.meta({ id: "ModelOut" });

/** A runnable backend in the model catalog (NB `base_url` is a *bool flag* — does
 *  the provider accept a base-url override — not a URL). */
export const ModelProviderOut = z
	.object({
		id: z.string(),
		label: z.string(),
		base_url: z.boolean(),
		/** True when Ingram hosts a key for this provider (runnable without a tenant key). */
		hosted: z.boolean().optional(),
	})
	.meta({ id: "ModelProviderOut" });

export const ModelsListOut = z
	.object({
		data: z.array(ModelOut),
		providers: z.array(ModelProviderOut),
	})
	.meta({ id: "ModelsListOut" });

/** A BYOK model key — the `api_key` is NEVER echoed, only its presence. */
export const ModelKeyOut = z
	.object({
		provider: z.string(),
		base_url: z.string().nullable(),
		has_key: z.boolean(),
		updated_at: z.string().nullable(),
	})
	.meta({ id: "ModelKeyOut" });

export const ModelKeyListOut = z
	.object({ data: z.array(ModelKeyOut) })
	.meta({ id: "ModelKeyListOut" });

/** The PUT ack — never echoes the key, only presence + the (non-secret) base_url. */
export const ModelKeyConfiguredOut = z
	.object({
		provider: z.string(),
		configured: z.boolean(),
		base_url: z.string().nullable(),
	})
	.meta({ id: "ModelKeyConfiguredOut" });

export const ModelKeyIn = z
	.object({
		api_key: z.string(),
		base_url: z.string().nullish(),
	})
	.meta({ id: "ModelKeyIn" });

// ── Providers (tenant OAuth client credentials) ──────────────────────────────

/** A provider's OAuth client config — the `client_secret` is NEVER echoed, only
 *  `has_client_secret`. */
export const ProviderOut = z
	.object({
		provider: z.string(),
		client_id: z.string().nullable(),
		token_uri: z.string().nullable(),
		scopes_allowed: z.array(z.string()),
		refresh_webhook: z.string().nullable(),
		authorize_url: z.string().nullable(),
		has_client_secret: z.boolean(),
	})
	.meta({ id: "ProviderOut" });

export const ProviderListOut = z
	.object({ data: z.array(ProviderOut) })
	.meta({ id: "ProviderListOut" });

/** The PUT ack. */
export const ProviderConfiguredOut = z
	.object({
		provider: z.string(),
		configured: z.boolean(),
	})
	.meta({ id: "ProviderConfiguredOut" });

export const ProviderIn = z
	.object({
		client_id: z.string().nullish(),
		client_secret: z.string().nullish(),
		token_uri: z.string().nullish(),
		scopes_allowed: z.array(z.string()).default([]),
		refresh_webhook: z.string().nullish(),
		/** Tenant-hosted connector consent page (#123): the connector OAuth
		 *  authorize endpoint redirects the end-user here (`?request_id=…`)
		 *  instead of rendering the built-in connect-token page. */
		authorize_url: z.string().nullish(),
	})
	.meta({ id: "ProviderIn" });

// ── Delegated connector consent (connector OAuth, #123) ─────────────────────

/** Render data for a tenant-hosted consent page: the pending authorize request
 *  stashed by `GET /oauth/authorize` when the tenant's provider registers an
 *  `authorize_url`. */
export const AuthorizeRequestOut = z
	.object({
		/** `connector`: an MCP host connecting to a deployment (the tenant's page
		 *  completes it naming a smith). `app`: a third-party app linking an
		 *  organization (the console completes it with an organization token; the
		 *  grant's subject is the app's project in that organization). */
		kind: z.enum(["connector", "app"]),
		client_id: z.string(),
		client_name: z.string(),
		/** The scopes the client asked for, space-separated (`app` only). */
		scope: z.string(),
		target_name: z.string(),
		/** '' on an `app` request until it is completed. */
		tenant: z.string(),
		resource: z.string(),
		deployment_id: z.string(),
	})
	.meta({ id: "AuthorizeRequestOut" });

/** Complete the delegated grant server-to-server. A `connector` request names
 *  the smith the end-user authorized; an `app` request carries nothing — the
 *  organization is the token's. */
export const AuthorizeCompleteIn = z
	.object({ smith_id: z.string().nullish() })
	.meta({ id: "AuthorizeCompleteIn" });

/** Where the tenant 302s the browser after completing or declining. */
export const AuthorizeRedirectOut = z
	.object({ redirect_url: z.string() })
	.meta({ id: "AuthorizeRedirectOut" });

// ── Hosted-tool catalog ──────────────────────────────────────────────────────

/** One tool hosted by Ingram Cloud that the catalog advertises. */
export const HostedToolOut = z
	.object({
		name: z.string(),
		description: z.string(),
	})
	.meta({ id: "HostedToolOut" });

export const HostedToolsListOut = z
	.object({ data: z.array(HostedToolOut) })
	.meta({ id: "HostedToolsListOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICEvent = z.infer<typeof EventOut>;
export type ICWebhook = z.infer<typeof WebhookOut>;
export type ICWebhookDelivery = z.infer<typeof WebhookDeliveryOut>;
export type ICToken = z.infer<typeof TokenOut>;
export type ICMintedToken = z.infer<typeof MintedTokenOut>;
export type ICUsage = z.infer<typeof UsageOut>;
export type ICModel = z.infer<typeof ModelOut>;
export type ICModelProvider = z.infer<typeof ModelProviderOut>;
export type ICModelCatalog = z.infer<typeof ModelsListOut>;
export type ICModelKey = z.infer<typeof ModelKeyOut>;
export type ICProvider = z.infer<typeof ProviderOut>;
export type ICAuthorizeRequest = z.infer<typeof AuthorizeRequestOut>;

// ── Sandbox secrets (env a tenant's sandboxes carry) ─────────────────────────

/** One secret by name. The value is NEVER echoed — only that it is set. */
export const SandboxSecretOut = z
	.object({
		name: z.string(),
		updated_at: z.string().nullable(),
	})
	.meta({ id: "SandboxSecretOut" });

export const SandboxSecretListOut = z
	.object({ data: z.array(SandboxSecretOut) })
	.meta({ id: "SandboxSecretListOut" });

export const SandboxSecretIn = z
	.object({ value: z.string() })
	.meta({ id: "SandboxSecretIn" });

export const SandboxSecretConfiguredOut = z
	.object({ name: z.string(), configured: z.boolean() })
	.meta({ id: "SandboxSecretConfiguredOut" });
