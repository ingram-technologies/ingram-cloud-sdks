/**
 * The retry contract: honour Retry-After, never retry a refusal that retrying
 * cannot fix, and stop after a bounded number of attempts.
 */
import { describe, expect, it, vi } from "vitest";
import { IngramCloud } from "../ts/client.js";

function transportThat(statuses: number[], headers: Record<string, string> = {}) {
	let i = 0;
	const calls: number[] = [];
	const transport = async () => {
		const status = statuses[Math.min(i, statuses.length - 1)];
		calls.push(status);
		i += 1;
		return status < 400
			? new Response("{}", { status })
			: new Response(JSON.stringify({ error: { code: "x" } }), {
					status,
					headers,
				});
	};
	return { transport, calls };
}

describe("SDK retry", () => {
	it("retries a 429 and succeeds", async () => {
		const { transport, calls } = transportThat([429, 200], { "retry-after": "0" });
		const ic = new IngramCloud({
			baseURL: "https://x",
			token: "t",
			fetch: transport,
		});
		await ic.json("GET", "/smiths");
		expect(calls).toEqual([429, 200]);
	});

	it("never retries a 402 — retrying cannot fix an empty wallet", async () => {
		const { transport, calls } = transportThat([402]);
		const ic = new IngramCloud({
			baseURL: "https://x",
			token: "t",
			fetch: transport,
		});
		await expect(ic.json("GET", "/smiths")).rejects.toThrow();
		expect(calls).toEqual([402]);
	});

	it("gives up after a bounded number of attempts", async () => {
		const { transport, calls } = transportThat([429], { "retry-after": "0" });
		const ic = new IngramCloud({
			baseURL: "https://x",
			token: "t",
			fetch: transport,
		});
		await expect(ic.json("GET", "/smiths")).rejects.toThrow();
		expect(calls.length).toBe(4);
	});

	it("honours the HTTP-date form of Retry-After that intermediaries send", async () => {
		vi.useFakeTimers();
		try {
			const when = new Date(Date.now() + 2000).toUTCString();
			const { transport, calls } = transportThat([503, 200], {
				"retry-after": when,
			});
			const ic = new IngramCloud({
				baseURL: "https://x",
				token: "t",
				fetch: transport,
			});
			const result = ic.json("GET", "/smiths");
			await vi.advanceTimersByTimeAsync(3000);
			await result;
			expect(calls).toEqual([503, 200]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not retry an unparseable Retry-After, rather than hammering with no delay", async () => {
		const { transport, calls } = transportThat([503], { "retry-after": "soon" });
		const ic = new IngramCloud({
			baseURL: "https://x",
			token: "t",
			fetch: transport,
		});
		await expect(ic.json("GET", "/smiths")).rejects.toThrow();
		expect(calls).toEqual([503]);
	});

	it("surfaces the refusal instead of blocking the caller for an absurd wait", async () => {
		const { transport, calls } = transportThat([503], { "retry-after": "86400" });
		const ic = new IngramCloud({
			baseURL: "https://x",
			token: "t",
			fetch: transport,
		});
		await expect(ic.json("GET", "/smiths")).rejects.toThrow();
		expect(calls).toEqual([503]);
	});

	it("aborts promptly during a Retry-After wait, without sitting out the full delay", async () => {
		vi.useFakeTimers();
		try {
			const { transport, calls } = transportThat([429, 200], {
				"retry-after": "5",
			});
			const ic = new IngramCloud({
				baseURL: "https://x",
				token: "t",
				fetch: transport,
			});
			const controller = new AbortController();
			const result = ic.json("GET", "/smiths", { signal: controller.signal });
			const assertion = expect(result).rejects.toThrow();

			// Let the first transport call resolve and the retry loop reach its
			// `Retry-After` wait, without advancing wall-clock time.
			await vi.advanceTimersByTimeAsync(0);
			controller.abort();

			await assertion;
			// One attempt only: the abort cut the wait short before a retry fired.
			expect(calls).toEqual([429]);
		} finally {
			vi.useRealTimers();
		}
	});
});
