/**
 * Hand-authored Zod schemas for the `mcp` resource — the tenant config plane for
 * registering third-party MCP tool servers (`/v1/tenant/mcp/...`).
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it. `ApprovalRule` and
 * `McpTool` are standalone named schemas referenced by `McpServerOut`, so they
 * emit as `$ref` components rather than inlined objects.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

/** One approval-policy rule: a name glob that gates matching tools behind a
 *  human approval. `require` is always `"approval"` today (the only supported
 *  value); arg-conditional (`when`) gating is rejected, not stored. */
export const ApprovalRule = z
	.object({
		match: z.string(),
		require: z.string().optional(),
	})
	.meta({ id: "ApprovalRule" });

/** The rule shape on *input* (`McpServerIn.approval_policy`). Loose, so unknown
 *  clauses (e.g. an arg-conditional `when`) reach the handler, which rejects them
 *  with its own `unsupported_policy_rule` (422) rather than being silently
 *  stripped by a strict object. */
export const ApprovalRuleIn = z.looseObject({
	match: z.string(),
	require: z.string().optional(),
});

/** A discovered MCP tool, with its *effective* gating folded in by the
 *  serializer: `enabled` reflects the default-deny `tool_allowlist`,
 *  `requires_approval` folds the server's destructive hint with the approval
 *  policy. */
export const McpTool = z
	.object({
		name: z.string(),
		description: z.string().nullable(),
		/** Effective gate: server destructiveHint OR an approval_policy match. */
		requires_approval: z.boolean(),
		/** Passes the default-deny tool_allowlist (always true when no allow-list). */
		enabled: z.boolean(),
	})
	.meta({ id: "McpTool" });

/** Secret-free auth descriptor returned for a registered server. */
export const McpAuth = z
	.object({
		kind: z.string(),
		provider: z.string().nullable(),
		client_mode: z.string().optional(),
	})
	.meta({ id: "McpAuth" });

export const McpServerOut = z
	.object({
		id: z.string(),
		name: z.string(),
		url: z.string(),
		auth: McpAuth,
		/** tenant_owned | tenant_registered | catalog. */
		origin: z.string().optional(),
		catalog_slug: z.string().nullish(),
		/** null = expose all discovered tools; otherwise the default-deny set. */
		tool_allowlist: z.array(z.string()).nullish(),
		approval_policy: z.array(ApprovalRule).optional(),
		tools: z.array(McpTool),
		/** How many tools this registration currently holds — what a run is offered,
		 *  before the allow-list gate each tool's own `enabled` reports. Same number on
		 *  a read as on the register/refresh response that produced it. */
		tools_discovered: z.number().int(),
		tools_refreshed_at: z.string().nullable(),
		/** `degraded` when the edge failed discovery, its secret can't be decoded at
		 *  run time, or its last `tools/call` failed at the transport level;
		 *  otherwise the stored lifecycle status. */
		status: z.string(),
		/** Last discovery/runtime-load failure, or null when discovery is healthy. */
		discovery_error: z.string().nullable(),
		/** Last transport-level `tools/call` failure (network / HTTP status), or
		 *  null. Discovery can succeed while calls fail — this catches that. Cleared
		 *  by a successful call or a re-PUT. */
		last_call_error: z.string().nullable(),
		last_call_error_at: z.string().nullable(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "McpServerOut" });

export const McpServerListOut = pageOut(McpServerOut, "McpServerListOut");

// ── Request bodies ──────────────────────────────────────────────────────────

/** Auth block on a register/replace body. `kind` is `none` | `bearer` | `oauth`;
 *  `secret` (the shared bearer token) is write-only — never echoed back. */
export const McpAuthIn = z
	.object({
		kind: z.string().nullish(),
		provider: z.string().nullish(),
		secret: z.string().nullish(),
		client_mode: z.string().nullish(),
	})
	.meta({ id: "McpAuthIn" });

/** Register or replace a server: supply a raw `url` + `auth`, or a `catalog`
 *  slug (catalog defaults are stamped down, body fields override). PUT is a
 *  full replace and `auth.kind` is required unless a catalog preset supplies
 *  it — there is no implicit `none`. */
export const McpServerIn = z
	.object({
		url: z.string().nullish(),
		catalog: z.string().nullish(),
		auth: McpAuthIn.nullish(),
		tool_allowlist: z.array(z.string()).nullish(),
		approval_policy: z.array(ApprovalRuleIn).nullish(),
	})
	.meta({ id: "McpServerIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICMcpTool = z.infer<typeof McpTool>;
export type ICApprovalRule = z.infer<typeof ApprovalRule>;
export type ICMcpServer = z.infer<typeof McpServerOut>;
