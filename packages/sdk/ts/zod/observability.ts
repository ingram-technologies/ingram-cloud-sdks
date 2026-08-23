/**
 * Hand-authored Zod schemas for the `observability` resource — traces, spans,
 * and the usage breakdown. The wire's source of truth, replacing the loose
 * generated shapes for this resource.
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
 * Shapes follow the `responses.ts` interfaces (the source of truth), not the
 * relic's looser `SpanOut`/`TraceOut`: the relic flattened `children`, `spans`,
 * and `span_tree` onto every span/trace and made `kind`/timestamps nullable. We
 * split them — `SpanOut` has no `children`, the recursive `SpanNodeOut` adds
 * it; `TraceOut` carries no `spans`/`span_tree`, `TraceDetailOut` adds them.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

/** Span kinds emitted by the observability backend. `retrieval` covers vector-store
 *  search (the hosted `file_search` tool, and externally-pushed RAG spans). */
export const ICSpanKindEnum = z
	.enum(["run", "model_call", "tool_call", "memory_op", "retrieval", "runtime_event"])
	.meta({ id: "SpanKind" });

/** A single timed unit of work inside a trace. */
export const SpanOut = z
	.object({
		id: z.string(),
		trace_id: z.string(),
		parent_span_id: z.string().nullable(),
		kind: ICSpanKindEnum,
		name: z.string(),
		status: z.string(),
		started_at: z.string(),
		ended_at: z.string().nullable(),
		duration_ms: z.number().int().nullable(),
		model: z.string().nullable(),
		input_tokens: z.number().int().nullable(),
		output_tokens: z.number().int().nullable(),
		cost: z.number().nullable(),
		attributes: z.record(z.string(), z.unknown()),
	})
	.meta({ id: "SpanOut" });

/** A span node in the nested `span_tree` (same shape + recursive children). */
export const SpanNodeOut = SpanOut.extend({
	get children() {
		return z.array(SpanNodeOut);
	},
}).meta({ id: "SpanNodeOut" });

/** Top-level trace — one end-to-end agent operation. */
export const TraceOut = z
	.object({
		id: z.string(),
		/** Null for a trace no smith owns — an external `/v1/traces:ingest` under a
		 *  tenant token attributes to none. Such a trace is tenant-scope only: a
		 *  smith-bound token cannot read it. */
		smith_id: z.string().nullable(),
		app_id: z.string().nullable(),
		run_id: z.string().nullable(),
		root_kind: ICSpanKindEnum,
		name: z.string(),
		status: z.string(),
		started_at: z.string(),
		ended_at: z.string().nullable(),
		duration_ms: z.number().int().nullable(),
		total_tokens: z.number().int().nullable(),
		total_cost: z.number().nullable(),
		attributes: z.record(z.string(), z.unknown()),
	})
	.meta({ id: "TraceOut" });

/** A trace plus its flat spans and nested tree. */
export const TraceDetailOut = TraceOut.extend({
	spans: z.array(SpanOut),
	span_tree: z.array(SpanNodeOut),
}).meta({ id: "TraceDetailOut" });

export const TraceListOut = pageOut(TraceOut, "TraceListOut");

/** Aggregated usage grouped by app, smith, model, or customer. */
/** The token/cost amounts a usage bucket reports. `tokens` is the grand total
 *  (input + output); `input_tokens` is the input slice, and `cache_read_tokens`
 *  / `cache_write_tokens` are sub-slices of input (reads served from the
 *  provider's prompt cache, writes billed at the cache-write premium). The cache
 *  hit rate is `cache_read_tokens / input_tokens`. */
const UsageAmounts = z.object({
	tokens: z.number(),
	input_tokens: z.number(),
	cache_read_tokens: z.number(),
	cache_write_tokens: z.number(),
	cost: z.number(),
	run_count: z.number(),
});

export const UsageBreakdownOut = z
	.object({
		group_by: z.enum(["app", "smith", "model", "customer"]),
		totals: UsageAmounts,
		groups: z.array(
			z
				.object({
					app: z.string().nullable().optional(),
					smith: z.string().nullable().optional(),
					model: z.string().nullable().optional(),
					// Customer-grouped views label unassigned usage `principal:<smith id>`.
					customer: z.string().nullable().optional(),
				})
				.extend(UsageAmounts.shape),
		),
		/** Custom billable events aggregated per meter over the same filters. */
		meters: z
			.array(
				z.object({
					meter: z.string(),
					customer: z.string().nullable().optional(),
					quantity: z.number(),
					events: z.number(),
				}),
			)
			.optional(),
	})
	.meta({ id: "UsageBreakdownOut" });

/** One recorded billable usage event. */
export const UsageEventOut = z
	.object({
		id: z.string(),
		smith_id: z.string(),
		customer_id: z.string().nullable(),
		meter: z.string(),
		quantity: z.number(),
		day: z.string(),
		metadata: z.record(z.string(), z.unknown()),
		created_at: z.string().nullable(),
	})
	.meta({ id: "UsageEventOut" });

/** A page of usage events (keyset pagination). */
export const UsageEventListOut = z
	.object({
		data: z.array(UsageEventOut),
		next_cursor: z.string().nullable(),
		has_more: z.boolean(),
	})
	.meta({ id: "UsageEventListOut" });

// ── Span ingestion (POST /v1/traces:ingest) ─────────────────────────────────

/** The request body for span ingestion (externally-pushed spans / OTel).
 *
 *  Deliberately permissive: the handler normalizes rather than rejects — an
 *  unrecognized `kind` degrades to `runtime_event`, missing ids and timestamps
 *  are generated. Validating {@link ICSpanIn} here would 422 exactly the sloppy
 *  exporter payloads the endpoint exists to absorb. `ICSpanIn` documents the
 *  shape for callers; the wire stays open. */
export const TraceIngestIn = z
	.object({ spans: z.array(z.record(z.string(), z.unknown())).optional() })
	.meta({ id: "TraceIngestIn" });

/** The 202 ack for span ingestion: how many spans were written. */
export const TraceIngestOut = z
	.object({ accepted: z.number().int() })
	.meta({ id: "TraceIngestOut" });

/** One span as pushed to `POST /v1/traces:ingest` — the caller-facing contract
 *  for {@link TraceIngestIn}'s open `spans` array. Every field is optional; the
 *  tenant is always taken from the token, never the body. A TS type rather than
 *  a schema precisely because the wire does not enforce it. */
export interface ICSpanIn {
	trace_id?: string | null;
	span_id?: string | null;
	parent_span_id?: string | null;
	/** One of {@link ICSpanKindEnum}; anything else lands as `runtime_event`. */
	kind?: string;
	name?: string | null;
	status?: string;
	started_at?: string | null;
	ended_at?: string | null;
	duration_ms?: number | null;
	model?: string | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_tokens?: number | null;
	cache_write_tokens?: number | null;
	attributes?: Record<string, unknown> | null;
	smith_id?: string | null;
	app_id?: string | null;
	run_id?: string | null;
	open_trace?: boolean;
}

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICSpanKind = z.infer<typeof ICSpanKindEnum>;
export type ICSpan = z.infer<typeof SpanOut>;
export type ICSpanNode = z.infer<typeof SpanNodeOut>;
export type ICTrace = z.infer<typeof TraceOut>;
export type ICTraceDetail = z.infer<typeof TraceDetailOut>;
export type ICUsageBreakdown = z.infer<typeof UsageBreakdownOut>;
export type ICUsageEvent = z.infer<typeof UsageEventOut>;
