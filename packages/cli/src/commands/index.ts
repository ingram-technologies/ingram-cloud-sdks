import { shellCommands } from "./completion";
import { loginCommand, logoutCommand } from "./login";
import { projectCommands } from "./project";
import { versionCommand } from "./version";
import type { Leaf } from "../tree";

/** The commands that are not `/v1` operations. */
export function extraCommands(apiVersion: string): Leaf[] {
	return [
		{ id: "login", command: loginCommand },
		{ id: "logout", command: logoutCommand },
		{ id: "version", command: versionCommand(apiVersion) },
		...projectCommands(apiVersion),
		...shellCommands(),
	];
}
