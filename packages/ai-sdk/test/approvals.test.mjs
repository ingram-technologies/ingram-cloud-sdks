import assert from "node:assert/strict";
import test from "node:test";
import {
	approvalResponseMessages,
	approvalWireItem,
	buildApprovalId,
	getApprovalRequests,
	parseApprovalId,
} from "../dist/index.js";

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

test("getApprovalRequests extracts approvals from result content parts", () => {
	const reqs = getApprovalRequests([
		{ type: "text", text: "About to delete." },
		{
			type: "tool-approval-request",
			approvalId: "run_a::tc_1",
			toolCall: {
				toolCallId: "dummy1",
				toolName: "mcp.delete_page",
				input: { id: "p1" },
			},
		},
		// A non-Ingram approval (no composite id) is not ours.
		{
			type: "tool-approval-request",
			approvalId: "appr_local",
			toolCall: { toolCallId: "c2", toolName: "search", input: {} },
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

const approval = {
	id: "run_a::tc_1",
	runId: "run_a",
	toolCallId: "tc_1",
	toolName: "delete_page",
	args: { id: "p1" },
};

test("approvalResponseMessages reconstructs the request the AI SDK requires in history", () => {
	assert.deepEqual(approvalResponseMessages(approval, "approve"), [
		{
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "tc_1",
					toolName: "mcp.delete_page",
					input: { id: "p1" },
					providerExecuted: true,
				},
				{
					type: "tool-approval-request",
					approvalId: "run_a::tc_1",
					toolCallId: "tc_1",
				},
			],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-approval-response",
					approvalId: "run_a::tc_1",
					approved: true,
					providerExecuted: true,
				},
			],
		},
	]);
	const [, rejected] = approvalResponseMessages(approval, "reject");
	assert.equal(rejected.content[0].approved, false);
});

test("approvalWireItem yields the raw mcp_approval_response input item", () => {
	assert.deepEqual(approvalWireItem("run_a::tc_1", "approve"), {
		type: "mcp_approval_response",
		approval_request_id: "run_a::tc_1",
		approve: true,
	});
});
