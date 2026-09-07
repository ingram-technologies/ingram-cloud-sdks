import {
	buildApplication,
	buildCommand,
	generateHelpTextForAllCommands,
} from "@stricli/core";
import { describe, expect, it } from "vitest";

import { buildTree } from "../src/tree";

const stub = (brief: string) =>
	buildCommand({ func: function () {}, parameters: {}, docs: { brief } });

// `RouteMap` does not expose its nested routes publicly (no `.routes`
// property on the built object — see @stricli/core's type, which only
// offers `getRoutingTargetForInput` / `getAllEntries`). Proving the nesting
// from outside the module means building a real application around the
// tree and reading back the route paths it registers, via
// `generateHelpTextForAllCommands`.
const paths = (root: ReturnType<typeof buildTree>) =>
	generateHelpTextForAllCommands(buildApplication(root, { name: "ic" })).map(
		([route]) => route,
	);

describe("buildTree", () => {
	it("nests a dotted id into route maps", () => {
		const root = buildTree(
			[
				{ id: "smiths.list", command: stub("List smiths") },
				{ id: "smiths.runs.submit", command: stub("Resume a run") },
				{ id: "tenant.webhooks.rotate", command: stub("Rotate") },
			],
			"The Ingram Cloud command line",
		);
		// Walking the built application's registered routes proves the
		// nesting structure rather than trusting the builder blindly.
		expect(paths(root)).toEqual(
			expect.arrayContaining([
				"ic smiths list",
				"ic smiths runs submit",
				"ic tenant webhooks rotate",
			]),
		);
	});

	it("refuses a leaf and a group with the same name", () => {
		// `agents.ui` cannot be both a command and a parent. Silently dropping one
		// would lose an operation; this is the loud version.
		expect(() =>
			buildTree(
				[
					{ id: "agents.ui", command: stub("x") },
					{ id: "agents.ui.get", command: stub("y") },
				],
				"x",
			),
		).toThrow(/agents\.ui/);
	});

	it("refuses the same id registered twice, so a duplicate operation is not silently dropped", () => {
		expect(() =>
			buildTree(
				[
					{ id: "smiths.list", command: stub("x") },
					{ id: "smiths.list", command: stub("y") },
				],
				"x",
			),
		).toThrow(/smiths\.list/);
	});

	it("refuses to build a tree from no leaves, since stricli refuses an empty route map", () => {
		expect(() => buildTree([], "x")).toThrow(/at least one route/);
	});

	it("puts a dotless id at the root, with no group", () => {
		const root = buildTree(
			[{ id: "version", command: stub("Print version") }],
			"x",
		);
		expect(paths(root)).toEqual(["ic version"]);
	});
});
