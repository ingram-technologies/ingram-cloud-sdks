import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { configPath, loadConfig, saveConfig, tokenFor } from "../src/config";

const home = () => mkdtempSync(join(tmpdir(), "ic-cli-"));

describe("configPath", () => {
	it("follows XDG on Linux and APPDATA on Windows", () => {
		expect(configPath({ XDG_CONFIG_HOME: "/x" }, "linux")).toBe(
			"/x/ingram-cloud/config.json",
		);
		expect(
			configPath({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32"),
		).toContain("ingram-cloud");
	});
});

describe("the store", () => {
	it("writes a file only its owner can read", () => {
		const dir = home();
		const env = { XDG_CONFIG_HOME: dir };
		saveConfig(
			{ profiles: { default: { base_url: "https://x", org_key: "k" } } },
			env,
		);
		expect(statSync(configPath(env)).mode & 0o777).toBe(0o600);
		expect(
			JSON.parse(readFileSync(configPath(env), "utf8")).profiles.default.org_key,
		).toBe("k");
	});

	it("reads back what it wrote", () => {
		const env = { XDG_CONFIG_HOME: home() };
		saveConfig(
			{ profiles: { default: { base_url: "https://x", org_key: "k" } } },
			env,
		);
		expect(loadConfig(env).profiles.default?.org_key).toBe("k");
	});

	it("is an empty store when no file exists", () => {
		expect(loadConfig({ XDG_CONFIG_HOME: home() })).toEqual({ profiles: {} });
	});
});

describe("tokenFor", () => {
	const profile = {
		base_url: "https://x",
		org_key: "ORG",
		project: { id: "proj_1", name: "acme", token: "PROJ", token_id: "tok_1" },
	};

	it("sends an organization path the organization key", () => {
		expect(tokenFor(profile, "/organization/projects")).toBe("ORG");
	});

	it("sends every other path the project token", () => {
		expect(tokenFor(profile, "/smiths")).toBe("PROJ");
	});

	it("says which one is missing rather than sending the wrong key", () => {
		// Sending an org key to /v1/smiths would 403 with a message about scopes,
		// which reads as a permissions bug rather than "you have not picked a
		// project".
		expect(() =>
			tokenFor({ base_url: "https://x", org_key: "ORG" }, "/smiths"),
		).toThrow(/ic project use/);
		expect(() =>
			tokenFor({ base_url: "https://x" }, "/organization/projects"),
		).toThrow(/ic login/);
	});
});
