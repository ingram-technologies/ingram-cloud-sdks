/**
 * Hand-authored Zod schemas for the `deployments` resource — messaging endpoints
 * attached to a smith (Telegram/WhatsApp/Slack/SMS/voice/email).
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 *
 * Two response shapes on purpose: `DeploymentOut` is the plain serializer
 * (`api/src/runtime/deployments.ts::publicDeployment`) returned by GET/list, PATCH,
 * and the email `provision` create. `DeploymentCreatedOut` is the richer create
 * response — the deferred-setup gateways (telegram/whatsapp `start_token`,
 * slack `provision`/`oauth_install`) hand back binding affordances on top of
 * the base shape (`start_token` + `deep_link`, slack's `install_url`/`state`,
 * …). The relic `DeploymentOut` did NOT document these create-only fields; the
 * handler is the truth, so they live here as optionals.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

/** A deployment's target: a fixed `smith` (one running clone) or an `agent`
 *  catch-all that mints a fresh smith per inbound sender. */
export const DeploymentTarget = z
	.object({ type: z.enum(["smith", "agent"]), id: z.string() })
	.meta({ id: "DeploymentTarget" });

/** The connectable channel kinds. The single source for both the request
 *  (`DeploymentIn.kind`) and the response (`DeploymentOut.kind`); the API derives
 *  its accepted-kinds set from these options, so the enum is the discoverable list. */
export const DeploymentKind = z
	.enum([
		"whatsapp",
		"telegram",
		"slack",
		"discord",
		"sms",
		"voice",
		"email",
		"mcp",
		"web",
	])
	.meta({ id: "DeploymentKind" });

export const DeploymentOut = z
	.object({
		id: z.string(),
		target: DeploymentTarget,
		kind: DeploymentKind,
		address: z.string().nullable(),
		provider: z.string().nullable(),
		provider_metadata: z.record(z.string(), z.unknown()).optional(),
		/** Names of the encrypted secret fields that are set (values never returned). */
		secret_keys: z.array(z.string()).optional(),
		/** The connectable MCP endpoint — present only for `kind: "mcp"`. Paste into
		 *  Claude / ChatGPT as the server URL; survives a later GET, not just create. */
		mcp_url: z.string().optional(),
		/** The shareable hosted-page URL — present only for `kind: "web"`. Open in a
		 *  browser to chat with the agent; survives a later GET, not just create. */
		page_url: z.string().optional(),
		status: z.string(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "DeploymentOut" });

export const DeploymentListOut = pageOut(DeploymentOut, "DeploymentListOut");

/**
 * The richer create response. Beyond the base `DeploymentOut`, the setup gateways
 * attach provider-specific binding affordances:
 * - telegram `start_token`: `start_token`, `deep_link` (t.me link).
 * - whatsapp `start_token`: `start_token`, `prefilled_message`, `deep_link` (wa.me link).
 * - slack `provision`/`oauth_install`: `install_url`, `state`, optional `slack_app_id`.
 * - email `provision`: no extras (plain `DeploymentOut`).
 * - mcp: `mcp_url` (on the base `DeploymentOut`, so it also survives a GET).
 * - web: `page_url` (on the base `DeploymentOut`, so it also survives a GET).
 * All are optional — which appear depends on the kind + setup mode.
 */
export const DeploymentCreatedOut = DeploymentOut.extend({
	start_token: z.string().optional(),
	deep_link: z.string().optional(),
	prefilled_message: z.string().optional(),
	install_url: z.string().optional(),
	state: z.string().optional(),
	slack_app_id: z.string().optional(),
}).meta({ id: "DeploymentCreatedOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const DeploymentIn = z
	.object({
		/** Who the deployment binds: a `smith` (fixed) or an `agent` (mints a smith
		 *  per inbound sender). A smith token may only target its own smith. */
		target: DeploymentTarget,
		kind: DeploymentKind,
		address: z.string().nullish(),
		provider: z.string().nullish(),
		provider_metadata: z.record(z.string(), z.unknown()).optional(),
		secrets: z.record(z.string(), z.unknown()).optional(),
		setup: z.record(z.string(), z.unknown()).nullish(),
	})
	.meta({ id: "DeploymentIn" });

export const DeploymentPatch = z
	.object({
		display_name: z.string().nullish(),
		owner_email: z.string().nullish(),
	})
	.meta({ id: "DeploymentPatch" });

// ── Inbound events ───────────────────────────────────────────────────────────

/**
 * One message as it arrived, before anything interpreted it — the immutable
 * ingest record behind every channel-triggered run, in CloudEvents terms
 * (`source` / `type` / `subject` / `data`).
 *
 * It is recorded before resolution, so an event that matched no smith is here
 * too, with `smith_id: ""` — "the webhook fired and nothing happened" is a
 * readable answer, not an absence. `idempotency_key` is the provider's own
 * delivery id (`Message-Id`, `X-GitHub-Delivery`); a re-delivery of the same key
 * records once, so this log is also the dedup ledger. `""` throughout means the
 * source supplied nothing, never "unknown".
 */
export const InboundEventOut = z
	.object({
		id: z.string(),
		/** The channel it arrived on: `email`, `telegram`, `slack`, `whatsapp`, … */
		source: z.string(),
		/** The provider's event name (`email.received`); `""` if it names none. */
		type: z.string(),
		/** The addressed resource — inbox address, channel, repo. */
		subject: z.string(),
		/** The provider's delivery id, and this log's dedup key. */
		idempotency_key: z.string(),
		/** The smith it woke; `""` when the sender resolved to none. */
		smith_id: z.string(),
		/** The provider payload as received. */
		data: z.record(z.string(), z.unknown()),
		created_at: z.string().nullable(),
	})
	.meta({ id: "InboundEventOut" });

export const InboundEventListOut = pageOut(InboundEventOut, "InboundEventListOut");

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICDeployment = z.infer<typeof DeploymentOut>;
export type ICDeploymentCreated = z.infer<typeof DeploymentCreatedOut>;
export type ICInboundEvent = z.infer<typeof InboundEventOut>;
