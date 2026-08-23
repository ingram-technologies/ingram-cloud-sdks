/**
 * Hand-authored Zod schemas for the `smiths` resource — the wire's source of
 * truth, replacing the loose generated `schemas.ts` shapes for this resource.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * A smith is one running clone of an agent (`/v1/smiths`, `smt_` ids), the unit
 * of data isolation. Its identity fields live alongside its *effective* agent
 * config (model/instructions/tools), flattened onto the resource. Memory is a
 * separate sub-resource (`/v1/smiths/{id}/memory`, schemas in `./memories`).
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";
import { SkillRef } from "./skills.js";

// ── Smith response ───────────────────────────────────────────────────────────

export const SmithOut = z
	.object({
		id: z.string(),
		external_id: z.string().nullable(),
		display_name: z.string().nullable(),
		locale: z.string().nullable(),
		timezone: z.string().nullable(),
		/** The customer (billable party) this smith's usage rolls up to. */
		customer_id: z.string().nullish(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		// The *effective* agent config (agent-resolved when attached).
		model: z.string(),
		/** The raw instructions template (may contain {{ variables }}). */
		instructions: z.string(),
		/** What this smith actually runs with — {{ variables }} bound per-smith. */
		rendered_instructions: z.string().nullish(),
		enabled_hosted_tools: z.array(z.string()).optional(),
		vector_store_ids: z.array(z.string()).optional(),
		/** Registered MCP servers this smith's runs load, by name. Null = all. */
		mcp_servers: z.array(z.string()).nullish(),
		skills: z.array(SkillRef).optional(),
		auto_memory: z.boolean().optional(),
		memory_consolidation: z.boolean().optional(),
		/** How the config resolved: by reference, with overrides, or embedded. */
		config_source: z.enum(["agent", "override", "custom"]).optional(),
		agent_id: z.string().nullish(),
		agent_version: z.number().int().nullish(),
		pin: z.number().int().nullish(),
		/** Which config fields this smith overrides on top of its agent version.
		 *  The rest track the agent. Empty for a clean reference or a standalone
		 *  smith. Clear an override by PATCHing that field to `null`. */
		override_keys: z.array(z.string()).optional(),
		/** What each field reverts to — the agent version's value, before this
		 *  smith's overrides. `null` for a standalone smith (nothing to inherit). */
		inherited: z
			.object({
				model: z.string(),
				instructions: z.string().nullable(),
				enabled_hosted_tools: z.array(z.string()),
				vector_store_ids: z.array(z.string()),
				mcp_servers: z.array(z.string()).nullable(),
				skills: z.array(SkillRef),
				auto_memory: z.boolean().nullable(),
				memory_consolidation: z.boolean().nullable(),
			})
			.nullish(),
		created_at: z.string(),
	})
	.meta({ id: "SmithOut" });

/** Cursor-paginated smith list: `data` + `has_more` (+ opaque `next_cursor`). */
export const SmithListOut = z
	.object({
		data: z.array(SmithOut),
		has_more: z.boolean(),
		next_cursor: z.string().nullish(),
	})
	.meta({ id: "SmithListOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const SmithCreate = z
	.object({
		external_id: z.string().nullish(),
		display_name: z.string().nullish(),
		locale: z.string().nullish(),
		timezone: z.string().nullish(),
		customer_id: z.string().nullish(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		agent_id: z.string().nullish(),
		pin: z.number().int().nullish(),
		model: z.string().nullish(),
		instructions: z.string().nullish(),
		enabled_hosted_tools: z.array(z.string()).nullish(),
		vector_store_ids: z.array(z.string()).nullish(),
		/** Scope this smith's runs to these registered MCP servers (by name). */
		mcp_servers: z.array(z.string()).nullish(),
		skills: z.array(SkillRef).nullish(),
		auto_memory: z.boolean().nullish(),
		memory_consolidation: z.boolean().nullish(),
	})
	.meta({ id: "SmithCreate" });

export const SmithPatch = z
	.object({
		display_name: z.string().nullish(),
		locale: z.string().nullish(),
		timezone: z.string().nullish(),
		customer_id: z.string().nullish(),
		metadata: z.record(z.string(), z.unknown()).nullish(),
		agent_id: z.string().nullish(),
		pin: z.number().int().nullish(),
		model: z.string().nullish(),
		instructions: z.string().nullish(),
		enabled_hosted_tools: z.array(z.string()).nullish(),
		vector_store_ids: z.array(z.string()).nullish(),
		/** Scope this smith's runs to these registered MCP servers (by name).
		 *  Null clears the per-smith override (re-inherit the agent's value). */
		mcp_servers: z.array(z.string()).nullish(),
		/** Null clears the per-smith override (re-inherit the agent's value). */
		skills: z.array(SkillRef).nullish(),
		auto_memory: z.boolean().nullish(),
		memory_consolidation: z.boolean().nullish(),
	})
	.meta({ id: "SmithPatch" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICSmith = z.infer<typeof SmithOut>;
