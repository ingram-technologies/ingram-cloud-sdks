/**
 * Hand-authored Zod schemas for `POST /v1/evaluate`: typed questions about one
 * state, answered by a classifier model. The wire is the AI Gateway's
 * `/v1/evaluate`, whose fields are the AI SDK's `EvaluationModelV4`, so the keys
 * are camelCase on purpose.
 *
 * `.meta({ id })` names each recursive or shared part, so the emitted OpenAPI
 * references it as `#/components/schemas/<id>` rather than inlining it
 * (`z.json()` overflows the OpenAPI generator).
 */
import { z } from "zod";

/** Any JSON value. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export const JsonValue: z.ZodType<JsonValue> = z
	.lazy(() =>
		z.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.null(),
			z.array(JsonValue),
			z.record(z.string(), JsonValue),
		]),
	)
	.meta({ id: "JsonValue" });

/** A state, an instruction or a criterion: text, or structured JSON. */
export type EvaluationInput = string | { [key: string]: JsonValue } | JsonValue[];

export const EvaluationInput: z.ZodType<EvaluationInput> = z
	.union([z.string(), z.record(z.string(), JsonValue), z.array(JsonValue)])
	.meta({ id: "EvaluationInput" });

/** A criterion's description; null for none. */
const Description = EvaluationInput.nullable();

export const EvaluationQuestion = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("choice"),
			instructions: EvaluationInput,
			criteria: z
				.record(z.string(), Description)
				.refine((criteria) => Object.keys(criteria).length > 0, {
					message: "A choice question needs at least one option.",
				})
				.describe("Option name → description."),
		}),
		z.object({
			type: z.literal("score"),
			instructions: EvaluationInput,
			criteria: z
				.array(Description)
				.min(2)
				.describe("Ordered levels, lowest first."),
		}),
		z.object({
			type: z.literal("boolean"),
			instructions: EvaluationInput,
			criteria: z
				.strictObject({
					true: Description.optional(),
					false: Description.optional(),
				})
				.optional(),
		}),
	])
	.meta({ id: "EvaluationQuestion" });

export const EvaluateIn = z
	.object({
		model: z
			.string()
			.optional()
			.describe(
				"A classifier model id. Defaults to the platform's evaluation model.",
			),
		state: EvaluationInput,
		questions: z
			.record(z.string(), EvaluationQuestion)
			.describe("Question id → question. Each answer comes back under its id."),
	})
	.meta({ id: "EvaluateIn" });

const Probabilities = z.record(z.string(), z.number());

export const EvaluateOut = z
	.object({
		model: z.string(),
		answers: z.record(
			z.string(),
			z.discriminatedUnion("type", [
				z.object({
					type: z.literal("choice"),
					choice: z.string(),
					probabilities: Probabilities.optional(),
				}),
				z.object({
					type: z.literal("score"),
					score: z.number(),
					probabilities: Probabilities.optional(),
				}),
				z.object({ type: z.literal("boolean"), probability: z.number() }),
			]),
		),
		usage: z.object({
			inputTokens: z.number().optional(),
			outputTokens: z.number().optional(),
		}),
		rounding: z
			.object({
				probabilityDecimals: z.number().optional(),
				scoreDecimals: z.number().optional(),
			})
			.optional(),
		warnings: z.array(z.looseObject({ type: z.string() })).optional(),
		providerMetadata: z
			.record(z.string(), z.record(z.string(), z.unknown()))
			.optional(),
	})
	.meta({ id: "EvaluateOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICEvaluation = z.infer<typeof EvaluateOut>;
