/**
 * Hand-authored Zod schemas for the `approvals` resource — the wire's source of
 * truth, replacing the loose generated `schemas.ts` shapes for this resource.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 *
 * The approvals route is read-only (list + get); there is no decision/submit
 * body here — approvals are resolved on the standard tool-call channel via the
 * run's `/submit`, not a bespoke endpoint.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

/** A first-class human-in-the-loop decision raised by a paused run. */
export const ApprovalOut = z
	.object({
		id: z.string(),
		run_id: z.string().nullable(),
		smith_id: z.string().nullable(),
		tool_call_id: z.string().nullable(),
		tool: z.string().nullable(),
		/** The tool-call arguments awaiting a decision; `{}` when none. */
		args: z.record(z.string(), z.unknown()),
		/** Set when the pause is a remote MCP tool asking the end-user for input
		 *  (not a gate before a tool runs): the prompt and the JSON Schema the
		 *  answer must match. Approve with `content` to answer it. */
		elicitation: z
			.object({
				message: z.string(),
				requested_schema: z.record(z.string(), z.unknown()),
			})
			.nullable(),
		/** pending | approved | rejected. */
		status: z.string(),
		actor: z.string().nullable(),
		reason: z.string().nullable(),
		created_at: z.string().nullable(),
		resolved_at: z.string().nullable(),
	})
	.meta({ id: "ApprovalOut" });

export const ApprovalListOut = pageOut(ApprovalOut, "ApprovalListOut");

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICApproval = z.infer<typeof ApprovalOut>;
