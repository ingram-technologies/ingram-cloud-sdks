# @ingram-cloud/ai-sdk

Drive an [Ingram Cloud](https://cloud.ingram.tech) smith from the
[Vercel AI SDK](https://ai-sdk.dev). It is a thin, idiomatic extension of the AI
SDK: a pre-configured provider plus small helpers for the few things Ingram
Cloud adds on top — smith identity, server-side memory, and human-in-the-loop
approvals.

## Philosophy: stand on the standard

This package is deliberately **not** a bespoke protocol client. The main entry
point is `@ai-sdk/openai`'s Responses model pointed at Ingram Cloud's
[Responses API](https://cloud.ingram.tech/docs/openai-compat), so your app
speaks the OpenAI Responses wire format end-to-end and the smith's full agentic
turn arrives as **standard AI SDK parts**: text, the agent's server-executed
tool calls (`tool-call`/`tool-result`), and approval pauses
(`tool-approval-request`). Memory rides a single request header. There is no
custom SSE envelope to parse and no `streamText` replacement to learn.

A smith still runs the agent loop server-side (that's the whole point — memory,
tools, approvals, isolation), but from your code it looks like any other model.

> The native run envelope (`/v1/smiths/{id}/runs`) is available behind the opt-in
> [`/native`](#native-fallback) subpath for the one thing the standard parts
> don't carry — the in-flight `tool.executing` frame the moment a tool starts.
> Prefer the standard provider.

## Install

```bash
npm install @ingram-cloud/ai-sdk ai
```

`ai` (v7+) is a peer dependency — you already have it. `@ai-sdk/react` is only
needed for the [client helpers](#client-usechat).

## Quickstart

### Server (`streamText`, `generateText`, agents)

```ts
import { createIngramCloud } from "@ingram-cloud/ai-sdk";
import { streamText } from "ai";

// A per-smith token names exactly one smith; the agent is the one that smith runs.
// The model id is the inference LLM: "" uses the agent's configured model, or pass
// a model id (e.g. "gpt-5.6-sol") to override the LLM for that call.
const ingram = createIngramCloud({ apiKey: process.env.IC_SMITH_TOKEN! });

const result = streamText({
	model: ingram(""),
	prompt: "How do I reset my password?",
});

for await (const delta of result.textStream) process.stdout.write(delta);
```

Server-side with a tenant-admin token instead? Name the smith explicitly:

```ts
const ingram = createIngramCloud({
	apiKey: process.env.IC_TENANT_TOKEN!,
	smithId: "smt_…",
});
```

Never ship a tenant-admin token to the browser — proxy through your backend.

### Server-side tool steps

When the agent's own MCP tools run inside a turn, each call reaches the stream
as a `tool-call` part (named `mcp.<tool>`, marked `providerExecuted`) followed
by a `tool-result` part, slotted between the text runs — a multi-step turn
arrives as steps, not one unbroken text run:

```ts
for await (const part of result.fullStream) {
	if (part.type === "tool-call") showStep(part.toolName, part.input);
	if (part.type === "tool-result") completeStep(part.toolCallId);
	if (part.type === "text-delta") appendText(part.text);
}
```

In a `useChat` UI the same parts arrive as tool invocations on the message — no
extra wiring.

### Client (`useChat`)

The recommended shape is a proxy route: the browser talks to your `/api/chat`
route, which holds the token and runs `createIngramCloud`. The client is plain AI
SDK:

```tsx
"use client";
import { useChat } from "@ai-sdk/react";
import { ingramCloudTransport, approvalsSettled } from "@ingram-cloud/ai-sdk/react";

export function Chat() {
	const { messages, sendMessage } = useChat({
		transport: ingramCloudTransport({ api: "/api/chat" }),
		// auto-resume a turn once every approval has a decision
		sendAutomaticallyWhen: approvalsSettled,
	});
	// …render messages, call sendMessage(...)
}
```

## Memory: one header

A stateless call sends the whole context each turn. Pass a `threadId` and Ingram
Cloud holds the conversation server-side (the same thread model as a native
run): you send only the new turn, and
[memory](https://cloud.ingram.tech/docs/memory) works. This holds with
client-side `tools` too — the thread replays the prior turns, tool-call linkage
included. Use a `cnv_`
[conversation](https://cloud.ingram.tech/docs/conversations) id as the `threadId`
and the chat's transcript accrues on the conversation.

```ts
const ingram = createIngramCloud({
	apiKey: SMITH_TOKEN,
	threadId: `chat_${conversationId}`, // sent as IC-Thread-Id
});
```

## Structured outputs (`generateObject`)

`generateObject` sends your schema as a strict `text.format` and Ingram Cloud
enforces it — conforming JSON or an error, never a best-effort guess:

```ts
import { generateObject } from "ai";
import { z } from "zod";

const { object } = await generateObject({
	model: ingram(""),
	schema: z.object({
		invoice_number: z.string().nullable(),
		total: z.number().nullable(),
	}),
	prompt: "Invoice #A-1, total 100 EUR.",
});
```

The schema'd call is a stateless one-shot (no tools, no memory) — use a provider
**without** `threadId` for it; a `threadId` provider is rejected with a `400`.

## Approvals (human-in-the-loop)

A tool the agent marks `destructiveHint` pauses the run for approval. The pause
arrives as a standard `tool-approval-request` content part whose `approvalId` is
`"<run_id>::<tool_call_id>"`. Pull the pending approvals off the result and
resume by appending a decision:

```ts
import {
	createIngramCloud,
	getApprovalRequests,
	approvalResponseMessage,
} from "@ingram-cloud/ai-sdk";
import { generateText } from "ai";

const ingram = createIngramCloud({ apiKey: SMITH_TOKEN, threadId });
const first = await generateText({ model: ingram(""), messages });

const approvals = getApprovalRequests(first.content);
if (approvals.length) {
	const decided = await askTheHuman(approvals); // your UI/policy
	const resumed = await generateText({
		model: ingram(""),
		messages: [
			...messages,
			...first.response.messages,
			...decided.map((a) =>
				approvalResponseMessage(a.request, a.ok ? "approve" : "reject"),
			),
		],
	});
}
```

On `approve`, Ingram Cloud executes the tool itself and continues — the executed
call arrives as a `tool-result` part like any other server-side step; on
`reject`, the run completes with `stop_reason: "approval_rejected"` and nothing
runs. Calling `/v1/responses` directly without AI SDK message conversion? Use
`approvalWireItem(id, "approve")` to build the raw `mcp_approval_response`
input item.

## Tools

Two models, both standard — pick per use case:

- **Client-side tools (you run them).** Define tools with the AI SDK's `tool()` and
  pass them to `streamText`/`generateText` as with any provider. The model's calls
  come back for **you** to execute; the SDK loops by re-sending the conversation.
  Ingram Cloud executes nothing — the standard OpenAI function-call contract, no
  Ingram-specific setup.

    ```ts
    import { tool } from "ai";
    import { z } from "zod";

    const result = streamText({
    	model: ingram(""),
    	messages,
    	tools: {
    		get_weather: tool({
    			description: "…",
    			inputSchema: z.object({ city: z.string() }),
    		}),
    	},
    });
    ```

    A turn that passes `tools` runs only those client tools (the agent still supplies
    instructions; its server-side MCP tools sit out that turn). Memory composes: with
    a `threadId` the loop is stateful and you send only the new turn.

- **Server-side tools (MCP).** Ingram Cloud calls your MCP server and runs the tools
  for you, with approval gating. Don't pass `tools` — register the MCP server once
  and it's available to the smith automatically. Every call is visible on the
  stream (see [Server-side tool steps](#server-side-tool-steps)). For
  shared/remote tools.

## Identity & tokens

| Token                                    | Use                       | How the smith is chosen                |
| ---------------------------------------- | ------------------------- | -------------------------------------- |
| Smith token (`sub = "<tenant>:<smith>"`) | browser-safe; the default | the token _is_ the smith               |
| Tenant-admin token                       | server-side only          | pass `smithId` (sent as `IC-Smith-Id`) |

The agent is the one the smith runs — chosen by the smith, never by an argument.
The `model` argument is the upstream inference LLM: `""` uses the agent's configured
model; a model id (e.g. `gpt-5.6-sol`) overrides the LLM for that call.

## Native fallback

`@ingram-cloud/ai-sdk/native` parses Ingram Cloud's native SSE envelope
into an AI SDK UI message stream. Reach for it only when you need the native
extras the standard parts don't carry — chiefly the in-flight `tool.executing`
frame the moment a tool starts:

```ts
import { pipeIngramCloudRun } from "@ingram-cloud/ai-sdk/native";

const result = await pipeIngramCloudRun(icResponse, writer, {
	onToolActivity: ({ tool, phase }) => console.log(tool, phase),
	onApproval: (req) => surface(req),
});
// result.status: "completed" | "paused" | "failed" | "cancelled" | "unknown"
```

`"unknown"` means the stream closed without saying how the run ended — treat the
text as partial and read the run record. `result.warnings` is set when a
`completed` turn answered without a tool source or a skill it needed: the answer
is shaped exactly like a healthy one, so this is the only way to tell.

## Notes

- **ESM-only**, ships as `dist/`. Build with `npm run build` (plain `tsc`).
- Independent of the API's api/web checks, like the `pulumi/` package. Keep it
  in step when the Responses surface it wraps changes.
- This is the seed of the official Ingram Cloud JavaScript SDK; the intended
  long-term home is `@ai-sdk/ingram-cloud`.
