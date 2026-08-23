# @ingram-cloud/flue

Drive an [Ingram Cloud](https://cloud.ingram.tech) smith from a
[Flue](https://flueframework.com) agent. A thin, idiomatic extension of Flue:
register a smith as a model **provider**, attach Ingram-hosted **tools** over
MCP, and resolve **approvals** — each over an industry-standard surface, no
bespoke protocol.

## Philosophy: stand on the standard

This package adds no proprietary client. The provider rides Flue's built-in
`openai-completions` wire protocol pointed at Ingram Cloud's
[OpenAI-compatible API](https://cloud.ingram.tech/docs/openai-compat); tools ride
[MCP](https://cloud.ingram.tech/docs/tools); approvals ride the **standard
tool-call channel**. A smith still runs the agent loop server-side — memory,
tools, approvals, isolation — but to Flue it looks like any model.

## Install

```bash
npm install @ingram-cloud/flue
```

`@flue/runtime` (v2) is a **peer dependency** — you already have it in a Flue
app. It must stay a peer: `setProvider()` writes to a module-scoped registry,
so the adapter and your app have to share one instance.

## Provider: a smith as your model

Register once in `src/app.ts`, before routing — exactly like any other Flue
provider. Flue 2 resolves model ids against the provider's declared list, so
name every model you plan to use:

```ts
import { registerIngramCloud } from "@ingram-cloud/flue";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { Triage } from "./agents/triage.js";

// A per-smith token names exactly one smith; the agent is the one that smith runs.
export const ingram = registerIngramCloud({
	apiKey: process.env.IC_SMITH_TOKEN!,
	models: { "gpt-5.6-sol": {} },
});

const app = new Hono();
app.route("/agents/triage", createAgentRouter(Triage));
export default app;
```

Then point an agent at it:

```ts
// agents/triage.ts
"use agent";
import { useModel } from "@flue/runtime";
import { ingram } from "../app.js";

export function Triage() {
	useModel(ingram.model("gpt-5.6-sol"));
	return "Triage the incoming request.";
}
```

### The model id is the LLM, not the agent

The agent a smith runs — its instructions, tools, and memory — is resolved from
the smith, **never** from the model id. The model id is the upstream inference
LLM for the turn (`ingram.model("gpt-5.6-sol")` runs the smith's agent on GPT-5.6 Sol).

Unlike the raw OpenAI-compatible surface, **Flue requires a non-empty model id**
(`provider/model`), so there is no "use the agent's configured model" form here —
name the model you want. `ingram.model("")` throws to make that explicit.

Server-side with a tenant-admin token instead of a smith token? Name the smith:

```ts
const ingram = registerIngramCloud({
	apiKey: process.env.IC_TENANT_TOKEN!,
	smithId: "smt_…",
});
```

Never ship a tenant-admin token to the browser.

## Tools: Ingram-hosted MCP

Expose an Ingram Cloud deployment of `kind: "mcp"` as Flue tools. Mount the
definition with `useMcpConnection()`:

```ts
import { defineIngramMcp } from "@ingram-cloud/flue";
import { useMcpConnection, useModel } from "@flue/runtime";

const ingramMcp = defineIngramMcp({
	apiKey: process.env.IC_SMITH_TOKEN!,
	deploymentId: "dep_…",
});

export function Assistant() {
	useModel(ingram.model("gpt-5.6-sol"));
	useMcpConnection(ingramMcp); // tools named mcp__ingram__<tool>
	return instructions;
}
```

Tools arrive as ordinary Flue tools, so they compose with native tools, skills,
and the sandbox. Outside an agent render (trusted application code, Node target
only), `connectIngramMcp(settings)` connects now and returns `{ tools, close }`.

## Approvals (human-in-the-loop)

A smith tool marked `destructiveHint` pauses the run for approval. On this
surface the pause arrives as a tool call whose id is `"<run_id>::<tool_call_id>"`
and the turn ends with `finish_reason: "tool_calls"`. The helpers are pure and
also live at `@ingram-cloud/flue/approvals`:

```ts
import { getApprovalRequests, approvalWireMessage } from "@ingram-cloud/flue";

// `toolCalls` from the model response (composite ids are Ingram approvals).
const approvals = getApprovalRequests(toolCalls);
for (const a of approvals) {
	const decision = (await askTheHuman(a)) ? "approve" : "reject";
	// Send this `tool` message back as the next turn to resume the paused run:
	sendNextTurn(approvalWireMessage(a, decision));
}
```

On `approve`, Ingram Cloud executes the tool itself and continues; on `reject`,
the run completes with `stop_reason: "approval_rejected"` and nothing runs.

## Identity & tokens

| Token                                    | Use                       | How the smith is chosen                |
| ---------------------------------------- | ------------------------- | -------------------------------------- |
| Smith token (`sub = "<tenant>:<smith>"`) | browser-safe; the default | the token _is_ the smith               |
| Tenant-admin token                       | server-side only          | pass `smithId` (sent as `IC-Smith-Id`) |

## Notes

- **ESM-only**, ships as `dist/`. Build with `npm run build` (plain `tsc`).
- Independent of the API's api/web checks, like the `pulumi/` and
  `ai-sdk/` packages. Keep it in step when the OpenAI-compatible / MCP
  surfaces it wraps change.
- For the same product over the Vercel AI SDK, see
  [`@ingram-cloud/ai-sdk`](https://www.npmjs.com/package/@ingram-cloud/ai-sdk).
