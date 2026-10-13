/**
 * The conversation list pages by an opaque `next_cursor`, because it sorts by
 * last activity and `after=<id>` cannot page a mutable key.
 */
import { describe, expect, it } from "vitest";
import { ConversationListOut } from "../ts/zod/index.js";

const page = {
	object: "list",
	data: [
		{
			id: "conv_1",
			object: "conversation",
			created_at: 1,
			updated_at: 2,
			title: null,
			smith_id: "smt_1",
			metadata: {},
		},
	],
	first_id: "conv_1",
	last_id: "conv_1",
	has_more: true,
	next_cursor: "c2",
};

describe("ConversationListOut", () => {
	it("carries next_cursor", () => {
		expect(ConversationListOut.parse(page).next_cursor).toBe("c2");
	});

	it("accepts a null next_cursor on the last page", () => {
		expect(
			ConversationListOut.parse({ ...page, has_more: false, next_cursor: null })
				.next_cursor,
		).toBeNull();
	});

	it("rejects a page without next_cursor", () => {
		const { next_cursor: _, ...withoutCursor } = page;
		expect(ConversationListOut.safeParse(withoutCursor).success).toBe(false);
	});
});
