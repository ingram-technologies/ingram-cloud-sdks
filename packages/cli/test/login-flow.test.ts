import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApplication, run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logoutCommand, redeem } from "../src/commands/login";
import { loadConfig, saveConfig } from "../src/config";

/**
 * `login.test.ts` pins the pure PKCE helpers; these exercise the network
 * behavior around them — the exchange and the revoke — the way
 * `generic.test.ts` does for the generated commands. `awaitCode`/
 * `openBrowser` (real sockets, a real subprocess) are left to the manual
 * walk: there is nothing left to fake that would still prove anything.
 */

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

beforeEach(() => {
	vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "ic-cli-login-")));
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("redeem", () => {
	it("sends the code and verifier, and returns the granted token", async () => {
		let sentBody: unknown;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string | URL, init?: RequestInit) => {
				expect(String(url)).toBe("https://console.test/api/cli/token");
				sentBody = JSON.parse(String(init?.body));
				return jsonResponse({
					token: "org_tok",
					organization_id: "org_1",
					expires_at: "2027-01-01T00:00:00Z",
				});
			}),
		);
		const granted = await redeem("https://console.test", "code_1", "verifier_1");
		expect(sentBody).toEqual({ code: "code_1", verifier: "verifier_1" });
		expect(granted).toEqual({
			token: "org_tok",
			organization_id: "org_1",
			expires_at: "2027-01-01T00:00:00Z",
		});
	});

	it("gives a specific message for an expired or reused code", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({ error: "invalid_grant" }, { status: 400 }),
			),
		);
		await expect(
			redeem("https://console.test", "code_1", "verifier_1"),
		).rejects.toThrow(/expired or already used/);
	});

	it("names the status for any other refusal", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({}, { status: 500 })),
		);
		await expect(
			redeem("https://console.test", "code_1", "verifier_1"),
		).rejects.toThrow(/500/);
	});
});

/** `mockRestore()` clears recorded calls along with the mock, so the written
 *  lines are captured before restoring, not read off the spy after. */
async function stderrLines(fn: () => Promise<void>): Promise<string[]> {
	const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		await fn();
		return spy.mock.calls.map((c) => String(c[0]));
	} finally {
		spy.mockRestore();
	}
}

describe("logoutCommand", () => {
	it("revokes the project token, then drops the profile", async () => {
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
		const fetchImpl = vi.fn(
			async (_url: string | URL) => new Response(null, { status: 204 }),
		);
		vi.stubGlobal("fetch", fetchImpl);

		const lines = await stderrLines(() =>
			run(buildApplication(logoutCommand, { name: "ic" }), [], { process }),
		);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
			"/v1/tenant/tokens/tok_1",
		);
		expect(loadConfig(env).profiles.default).toBeUndefined();
		expect(lines.some((l) => l.includes("Signed out"))).toBe(true);
	});

	it("removes the profile locally even when the revoke call fails", async () => {
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
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 500 })),
		);

		const lines = await stderrLines(() =>
			run(buildApplication(logoutCommand, { name: "ic" }), [], { process }),
		);

		expect(loadConfig(env).profiles.default).toBeUndefined();
		expect(lines.some((l) => l.includes("Could not revoke"))).toBe(true);
	});

	it("says so and does nothing when there is no stored login", async () => {
		const lines = await stderrLines(() =>
			run(buildApplication(logoutCommand, { name: "ic" }), [], { process }),
		);
		expect(lines).toEqual(["Not signed in.\n"]);
	});
});
