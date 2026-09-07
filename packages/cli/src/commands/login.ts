import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";

import { buildCommand } from "@stricli/core";
import type { CommandContext } from "@stricli/core";

import { DEFAULT_BASE_URL, consoleBase, loadConfig, saveConfig } from "../config.js";
import { openSession } from "../client.js";
import { messageFor, reportError } from "../errors.js";

/**
 * Sign in through the browser, so nobody pastes a key.
 *
 * PKCE-shaped: the verifier never leaves this process, and the console only
 * ever sees its hash. A code intercepted on the loopback redirect is
 * therefore useless, and the code itself is single-use and lives one minute.
 */

const b64url = (b: Buffer) => b.toString("base64url");

export const newVerifier = () => b64url(randomBytes(48));
export const challengeFor = (verifier: string) =>
	b64url(createHash("sha256").update(verifier).digest());

export function loginUrl(
	consoleUrl: string,
	q: { port: number | null; state: string; challenge: string; label: string },
): string {
	const url = new URL("/cli/login", consoleUrl);
	if (q.port !== null) url.searchParams.set("port", String(q.port));
	url.searchParams.set("state", q.state);
	url.searchParams.set("challenge", q.challenge);
	url.searchParams.set("label", q.label);
	return url.toString();
}

/** Open a URL with the platform's opener; failure is not fatal — the URL is
 *  printed either way, which is all a remote shell can use. */
function openBrowser(url: string): void {
	// `start` is a cmd.exe builtin, not an executable on PATH — it must run
	// through cmd.exe, and its first quoted argument is a window title, so an
	// empty one is required or `url` itself would be swallowed as the title.
	const [cmd, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
	} catch {
		// printed by the caller
	}
}

/** How long to wait for the console's redirect before giving up. The console
 *  itself treats a code as expired after a minute; a login that never
 *  reaches the browser (a headless box, a browser that failed to launch)
 *  would otherwise hang `ic login` forever with no way out but Ctrl-C. */
const CALLBACK_TIMEOUT_MS = 120_000;

/** Wait for the console's redirect on a loopback port. `listen` settles once
 *  the server is bound (or fails to bind); `code` settles once the browser
 *  answers (or the wait times out) — a bind failure rejects both. */
function awaitCode(state: string): Promise<{ port: number; code: Promise<string> }> {
	let resolveCode!: (v: string) => void;
	let rejectCode!: (e: Error) => void;
	const code = new Promise<string>((res, rej) => {
		resolveCode = res;
		rejectCode = rej;
	});
	// A bind failure rejects `code` before the caller ever reaches `await
	// listener.code` — an orphaned rejection Node would otherwise warn about.
	// This extra handler doesn't consume the rejection for a real awaiter;
	// it's chained off, not in place of, the original promise.
	code.catch(() => {});
	const fail = (err: unknown) => {
		clearTimeout(timer);
		rejectCode(err instanceof Error ? err : new Error(String(err)));
	};
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== "/callback") {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { "content-type": "text/plain" });
		if (url.searchParams.get("state") !== state) {
			res.end(
				"This response did not come from the login you started. Nothing was saved.\n",
			);
			fail(new Error("state mismatch: the browser answered a different login."));
		} else {
			res.end("Signed in. You can close this tab.\n");
			clearTimeout(timer);
			resolveCode(url.searchParams.get("code") ?? "");
		}
		server.close();
	});
	const timer = setTimeout(() => {
		server.close();
		fail(new Error("Timed out waiting for the browser. Run ic login again."));
	}, CALLBACK_TIMEOUT_MS);
	timer.unref();
	return new Promise((resolveListen, rejectListen) => {
		// A bind failure (no loopback interface, a sandboxed network namespace)
		// is an "error" event; with no listener, Node treats it as fatal and
		// crashes the process outside this function's own try/catch.
		server.once("error", (err) => {
			fail(err);
			rejectListen(err);
		});
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			resolveListen({ port, code });
		});
	});
}

interface TokenResponse {
	id: string;
	token: string;
	organization_id: string;
	expires_at: string;
}

