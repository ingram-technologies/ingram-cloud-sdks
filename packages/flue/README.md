# @ingram-cloud/flue

Run an [Ingram Cloud](https://cloud.ingram.tech) smith from a
[Flue](https://flueframework.com) agent. The package provides three things:

- `registerIngramCloud()`: a smith as a Flue model provider, over Flue's
  built-in `openai-completions` wire protocol pointed at Ingram Cloud's
  [OpenAI-compatible API](https://cloud.ingram.tech/docs/openai-compat).
- `defineIngramMcp()` / `connectIngramMcp()`: an Ingram-hosted
  [MCP](https://cloud.ingram.tech/docs/tools) deployment as Flue tools.
- Approval helpers for the standard tool-call channel.

The smith runs its agent loop server-side (memory, tools, approvals,
isolation). To Flue it is a model.

## Install

```bash
npm install @ingram-cloud/flue
```

`@flue/runtime` (v2) is a peer dependency and must stay one: `setProvider()`
writes to a module-scoped registry, so the adapter and your app have to share
one instance.

## Provider

Register once in `src/app.ts`, before routing. Flue 2 resolves model ids
against the provider's declared list, so name every model you plan to use:

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

The agent a smith runs (instructions, tools, memory) is resolved from the
smith, never from the model id. The model id is the upstream inference LLM for
the turn: `ingram.model("gpt-5.6-sol")` runs the smith's agent on GPT-5.6 Sol.

Flue requires a non-empty model id (`provider/model`), so unlike the raw
OpenAI-compatible surface there is no "use the smith's configured model" form.
`ingram.model("")` throws.

With a tenant-admin token, name the smith:

```ts
const ingram = registerIngramCloud({
	apiKey: process.env.IC_TENANT_TOKEN!,
	smithId: "smt_…",
});
```

Never ship a tenant-admin token to the browser.

## Tools

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

The tools are ordinary Flue tools. Outside an agent render (trusted application
code, Node target only), `connectIngramMcp(settings)` connects immediately and
returns `{ tools, close }`.

## Approvals

A smith tool marked `destructiveHint` pauses the run for approval. On this
surface the pause arrives as a tool call whose id is `"<run_id>::<tool_call_id>"`,
and the turn ends with `finish_reason: "tool_calls"`. The helpers also live at
`@ingram-cloud/flue/approvals`:

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

On `approve`, Ingram Cloud executes the tool and continues; on `reject`, the run
completes with `stop_reason: "approval_rejected"` and nothing runs.

## Identity and tokens

| Token                                    | Use                       | How the smith is chosen                |
| ---------------------------------------- | ------------------------- | -------------------------------------- |
| Smith token (`sub = "<tenant>:<smith>"`) | browser-safe; the default | the token _is_ the smith               |
| Tenant-admin token                       | server-side only          | pass `smithId` (sent as `IC-Smith-Id`) |

## Notes

- ESM-only, ships as `dist/`. Build with `npm run build` (plain `tsc`).
- For the Vercel AI SDK, use
  [`@ingram-cloud/ai-sdk`](https://www.npmjs.com/package/@ingram-cloud/ai-sdk).
