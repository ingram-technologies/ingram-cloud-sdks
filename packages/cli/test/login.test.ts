import { describe, expect, it } from "vitest";

import { challengeFor, loginUrl, newVerifier } from "../src/commands/login";

describe("the login handshake", () => {
	it("mints a verifier long enough for PKCE and no longer", () => {
		const v = newVerifier();
		expect(v.length).toBeGreaterThanOrEqual(43);
		expect(v.length).toBeLessThanOrEqual(128);
		expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("derives the challenge the console will check against", () => {
		// The console computes the same SHA-256; a mismatch here means every
		// login fails at the last step, so this pins the encoding.
		expect(challengeFor("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
	});

	it("puts the port in the url only when there is a listener", () => {
		const url = loginUrl("https://cloud.ingram.tech", {
			port: 7788,
			state: "s",
			challenge: "c",
			label: "ic on box",
		});
		expect(url).toContain("port=7788");
		const remote = loginUrl("https://cloud.ingram.tech", {
			port: null,
			state: "s",
			challenge: "c",
			label: "ic on box",
		});
		expect(remote).not.toContain("port=");
	});
});
