/**
 * Hand-authored Zod schemas for the `runs` resource — the wire's source of
 * truth, replacing the inline `IC*` run shapes previously declared in
 * `../responses`.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it. `RunUsage` is standalone
 * (`$ref`'d) so the inferred `ICRunUsage` comes out identical to its hand-written
 * interface ancestor.
 *
 * Only the JSON shapes are modelled here: the run object, the run list, run
 * events + their list, and the create/submit request bodies. The streaming
 * surfaces emit the native `{v:1}` SSE envelope (not a single JSON schema) and
 * are deliberately not modelled.
 */
import { z } from "zod";
import { Actor } from "./_actor.js";
import { pageOut } from "./_page.js";

/** One message in a run's `input`. `content` is a plain string for a text-only
 *  turn, or an array of content parts (`{type:"text"|"file"|"image", …}`) for a
 *  multimodal turn — the OpenAI-compatible surface and inline-file offloading both
 *  persist the array form, so the read schema must accept both. */
export const InputMessage = z
	.object({
		role: z.string(),
		content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
	})
	.meta({ id: "InputMessage" });

/** One run's own token usage (the `usage` map on a run). Distinct from the
 *  tenant's aggregated billing summary. Plain numbers, not ints: provider/cache
 *  token math can be fractional, and an int assertion on a read surface buys
 *  nothing but a 500 risk. */
export const RunUsage = z
	.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		total_tokens: z.number(),
		// This turn's priced cost in the account currency, computed at finish from the
		// model's price book entry. Optional: runs metered before pricing landed — and
		// any turn with no resolvable model — carry tokens but no `cost`.
		cost: z.number().optional(),
	})
	.meta({ id: "RunUsage" });

/** One thing that went wrong during a run without ending it — today, a tool source
 *  the run could not reach. A run that lost its tools still answers, and the answer
 *  is shaped like a healthy one, so this rides the run's own summary fields rather
 *  than a nested metadata key nobody reads. */
export const RunWarning = z
	.object({
		code: z.string(),
		message: z.string(),
	})
	.meta({ id: "RunWarning" });

export const RunOut = z
	.object({
		id: z.string(),
		smith_id: z.string(),
		thread_id: z.string(),
		status: z.string(),
		channel: z.string(),
		input: z.array(InputMessage),
		// `tool_calls` is an array of surface-specific call objects: the OpenAI
		// `{id,type,function}` shape for a client-tools turn, a pending-call dict for
		// an approval pause. Modelled loosely on purpose — a single strict struct here
		// would 500 the read surface on the shapes actually stored.
		output: z
			.object({
				content: z.string().optional(),
				// Set by a structured (`response_format`) run: the media type of `content`
				// (e.g. `application/json`), so a reader knows to parse it.
				content_type: z.string().optional(),
				tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
				// Quick-reply chips the agent offered for this reply (via the
				// `suggest_replies` tool). Channels with native support render them as
				// tappable buttons; a tap arrives as the user's next message.
				suggested_replies: z.array(z.string()).optional(),
			})
			.nullable(),
		stop_reason: z.string().nullable(),
		// Always present, `[]` on a clean run: absence must never read as "fine".
		warnings: z.array(RunWarning),
		usage: RunUsage.nullable(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		/** Who started this run. Null on runs created before attribution shipped. */
		actor: Actor.nullable(),
		created_at: z.string().nullable(),
		updated_at: z.string().nullable(),
	})
	.meta({ id: "RunOut" });

export const RunListOut = pageOut(RunOut, "RunListOut");

/** One recorded run event, as replayed from the event log. */
export const RunEventOut = z
	.object({
		seq: z.number().int(),
		type: z.string(),
		data: z.record(z.string(), z.unknown()),
		created_at: z.string().nullable(),
	})
	.meta({ id: "RunEventOut" });

export const RunEventListOut = z
	.object({ data: z.array(RunEventOut) })
	.meta({ id: "RunEventListOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const RunIn = z
	.object({
		input: z.array(InputMessage).optional(),
		thread_id: z.string().nullish(),
		stream: z.boolean().optional(),
		channel: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		response_format: z.record(z.string(), z.unknown()).nullish(),
	})
	.meta({ id: "RunIn" });

export const Submit = z
	.object({
		kind: z.string(),
		tool_call_id: z.string().nullish(),
		result: z.record(z.string(), z.unknown()).nullish(),
		approval_id: z.string().nullish(),
		decision: z.string().nullish(),
		/** The answer to an approval's `elicitation`, matching its
		 *  `requested_schema`; with `decision: "approve"`. */
		content: z.record(z.string(), z.unknown()).nullish(),
		actor: z.string().nullish(),
		reason: z.string().nullish(),
		stream: z.boolean().optional(),
	})
	.meta({ id: "Submit" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICInputMessage = z.infer<typeof InputMessage>;
export type ICRunUsage = z.infer<typeof RunUsage>;
export type ICRunWarning = z.infer<typeof RunWarning>;
export type ICRun = z.infer<typeof RunOut>;
export type ICRunEvent = z.infer<typeof RunEventOut>;
