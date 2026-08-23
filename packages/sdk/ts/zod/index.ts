/**
 * Hand-authored Zod schemas — the wire's source of truth, one resource module
 * per file. The API imports these into its `createRoute` definitions (runtime
 * validation + emitted OpenAPI); `../responses` re-exports the `z.infer`red
 * `IC*` types from them.
 *
 * Resources are migrated here off the generated `../schemas.ts` one at a time;
 * when the last one lands, the generated file and the `openapi-zod-client` step
 * are deleted and this becomes the sole `schemas` source.
 */
export * from "./_actor.js";
export * from "./_page.js";
export * from "./agents.js";
export * from "./approvals.js";
export * from "./billing.js";
export * from "./budgets.js";
export * from "./catalog.js";
export * from "./connections.js";
export * from "./conversations.js";
export * from "./deployments.js";
export * from "./customers.js";
export * from "./discord.js";
export * from "./email.js";
export * from "./files.js";
export * from "./mcp.js";
export * from "./memories.js";
export * from "./observability.js";
export * from "./projects.js";
export * from "./runs.js";
export * from "./schedules.js";
export * from "./skills.js";
export * from "./slack.js";
export * from "./smith-revisions.js";
export * from "./smiths.js";
export * from "./telegram.js";
export * from "./tenant.js";
export * from "./vector-stores.js";
export * from "./whatsapp.js";
