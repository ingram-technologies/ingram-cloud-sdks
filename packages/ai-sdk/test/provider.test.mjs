import assert from "node:assert/strict";
import test from "node:test";
import { createIngramCloud } from "../dist/index.js";

test("the provider builds a Responses model against /v1/responses with the IC headers", async () => {
	let url = "";
	let headers;
	const ingram = createIngramCloud({
		apiKey: "tok",
		smithId: "smt_1",
		threadId: "cnv_1",
		fetch: async (input, init) => {
			url = String(input);
			headers = new Headers(init?.headers);
			return new Response(JSON.stringify({ output: [] }), {
				headers: { "content-type": "application/json" },
			});
		},
	});
	const model = ingram("");
	assert.equal(model.provider, "ingram-cloud.responses");
	await model.doGenerate({
		prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
	});
	assert.equal(url, "https://api.cloud.ingram.tech/v1/responses");
	assert.equal(headers.get("ic-smith-id"), "smt_1");
	assert.equal(headers.get("ic-thread-id"), "cnv_1");
	assert.ok(headers.get("ic-api-version"));
	assert.equal(headers.get("authorization"), "Bearer tok");
});
