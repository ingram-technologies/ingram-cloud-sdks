import { buildApplication, buildCommand, buildRouteMap } from "@stricli/core";
import type { Application, CommandContext } from "@stricli/core";

export function buildIc(): Application<CommandContext> {
	return buildApplication(
		buildRouteMap({
			routes: {
				version: buildCommand({
					func: function () {
						process.stdout.write("ic 0.1.0\n");
					},
					parameters: {},
					docs: { brief: "Print version information" },
				}),
			},
			docs: { brief: "The Ingram Cloud command line" },
		}),
		{ name: "ic" },
	);
}
