import { buildApplication } from "@stricli/core";
import type { Application, CommandContext } from "@stricli/core";

/** Commands that are not operations: sign-in, chat, the raw escape hatch. */
import { extraCommands } from "./commands/index.js";
import { genericCommand } from "./generic.js";
import { OVERRIDES } from "./overrides.js";
import { loadSpec, operations } from "./spec.js";
import { buildTree } from "./tree.js";
import type { Leaf } from "./tree.js";

export function buildIc(): Application<CommandContext> {
	const spec = loadSpec();
	const apiVersion = spec["x-ic-api-version"] ?? "2026-05-01";
	const leaves: Leaf[] = operations(spec).map((op) => ({
		id: op.id,
		command: (OVERRIDES[op.id] ?? genericCommand)(op, apiVersion),
	}));
	leaves.push(...extraCommands(apiVersion));
	return buildApplication(buildTree(leaves, "The Ingram Cloud command line"), {
		name: "ic",
	});
}
