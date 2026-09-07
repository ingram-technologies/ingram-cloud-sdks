import { loginCommand, logoutCommand } from "./login";
import type { Leaf } from "../tree";

/** The commands that are not `/v1` operations. */
export function extraCommands(_apiVersion: string): Leaf[] {
	return [
		{ id: "login", command: loginCommand },
		{ id: "logout", command: logoutCommand },
	];
}
