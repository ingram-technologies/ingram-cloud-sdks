/**
 * Hand-authored Zod schemas for the `vector_stores` resource — the wire's
 * source of truth, mapped onto the OpenAI **Vector Stores API** so an OpenAI
 * client library talks to it unchanged.
 *
 * Standards mapping: objects, statuses, chunking strategies, the attribute
 * filter grammar, and the `search_results.page` envelope are OpenAI's, wart for
 * wart (modify is `POST`, the batch object is `vector_store.files_batch`, the
 * search page uses a `next_page` token while CRUD lists use `first_id`/
 * `last_id`). Two documented IC extensions: `smith_id` scopes a store to a
 * single smith ("" = tenant-wide), the same isolation boundary every other
 * smith-owned resource has; `embedding_model` names the store's embedder,
 * frozen at create (OpenAI pins one platform-wide, Gemini's File Search exposes
 * it the same way). Expiration policies (`expires_after`), query
 * rewriting, and rankers are not implemented — the fields don't exist here
 * rather than being accepted and ignored.
 */
import { z } from "zod";
import { oaiListOut } from "./_page.js";

// ── Chunking ─────────────────────────────────────────────────────────────────

/** Static chunking params. Overlap must not exceed half the chunk size. */
export const StaticChunkingConfig = z
	.object({
		max_chunk_size_tokens: z.number().int().min(100).max(4096),
		chunk_overlap_tokens: z.number().int().min(0),
	})
	.refine((v) => v.chunk_overlap_tokens <= Math.floor(v.max_chunk_size_tokens / 2), {
		message: "chunk_overlap_tokens must not exceed max_chunk_size_tokens / 2",
	});

/** Request-side chunking strategy: `auto` (800/400) or explicit `static`. */
export const ChunkingStrategyIn = z
	.union([
		z.object({ type: z.literal("auto") }),
		z.object({ type: z.literal("static"), static: StaticChunkingConfig }),
	])
	.meta({ id: "ChunkingStrategyIn" });

/** Response-side strategy: always the resolved `static` values (never `auto`). */
export const ChunkingStrategyOut = z
	.object({
		type: z.literal("static"),
		static: z.object({
			max_chunk_size_tokens: z.number().int(),
			chunk_overlap_tokens: z.number().int(),
		}),
	})
	.meta({ id: "ChunkingStrategyOut" });

// ── Attributes & filters ─────────────────────────────────────────────────────

/** File attributes: ≤16 keys, key ≤64 chars, value string(≤512)|number|bool. */
export const VectorStoreAttributes = z
	.record(z.string().max(64), z.union([z.string().max(512), z.number(), z.boolean()]))
	.refine((v) => Object.keys(v).length <= 16, {
		message: "at most 16 attribute keys",
	});

/** A filter node: a comparison (`type` eq/ne/gt/gte/lt/lte/in/nin over `key`/
 *  `value`) or a compound (`type` and/or over nested `filters`). The grammar is
 *  recursive; the schema validates one node and the API validates nested nodes
 *  when it compiles the filter (the OpenAPI generator cannot express the
 *  recursion).
 */
export const VectorStoreFilter = z
	.object({
		type: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "and", "or"]),
		key: z.string().optional(),
		value: z
			.union([
				z.string(),
				z.number(),
				z.boolean(),
				z.array(z.union([z.string(), z.number()])),
			])
			.optional(),
		filters: z.array(z.record(z.string(), z.unknown())).optional(),
	})
	.meta({ id: "VectorStoreFilter" });

export type ICVectorStoreFilter =
	| {
			type: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "nin";
			key: string;
			value: string | number | boolean | Array<string | number>;
	  }
	| { type: "and" | "or"; filters: ICVectorStoreFilter[] };

// ── Vector store ─────────────────────────────────────────────────────────────

