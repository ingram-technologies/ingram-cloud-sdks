import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IngramCloud } from "@ingram-cloud/sdk/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "../src/client";
import { readCache, recordSeen, resolveRef } from "../src/ids";
import type { Operation } from "../src/spec";

/**
 * `ids.test.ts` pins the pure pieces (`classifyRef`, `pickPrefixMatch`,
 * `mergeCache`); these exercise `resolveRef` and `recordSeen` against a
 * mocked transport, the way `generic.test.ts` does for the generated
 * commands — the two functions every path parameter in every generated
 * command actually flows through.
 */

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function session(
	fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Session {
	const ic = new IngramCloud({
		token: "tok",
		baseURL: "https://x.test",
		fetch: fetchImpl as never,
	});
	return {
		profile: { base_url: "https://x.test" },
		ic,
		apiVersion: "2026-05-01",
		token: () => "tok",
	};
}

const smithsList = (over: Partial<Operation> = {}): Operation => ({
	id: "smiths.get",
	method: "get",
	path: "/v1/smiths/{pid}",
	summary: "",
	description: "",
	pathParams: [{ name: "pid", in: "path", schema: { type: "string" } }],
	queryParams: [],
	body: null,
	requestMediaTypes: [],
	responseMediaTypes: [],
	...over,
});

let env: { XDG_CACHE_HOME: string };

beforeEach(() => {
	env = { XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "ic-cli-idcache-")) };
	vi.stubEnv("XDG_CACHE_HOME", env.XDG_CACHE_HOME);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("resolveRef", () => {
	it("returns an id-shaped value as-is, with no request", async () => {
		const fetchImpl = vi.fn();
		const s = session(fetchImpl as never);
		const id = await resolveRef(
			{
				session: s,
				profile: "default",
				op: smithsList(),
				paramIndex: 0,
				resolvedIds: [],
			},
			"smt_1CeiMLuPbyEaUASpW5BbxU",
		);
		expect(id).toBe("smt_1CeiMLuPbyEaUASpW5BbxU");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("resolves a natural key via the resource's exact server-side filter", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			expect(url).toContain("/v1/smiths?external_id=user_42");
			return jsonResponse({ data: [{ id: "smt_1CeiMLuPbyEaUASpW5BbxU" }] });
		});
		const s = session(fetchImpl as never);
		const id = await resolveRef(
			{
				session: s,
				profile: "default",
				op: smithsList(),
				paramIndex: 0,
				resolvedIds: [],
			},
			"user_42",
		);
		expect(id).toBe("smt_1CeiMLuPbyEaUASpW5BbxU");
	});

	it("resolves last~N to the Nth-newest row", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				data: [{ id: "smt_a" }, { id: "smt_b" }, { id: "smt_c" }],
				has_more: false,
			}),
		);
		const s = session(fetchImpl as never);
		const id = await resolveRef(
			{
				session: s,
				profile: "default",
				op: smithsList(),
				paramIndex: 0,
				resolvedIds: [],
			},
			"last~2",
		);
		expect(id).toBe("smt_c");
	});

	it("errors, naming the parameter, for a path with no resource rule", async () => {
		const op = smithsList({
			path: "/v1/no-such-resource/{pid}",
			pathParams: [{ name: "pid", in: "path", schema: { type: "string" } }],
		});
		const s = session(vi.fn() as never);
		await expect(
			resolveRef(
				{ session: s, profile: "default", op, paramIndex: 0, resolvedIds: [] },
				"abcdef",
			),
		).rejects.toThrow(/does not know how to look up/);
	});
});

describe("recordSeen and the project/tenant token ambiguity", () => {
	it("caches an id with its label from a printed response", () => {
		recordSeen("default", {
			data: [{ id: "smt_1CeiMLuPbyEaUASpW5BbxU", external_id: "user_42" }],
		});
		const cached = readCache("default");
		expect(cached).toEqual([
			expect.objectContaining({
				id: "smt_1CeiMLuPbyEaUASpW5BbxU",
				resource: "smith",
				label: "user_42",
			}),
		]);
	});

	it("never labels a tok_ id, since a project token and a tenant token share the prefix", () => {
		// A wrong label here would let a prefix lookup for one silently return
		// the other from the cache — see the comment on PREFIX_RESOURCE in
		// ids.ts. Recording a tok_ id must not manufacture a false resource.
		recordSeen("default", { id: "tok_1CeiMLuPbyEaUASpW5BbxU" });
		const [entry] = readCache("default");
		expect(entry?.resource).not.toBe("project token");
		expect(entry?.resource).not.toBe("tenant token");
	});
});
