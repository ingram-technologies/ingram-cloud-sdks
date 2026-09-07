import { describe, expect, it } from "vitest";

import { loadSpec, operations } from "../src/spec";

describe("the spec snapshot", () => {
	it("gives every commandable operation an id, a method and a path", () => {
		const ops = operations(loadSpec());
		expect(ops.length).toBeGreaterThan(150);
		for (const op of ops) {
			expect(op.id, `${op.method} ${op.path}`).toMatch(
				/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/,
			);
			expect(op.path.startsWith("/")).toBe(true);
		}
	});

	it("excludes operations that carry no bearer token", () => {
		// A webhook receiver, a hosted page and the OAuth endpoints are called by
		// providers and browsers, never by this tool holding a key. A command for
		// one would be a command nobody can run.
		const ids = operations(loadSpec()).map((o) => o.id);
		expect(ids).not.toContain("stripe.webhook");
		expect(ids).not.toContain("oauth.token");
		expect(ids).toContain("smiths.list");
	});

	it("carries the api version the snapshot was taken under", () => {
		expect(loadSpec()["x-ic-api-version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
