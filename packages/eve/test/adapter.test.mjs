import assert from "node:assert/strict";
import test from "node:test";

// Import the pure modules directly (not the package index), so the suite never
// loads `eve` or the AI SDK — these are string/shape helpers with no runtime.
import {
	approvalResponseMessage,
	approvalWireItem,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
} from "../dist/approvals.js";
import { ingramMcpUrl } from "../dist/types.js";

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

test("approvalWireItem yields the raw mcp_approval_response input item", () => {
	assert.deepEqual(approvalWireItem("run_a::tc_1", "approve"), {
		type: "mcp_approval_response",
		approval_request_id: "run_a::tc_1",
		approve: true,
	});
});

test("approvalResponseMessage yields the provider-executed approval response", () => {
	assert.deepEqual(
		approvalResponseMessage(
			{
				id: "run_a::tc_1",
				runId: "run_a",
				toolCallId: "tc_1",
				toolName: "delete_page",
				args: {},
			},
			"reject",
		),
		{
			role: "tool",
			content: [
				{
					type: "tool-approval-response",
					approvalId: "run_a::tc_1",
					approved: false,
					providerExecuted: true,
				},
			],
		},
	);
});

test("getApprovalRequests extracts composite approval requests, skips foreign ones", () => {
	const reqs = getApprovalRequests([
		{
			type: "tool-approval-request",
			approvalId: "run_a::tc_1",
			toolCall: {
				toolCallId: "d1",
				toolName: "mcp.delete_page",
				input: { id: "p1" },
			},
		},
		{
			type: "tool-approval-request",
			approvalId: "appr_local",
			toolCall: { toolCallId: "c2", toolName: "search" },
		},
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

test("ingramMcpUrl builds the deployment MCP endpoint and trims a trailing slash", () => {
	assert.equal(
		ingramMcpUrl("https://api.cloud.ingram.tech/v1/", "dep_123"),
		"https://api.cloud.ingram.tech/v1/deployments/dep_123/mcp",
	);
});
