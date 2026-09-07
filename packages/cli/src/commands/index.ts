import { apiCommand } from "./api.js";
import { chatCommand } from "./chat.js";
import { shellCommands } from "./completion.js";
import { loginCommand, logoutCommand } from "./login.js";
import { projectCommands } from "./project.js";
import { versionCommand } from "./version.js";
import type { Leaf } from "../tree.js";

/** The commands that are not `/v1` operations. */
export function extraCommands(apiVersion: string): Leaf[] {
	return [
		{ id: "login", command: loginCommand },
		{ id: "logout", command: logoutCommand },
		{ id: "chat", command: chatCommand(apiVersion) },
		{ id: "version", command: versionCommand(apiVersion) },
		{ id: "api", command: apiCommand(apiVersion) },
		...projectCommands(apiVersion),
		...shellCommands(),
	];
}
