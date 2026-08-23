import assert from "node:assert/strict";
import test from "node:test";

// Import the pure modules directly (not the package index), so the suite never
// loads `@flue/runtime` — these are string/shape helpers with no runtime needed.
import {
	approvalWireMessage,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
} from "../dist/approvals.js";
import { ingramMcpUrl, ingramModelSpec } from "../dist/types.js";

test("parseApprovalId splits on the first ::", () => {
	assert.deepEqual(parseApprovalId("run_abc::tc_1"), {
		runId: "run_abc",
		toolCallId: "tc_1",
	});
});

test("parseApprovalId keeps any :: inside the tool call id", () => {
	assert.deepEqual(parseApprovalId("run_abc::tc::weird"), {
		runId: "run_abc",
		toolCallId: "tc::weird",
	});
});

test("buildApprovalId round-trips with parseApprovalId", () => {
	const id = buildApprovalId("run_x", "tc_y");
	assert.equal(id, "run_x::tc_y");
	assert.deepEqual(parseApprovalId(id), { runId: "run_x", toolCallId: "tc_y" });
});

test("approvalWireMessage yields a tool message the endpoint accepts", () => {
	assert.deepEqual(approvalWireMessage("run_a::tc_1", "approve"), {
		role: "tool",
		tool_call_id: "run_a::tc_1",
		content: "approve",
	});
});

test("getApprovalRequests extracts composite tool calls, skips plain ones", () => {
	const reqs = getApprovalRequests([
		{ toolCallId: "run_a::tc_1", toolName: "delete_page", input: { id: "p1" } },
		{ id: "plain_local_call", name: "search" },
	]);
	assert.equal(reqs.length, 1);
	assert.deepEqual(reqs[0], {
		id: "run_a::tc_1",
		runId: "run_a",
		toolCallId: "tc_1",
		toolName: "delete_page",
		args: { id: "p1" },
	});
});

test("getApprovalRequests probes id/name/arguments aliases", () => {
	const reqs = getApprovalRequests([
		{ id: "run_b::tc_2", name: "issue_refund", arguments: { amount: 48 } },
	]);
	assert.deepEqual(reqs[0], {
		id: "run_b::tc_2",
		runId: "run_b",
		toolCallId: "tc_2",
		toolName: "issue_refund",
		args: { amount: 48 },
	});
});

test("ingramModelSpec joins provider and model", () => {
	assert.equal(ingramModelSpec("ingram", "gpt-5.5"), "ingram/gpt-5.5");
});

test("ingramModelSpec rejects an empty model id (Flue requires one)", () => {
	assert.throws(() => ingramModelSpec("ingram", ""), /model id is required/);
});

test("ingramMcpUrl builds the deployment MCP endpoint and trims a trailing slash", () => {
	assert.equal(
		ingramMcpUrl("https://api.cloud.ingram.tech/v1/", "dep_123"),
		"https://api.cloud.ingram.tech/v1/deployments/dep_123/mcp",
	);
});
