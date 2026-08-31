/**
 * Hand-authored Zod schemas for the `agents` resource — the wire's source of
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
 */
import { z } from "zod";
import { pageOut } from "./_page.js";
import { SkillRef } from "./skills.js";

/** A per-smith variable an agent declares; bound at run time. */
export const AgentVariable = z
	.object({
		name: z.string(),
		default: z.string().nullish(),
		description: z.string().nullish(),
		required: z.boolean().optional(),
	})
	.meta({ id: "AgentVariable" });

/** A typed app-tool bound to a UI template: the MCP host's model (or the
 *  rendered panel) calls it and the template renders the result. */
export const UiResourceTool = z
	.object({
		description: z.string(),
		/** JSON Schema for the tool's arguments (host-supplied). */
		input_schema: z.record(z.string(), z.unknown()).optional(),
		/** Scoped instruction the smith runs with when this tool is called. */
		instruction: z.string().nullish(),
		/** Writes gate through approval; reads flow freely. */
		mutating: z.boolean().optional(),
		/** Who may call the tool — the MCP Apps `_meta.ui.visibility` list. Omitted
		 *  means both; `["app"]` hides it from the host's model so only the rendered
		 *  panel can call it (a refresh or a paginated read). */
		visibility: z.array(z.enum(["model", "app"])).optional(),
	})
	.meta({ id: "UiResourceTool" });

/** CSP domain allowlists for the sandboxed iframe — the MCP Apps `_meta.ui.csp`
 *  shape (each key a list of allowed origins), passed through to the host verbatim. */
export const UiCsp = z
	.object({
		connectDomains: z.array(z.string()).optional(),
		resourceDomains: z.array(z.string()).optional(),
		frameDomains: z.array(z.string()).optional(),
		baseUriDomains: z.array(z.string()).optional(),
	})
	.meta({ id: "UiCsp" });

/** The authored metadata of a UI template — one set of fields shared by the
 *  upload sidecar and the stored resource. `csp`, `permissions`, `prefers_border`
 *  and `domain` are the MCP Apps resource `_meta.ui`, echoed to the host verbatim. */
const uiTemplateMeta = {
	csp: UiCsp.nullish(),
	/** Host permissions the template requests, a Permissions-Policy-style map
	 *  (e.g. `{ "camera": {}, "microphone": {} }`). */
	permissions: z.record(z.string(), z.unknown()).nullish(),
	/** Whether the host should draw its own border around the panel. Omitted
	 *  leaves it to the host (Claude: borderless on web, bordered on mobile). */
	prefers_border: z.boolean().nullish(),
	/** A stable sandbox origin for the panel, in the host's own format — needed
	 *  only when the panel runs its own OAuth flow or is CORS-allowlisted. */
	domain: z.string().nullish(),
	tool: UiResourceTool.nullish(),
};

/** A tenant-authored interactive UI template (MCP Apps, SEP-1865) attached to an
 *  agent. The HTML bundle lives in blob storage; this is its wire metadata (the
 *  internal blob ref is never exposed). */
export const UiResource = z
	.object({
		name: z.string(),
		content_hash: z.string(),
		...uiTemplateMeta,
	})
	.meta({ id: "UiResource" });

/** The mutable draft head — what the next publish snapshots. */
export const AgentDraft = z
	.object({
		instructions: z.string().nullable(),
		model: z.string().nullable(),
		enabled_hosted_tools: z.array(z.string()),
		vector_store_ids: z.array(z.string()),
		/** Registered MCP servers this agent's smiths load, by name. Null = all. */
		mcp_servers: z.array(z.string()).nullable(),
		/** Skills this agent's smiths carry. Frozen into the snapshot at publish. */
		skills: z.array(SkillRef),
		auto_memory: z.boolean().nullable(),
		memory_consolidation: z.boolean().nullable(),
		variables: z.array(AgentVariable),
		ui_resources: z.array(UiResource),
	})
	.meta({ id: "AgentDraft" });