export async function redeem(
	consoleUrl: string,
	code: string,
	verifier: string,
): Promise<TokenResponse> {
	const res = await fetch(new URL("/api/cli/token", consoleUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code, verifier }),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(
			body.error === "invalid_grant"
				? "That code is expired or already used. Run ic login again."
				: `The console refused the exchange (${res.status}).`,
		);
	}
	return (await res.json()) as TokenResponse;
}

export const loginCommand = buildCommand({
	func: async function (
		this: CommandContext,
		flags: { browser: boolean; profile?: string; console?: string },
	) {
		try {
			const consoleUrl = flags.console ?? consoleBase();
			const verifier = newVerifier();
			const challenge = challengeFor(verifier);
			const state = b64url(randomBytes(16));
			const label = `ic on ${hostname()}`;
			const useBrowser = flags.browser;

			let code: string;
			if (useBrowser) {
				const listener = await awaitCode(state);
				const url = loginUrl(consoleUrl, {
					port: listener.port,
					state,
					challenge,
					label,
				});
				process.stderr.write(`Opening ${url}\n`);
				openBrowser(url);
				code = await listener.code;
			} else {
				const url = loginUrl(consoleUrl, {
					port: null,
					state,
					challenge,
					label,
				});
				process.stderr.write(
					`Open this page, then paste the code it shows:\n${url}\n`,
				);
				const rl = createInterface({
					input: process.stdin,
					output: process.stderr,
				});
				code = (await rl.question("Code: ")).trim();
				rl.close();
			}

			const granted = await redeem(consoleUrl, code, verifier);
			const name = flags.profile ?? "default";
			const config = loadConfig();
			config.profiles[name] = {
				...config.profiles[name],
				base_url: config.profiles[name]?.base_url ?? DEFAULT_BASE_URL,
				org_id: granted.organization_id,
				org_key: granted.token,
				org_key_id: granted.id,
			};
			saveConfig(config);
			process.stderr.write(
				`Signed in to ${granted.organization_id}. Next: ic project use <name>\n`,
			);
		} catch (error) {
			process.exitCode = reportError(error);
		}
	},
	parameters: {
		flags: {
			browser: {
				kind: "boolean",
				brief: "Open a browser (--noBrowser prints the URL and asks for the code)",
				default: true,
			},
			profile: {
				kind: "parsed",
				parse: String,
				brief: "Store under this profile",
				optional: true,
			},
			console: {
				kind: "parsed",
				parse: String,
				brief: "Console base URL (else IC_CONSOLE_BASE)",
				optional: true,
			},
		},
	},
	docs: { brief: "Sign in through the browser" },
});

export const logoutCommand = buildCommand({
	func: async function (this: CommandContext, flags: { profile?: string }) {
		const name = flags.profile ?? "default";
		const config = loadConfig();
		const profile = config.profiles[name];
		if (!profile) {
			process.stderr.write("Not signed in.\n");
			return;
		}
		// Both credentials were registered when minted, so revocation reaches the
		// API's `jti` check before the local profile is removed.
		if (profile.project?.token_id) {
			try {
				const session = openSession({
					profile: name,
					apiVersion: "2026-05-01",
				});
				const path = `/tenant/tokens/${profile.project.token_id}`;
				await session.ic.request("DELETE", path, {
					token: session.token(path),
				});
			} catch (error) {
				process.stderr.write(
					`Could not revoke the project token: ${messageFor(error)}; removing it locally.\n`,
				);
			}
		}
		if (profile.org_key_id) {
			try {
				const session = openSession({
					profile: name,
					apiVersion: "2026-05-01",
				});
				const path = `/organization/keys/${profile.org_key_id}`;
				await session.ic.request("DELETE", path, {
					token: session.token(path),
				});
			} catch (error) {
				process.stderr.write(
					`Could not revoke the organization key: ${messageFor(error)}; removing it locally.\n`,
				);
			}
		}
		delete config.profiles[name];
		saveConfig(config);
		process.stderr.write("Signed out.\n");
	},
	parameters: {
		flags: {
			profile: {
				kind: "parsed",
				parse: String,
				brief: "Which stored login",
				optional: true,
			},
		},
	},
	docs: { brief: "Forget this machine's login" },
});
