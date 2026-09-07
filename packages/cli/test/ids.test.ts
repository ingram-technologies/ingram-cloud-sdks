import { describe, expect, it } from "vitest";

import { classifyRef, mergeCache, pickPrefixMatch } from "../src/ids";

describe("classifyRef", () => {
	it("reads a prefixed id as an id", () => {
		expect(classifyRef("smt_1CeiMLuPbyEaUASpW5BbxU")).toBe("id");
	});

	it("reads an external id as a natural key, because base58 has no underscore", () => {
		// `user_42` cannot be an id prefix: the alphabet excludes `_`. That is
		// what keeps the two forms apart without asking the caller.
		expect(classifyRef("user_42")).toBe("key");
	});

	it("reads a bare base58 run as a prefix", () => {
		expect(classifyRef("1CeiML")).toBe("prefix");
	});

	it("reads last and last~2 as positions", () => {
		expect(classifyRef("last")).toBe("position");
		expect(classifyRef("last~2")).toBe("position");
	});
});

describe("pickPrefixMatch", () => {
	it("returns the one match", () => {
		expect(pickPrefixMatch(["smt_1CeiMLa", "smt_9xx"], "1CeiML")).toBe(
			"smt_1CeiMLa",
		);
	});

	it("refuses two matches, naming both", () => {
		// Silently taking the newest would act on a resource the caller did not
		// name — the one failure mode an abbreviation must never have.
		expect(() => pickPrefixMatch(["smt_1CeiMLa", "smt_1CeiMLb"], "1CeiML")).toThrow(
			/smt_1CeiMLa.*smt_1CeiMLb/s,
		);
	});

	it("returns null when nothing matches, so the caller can widen the search", () => {
		expect(pickPrefixMatch(["smt_9xx"], "1CeiML")).toBeNull();
	});
});

describe("mergeCache", () => {
	it("keeps the newest entries and drops the oldest past the cap", () => {
		const entries = Array.from({ length: 12 }, (_, i) => ({
			id: `smt_${i}`,
			resource: "smith",
			label: `user_${i}`,
			seen_at: i,
		}));
		const merged = mergeCache([], entries, 10);
		expect(merged).toHaveLength(10);
		expect(merged.map((e) => e.id)).toContain("smt_11");
		expect(merged.map((e) => e.id)).not.toContain("smt_0");
	});
});
