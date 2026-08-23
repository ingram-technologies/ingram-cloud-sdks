# @ingram-cloud/pulumi

Pulumi dynamic resources for the [Ingram Cloud](https://cloud.ingram.tech) `/v1`
API. Declare your tenant's IC configuration — agents, MCP servers, integrations,
webhooks, BYOK model keys — as Pulumi resources instead of imperative
`register-*.ts` / `ensure-agent.ts` scripts, so it lives in state and a change
is a `pulumi up`.

The library is published alongside the Ingram Cloud `/v1` API so the wrapper
tracks the surface it wraps. The API version it targets is pinned per library
version (`IC_API_VERSION`).

## Install

```bash
bun add @ingram-cloud/pulumi @pulumi/pulumi
```

## How the repos interact

```
cloud.ingram.tech/pulumi/   THIS LIBRARY — knows nothing about any consumer
                            (Agent, McpServer, TelegramBot, WhatsAppConfig,
                             Webhook, ModelKey, Secret)

app repos (thornhill, …)    declare their AGENTS — the `instructions` are
                            app-owned content (prompts), so they stay in the app
                            repo, sourced from the app's own spec module. The app's
                            Pulumi program imports this library + those specs.

infra repo (~/src/infra)    declares tenant INTEGRATION config (MCP, Telegram, WhatsApp,
                            webhook, model keys) alongside DNS/DB/Vercel, and can
                            read an app stack's outputs via pulumi.StackReference to
                            push IC-derived values (agent ids, webhook secret)
                            into Vercel env. No prompts ever live here.
```

The hard rule: **prompts never leave the app repo.** This library carries no
content; it only carries the machinery.

## Connection

Every resource takes `baseUrl` + `token` (the tenant-admin bearer; `IcProject` /
`IcProjectToken` take an **organization** key instead — see below). Resolve them
once with `connectionFromConfig()` and spread:

```ts
import * as ic from "@ingram-cloud/pulumi";

const conn = ic.connectionFromConfig(); // ingram-cloud:token (secret) / :baseUrl
// or env INGRAM_CLOUD_TOKEN|CLOUD_API_KEY
```

Set the token as a stack secret:

```bash
pulumi config set --secret ingram-cloud:token tha_live_…
```

## Resources

### IcAgent (declare in the APP repo)

Create-or-adopt by **`slug`** → publish a new immutable version **only when the
content changed** → roll it out. Mirrors the old `ensure-agent.ts` idempotency, so
the first `pulumi up` after switching from a script **adopts** the existing agent
(matched by slug) rather than recreating it.

`slug` is the immutable reconcile key; it defaults to the Pulumi resource name
(here `"curator"`), so existing stacks keep adopting the same agent. `name` is a
free display label you can rename without churning the agent. Changing `slug`
replaces it.

```ts
import { AGENT_SPECS } from "../src/lib/cloud/agent-spec"; // app-owned

const curator = new ic.IcAgent("curator", {
	...conn,
	// slug defaults to "curator"; pass `slug` to decouple the key from the name.
	name: AGENT_SPECS.curator.name, // display label, freely renamable
	instructions: AGENT_SPECS.curator.instructions,
	model: AGENT_SPECS.curator.model,
	autoMemory: AGENT_SPECS.curator.auto_memory,
	// memoryConsolidation: true,  // opt into background consolidation (billed)
	// variables: [...], enabledHostedTools: [...], rolloutPercent: 100,
	// mcpServers: ["sheets"],  // scope runs to these registered MCP servers (omit = all)
});

export const curatorAgentId = curator.agentId;
```

**MCP Apps UI templates.** Pass `uiTemplates` to attach interactive HTML bundles
(MCP Apps, SEP-1865). Each template's bytes upload when they (or the metadata)
change, and its name + content hash + `tool`/`csp`/`permissions` fold into the
content signature — so a template edit publishes and rolls out a new version like
an instruction change. Provide the HTML as an absolute `htmlPath` or inline
`html`; a `tool` binds it as a typed app-tool. Dropping a template from the array
deletes it from the draft.

```ts
import { join } from "node:path";

const bookkeeper = new ic.IcAgent("bookkeeper", {
	...conn,
	instructions: BOOKKEEPER_INSTRUCTIONS,
	uiTemplates: [
		{
			name: "cash_chart",
			htmlPath: join(__dirname, "ui/cash-chart.html"),
			tool: {
				description: "Show an interactive cash-flow chart.",
				input_schema: { type: "object", properties: {}, required: [] },
				instruction:
					"Call get_cash_flow_history, then render_app with template cash_chart.",
				mutating: false,
			},
		},
	],
});
```

> Attaching **existing** smiths to a agent is a one-time fleet backfill —
> keep it as the app's migration script. New smiths attach at birth in app code.
> Pulumi does not own per-smith runtime state.

### IcWebPage (declare in the APP repo)

A **hosted page** — a private, shareable web page that runs an agent (a `web`
deployment). Each visitor gets their own smith; the 128-bit `dep_` id in the URL is
the privacy boundary, with an optional shared `password` on top. Point it at an
`IcAgent` and read back `pageUrl` — the link to hand out.

```ts
const page = new ic.IcWebPage("docs-page", {
	...conn,
	agentId: curator.agentId,
	title: "Ingram Cloud docs assistant",
	greeting: "Ask me anything about Ingram Cloud.",
	// password: "optional-shared-secret",
});

export const pageUrl = page.pageUrl; // https://cloud.ingram.tech/hosted/dep_…
```

> The API has no update path for a web deployment's title/greeting/password, so a
> change to any of those (or to `agentId`) **replaces** the page and mints a fresh
> `pageUrl`. The agent's instructions change on the `IcAgent`, not here.

### IcSkill (declare in the APP repo)

An [Agent Skills](https://cloud.ingram.tech/docs/skills) bundle: a folder
anchored by `SKILL.md`, uploaded whole and versioned server-side. Declared by
**local directory** — the folder is the unit — like `IcAgent`'s `uiTemplates`
and the vector-store-shaped file attachments elsewhere in this pattern. The
bytes are read at `pulumi up`; any edit inside the folder publishes a new
immutable version and moves `default_version` to it, because a version is
immutable and nothing resolving by default would otherwise see the change.

```ts
// The folder is the unit. Its basename is the skill's name, and any edit
// inside it publishes a new immutable version and moves the default.
const vatFiling = new ic.IcSkill("vat-filing", {
	...conn,
	path: join(__dirname, "skills/vat-filing"),
});

// Put it in front of a fleet. Order matters: a run that fills its search index
// keeps the earlier entries and drops the rest.
const biller = new ic.IcAgent("biller", {
	...conn,
	instructions: AGENT_SPECS.biller.instructions,
	skills: [{ skill_id: vatFiling.skillId }],
	// A skill's scripts/ only run through the run_command hosted tool.
	enabledHostedTools: ["run_command"],
});
```

### IcMcpServer, IcOauthProvider, IcTelegramBot, IcWhatsAppConfig, IcEmail, IcWebhook, IcModelKey (declare in INFRA)

```ts
// Your own server (raw URL).
new ic.IcMcpServer("thornhill-mcp", {
	...conn,
	serverName: "thornhill",
	url: `${APP_URL}/api/mcp`,
	authKind: "bearer",
	secret: mcpSecret,
});

// The tool list is discovered at create, not on every `pulumi up` — nothing in
// this stack changes when your *server's* tools do, so `toolsDiscovered` is what
// was true at registration. Ingram Cloud re-discovers on the run path once a
// manifest is an hour old; call `POST /v1/tenant/mcp/{serverName}/refresh` at the
// end of a deploy that changed your tools if an hour is too long to wait.

// An `oauth`-kind server forwards each end-user's own stored token; its
// provider record tells IC how tokens refresh. Webhook-delegation mode (a
// refreshWebhook and NO clientSecret): IC POSTs { connection_id } to the
// tenant near expiry and the tenant PATCHes a fresh pair back — the tenant
// owns the token format entirely.
new ic.IcMcpServer("thornhill-user-mcp", {
	...conn,
	serverName: "thornhill-user",
	url: `${APP_URL}/api/user-mcp`,
	authKind: "oauth",
	authProvider: "thornhill",
});
new ic.IcOauthProvider("thornhill-provider", {
	...conn,
	provider: "thornhill",
	refreshWebhook: `${APP_URL}/api/ic/refresh`,
});

// A curated third party: stamp from the catalog, gate which tools run, and
// require human approval on the scary ones. Per-smith OAuth tokens are NOT
// declared here — the runtime collects each end-user's identity (the hosted
// connect flow vaults it). `clientMode: "platform"` uses Ingram's OAuth client.
new ic.IcMcpServer("stripe", {
	...conn,
	serverName: "stripe",
	catalog: "stripe",
	toolAllowlist: ["get_balance", "list_charges", "create_refund"],
	approvalPolicy: [{ match: "create_refund" }],
});

new ic.IcTelegramBot("thornhill-telegram", { ...conn, botToken });

// The agent's own email channel (BYO-Cloudflare transport). IC returns the
// inbound HMAC once — it becomes a secret output you flow into the inbound worker.
const email = new ic.IcEmail("thornhill-email", {
	...conn,
	cloudflareAccountId,
	cloudflareApiToken,
	fromDomain: "mail.thornhill.app",
});
export const inboundEmailSecret = email.inboundSecret; // create-time secret output

const hook = new ic.IcWebhook("thornhill-events", {
	...conn,
	url: `${APP_URL}/api/ic/events`,
	events: ["run.completed", "approval.required" /* … */],
});
export const webhookSigningSecret = hook.secret; // whsec_… (create-only secret output)

new ic.IcModelKey("anthropic", { ...conn, provider: "anthropic", apiKey });
```

`IcWebhook.secret` is the `whsec_…` signing secret IC returns exactly once — it
becomes a secret Pulumi output, so the infra stack can flow it straight into Vercel
env with no copy-paste.

### IcProject + IcProjectToken (declare in the PLATFORM stack)

The tier **above** a project. These take an **organization key**
(`organization:*`, your account master key) — not a project token. Hand it to a
platform stack and it provisions projects and mints each one a project-scoped
`tenant:*` token, which you drop straight into that app's env. The org key reads
no run, memory, or smith itself; only the project tokens it mints can.

```ts
// In the PLATFORM stack, `ingram-cloud:token` is your ORGANIZATION key.
const project = new ic.IcProject("thornhill", { ...conn }); // adopt-by-name
const icToken = new ic.IcProjectToken("thornhill-admin", {
	...conn,
	project: project.projectId, // the project id == the tenant
});

// Flow the minted tenant token straight into the app's runtime env:
new vercel.ProjectEnvironmentVariable("th-ic-token", {
	projectId: thornhillVercelId,
	key: "INGRAM_CLOUD_TOKEN",
	value: icToken.projectToken, // secret tenant:* token
	targets: ["production"],
});
export const thornhillProjectId = project.projectId;
```

`IcProject` adopts an existing project by `projectName` (defaults to the resource
name), so re-runs reconcile. `IcProjectToken.projectToken` is a secret output; it
re-mints on any change and revokes on destroy.

## Importing resources a script already created

Agents and webhooks implement `read`, so you can adopt pre-existing ones:

```bash
pulumi import 'ingram-cloud:index:IcAgent' curator agt_123…
```

(Agents also self-adopt by slug on first `create`, so an explicit import is
usually unnecessary — a plain `pulumi up` will reconcile the live agent.)

## Notes

- Built as CommonJS to match the Pulumi Node.js runtime and the infra stack's
  `module: commonjs` tsconfig.
- `token` and every credential input are marked `additionalSecretOutputs`, so they
  are encrypted in Pulumi state.
- CRUD runs inline in the Pulumi process over the global `fetch` (Node ≥18).
- `read` treats a server-side **404 as "gone"** (returns an empty id) so
  `pulumi refresh` prunes a resource deleted out-of-band — e.g. after an IC DB
  reset, `pulumi refresh && pulumi up` recreates it, no `pulumi state delete`.
  Non-404 errors still throw, so a transient API blip can't drop it from state.
- `IcMcpServer` `read` also round-trips the live `url` / `authKind` /
  `authProvider` (raw registrations only — catalog presets supply these
  server-side), so `pulumi refresh && pulumi up` detects and repairs server-side
  drift such as a lost auth block. Write-only fields (`secret`) can't round-trip
  and stay diff-by-state. Dynamic providers run the code serialized into state,
  so drift detection starts after the first `pulumi up` with this version.
