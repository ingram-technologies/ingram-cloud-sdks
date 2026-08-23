# `@ingram-cloud/sdk`

The Ingram Cloud `/v1` API wire contract in TypeScript — **Zod request/response
schemas + SSE/webhook event types + JSON response types** — plus a typed
**management-plane client** built on it. The schemas are hand-authored and are
the **source of truth for the wire**: the API imports the same schemas to
validate requests and to emit its OpenAPI document, and the `IC*` response
types are inferred from them.

```ts
import { schemas } from "@ingram-cloud/sdk";

// Runtime-validate a request/response body against the contract.
const agent = schemas.AgentIn.parse(input);
```

```ts
import type { ICSmith, ICRun, ICAgent } from "@ingram-cloud/sdk/responses";

// Type a /v1 JSON response — no zod is pulled in.
function render(smith: ICSmith) {
	/* … */
}
```

```ts
import { IngramCloud } from "@ingram-cloud/sdk/client";

// Typed CRUD over the management plane (smiths, agents, tenant config, …).
const ic = new IngramCloud({ token: process.env.INGRAM_CLOUD_TOKEN! });
const smith = await ic.smiths.create({ external_id: "user-42" });
```

## Exports

- `.` — the `schemas` Zod map plus the SSE/webhook event types (`EVENT_TYPES`,
  `webhookEvent`, `streamFrame`, …).
- `./schemas` — just the Zod `schemas` map.
- `./zod` — the same schemas as individual named exports, one module per resource.
- `./responses` — the `IC*` TypeScript types for the JSON response bodies.
  Zod-free; `import type` these to stay dependency-light.
- `./client` — `IngramCloud`, the typed management-plane REST client. Method
  inputs are `z.input`-inferred from the same schemas the API validates with,
  so the client can't drift from the contract. Zod-free at runtime (type-only
  imports; transport is the global `fetch`). Auth is a pluggable token seam:
  a static bearer or a per-request minting function; smith-scoped calls made
  with a tenant token pass `{ smith }` (the `IC-Smith-Id` header). Non-2xx
  throws `ICError { status, code, requestId }`.

The OpenAPI document is served by the API itself (`/openapi.json`), emitted from
these schemas — it is no longer shipped as a file in this package.

The client is the **management plane** only. The **data plane** stays on
industry standards: chat rides the OpenAI-compatible surface — use
`@ingram-cloud/ai-sdk` and the standard `@ai-sdk/*` types for that. The
native run stream is exposed raw (`smiths.runs.stream` returns the SSE
`Response` unconsumed).

> Ships compiled ESM (`dist/`) alongside the TypeScript source (`ts/`). Node
> and bundlers load `dist/` — no transpile config needed. Types resolve straight
> to the source, and Bun (the `bun` export condition) runs the source directly.

## Coverage

Every resource's request bodies and non-streaming JSON responses are typed as
precise Zod (one module per resource under `./zod`), and the `IC*` types are
inferred from them. The **streaming/union** endpoints (`/runs` stream,
`/chat/completions`, `/responses` — a stream _or_ JSON from one handler), deployment
**webhook acks**, and the OAuth **redirect** are not expressible as a single
response schema, so they're not in the typed surface; the `{v:1}` webhook/feed
envelope and the SSE run-stream frames are the hand-authored `./events` half.

The OpenAI-compatible stream chunks themselves are standard — use the `@ai-sdk/*`
types rather than redefining them here.
