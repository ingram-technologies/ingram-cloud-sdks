/**
 * Hand-authored Zod schemas for `POST /v1/extract`: typed values read,
 * computed, estimated or forecast from one state and up to four images, by an
 * extraction model. The wire is Cloudflare Clairic's body, so the keys are
 * snake_case.
 *
 * `fields` is strict: a bad field fails at parse with its path. `answers` is
 * loose: a field Cloudflare adds later passes through.
 */
import { z } from "zod";
import { JsonValue } from "./evaluate.js";

/** What every field type takes. */
const FieldBase = z.strictObject({
	instructions: z.string().optional().describe("What the field should contain."),
	null_threshold: z
		.number()
		.gt(0)
		.max(1)
		.optional()
		.describe("Probability of null above which value is null. Default 0.5."),
});

/** A grid bound: a number, or an ISO date for date estimates. */
const Bound = z.union([z.number(), z.string()]);

/** What `estimate` and `forecast` share. */
const Distribution = FieldBase.extend({
	min: Bound,
	max: Bound,
	step: z
		.union([z.number().positive(), z.enum(["month", "year"])])
		.optional()
		.describe("Grid step: a positive number (days for dates), month or year."),
	scale: z.enum(["linear", "log"]).optional(),
	unit: z.string().optional(),
});

export const ExtractField = z
	.discriminatedUnion("type", [
		FieldBase.extend({ type: z.literal("text") }),
		FieldBase.extend({
			type: z.literal("number"),
			unit: z.string().optional(),
			integer: z.boolean().optional(),
			decimals: z.int().min(0).max(6).optional(),
		}),
		FieldBase.extend({
			type: z.literal("duration"),
			unit: z
				.string()
				.optional()
				.describe("seconds, minutes, hours, days, weeks, months or years."),
			integer: z.boolean().optional(),
			decimals: z.int().min(0).max(6).optional(),
		}),
		FieldBase.extend({ type: z.literal("date") }),
		FieldBase.extend({ type: z.literal("time") }),
		FieldBase.extend({ type: z.literal("datetime") }),
		FieldBase.extend({
			type: z.literal("list"),
			items: z.enum(["text", "number", "date"]),
			decimals: z.int().min(0).max(6).optional(),
		}),
		Distribution.extend({ type: z.literal("estimate") }),
		Distribution.extend({
			type: z.literal("forecast"),
			horizon: z.int().min(1).max(64).describe("Number of steps."),
			interval: z.enum([
				"step",
				"minute",
				"hour",
				"day",
				"week",
				"month",
				"quarter",
				"year",
			]),
		}),
	])
	.meta({ id: "ExtractField" });

const FieldName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/);

const Image = z.union([
	z
		.string()
		.regex(/^data:/i)
		.describe("A data URL."),
	z.strictObject({ content_type: z.string(), base64: z.string() }),
]);

export const ExtractIn = z
	.object({
		model: z.string().describe("An extraction model id."),
		state: z
			.string()
			.optional()
			.describe("The text to read from. Text answers are spans of it."),
		fields: z
			.record(FieldName, ExtractField)
			.refine((fields) => Object.keys(fields).length > 0, {
				message: "At least one field.",
			})
			.describe(
				"Field name → typed field. Each answer comes back under its name.",
			),
		images: z
			.array(Image)
			.max(4)
			.optional()
			.describe("PNG, JPEG or WebP, 4 MiB each, placed before the state."),
		reference_date: z
			.string()
			.optional()
			.describe("ISO date that anchors dates written without a year."),
		options: z
			.strictObject({
				include_quantiles: z.boolean().optional(),
				return_state_text: z.boolean().optional(),
			})
			.optional(),
	})
	.refine((body) => Boolean(body.state) || Boolean(body.images?.length), {
		message: "state is required when no images are sent.",
		path: ["state"],
	})
	.meta({ id: "ExtractIn" });

const Span = z.tuple([z.number(), z.number()]);

/** One field's answer. `value` is null when the input does not determine it. */
export const ExtractAnswer = z
	.looseObject({
		type: z.string(),
		value: JsonValue,
		guess: JsonValue.optional(),
		p_null: z.number().optional(),
		confidence: z.number().optional(),
		span: Span.optional(),
		spans: z.array(Span).optional(),
		mean: JsonValue.optional(),
		median: JsonValue.optional(),
		p10: JsonValue.optional(),
		p90: JsonValue.optional(),
		p_below: z.number().optional(),
		p_above: z.number().optional(),
		quantiles: z.array(JsonValue).optional(),
		steps: z.array(JsonValue).optional(),
	})
	.meta({ id: "ExtractAnswer" });

export const ExtractOut = z
	.object({
		model: z.string(),
		answers: z.record(z.string(), ExtractAnswer),
		truncated: z.boolean(),
		state_text: z.string().optional(),
		usage: z.object({
			input_tokens: z.number(),
			output_tokens: z.number(),
			state_tokens: z.number().optional(),
			image_tokens: z.number().optional(),
			schema_tokens: z.number().optional(),
			passes: z.number().optional(),
		}),
	})
	.meta({ id: "ExtractOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICExtraction = z.infer<typeof ExtractOut>;
