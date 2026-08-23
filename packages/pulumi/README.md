# @ingram-cloud/pulumi

Pulumi dynamic resources for the [Ingram Cloud](https://cloud.ingram.tech) `/v1`
API: agents, MCP servers, integrations, webhooks, BYOK model keys and projects,
declared as Pulumi resources and applied with `pulumi up`. Each library version
pins the API version it targets (`IC_API_VERSION`).

## Install

```bash
bun add @ingram-cloud/pulumi @pulumi/pulumi
```

## Where each resource belongs

This library carries no prompts or agent content; `instructions` is an input you
pass. A typical split:

```
app stack        IcAgent, IcWebPage, IcSkill — instructions come from the app's
                 own source.

infra stack      IcMcpServer, IcOauthProvider, IcTelegramBot, IcWhatsAppConfig,
                 IcEmail, IcWebhook, IcModelKey — tenant integration config. It can
                 read the app stack's outputs (agent ids, webhook secret) through
                 pulumi.StackReference and write them to the app's env.

platform stack   IcProject, IcProjectToken — provisions projects and mints their
                 tokens with an organization key.
```

## Connection

Every resource takes `baseUrl` + `token` (the tenant-admin bearer; `IcProject` /
`IcProjectToken` take an organization key instead, see below). Resolve them once
with `connectionFromConfig()` and spread:

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

### IcAgent (app stack)

Creates or adopts an agent by `slug`, publishes a new immutable version only when
the content changed, then rolls it out. The first `pulumi up` adopts an existing
agent with a matching slug rather than recreating it.

`slug` is the reconcile key and defaults to the Pulumi resource name. `name` is a
display label you can change without churning the agent. Changing `slug` replaces
the agent.

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
(MCP Apps, SEP-1865). A template's bytes upload when they or its metadata change.
Its name, content hash and `tool`/`csp`/`permissions` are part of the content
signature, so editing a template publishes and rolls out a new version. Provide
the HTML as an absolute `htmlPath` or inline `html`; `tool` binds it as a typed
app-tool. Removing a template from the array deletes it from the draft.

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

Pulumi does not own per-smith runtime state. New smiths attach to an agent in
app code; attaching existing smiths is a one-time migration, not a resource.

### IcWebPage (app stack)

A hosted page: a private, shareable web page that runs an agent (a `web`
deployment). Each visitor gets their own smith. The 128-bit `dep_` id in the URL
is the access control, with an optional shared `password`. Point it at an
`IcAgent` and read back `pageUrl`.

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

The API has no update path for a web deployment's title, greeting or password,
so changing any of those (or `agentId`) replaces the page and mints a new
`pageUrl`. Instructions change on the `IcAgent`.

### IcSkill (app stack)

An [Agent Skills](https://cloud.ingram.tech/docs/skills) bundle: a folder
anchored by `SKILL.md`, uploaded whole and versioned server-side. Declare it by
local directory. The bytes are read at `pulumi up`; any edit inside the folder
publishes a new immutable version and moves `default_version` to it.

```ts
// The folder is the unit. Its basename is the skill's name, and any edit
// inside it publishes a new immutable version and moves the default.
const vatFiling = new ic.IcSkill("vat-filing", {
	...conn,
	path: join(__dirname, "skills/vat-filing"),
});

// Attach it to an agent. Order matters: a run that fills its search index
// keeps the earlier entries and drops the rest.
const biller = new ic.IcAgent("biller", {
	...conn,
	instructions: AGENT_SPECS.biller.instructions,
	skills: [{ skill_id: vatFiling.skillId }],
	// A skill's scripts/ only run through the run_command hosted tool.
	enabledHostedTools: ["run_command"],
});
```

### IcMcpServer, IcOauthProvider, IcTelegramBot, IcWhatsAppConfig, IcEmail, IcWebhook, IcModelKey (infra stack)

```ts
// Your own server (raw URL).
new ic.IcMcpServer("acme-mcp", {
	...conn,
	serverName: "acme",
	url: `${APP_URL}/api/mcp`,
	authKind: "bearer",
	secret: mcpSecret,
});

// The tool list is discovered at create, not on every `pulumi up`: nothing in
// this stack changes when your server's tools do, so `toolsDiscovered` is what
// was true at registration. Ingram Cloud re-discovers on the run path once a
// manifest is an hour old; call `POST /v1/tenant/mcp/{serverName}/refresh` at the
// end of a deploy that changed your tools if an hour is too long to wait.

// An `oauth`-kind server forwards each end-user's own stored token; its
// provider record tells IC how tokens refresh. Webhook-delegation mode (a
// refreshWebhook and NO clientSecret): IC POSTs { connection_id } to the
// tenant near expiry and the tenant PATCHes a fresh pair back, so the tenant
// owns the token format.
new ic.IcMcpServer("acme-user-mcp", {
	...conn,
	serverName: "acme-user",
	url: `${APP_URL}/api/user-mcp`,
	authKind: "oauth",
	authProvider: "acme",
});
new ic.IcOauthProvider("acme-provider", {
	...conn,
	provider: "acme",
	refreshWebhook: `${APP_URL}/api/ic/refresh`,
});

// A catalog third party: stamp from the catalog, gate which tools run, and
// require human approval on the destructive ones. Per-smith OAuth tokens are
// NOT declared here; the runtime collects each end-user's identity (the hosted
// connect flow vaults it). `clientMode: "platform"` uses Ingram's OAuth client.
new ic.IcMcpServer("stripe", {
	...conn,
	serverName: "stripe",
	catalog: "stripe",
	toolAllowlist: ["get_balance", "list_charges", "create_refund"],
	approvalPolicy: [{ match: "create_refund" }],
});

new ic.IcTelegramBot("acme-telegram", { ...conn, botToken });

// The agent's own email channel (BYO-Cloudflare transport). IC returns the
// inbound HMAC once; it becomes a secret output you flow into the inbound worker.
const email = new ic.IcEmail("acme-email", {
	...conn,
	cloudflareAccountId,
	cloudflareApiToken,
	fromDomain: "mail.acme.example",
});
export const inboundEmailSecret = email.inboundSecret; // create-time secret output

const hook = new ic.IcWebhook("acme-events", {
	...conn,
	url: `${APP_URL}/api/ic/events`,
	events: ["run.completed", "approval.required" /* … */],
});
export const webhookSigningSecret = hook.secret; // whsec_… (create-only secret output)

new ic.IcModelKey("anthropic", { ...conn, provider: "anthropic", apiKey });
```

`IcWebhook.secret` is the `whsec_…` signing secret the API returns once. It is a
secret Pulumi output.

### IcProject + IcProjectToken (platform stack)

These take an organization key (`organization:*`, your account master key), not a
project token. `IcProject` provisions a project; `IcProjectToken` mints it a
project-scoped `tenant:*` token for the app's env. The organization key cannot
read runs, memory or smiths; only the project tokens it mints can.

```ts
// In the PLATFORM stack, `ingram-cloud:token` is your ORGANIZATION key.
const project = new ic.IcProject("acme", { ...conn }); // adopt-by-name
const icToken = new ic.IcProjectToken("acme-admin", {
	...conn,
	project: project.projectId, // the project id == the tenant
});

// Flow the minted tenant token into the app's runtime env:
new vercel.ProjectEnvironmentVariable("acme-ic-token", {
	projectId: acmeVercelId,
	key: "INGRAM_CLOUD_TOKEN",
	value: icToken.projectToken, // secret tenant:* token
	targets: ["production"],
});
export const acmeProjectId = project.projectId;
```

`IcProject` adopts an existing project by `projectName` (defaults to the resource
name). `IcProjectToken.projectToken` is a secret output; it re-mints on any change
and revokes on destroy.

## Importing existing resources

Agents and webhooks implement `read`, so you can import them:

```bash
pulumi import 'ingram-cloud:index:IcAgent' curator agt_123…
```

## Notes

- Built as CommonJS for the Pulumi Node.js runtime.
- `token` and every credential input are `additionalSecretOutputs`, encrypted in
  Pulumi state.
- CRUD runs inline in the Pulumi process over the global `fetch` (Node ≥18).
- `read` treats a server-side 404 as gone (empty id), so `pulumi refresh` prunes a
  resource deleted out-of-band and `pulumi up` recreates it without
  `pulumi state delete`. Other errors throw, so a transient API error cannot drop
  a resource from state.
- `IcMcpServer` `read` round-trips the live `url` / `authKind` / `authProvider`
  (raw registrations only; catalog presets supply these server-side), so
  `pulumi refresh && pulumi up` repairs server-side drift such as a lost auth
  block. Write-only fields (`secret`) cannot round-trip and diff by state.
  Dynamic providers run the code serialized into state, so drift detection starts
  after the first `pulumi up` with this version.
