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

const sse = (events) =>
	events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

const fileSearchItem = {
	id: "fs_1",
	type: "file_search_call",
	status: "completed",
	queries: ["q"],
	results: null,
};

const fileSearchStream = sse([
	{
		type: "response.created",
		response: { id: "resp_1", created_at: 1, model: "m", service_tier: null },
	},
	{
		type: "response.output_item.added",
		output_index: 0,
		item: { ...fileSearchItem, status: "in_progress" },
	},
	{ type: "response.file_search_call.in_progress", output_index: 0, item_id: "fs_1" },
	{ type: "response.file_search_call.searching", output_index: 0, item_id: "fs_1" },
	{ type: "response.file_search_call.completed", output_index: 0, item_id: "fs_1" },
	{ type: "response.output_item.done", output_index: 0, item: fileSearchItem },
	{
		type: "response.output_item.added",
		output_index: 1,
		item: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			content: [],
			status: "in_progress",
		},
	},
	{
		type: "response.output_text.delta",
		item_id: "msg_1",
		output_index: 1,
		content_index: 0,
		delta: "Hello",
	},
	{
		type: "response.output_item.done",
		output_index: 1,
		item: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "Hello", annotations: [] }],
		},
	},
	{
		type: "response.completed",
		response: {
			id: "resp_1",
			incomplete_details: null,
			usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			service_tier: null,
		},
	},
]);

test("hosted file_search with no declared tools streams without NoSuchToolError", async () => {
	const { streamText } = await import("ai");
	const errors = [];
	const ingram = createIngramCloud({
		apiKey: "tok",
		fetch: async () =>
			new Response(fileSearchStream, {
				headers: { "content-type": "text/event-stream" },
			}),
	});
	const result = streamText({
		model: ingram(""),
		prompt: "hi",
		onError: ({ error }) => errors.push(error),
	});
	const parts = [];
	for await (const part of result.fullStream) parts.push(part);

	assert.deepEqual(errors, []);
	assert.ok(!parts.some((p) => p.type === "tool-error" || p.type === "error"));
	const call = parts.find((p) => p.type === "tool-call");
	assert.equal(call.toolName, "file_search");
	assert.equal(call.providerExecuted, true);
	assert.equal(call.dynamic, true);
	assert.equal(call.invalid, undefined);
	assert.equal(await result.text, "Hello");
	assert.equal(await result.finishReason, "stop");
});
