/**
 * The WhatsApp `start_token` setup block: `phone_number_id` picks which of the
 * project's numbers the wa.me link points at, and may be omitted.
 */
import { describe, expect, it } from "vitest";
import { WhatsAppStartSetup } from "../ts/zod/index.js";

describe("WhatsAppStartSetup", () => {
	it("accepts a start_token setup naming a number", () => {
		expect(
			WhatsAppStartSetup.parse({ mode: "start_token", phone_number_id: "1234" }),
		).toEqual({ mode: "start_token", phone_number_id: "1234" });
	});

	it("accepts a start_token setup without a number", () => {
		expect(WhatsAppStartSetup.parse({ mode: "start_token" })).toEqual({
			mode: "start_token",
		});
	});

	it("rejects an empty phone_number_id", () => {
		expect(
			WhatsAppStartSetup.safeParse({ mode: "start_token", phone_number_id: "" })
				.success,
		).toBe(false);
	});

	it("rejects another setup mode", () => {
		expect(WhatsAppStartSetup.safeParse({ mode: "provision" }).success).toBe(false);
	});
});
