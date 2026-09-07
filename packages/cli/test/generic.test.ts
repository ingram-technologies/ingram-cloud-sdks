import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApplication, run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { genericCommand } from "../src/generic";
import type { Operation } from "../src/spec";

/**
 * `app.test.ts` proves every operation gets a command; these exercise what
 * that command actually does when run — the piece `app.test.ts` doesn't
 * touch, since it only inspects the built tree's shape.
 */

const op = (over: Partial<Operation> = {}): Operation => ({
	id: "smiths.list",
	method: "get",
	path: "/v1/smiths",
	summary: "List smiths",
	description: "",
	pathParams: [],
	queryParams: [],
	body: null,
	requestMediaTypes: [],
	responseMediaTypes: [],
	...over,
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

/** Run a generic command against a mocked transport, capturing stdout. */
async function invoke(
	operation: Operation,
	args: string[],
	fetchImpl: typeof fetch,
): Promise<{ out: string; exitCode: number | string | null | undefined }> {
	vi.stubGlobal("fetch", fetchImpl);
	const app = buildApplication(genericCommand(operation, "2026-05-01"), {
		name: "ic",
	});
	const out: string[] = [];
	const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		out.push(String(chunk));
		return true;
	});
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	process.exitCode = undefined;
	try {
		await run(app, args, { process });
	} finally {
		stdout.mockRestore();
		stderr.mockRestore();
	}
	return { out: out.join(""), exitCode: process.exitCode };
}

beforeEach(() => {
	vi.stubEnv("INGRAM_CLOUD_TOKEN", "tok_test");
	vi.stubEnv("IC_BASE_URL", "https://x.test");
	vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "ic-cli-generic-")));
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	process.exitCode = undefined;
});

describe("genericCommand", () => {
	it("sends the bearer token and prints the response body", async () => {
		const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
			expect(String(url)).toBe("https://x.test/v1/smiths");
			expect(
				(init?.headers as Record<string, string> | undefined)?.authorization,
			).toBe("Bearer tok_test");
			return jsonResponse({ data: [{ id: "smt_1" }] });
		});
		const { out } = await invoke(
			op(),
			["--json"],
			fetchImpl as unknown as typeof fetch,
		);
		expect(JSON.parse(out)).toEqual({ data: [{ id: "smt_1" }] });
	});

	it("builds the request body from flags", async () => {
		let sentBody: unknown;
		const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			sentBody = JSON.parse(String(init?.body));
			return jsonResponse({ id: "smt_1" });
		});
		const create = op({
			id: "smiths.create",
			method: "post",
			path: "/v1/smiths",
			body: {
				type: "object",
				required: ["external_id"],
				properties: { external_id: { type: "string" } },
			},
		});
		await invoke(
			create,
			["--external-id", "user_42", "--json"],
			fetchImpl as unknown as typeof fetch,
		);
		expect(sentBody).toEqual({ external_id: "user_42" });
	});

	it("does not send a 204 body through the renderer", async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
		const del = op({
			id: "smiths.delete",
			method: "delete",
			path: "/v1/smiths/{pid}",
			pathParams: [{ name: "pid", in: "path", schema: { type: "string" } }],
		});
		const { out, exitCode } = await invoke(
			del,
			["smt_1CeiMLuPbyEaUASpW5BbxU", "--yes", "--json"],
			fetchImpl as unknown as typeof fetch,
		);
		expect(out).toBe("");
		expect(exitCode).not.toBeGreaterThan(0);
	});

	it("skips the delete confirmation off a terminal, so a script can run non-interactively", async () => {
		// A pipe/CI runner is never a TTY; `op.method === "delete" && tty` gates
		// the confirmation prompt, so this exercises the branch that reaches the
		// API directly without needing --yes.
		const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
		const del = op({
			id: "smiths.delete",
			method: "delete",
			path: "/v1/smiths/{pid}",
			pathParams: [{ name: "pid", in: "path", schema: { type: "string" } }],
		});
		await invoke(
			del,
			["smt_1CeiMLuPbyEaUASpW5BbxU"],
			fetchImpl as unknown as typeof fetch,
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("follows every page with --all-pages", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					data: [{ id: "smt_1" }],
					has_more: true,
					next_cursor: "c2",
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					data: [{ id: "smt_2" }],
					has_more: false,
					next_cursor: null,
				}),
			);
		const { out } = await invoke(
			op(),
			["--all-pages", "--json"],
			fetchImpl as unknown as typeof fetch,
		);
		expect(JSON.parse(out)).toEqual({ data: [{ id: "smt_1" }, { id: "smt_2" }] });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("refuses to loop forever when a page's cursor does not advance", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				data: [{ id: "smt_1" }],
				has_more: true,
				next_cursor: "same",
			}),
		);
		const { exitCode } = await invoke(
			op(),
			["--all-pages", "--json"],
			fetchImpl as unknown as typeof fetch,
		);
		// A server bug repeating a cursor must surface as a reported error, not
		// hang the process re-fetching the same page.
		expect(exitCode).toBeGreaterThan(0);
		expect(fetchImpl.mock.calls.length).toBeLessThan(5);
	});

	it("routes an organization path the organization key, everything else the project token", async () => {
		vi.unstubAllEnvs();
		vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "ic-cli-generic-")));
		// Directly set a profile with distinct org/project credentials so the
		// two tiers are provably different, rather than the single-token env
		// shortcut the other tests use.
		const { saveConfig } = await import("../src/config");
		const env = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
		saveConfig(
			{
				profiles: {
					default: {
						base_url: "https://x.test",
						org_key: "org_tok",
						project: {
							id: "proj_1",
							name: "acme",
							token: "proj_tok",
							token_id: "tok_1",
						},
					},
				},
			},
			env,
		);
		let authHeader = "";
		const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			authHeader =
				(init?.headers as Record<string, string> | undefined)?.authorization ??
				"";
			return jsonResponse({ data: [] });
		});
		await invoke(
			op({ id: "organization.projects.list", path: "/v1/organization/projects" }),
			["--json"],
			fetchImpl as unknown as typeof fetch,
		);
		expect(authHeader).toBe("Bearer org_tok");

		await invoke(op(), ["--json"], fetchImpl as unknown as typeof fetch);
		expect(authHeader).toBe("Bearer proj_tok");
	});
});
