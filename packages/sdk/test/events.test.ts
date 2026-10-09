/**
 * `runs.events()` returns what a run has recorded and then returns. The API's events
 * endpoint follows a run in flight unless told otherwise, so the call must say so.
 */
import { describe, expect, it } from "vitest";
import { IngramCloud } from "../ts/client.js";

describe("runs.events", () => {
	it("asks the API to close after the recorded events, and parses them", async () => {
		const urls: string[] = [];
		const ic = new IngramCloud({
			baseURL: "https://x",
			token: "t",
			fetch: async (url) => {
				urls.push(url);
				return new Response(
					'id: 0\nevent: run.started\ndata: {"v":1,"run_id":"run_1"}\n\n' +
						'id: 1\nevent: run.completed\ndata: {"v":1,"run_id":"run_1"}\n\n',
				);
			},
		});

		const events = await ic.smiths.runs.events("smt_1", "run_1");

		expect(urls).toEqual([
			"https://x/v1/smiths/smt_1/runs/run_1/events?follow=false",
		]);
		expect(events.map((event) => [event.seq, event.type])).toEqual([
			[0, "run.started"],
			[1, "run.completed"],
		]);
	});
});
