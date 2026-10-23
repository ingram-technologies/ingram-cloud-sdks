/**
 * `POST /v1/extract`: the two parse rules the API's 422s rely on. A forecast
 * needs its horizon, and a request with no images needs a state.
 */
import { describe, expect, it } from "vitest";
import { ExtractIn } from "../ts/zod/index.js";

const INVOICE = "Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30.";

describe("ExtractIn", () => {
	it("accepts the invoice example", () => {
		const result = ExtractIn.safeParse({
			model: "cloudflare.clairic",
			state: INVOICE,
			fields: {
				invoice_number: { type: "text" },
				due_date: { type: "date", instructions: "Issue date plus net days" },
				total: { type: "number", decimals: 2, unit: "USD" },
				contacts: { type: "list", items: "text" },
				days_to_pay: { type: "estimate", min: 0, max: 120, step: 1 },
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects a forecast without a horizon, at the field's path", () => {
		const result = ExtractIn.safeParse({
			model: "cloudflare.clairic",
			state: INVOICE,
			fields: {
				travelers: { type: "forecast", interval: "day", min: 0, max: 10 },
			},
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual([
			"fields",
			"travelers",
			"horizon",
		]);
	});

	it("rejects a request with neither state nor images, at state", () => {
		const result = ExtractIn.safeParse({
			model: "cloudflare.clairic",
			fields: { total: { type: "number" } },
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(["state"]);
	});

	it("accepts images without a state", () => {
		const result = ExtractIn.safeParse({
			model: "cloudflare.clairic",
			images: ["data:image/png;base64,iVBORw0KGgo="],
			fields: { total: { type: "number" } },
		});
		expect(result.success).toBe(true);
	});

	it("rejects a field key Cloudflare refuses", () => {
		const result = ExtractIn.safeParse({
			model: "cloudflare.clairic",
			state: INVOICE,
			fields: { "bad key": { type: "text" } },
		});
		expect(result.success).toBe(false);
	});
});
