import { describe, expect, it } from "vitest";

import { renderList, renderObject } from "../src/output";
import { exitCodeFor, messageFor } from "../src/errors";

describe("renderList", () => {
	it("puts the id first and the natural key beside it", () => {
		const table = renderList([
			{
				id: "smt_1",
				external_id: "user_42",
				status: "live",
				created_at: "2026-09-01T10:00:00Z",
			},
			{
				id: "smt_2",
				external_id: "user_43",
				status: "live",
				created_at: "2026-09-02T10:00:00Z",
			},
		]);
		const [header] = table.split("\n");
		expect(header.indexOf("ID")).toBeLessThan(header.indexOf("EXTERNAL_ID"));
		// Ids print in full: an abbreviated id in a table is one a reader cannot
		// copy, which is the whole point of printing it.
		expect(table).toContain("smt_1");
	});

	it("says so when there is nothing, instead of printing an empty table", () => {
		expect(renderList([])).toBe("No results.");
	});
});

describe("renderObject", () => {
	it("prints one field per line, nested objects indented", () => {
		expect(renderObject({ id: "smt_1", usage: { input_tokens: 12 } })).toBe(
			"id:    smt_1\nusage:\n  input_tokens: 12",
		);
	});
});

describe("errors", () => {
	it("shows the message, the code and the request id", () => {
		const e = Object.assign(new Error("x"), {
			status: 404,
			code: "not_found",
			requestId: "req_9",
			detail: "No smith with that id.",
		});
		expect(messageFor(e)).toBe("No smith with that id. (not_found) request req_9");
	});

	it("exits 3 when not signed in, so a script can tell it from a real failure", () => {
		expect(exitCodeFor(new Error("Not signed in. Run: ic login"))).toBe(3);
		expect(exitCodeFor(Object.assign(new Error("x"), { status: 404 }))).toBe(1);
	});
});