export const VectorStoreIn = z
	.object({
		name: z.string().optional(),
		description: z.string().optional(),
		/** Files to attach at create; more can be attached later. */
		file_ids: z.array(z.string()).max(500).optional(),
		chunking_strategy: ChunkingStrategyIn.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		/** IC extension: own the store to one smith ("" / omitted = tenant-wide). */
		smith_id: z.string().optional(),
		/** IC extension: the embedder to index and query this store with, frozen at
		 *  create (omitted = the platform default). Any model your OpenAI-provider
		 *  key can reach — including an EU-hosted OpenAI-compatible endpoint set as
		 *  that key's `base_url` — of at most 1536 dimensions. */
		embedding_model: z.string().optional(),
	})
	.meta({ id: "VectorStoreIn" });

export const VectorStoreFileCounts = z.object({
	in_progress: z.number().int(),
	completed: z.number().int(),
	failed: z.number().int(),
	cancelled: z.number().int(),
	total: z.number().int(),
});

/** The OpenAI vector store object (+ `smith_id`, the IC extension). */
export const VectorStoreOut = z
	.object({
		id: z.string(),
		object: z.literal("vector_store"),
		/** Unix seconds, like every OpenAI object. */
		created_at: z.number().int(),
		name: z.string(),
		description: z.string().nullable(),
		usage_bytes: z.number().int(),
		/** `in_progress` while any attached file is still indexing. */
		status: z.enum(["in_progress", "completed"]),
		file_counts: VectorStoreFileCounts,
		/** Unix seconds of the last search against the store. */
		last_active_at: z.number().int().nullable(),
		metadata: z.record(z.string(), z.unknown()),
		/** IC extension: the owning smith ("" = tenant-wide). */
		smith_id: z.string(),
		/** IC extension: the embedder this store is indexed and queried with,
		 *  frozen at create. */
		embedding_model: z.string(),
	})
	.meta({ id: "VectorStoreOut" });

/** Vector stores, in OpenAI's `list` envelope. */
export const VectorStoreListOut = oaiListOut(VectorStoreOut, "VectorStoreListOut");

/** Modify body (OpenAI uses `POST`, not `PATCH`). */
export const VectorStorePatch = z
	.object({
		name: z.string().nullish(),
		description: z.string().nullish(),
		metadata: z.record(z.string(), z.unknown()).nullish(),
	})
	.meta({ id: "VectorStorePatch" });

export const VectorStoreDeleted = z
	.object({
		id: z.string(),
		object: z.literal("vector_store.deleted"),
		deleted: z.literal(true),
	})
	.meta({ id: "VectorStoreDeleted" });

// ── Vector store files ───────────────────────────────────────────────────────

export const VectorStoreFileIn = z
	.object({
		file_id: z.string(),
		attributes: VectorStoreAttributes.nullish(),
		chunking_strategy: ChunkingStrategyIn.optional(),
	})
	.meta({ id: "VectorStoreFileIn" });

/** The OpenAI vector store file object. Its `id` IS the Files-API file id. */
export const VectorStoreFileOut = z
	.object({
		id: z.string(),
		object: z.literal("vector_store.file"),
		usage_bytes: z.number().int(),
		created_at: z.number().int(),
		vector_store_id: z.string(),
		status: z.enum(["in_progress", "completed", "failed", "cancelled"]),
		last_error: z
			.object({
				code: z.enum([
					"server_error",
					"unsupported_file",
					"no_text_layer",
					"invalid_file",
				]),
				message: z.string(),
			})
			.nullable(),
		chunking_strategy: ChunkingStrategyOut,
		attributes: VectorStoreAttributes.nullable(),
	})
	.meta({ id: "VectorStoreFileOut" });

export const VectorStoreFileListOut = oaiListOut(
	VectorStoreFileOut,
	"VectorStoreFileListOut",
);

/** Update body: attributes only (chunking is frozen once indexed). */
export const VectorStoreFileUpdate = z
	.object({
		attributes: VectorStoreAttributes.nullable(),
	})
	.meta({ id: "VectorStoreFileUpdate" });

/** The parsed text a file was indexed as, chunk by chunk, in OpenAI's
 *  `vector_store.file_content.page` envelope. The whole file is one page — the
 *  paging fields are the envelope's shape, not a promise of more. */
export const VectorStoreFileContentOut = z
	.object({
		object: z.literal("vector_store.file_content.page"),
		data: z.array(z.object({ type: z.literal("text"), text: z.string() })),
		has_more: z.literal(false),
		next_page: z.null(),
	})
	.meta({ id: "VectorStoreFileContentOut" });

