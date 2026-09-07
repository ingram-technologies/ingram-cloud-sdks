import { describe, expect, it, vi } from "vitest";

import { print, renderList, renderObject } from "../src/output";
import { exitCodeFor, messageFor, reportError } from "../src/errors";

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

const write = (fn: () => void) => {
	const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	try {
		fn();
		return spy.mock.calls.map((c) => c[0]).join("");
	} finally {
		spy.mockRestore();
	}
};

describe("print", () => {
	it("renders a page's data as a table on a terminal", () => {
		const out = write(() =>
			print({ data: [{ id: "smt_1" }] }, { json: false, tty: true }),
		);
		expect(out).toContain("ID");
		expect(out).toContain("smt_1");
	});

	it("prints a scalar body as-is, rather than routing it through renderObject", () => {
		// Object.keys("ok") is ['0','1']; renderObject would silently render
		// per-character garbage instead of the string.
		expect(write(() => print("ok", { json: false, tty: true }))).toBe("ok\n");
		expect(write(() => print(null, { json: false, tty: true }))).toBe("\n");
	});

	it("passes the body through untouched off a terminal, or with --json", () => {
		expect(write(() => print({ id: "smt_1" }, { json: false, tty: false }))).toBe(
			`${JSON.stringify({ id: "smt_1" }, null, 2)}\n`,
		);
		expect(write(() => print({ id: "smt_1" }, { json: true, tty: true }))).toBe(
			`${JSON.stringify({ id: "smt_1" }, null, 2)}\n`,
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

	it("handles a thrown value that is not an Error, instead of printing the literal string undefined", () => {
		// throw accepts any value; a rejected promise's reason is often a bare
		// string, and reportError is the last-resort handler — it must not
		// itself crash or discard the failure text.
		expect(messageFor("Not signed in. Run: ic login")).toBe(
			"Not signed in. Run: ic login",
		);
		expect(exitCodeFor("Not signed in. Run: ic login")).toBe(3);
		expect(exitCodeFor(null)).toBe(2);
	});

	it("reports a failure to stderr and returns its exit code", () => {
		const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const code = reportError(new Error("Not signed in. Run: ic login"));
		expect(spy).toHaveBeenCalledWith("error: Not signed in. Run: ic login\n");
		expect(code).toBe(3);
		spy.mockRestore();
	});
});
