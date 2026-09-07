import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderFrames } from "../src/render";
import type { RenderFrame } from "../src/render";

const here = dirname(fileURLToPath(import.meta.url));

/** One fixture line is `{event, data}`, `data` still an object — re-encoded
 *  to the JSON-string-payload shape `renderFrames` (and `readSse`) actually
 *  consume off the wire. Two fixtures, not one sliced in two: a real run
 *  never emits `run.completed` after `approval.required` (a paused run's
 *  stream ends at the pause), so a single linear fixture would misrepresent
 *  the wire it is meant to pin. */
function readFixture(name: string): RenderFrame[] {
	const raw = readFileSync(join(here, "fixtures", name), "utf8");
	return raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			const parsed = JSON.parse(line) as {
				event: string;
				data: Record<string, unknown>;
			};
			return { event: parsed.event, data: JSON.stringify(parsed.data) };
		});
}

async function* toAsync(items: readonly RenderFrame[]): AsyncGenerator<RenderFrame> {
	for (const item of items) yield item;
}

/** A turn that pauses on a gated tool's elicitation. */
function frames() {
	return toAsync(readFixture("run-frames.ndjson"));
}

/** A turn that finishes cleanly. */
function completedFrames() {
	return toAsync(readFixture("run-frames-completed.ndjson"));
}

describe("renderFrames", () => {
	it("writes the assistant's words as they arrive", async () => {
		const out: string[] = [];
		const result = await renderFrames(frames(), {
			write: (s) => out.push(s),
			tty: true,
		});
		expect(out.join("")).toContain("Hello there");
		expect(result.kind).toBe("approval");
	});

	it("surfaces an approval with its tool, arguments and question", async () => {
		const result = await renderFrames(frames(), { write: () => {}, tty: true });
		expect(result).toMatchObject({
			kind: "approval",
			approvalId: expect.stringMatching(/^apr_/),
			tool: "delete_record",
			elicitation: { message: "Which account?" },
		});
	});

	it("reports a completed run with its stop reason", async () => {
		const result = await renderFrames(completedFrames(), {
			write: () => {},
			tty: true,
		});
		expect(result).toMatchObject({ kind: "completed", stopReason: "stop" });
	});
});
