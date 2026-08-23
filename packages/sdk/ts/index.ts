/**
 * The Ingram Cloud API wire contract, in TypeScript.
 *
 * `schemas` is the named map of hand-authored Zod schemas for the request and
 * response bodies (defined in `./zod`, one module per resource). It's the source
 * of truth for the wire shapes — the API imports the same schemas to validate
 * requests and to emit its OpenAPI document — and you can use it to validate a
 * body against the contract. This package is not an HTTP client.
 *
 * `./responses` is the matching `IC*` TypeScript types (inferred from the same
 * schemas), for typing the JSON you read back without pulling in Zod.
 *
 * `./events` is the hand-authored `{v:1}` webhook/feed envelope and the SSE
 * run-stream frames, which OpenAPI can't express.
 *
 * `./scopes` is the closed permission vocabulary a smith token may carry — you
 * must name the scopes you want when minting one.
 *
 * See `../README.md`.
 */
export { schemas } from "./schemas.js";
export * from "./events.js";
export * from "./scopes.js";
export type * from "./responses.js";
