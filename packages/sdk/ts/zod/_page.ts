/**
 * The two `/v1` list envelopes, one definition each. Native resources page by
 * keyset: `data` + the opaque `next_cursor` (null on the last page) + `has_more`
 * — the cursor is an opaque, short-lived token; pass it straight back as
 * `?cursor=`, never parse it. OpenAI-mirrored resources use the OpenAI `list`
 * envelope instead: `object:"list"` + `first_id`/`last_id` + `has_more`, paged
 * by passing `last_id` back as `?after=`.
 */
import { z } from "zod";

/** Wrap an item schema as a cursor-paginated list out, named `id` in the spec. */
export function pageOut<T extends z.ZodTypeAny>(item: T, id: string) {
	return z
		.object({
			data: z.array(item),
			next_cursor: z.string().nullish(),
			has_more: z.boolean(),
		})
		.meta({ id });
}

/** Wrap an item schema in the OpenAI `list` envelope, named `id` in the spec. */
export function oaiListOut<T extends z.ZodTypeAny>(item: T, id: string) {
	return z
		.object({
			object: z.literal("list"),
			data: z.array(item),
			first_id: z.string().nullable(),
			last_id: z.string().nullable(),
			has_more: z.boolean(),
		})
		.meta({ id });
}
