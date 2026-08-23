# @ingram-cloud/ai-sdk

Drive an [Ingram Cloud](https://cloud.ingram.tech) smith from the
[Vercel AI SDK](https://ai-sdk.dev): a pre-configured provider plus helpers for
what Ingram Cloud adds on top of the AI SDK (smith identity, server-side memory,
human-in-the-loop approvals).

The provider is `@ai-sdk/openai`'s Responses model pointed at Ingram Cloud's
[Responses API](https://cloud.ingram.tech/docs/openai-compat). The smith's turn
arrives as standard AI SDK parts: text, server-executed tool calls
(`tool-call`/`tool-result`), and approval pauses (`tool-approval-request`).
Memory is one request header. The agent loop (memory, tools, approvals,
isolation) runs server-side; to `streamText` the smith is a model.

> The native run envelope (`/v1/smiths/{id}/runs`) is available behind the
> [`/native`](#native-fallback) subpath. It carries one thing the standard parts
> do not: the in-flight `tool.executing` frame when a tool starts.

## Install

```bash
npm install @ingram-cloud/ai-sdk ai
```

`ai` (v7+) is a peer dependency. `@ai-sdk/react` is needed only for the
[client helpers](#client-usechat).

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

With a tenant-admin token, name the smith:

```ts
const ingram = createIngramCloud({
	apiKey: process.env.IC_TENANT_TOKEN!,
	smithId: "smt_…",
});
```

Never ship a tenant-admin token to the browser; proxy through your backend.

### Server-side tool steps

When the agent's MCP tools run inside a turn, each call reaches the stream as a
`tool-call` part (named `mcp.<tool>`, marked `providerExecuted`) followed by a
`tool-result` part, between the text runs:

```ts
for await (const part of result.fullStream) {
	if (part.type === "tool-call") showStep(part.toolName, part.input);
	if (part.type === "tool-result") completeStep(part.toolCallId);
	if (part.type === "text-delta") appendText(part.text);
}
```

In `useChat` the same parts arrive as tool invocations on the message.

### Client (`useChat`)

Use a proxy route: the browser talks to your `/api/chat` route, which holds the
token and runs `createIngramCloud`. The client is plain AI SDK:

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

## Memory

A stateless call sends the whole context each turn. With a `threadId`, Ingram
Cloud holds the conversation server-side (the same thread model as a native
run) and you send only the new turn; see
[memory](https://cloud.ingram.tech/docs/memory). This holds with client-side
`tools` too: the thread replays the prior turns, tool-call linkage included.
Use a `cnv_` [conversation](https://cloud.ingram.tech/docs/conversations) id as
the `threadId` and the transcript accrues on the conversation.

```ts
const ingram = createIngramCloud({
	apiKey: SMITH_TOKEN,
	threadId: `chat_${conversationId}`, // sent as IC-Thread-Id
});
```

## Structured outputs (`generateObject`)

`generateObject` sends your schema as a strict `text.format`. Ingram Cloud
returns conforming JSON or an error:

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

The call is a stateless one-shot with no tools and no memory. Use a provider
without `threadId`; a `threadId` provider is rejected with a `400`.

## Approvals (human-in-the-loop)

A tool the agent marks `destructiveHint` pauses the run for approval. The pause
arrives as a `tool-approval-request` content part whose `approvalId` is
`"<run_id>::<tool_call_id>"`. Pull the pending approvals off the result and
resume by sending a decision:

```ts
import {
	createIngramCloud,
	getApprovalRequests,
	approvalResponseMessages,
} from "@ingram-cloud/ai-sdk";
import { generateText } from "ai";

const ingram = createIngramCloud({ apiKey: SMITH_TOKEN, threadId });
const first = await generateText({ model: ingram(""), messages });

const approvals = getApprovalRequests(first.content);
if (approvals.length) {
	const decided = await askTheHuman(approvals); // your UI/policy
	const resumed = await generateText({
		model: ingram(""),
		messages: decided.flatMap((a) =>
			approvalResponseMessages(a.request, a.ok ? "approve" : "reject"),
		),
	});
}
```

`approvalResponseMessages` returns the assistant turn that raised the approval
plus the `tool-approval-response` — the AI SDK rejects a response whose request
is not in the same `messages` (`AI_InvalidToolApprovalError`). With a
`threadId` those two messages are the whole resume; stateless, put them after
`...messages, ...first.response.messages`. Keep the `IngramApprovalRequest`
(it's plain JSON) between the pause and the decision.

On `approve`, Ingram Cloud executes the tool and continues; the executed call
arrives as a `tool-result` part. On `reject`, the run completes with
`stop_reason: "approval_rejected"` and nothing runs. When calling
`/v1/responses` directly without AI SDK message conversion, use
`approvalWireItem(id, "approve")` to build the raw `mcp_approval_response`
input item.

## Tools

- Client-side tools, run by you. Define tools with the AI SDK's `tool()` and
  pass them to `streamText`/`generateText`. The model's calls come back for you
  to execute; the SDK loops by re-sending the conversation. This is the OpenAI
  function-call contract; Ingram Cloud executes nothing.

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

    A turn that passes `tools` runs only those client tools; the agent still
    supplies instructions, and its server-side MCP tools sit out that turn. With
    a `threadId` the loop is stateful and you send only the new turn.

- Server-side tools, run by Ingram Cloud over MCP, with approval gating. Register
  the MCP server once and the smith has it; don't pass `tools`. Every call is
  visible on the stream (see [Server-side tool steps](#server-side-tool-steps)).

## Identity & tokens

| Token                                    | Use                       | How the smith is chosen                |
| ---------------------------------------- | ------------------------- | -------------------------------------- |
| Smith token (`sub = "<tenant>:<smith>"`) | browser-safe; the default | the token _is_ the smith               |
| Tenant-admin token                       | server-side only          | pass `smithId` (sent as `IC-Smith-Id`) |

The agent is chosen by the smith, not by an argument. The `model` argument is
the inference LLM: `""` uses the agent's configured model; a model id (e.g.
`gpt-5.6-sol`) overrides it for that call.

## Native fallback

`@ingram-cloud/ai-sdk/native` parses Ingram Cloud's native SSE envelope into an
AI SDK UI message stream. Use it for the `tool.executing` frame; the standard
provider covers everything else.

```ts
import { pipeIngramCloudRun } from "@ingram-cloud/ai-sdk/native";

const result = await pipeIngramCloudRun(icResponse, writer, {
	onToolActivity: ({ tool, phase }) => console.log(tool, phase),
	onApproval: (req) => surface(req),
});
// result.status: "completed" | "paused" | "failed" | "cancelled" | "unknown"
```

`"unknown"` means the stream closed without saying how the run ended: treat the
text as partial and read the run record. `result.warnings` is set when a
`completed` turn answered without a tool source or a skill it needed. The
answer is shaped like a healthy one, so the warning is the only signal.

## Notes

- ESM-only, ships as `dist/`. Build with `npm run build` (plain `tsc`).
- The intended long-term home of this package is `@ai-sdk/ingram-cloud`.
