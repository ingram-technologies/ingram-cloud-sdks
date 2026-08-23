import assert from "node:assert/strict";
import test from "node:test";
import { getRenderApps, RENDER_APP_TOOL } from "../dist/index.js";

test("getRenderApps reads a render intent off result content parts", () => {
	const panels = getRenderApps([
		{ type: "text", text: "Here's your cash flow." },
		{
			type: "tool-call",
			toolCallId: "tc_1",
			toolName: "mcp.render_app",
			input: { template: "cash_chart", data: { months: [1, 2] } },
		},
	]);
	assert.deepEqual(panels, [
		{ toolCallId: "tc_1", template: "cash_chart", data: { months: [1, 2] } },
	]);
});

test("getRenderApps reads a render intent off a useChat message", () => {
	const panels = getRenderApps({
		role: "assistant",
		parts: [
			{ type: "text", text: "hi" },
			{
				type: "tool-mcp.render_app",
				toolCallId: "tc_2",
				state: "output-available",
				input: { template: "cash_chart", data: { ok: true } },
				output: "rendered",
			},
		],
	});
	assert.deepEqual(panels, [
		{ toolCallId: "tc_2", template: "cash_chart", data: { ok: true } },
	]);
});

test("getRenderApps parses JSON-string tool input", () => {
	const panels = getRenderApps([
		{
			type: "tool-call",
			toolCallId: "tc_3",
			toolName: "render_app",
			input: JSON.stringify({ template: "panel", data: { a: 1 } }),
		},
	]);
	assert.deepEqual(panels[0].data, { a: 1 });
	assert.equal(panels[0].template, "panel");
});

test("getRenderApps ignores other tools and unrenderable intents", () => {
	const panels = getRenderApps([
		{
			type: "tool-call",
			toolCallId: "a",
			toolName: "mcp.suggest_replies",
			input: {},
		},
		{ type: "tool-mcp.get_cash_flow_history", toolCallId: "b", input: {} },
		// No template name: the agent called it wrong, there's nothing to render.
		{
			type: "tool-call",
			toolCallId: "c",
			toolName: "render_app",
			input: { data: 1 },
		},
		// Malformed args.
		{
			type: "tool-call",
			toolCallId: "d",
			toolName: "render_app",
			input: "{not json",
		},
	]);
	assert.deepEqual(panels, []);
});

test("getRenderApps returns panels in call order and tolerates no input", () => {
	assert.deepEqual(getRenderApps(undefined), []);
	assert.deepEqual(getRenderApps({}), []);
	const panels = getRenderApps([
		{
			type: "tool-call",
			toolCallId: "1",
			toolName: "render_app",
			input: { template: "a" },
		},
		{
			type: "tool-call",
			toolCallId: "2",
			toolName: "render_app",
			input: { template: "b" },
		},
	]);
	assert.deepEqual(
		panels.map((p) => p.template),
		["a", "b"],
	);
	// `data` is optional — a template can be self-contained.
	assert.equal(panels[0].data, undefined);
});

test("RENDER_APP_TOOL is the hosted tool name the API registers", () => {
	assert.equal(RENDER_APP_TOOL, "render_app");
});
