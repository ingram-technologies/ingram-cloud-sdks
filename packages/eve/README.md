# @ingram-cloud/eve

Run an [Ingram Cloud](https://cloud.ingram.tech) smith inside an
[eve](https://vercel.com/eve) agent. The package provides three things:

- `ingramCloudModel()`: a smith as the agent's `model`, a plain AI SDK
  `LanguageModel` over Ingram Cloud's
  [Responses API](https://cloud.ingram.tech/docs/openai-compat). The smith's
  server-executed tool calls arrive as standard `tool-call`/`tool-result` parts.
- `defineIngramMcpConnection()`: an Ingram-hosted
  [MCP](https://cloud.ingram.tech/docs/tools) deployment as an eve connection.
- Approval helpers for the AI SDK's standard approval channel.

The smith runs its agent loop server-side (memory, tools, approvals,
isolation). To eve it is a model.

## Install

```bash
npm install @ingram-cloud/eve
```

`eve` and `ai` are peer dependencies.

## Model

eve's `model` takes an AI SDK `LanguageModel`:

```ts
// agent/agent.ts
import { defineAgent } from "eve";
import { ingramCloudModel } from "@ingram-cloud/eve";

// A per-smith token names exactly one smith; the agent is the one that smith runs.
export default defineAgent({
	model: ingramCloudModel({ apiKey: process.env.IC_SMITH_TOKEN! }),
});
```

eve routes this as an external provider: it bypasses the AI Gateway and talks to
Ingram Cloud directly.

### The model id is the LLM, not the agent

The agent a smith runs (instructions, tools, memory) is resolved from the
smith, never from the model id. `modelId` is the upstream inference LLM for the
turn: omit it to use the smith's configured model, or name one to override it
(`ingramCloudModel({ apiKey, modelId: "gpt-5.6-sol" })`).

`threadId` opts into Ingram Cloud's server-side memory.

With a tenant-admin token, name the smith with `smithId`:

```ts
ingramCloudModel({ apiKey: process.env.IC_TENANT_TOKEN!, smithId: "smt_…" });
```

Never ship a tenant-admin token to the browser.

## Tools

Expose an Ingram Cloud deployment of `kind: "mcp"` as an eve connection. The
filename is the connection name:

```ts
// agent/connections/ingram.ts
import { defineIngramMcpConnection } from "@ingram-cloud/eve";

export default defineIngramMcpConnection({
	apiKey: process.env.IC_SMITH_TOKEN!,
	deploymentId: "dep_…",
	description: "Ingram-hosted tools for this smith.",
});
```

eve discovers the deployment's tools, brokers auth, and hands them to the model;
the token never reaches the model. Gate them with eve's per-connection
`approval` (`never()` / `once()` / `always()` from `eve/tools/approval`) or filter
with `tools: { allow: [...] }`.

Here the eve agent calls Ingram-hosted tools over MCP. With `ingramCloudModel`,
the smith runs its own tools server-side.

## Approvals

A smith tool marked `destructiveHint` pauses its run for approval. The pause
arrives as a standard `tool-approval-request` content part whose `approvalId` is
`"<run_id>::<tool_call_id>"`. The helpers also live at
`@ingram-cloud/eve/approvals`:

```ts
import { getApprovalRequests, approvalResponseMessage } from "@ingram-cloud/eve";

// `content` from the model result (composite approval ids are Ingram's).
const approvals = getApprovalRequests(result.content);
for (const a of approvals) {
	const decision = (await askTheHuman(a)) ? "approve" : "reject";
	// Append this message and run the next turn to resume the paused run.
	messages.push(approvalResponseMessage(a, decision));
}
```

On `approve`, Ingram Cloud executes the tool and continues; on `reject`, the run
completes with `stop_reason: "approval_rejected"` and nothing runs. These are the
smith's server-side approvals, not eve's per-connection `approval` gate.

## Identity and tokens

| Token                                    | Use                       | How the smith is chosen                |
| ---------------------------------------- | ------------------------- | -------------------------------------- |
| Smith token (`sub = "<tenant>:<smith>"`) | browser-safe; the default | the token _is_ the smith               |
| Tenant-admin token                       | server-side only          | pass `smithId` (sent as `IC-Smith-Id`) |

## Notes

- ESM-only, ships as `dist/`. Build with `npm run build` (plain `tsc`).
- Built on
  [`@ingram-cloud/ai-sdk`](https://www.npmjs.com/package/@ingram-cloud/ai-sdk).
  For the raw Vercel AI SDK use that package; for
  [Flue](https://flueframework.com) use
  [`@ingram-cloud/flue`](https://www.npmjs.com/package/@ingram-cloud/flue).
