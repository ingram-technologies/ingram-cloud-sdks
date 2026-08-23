/**
 * Hand-authored Zod schemas for the `schedules` resource — cron-triggered runs
 * on a smith's agent — the wire's source of truth, replacing the loose
 * generated `schemas.ts` shapes for this resource.
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

/** A schedule's stored input: messages replayed as the run input on each fire. */
const ScheduleInput = z.array(z.record(z.string(), z.unknown()));

export const ScheduleOut = z
	.object({
		id: z.string(),
		name: z.string().nullable(),
		cron: z.string(),
		timezone: z.string(),
		/** Messages replayed as the run input on each fire. */
		input: ScheduleInput,
		/** Thread the fired runs append to; null mints a fresh thread per fire. */
		thread_id: z.string().nullable(),
		enabled: z.boolean(),
		next_fire_at: z.string().nullable(),
		last_fire_at: z.string().nullable(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "ScheduleOut" });

export const ScheduleListOut = pageOut(ScheduleOut, "ScheduleListOut");

/** `POST .../:sid/run_now` — the fire is enqueued onto the smith's serial delivery
 *  lane (not run inline), so the response acknowledges the queued delivery rather
 *  than a completed run. Poll `/v1/events` or the smith's runs for the outcome. */
export const ScheduleRunNowOut = z
	.object({
		schedule_id: z.string(),
		delivery_id: z.string(),
		status: z.literal("queued"),
	})
	.meta({ id: "ScheduleRunNowOut" });

// ── Request bodies ──────────────────────────────────────────────────────────

export const ScheduleIn = z
	.object({
		cron: z.string(),
		name: z.string().nullish(),
		timezone: z.string().default("UTC"),
		input: ScheduleInput.default([]),
		thread_id: z.string().nullish(),
		enabled: z.boolean().default(true),
	})
	.meta({ id: "ScheduleIn" });

export const SchedulePatch = z
	.object({
		name: z.string().nullish(),
		cron: z.string().nullish(),
		timezone: z.string().nullish(),
		input: ScheduleInput.nullish(),
		thread_id: z.string().nullish(),
		enabled: z.boolean().nullish(),
	})
	.meta({ id: "SchedulePatch" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICSchedule = z.infer<typeof ScheduleOut>;
