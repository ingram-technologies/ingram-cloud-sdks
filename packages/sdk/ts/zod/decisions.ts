/**
 * Hand-authored Zod schemas for `POST /v1/decisions`: OpenAI's Decisions API
 * wire, on any classifier model. Typed questions (`predicate`, `choice`,
 * `score`) about one input; one answer per question, in question order. The
 * keys are OpenAI's, so snake_case.
 *
 * The answer is loose: one relayed from OpenAI keeps any field it adds.
 */
import { z } from "zod";

const InputText = z
	.object({ type: z.literal("input_text"), text: z.string() })
	.strict();

const InputImage = z
	.object({
		type: z.literal("input_image"),
		image_url: z.string().describe("A base64 data URL."),
		detail: z.enum(["low", "high", "auto", "original"]).nullish(),
	})
	.strict();

const InputMessage = z
	.object({
		role: z.literal("user"),
		type: z.literal("message").optional(),
		content: z.union([z.string(), z.array(z.union([InputText, InputImage]))]),
	})
	.strict();

const ChoiceValue = z.union([z.string(), z.boolean()]);

const QuestionBase = z.strictObject({
	name: z.string().optional(),
	instructions: z.string(),
});

export const DecisionQuestion = z.discriminatedUnion("type", [
	QuestionBase.extend({ type: z.literal("predicate") }),
	QuestionBase.extend({
		type: z.literal("choice"),
		choices: z
			.array(
				z.strictObject({
					value: ChoiceValue,
					description: z.string().optional(),
				}),
			)
			.min(1),
	}),
	QuestionBase.extend({
		type: z.literal("score"),
		levels: z
			.array(
				z.strictObject({
					label: z.string(),
					description: z.string().optional(),
				}),
			)
			.min(2),
	}),
]);

export const DecisionsIn = z
	.object({
		model: z.string().min(1),
		input: z.union([z.string(), z.array(InputMessage).min(1)]),
		questions: z.array(DecisionQuestion).min(1),
		safety_identifier: z.string().max(128).nullish(),
	})
	.strict()
	.meta({ id: "DecisionsIn" });

export const DecisionAnswer = z.discriminatedUnion("type", [
	z.looseObject({
		type: z.literal("predicate"),
		name: z.string().nullable(),
		probability: z.number(),
	}),
	z.looseObject({
		type: z.literal("choice"),
		name: z.string().nullable(),
		choice: ChoiceValue,
		confidence: z.number().optional(),
		probabilities: z.array(
			z.object({ value: ChoiceValue, probability: z.number() }),
		),
	}),
	z.looseObject({
		type: z.literal("score"),
		name: z.string().nullable(),
		score: z.number(),
		confidence: z.number().optional(),
		probabilities: z.array(
			z.object({ value: z.number(), label: z.string(), probability: z.number() }),
		),
	}),
	z.looseObject({ type: z.literal("refusal"), name: z.string().nullable() }),
]);

const DecisionUsage = z.looseObject({
	input_tokens: z.number(),
	input_tokens_details: z
		.object({ cached_tokens: z.number(), cache_write_tokens: z.number() })
		.optional(),
	output_tokens: z.number(),
	output_tokens_details: z.object({ reasoning_tokens: z.number() }).optional(),
	total_tokens: z.number(),
});

export const DecisionsOut = z
	.looseObject({
		model: z.string(),
		answers: z.array(DecisionAnswer),
		usage: DecisionUsage,
	})
	.meta({ id: "DecisionsOut" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICDecision = z.infer<typeof DecisionsOut>;
export type ICDecisionAnswer = z.infer<typeof DecisionAnswer>;
