import { createRequire } from "node:module";

import { buildCommand } from "@stricli/core";
import type { CommandContext } from "@stricli/core";

import { activeProfile } from "../config";

const require_ = createRequire(import.meta.url);

/** What this build is, and what it is pinned to. Three facts, because a bug
 *  report needs all three: the tool, the wire version it sends, and the API
 *  it is pointed at. */
export function versionCommand(apiVersion: string) {
	return buildCommand({
		func: function (this: CommandContext) {
			const pkg = require_("../../package.json") as { version: string };
			const profile = activeProfile();
			process.stdout.write(
				`ic ${pkg.version}\nIC-Api-Version ${apiVersion}\n${profile.base_url}\n`,
			);
		},
		parameters: {},
		docs: { brief: "Print the CLI version and the API version it pins" },
	});
}
