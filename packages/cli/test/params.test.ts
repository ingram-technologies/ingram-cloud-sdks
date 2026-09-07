import { describe, expect, it } from "vitest";

import { bodyFromFlags, flagsForOperation } from "../src/params";
import type { Operation } from "../src/spec";

const op = (over: Partial<Operation> = {}): Operation => ({
	id: "smiths.create",
	method: "post",
	path: "/v1/smiths",
	summary: "Create a smith",
	description: "",
	pathParams: [],
	queryParams: [],
	body: {
		type: "object",
		required: ["external_id"],
		properties: {
			external_id: { type: "string", description: "Your own user id" },
			display_name: { type: "string" },
			auto_memory: { type: "boolean" },
			temperature: { type: "number" },
			tags: { type: "array", items: { type: "string" } },
			metadata: { type: "object" },
		},
	},
	requestMediaTypes: [],
	responseMediaTypes: [],
	...over,
});

describe("flagsForOperation", () => {
	it("names a snake_case property as a kebab-case flag", () => {
		const flags = flagsForOperation(op());
		expect(Object.keys(flags)).toContain("external-id");
		expect(Object.keys(flags)).toContain("auto-memory");
	});

	it("makes a boolean property a boolean flag, so --auto-memory needs no value", () => {
		expect(flagsForOperation(op())["auto-memory"].kind).toBe("boolean");
	});
});

describe("bodyFromFlags", () => {
	it("builds the JSON the schema describes, typed", () => {
		expect(
			bodyFromFlags(op(), {
				"external-id": "user_42",
				"auto-memory": true,
				temperature: "0.4",
				tags: ["a", "b"],
			}),
		).toEqual({
			external_id: "user_42",
			auto_memory: true,
			temperature: 0.4,
			tags: ["a", "b"],
		});
	});

	it("reads a value that starts with @ from a file", async () => {
		const path = `${import.meta.dirname}/fixtures/instructions.md`;
		expect(bodyFromFlags(op(), { "display-name": `@${path}` })).toEqual({
			display_name: "Be helpful.\n",
		});
	});

	it("parses an object-typed property as inline JSON", () => {
		expect(bodyFromFlags(op(), { metadata: '{"plan":"pro"}' })).toEqual({
			metadata: { plan: "pro" },
		});
	});

	it("rejects inline JSON that does not parse, naming the flag", () => {
		expect(() => bodyFromFlags(op(), { metadata: "{oops" })).toThrow(/--metadata/);
	});

	it("merges flags over a file body, so -f is a starting point", () => {
		expect(
			bodyFromFlags(
				op(),
				{ "display-name": "Ada" },
				{ external_id: "u1", display_name: "old" },
			),
		).toEqual({ external_id: "u1", display_name: "Ada" });
	});
});