export const AgentOut = z
	.object({
		id: z.string(),
		/** Immutable, project-unique IaC reconcile key. Null for the default agent. */
		slug: z.string().nullable(),
		/** Free, mutable display label (not unique). */
		name: z.string(),
		/** True for the lazily-created default agent (can't be deleted). */
		is_default: z.boolean(),
		draft: AgentDraft,
		active_version: z.number().int().nullable(),
		rollout_version: z.number().int().nullable(),
		rollout_percent: z.number().int(),
		smith_count: z.number().int().optional(),
		/** Newest run across every smith of this agent. Null until one runs. */
		last_activity_at: z.string().nullable().optional(),
		created_at: z.string().nullable(),
		updated_at: z.string().nullable(),
	})
	.meta({ id: "AgentOut" });

export const AgentListOut = pageOut(AgentOut, "AgentListOut");

/** A published, immutable version snapshot of an agent. */
export const AgentVersionOut = z
	.object({
		version: z.number().int(),
		snapshot: z.object({
			instructions: z.string().nullish(),
			model: z.string().nullish(),
			enabled_hosted_tools: z.array(z.string()).optional(),
			vector_store_ids: z.array(z.string()).optional(),
			mcp_servers: z.array(z.string()).nullish(),
			skills: z.array(SkillRef).optional(),
			auto_memory: z.boolean().nullish(),
			memory_consolidation: z.boolean().nullish(),
			variables: z.array(AgentVariable).optional(),
			ui_resources: z.array(UiResource).optional(),
		}),
		created_by: z.string().nullable(),
		note: z.string().nullable(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "AgentVersionOut" });

export const AgentVersionListOut = pageOut(AgentVersionOut, "AgentVersionListOut");

// ── Request bodies ──────────────────────────────────────────────────────────

export const AgentIn = z
	.object({
		name: z.string(),
		slug: z.string().nullish(),
		instructions: z.string().nullish(),
		model: z.string().nullish(),
		enabled_hosted_tools: z.array(z.string()).nullish(),
		vector_store_ids: z.array(z.string()).nullish(),
		/** Scope runs to these registered MCP servers (by name). Null/omitted = all. */
		mcp_servers: z.array(z.string()).nullish(),
		skills: z.array(SkillRef).nullish(),
		auto_memory: z.boolean().nullish(),
		memory_consolidation: z.boolean().nullish(),
		variables: z.array(AgentVariable).nullish(),
	})
	.meta({ id: "AgentIn" });

export const AgentPatch = z
	.object({
		name: z.string().nullish(),
		instructions: z.string().nullish(),
		model: z.string().nullish(),
		enabled_hosted_tools: z.array(z.string()).nullish(),
		vector_store_ids: z.array(z.string()).nullish(),
		/** Scope runs to these registered MCP servers (by name). An explicit null
		 *  clears the restriction (= all); omitted leaves it unchanged. */
		mcp_servers: z.array(z.string()).nullish(),
		skills: z.array(SkillRef).nullish(),
		auto_memory: z.boolean().nullish(),
		memory_consolidation: z.boolean().nullish(),
		variables: z.array(AgentVariable).nullish(),
	})
	.meta({ id: "AgentPatch" });

export const RolloutIn = z
	.object({
		version: z.number().int(),
		percent: z.number().int().min(0).max(100).default(100),
	})
	.meta({ id: "RolloutIn" });

export const PublishIn = z
	.object({ note: z.string().nullish() })
	.meta({ id: "PublishIn" });

export const ImportIn = z
	.object({ from_smith: z.string(), name: z.string() })
	.meta({ id: "ImportIn" });

export const AttachIn = z
	.object({
		all: z.boolean().default(false),
		smith_ids: z.array(z.string()).nullish(),
	})
	.meta({ id: "AttachIn" });

/** The JSON `metadata` part of a UI-template multipart upload (the HTML bundle
 *  rides the `file` part). */
export const UiResourceIn = z
	.object({
		name: z
			.string()
			.regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, digits, - and _")
			.max(63),
		...uiTemplateMeta,
	})
	.meta({ id: "UiResourceIn" });

export const UiResourceListOut = z
	.object({ data: z.array(UiResource) })
	.meta({ id: "UiResourceListOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICAgentVariable = z.infer<typeof AgentVariable>;
export type ICAgent = z.infer<typeof AgentOut>;
export type ICAgentVersion = z.infer<typeof AgentVersionOut>;
export type ICUiResource = z.infer<typeof UiResource>;
export type ICUiResourceTool = z.infer<typeof UiResourceTool>;
