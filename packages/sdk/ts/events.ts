/**
 * The Ingram Cloud event types — HAND-AUTHORED (not generated).
 *
 * Two event surfaces ride the native `{v:1}` envelope and are deliberately NOT in
 * `openapi.json`: OpenAPI can't describe an SSE frame sequence (even OpenAI's own
 * spec doesn't type its stream chunks — SDKs hand-define them). So these live
 * here, hand-authored, and must be kept in step with
 * `web/src/content/docs/events.md` (the canonical catalog).
 *
 * 1. {@link webhookEvent} — the append-only feed / webhook delivery envelope
 *    (`GET /v1/events`, signed webhook POSTs).
 * 2. {@link streamFrame} — the live SSE run-stream frames (`POST .../runs` with
 *    `stream:true`), i.e. `runs.py::_stream`.
 *
 * `data` is `.passthrough()` on purpose: the catalog documents the *notable*
 * fields per type, not an exhaustive closed shape — same philosophy as the
 * `extra="allow"` response models. Consumers narrow on `type` / `event`.
 */
import { z } from "zod";

// ─── Feed / webhook event types (docs/events.md "Event type catalog") ────────
// Only these reach the `/v1/events` feed and signed webhooks. Pure run-stream frames
// — `run.started`, `message.delta`, `message.completed`, `run.cancelled` — ride the
// live SSE stream and the per-run timeline only; they are NOT feed events (see
// {@link STREAM_EVENTS}). `tool.executing` / `tool.completed` are both: a live frame
// AND a feed event.
export const EVENT_TYPES = [
	"run.paused",
	"run.completed",
	"run.failed",
	"tool.executing",
	"tool.completed",
	"approval.required",
	"approval.resolved",
	"connection.required",
	"unbound_message",
	"budget.threshold",
	"credit.exhausted",
	"deployment.bound",
	"deployment.inbound",
	"slack.app_provisioned",
	"slack.install",
	"slack.uninstalled",
	"email.send_failed",
	"webhook.test",
] as const;

export const eventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventType>;

/**
 * The envelope carried identically by the `/v1/events` feed and signed webhook
 * POSTs. `type` is a plain string (not the enum) so a forward-added type still
 * parses; compare against {@link EVENT_TYPES} / {@link eventType} when narrowing.
 */
export const webhookEvent = z
	.object({
		v: z.literal(1),
		id: z.string(),
		type: z.string(),
		created_at: z.string(),
		tenant_id: z.string(),
		smith_id: z.string().nullable().optional(),
		data: z.record(z.string(), z.unknown()).default({}),
	})
	.passthrough();
export type WebhookEvent = z.infer<typeof webhookEvent>;

// ─── Native SSE run-stream frames (runs.py::_stream `{v:1, run_id, ...}`) ─────
// The SSE `event:` line becomes `event`; the frame's data fields sit alongside
// `v` / `run_id`. `tool.executing` / `tool.completed` ride the live stream as they
// happen AND are mirrored to the run timeline + feed (see EVENT_TYPES) so a run's
// tool activity is auditable after the fact. The standard surface expresses the same
// live status on the OpenAI Responses API (`/v1/responses`) as `mcp_call` items
// (`response.mcp_call.in_progress` / `.completed`); those are standard OpenAI shapes,
// so we don't re-type them here — consume them with the OpenAI/AI SDK. These native
// frames are the place to retire as that lands everywhere (see CLAUDE.md).
export const STREAM_EVENTS = [
	"run.started",
	"message.delta",
	"tool.executing",
	"tool.completed",
	"run.paused",
	"approval.required",
	"run.completed",
	"run.failed",
	"run.cancelled",
	"run.duplicate",
	"message.completed",
] as const;

export const streamEventName = z.enum(STREAM_EVENTS);
export type StreamEventName = z.infer<typeof streamEventName>;

export const streamFrame = z
	.object({
		event: z.string(),
		v: z.number().optional(),
		run_id: z.string().optional(),
	})
	.passthrough();
export type StreamFrame = z.infer<typeof streamFrame>;

// ─── A few well-known `data` shapes (convenience; still passthrough) ─────────
export const messageDeltaData = z.object({ delta: z.string() }).passthrough();
export const runCompletedData = z
	.object({
		stop_reason: z.string(),
		usage: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();
export const approvalRequiredData = z
	.object({
		approval_id: z.string(),
		tool: z.string().nullable().optional(),
		args: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();
export const toolActivityData = z.object({ tool: z.string().nullable() }).passthrough();