export const VectorStoreFileDeleted = z
	.object({
		id: z.string(),
		object: z.literal("vector_store.file.deleted"),
		deleted: z.literal(true),
	})
	.meta({ id: "VectorStoreFileDeleted" });

// ── File batches ─────────────────────────────────────────────────────────────

/** Batch create: either flat `file_ids` (shared attributes/chunking) or
 *  per-file `files` entries — exactly one of the two. */
export const VectorStoreFileBatchIn = z
	.object({
		file_ids: z.array(z.string()).min(1).max(2000).optional(),
		attributes: VectorStoreAttributes.nullish(),
		chunking_strategy: ChunkingStrategyIn.optional(),
		files: z
			.array(
				z.object({
					file_id: z.string(),
					attributes: VectorStoreAttributes.nullish(),
					chunking_strategy: ChunkingStrategyIn.optional(),
				}),
			)
			.min(1)
			.max(2000)
			.optional(),
	})
	.refine((v) => !!v.file_ids !== !!v.files, {
		message: "provide exactly one of file_ids or files",
	})
	.meta({ id: "VectorStoreFileBatchIn" });

/** The batch object — wire `object` is `vector_store.files_batch` (plural,
 *  matching OpenAI's spec; their docs prose says `file_batch`). */
export const VectorStoreFileBatchOut = z
	.object({
		id: z.string(),
		object: z.literal("vector_store.files_batch"),
		created_at: z.number().int(),
		vector_store_id: z.string(),
		status: z.enum(["in_progress", "completed", "cancelled", "failed"]),
		file_counts: VectorStoreFileCounts,
	})
	.meta({ id: "VectorStoreFileBatchOut" });

// ── Search ───────────────────────────────────────────────────────────────────

/** OpenAI's `ranking_options`. `hybrid_search` turns on reciprocal-rank fusion
 *  of the embedding ranking with a full-text (keyword) ranking, weighted as
 *  given; without it search is embedding-only. */
export const VectorStoreRankingOptions = z
	.object({
		score_threshold: z.number().min(0).max(1).optional(),
		hybrid_search: z
			.object({
				embedding_weight: z.number().min(0),
				text_weight: z.number().min(0),
			})
			.refine((w) => w.embedding_weight > 0 || w.text_weight > 0, {
				message: "at least one weight must be positive",
			})
			.optional(),
	})
	.meta({ id: "VectorStoreRankingOptions" });

export const VectorStoreSearchIn = z
	.object({
		query: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
		max_num_results: z.number().int().min(1).max(50).optional(),
		filters: VectorStoreFilter.nullish(),
		ranking_options: VectorStoreRankingOptions.optional(),
	})
	.meta({ id: "VectorStoreSearchIn" });

export const VectorStoreSearchResult = z
	.object({
		file_id: z.string(),
		filename: z.string(),
		/** In [0, 1]: cosine similarity, or — with `hybrid_search` — the fused
		 *  reciprocal-rank score (1 = first in both rankings). */
		score: z.number(),
		attributes: VectorStoreAttributes.nullable(),
		content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
	})
	.meta({ id: "VectorStoreSearchResult" });

/** The search page — OpenAI's `search_results.page` envelope. `search_query`
 *  is an array even for a single query, per the OpenAI spec. */
export const VectorStoreSearchOut = z
	.object({
		object: z.literal("vector_store.search_results.page"),
		search_query: z.array(z.string()),
		data: z.array(VectorStoreSearchResult),
		has_more: z.boolean(),
		next_page: z.string().nullable(),
	})
	.meta({ id: "VectorStoreSearchOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICVectorStore = z.infer<typeof VectorStoreOut>;
export type ICVectorStoreFile = z.infer<typeof VectorStoreFileOut>;
export type ICVectorStoreFileContentPage = z.infer<typeof VectorStoreFileContentOut>;
export type ICVectorStoreFileBatch = z.infer<typeof VectorStoreFileBatchOut>;
export type ICVectorStoreSearchPage = z.infer<typeof VectorStoreSearchOut>;
export type ICVectorStoreAttributes = z.infer<typeof VectorStoreAttributes>;
