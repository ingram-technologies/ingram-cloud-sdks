# `@ingram-cloud/sdk`

The Ingram Cloud `/v1` API contract in TypeScript: Zod request/response
schemas, SSE/webhook event types, JSON response types, and a typed
management-plane client built on them. The schemas are hand-authored; the API
imports them to validate requests and to emit its OpenAPI document, and the
`IC*` response types are inferred from them.

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

- `.`: the `schemas` Zod map plus the SSE/webhook event types (`EVENT_TYPES`,
  `webhookEvent`, `streamFrame`, …).
- `./schemas`: the Zod `schemas` map only.
- `./zod`: the same schemas as individual named exports, one module per resource.
- `./responses`: the `IC*` TypeScript types for the JSON response bodies.
  Zod-free; `import type` these.
- `./client`: `IngramCloud`, the typed management-plane REST client. Method
  inputs are `z.input`-inferred from the schemas the API validates with. Zod-free
  at runtime (type-only imports; transport is the global `fetch`). Auth is a
  static bearer or a per-request minting function. Smith-scoped calls made with
  a tenant token pass `{ smith }`, sent as the `IC-Smith-Id` header. Non-2xx
  throws `ICError { status, code, requestId }`. A 429 or 503 that names a
  `Retry-After` is retried, up to four attempts and a minute's wait; a 402 is
  never retried.

The OpenAPI document is served by the API at `/openapi.json`, emitted from these
schemas.

The client covers the management plane only. Chat goes through the
OpenAI-compatible surface: use `@ingram-cloud/ai-sdk` and the standard
`@ai-sdk/*` types. The native run stream is exposed raw: `smiths.runs.stream`
returns the SSE `Response` unconsumed.

> Ships compiled ESM (`dist/`) alongside the TypeScript source (`ts/`). Node
> and bundlers load `dist/`. Types resolve to the source, and Bun (the `bun`
> export condition) runs the source directly.

## Coverage

Every resource's request bodies and non-streaming JSON responses are typed as
Zod (one module per resource under `./zod`), with the `IC*` types inferred from
them. Not in the typed surface, because no single response schema expresses
them: the streaming/union endpoints (`/runs` stream, `/chat/completions`,
`/responses`, each a stream or JSON from one handler), deployment webhook acks,
and the OAuth redirect. The `{v:1}` webhook/feed envelope and the SSE
run-stream frames are the hand-authored `./events` half.

The OpenAI-compatible stream chunks are standard; use the `@ai-sdk/*` types for
them.
