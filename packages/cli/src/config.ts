import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where the CLI keeps who you are.
 *
 * Two credentials, because the API has two tiers. The **organization key**
 * manages projects and mints their tokens; the **project token** is full
 * access inside one project. Routing between them is mechanical — a path
 * under `/organization/` needs the first, everything else the second — so it
 * lives here rather than in every command.
 */

export interface Project {
	id: string;
	name: string;
	token: string;
	/** The token's id, so `ic logout` can revoke it server-side. */
	token_id: string;
}

export interface Profile {
	base_url: string;
	org_id?: string;
	org_key?: string;
	project?: Project;
}

export interface Config {
	profiles: Record<string, Profile>;
}

export const DEFAULT_BASE_URL = "https://api.cloud.ingram.tech";
export const DEFAULT_CONSOLE_URL = "https://cloud.ingram.tech";

type Env = Record<string, string | undefined>;

/** The config file's path, honouring XDG on unix and APPDATA on Windows. */
export function configPath(
	env: Env = process.env,
	platform = process.platform,
): string {
	const dir =
		platform === "win32"
			? join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ingram-cloud")
			: join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ingram-cloud");
	return join(dir, "config.json");
}

/**
 * Where the console lives. `IC_CONSOLE_BASE` points `ic login` at a local or
 * staging console — the same variable the API reads to build a hosted page's
 * URL, so one name means "this stack's console" everywhere.
 */
export function consoleBase(env: Env = process.env): string {
	return env.IC_CONSOLE_BASE ?? DEFAULT_CONSOLE_URL;
}

export function loadConfig(env: Env = process.env): Config {
	let raw: string;
	try {
		raw = readFileSync(configPath(env), "utf8");
	} catch {
		return { profiles: {} }; // no file yet — the ordinary first run
	}
	try {
		return JSON.parse(raw) as Config;
	} catch {
		// The file exists but is not valid JSON: say so, rather than silently
		// discarding whatever profiles it held.
		process.stderr.write(
			`warning: ${configPath(env)} is not valid JSON, ignoring it.\n`,
		);
		return { profiles: {} };
	}
}

export function saveConfig(config: Config, env: Env = process.env): void {
	const path = configPath(env);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	// Written 0600 from the start, not chmod'd after: a token must never exist
	// on disk world-readable, not even for an instant.
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`, { mode: 0o600 });
}

/**
 * The token a `/v1` path needs. Throws with the command that fixes it — a
 * missing project token must not be sent as an org key, which would come back
 * as a scope error and read like a bug in the API.
 */
export function tokenFor(profile: Profile, path: string): string {
	if (path.startsWith("/organization/")) {
		if (!profile.org_key) throw new Error("Not signed in. Run: ic login");
		return profile.org_key;
	}
	if (!profile.project?.token)
		throw new Error("No project selected. Run: ic project use <name>");
	return profile.project.token;
}

/** The active profile, with the environment allowed to override the store —
 *  that is how CI runs without ever writing a file. */
export function activeProfile(name = "default", env: Env = process.env): Profile {
	const stored = loadConfig(env).profiles[name] ?? { base_url: DEFAULT_BASE_URL };
	const token = env.INGRAM_CLOUD_TOKEN;
	return {
		...stored,
		base_url: env.IC_BASE_URL ?? stored.base_url ?? DEFAULT_BASE_URL,
		...(token
			? {
					org_key: token,
					project: { id: "", name: "", token, token_id: "" },
				}
			: {}),
	};
}
