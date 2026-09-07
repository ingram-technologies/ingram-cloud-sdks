import { generateHelpTextForAllCommands } from "@stricli/core";
import { describe, expect, it } from "vitest";

import { buildIc } from "../src/app";
import { COMMON_FLAG_NAMES } from "../src/generic";
import { OVERRIDES } from "../src/overrides";
import { flagName } from "../src/params";
import { loadSpec, operations } from "../src/spec";

describe("the application", () => {
	it("builds a command for every commandable operation", () => {
		// The claim the whole design rests on: no operation is unreachable.
		const app = buildIc();
		const paths = new Set(
			generateHelpTextForAllCommands(app).map(([path]) => path),
		);
		for (const op of operations(loadSpec())) {
			const expected = `ic ${op.id.split(".").join(" ")}`;
			expect(paths.has(expected), expected).toBe(true);
		}
	});

	it("has an override for every operation JSON cannot carry", () => {
		// An upload, a download or a stream handled by the generic command would
		// send the wrong body or print bytes as JSON. This is the check that the
		// override map keeps up with the API rather than being audited by hand.
		for (const op of operations(loadSpec())) {
			const needsOne =
				op.requestMediaTypes.length > 0 || op.responseMediaTypes.length > 0;
			if (needsOne) expect(OVERRIDES[op.id], op.id).toBeDefined();
		}
	});

	it("names no override that the API no longer has", () => {
		const ids = new Set(operations(loadSpec()).map((o) => o.id));
		expect(Object.keys(OVERRIDES).filter((id) => !ids.has(id))).toEqual([]);
	});

	it("has no wire property that would shadow a common flag", () => {
		// `--json` must mean "print raw" on every command. A body property called
		// `json` would silently take the name; this fails the moment one appears.
		for (const op of operations(loadSpec()))
			for (const property of Object.keys(op.body?.properties ?? {}))
				expect(
					COMMON_FLAG_NAMES.has(flagName(property)),
					`${op.id}.${property}`,
				).toBe(false);
	});
});
