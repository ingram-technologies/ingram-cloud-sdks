import { hostname } from "node:os";

import { buildCommand } from "@stricli/core";
import type { CommandContext } from "@stricli/core";

import { openSession } from "../client";
import { loadConfig, saveConfig } from "../config";
import { reportError } from "../errors";
import { print } from "../output";

/**
 * Choosing a project is choosing a tenant: a project *is* the isolation
 * boundary, so this is the single most consequential piece of state the CLI
 * holds. `use` mints a project token with the organization key and caches it;
 * every non-organization request then carries that token.
 */

interface ProjectRow {
	id: string;
	name: string;
}

const PROJECT_TOKEN_DAYS = 30;

export function projectCommands(apiVersion: string) {
	const list = buildCommand({
		func: async function (
			this: CommandContext,
			flags: { json?: boolean; profile?: string },
		) {
			try {
				const session = openSession({ profile: flags.profile, apiVersion });
				const path = "/organization/projects";
				const page = await session.ic.json<{ data: ProjectRow[] }>("GET", path, {
					token: session.token(path),
				});
				print(page, { json: flags.json === true, tty: process.stdout.isTTY === true });
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			flags: {
				json: { kind: "boolean", brief: "Print the raw response", optional: true },
				profile: { kind: "parsed", parse: String, brief: "Which stored login", optional: true },
			},
		},
		docs: { brief: "List the organization's projects" },
	});

	const use = buildCommand({
		func: async function (
			this: CommandContext,
			flags: { profile?: string },
			nameOrId: string,
		) {
			try {
				const name = flags.profile ?? "default";
				const session = openSession({ profile: name, apiVersion });
				const listPath = "/organization/projects";
				const page = await session.ic.json<{ data: ProjectRow[] }>("GET", listPath, {
					token: session.token(listPath),
				});
				const match =
					page.data.find((p) => p.id === nameOrId) ??
					page.data.find((p) => p.name === nameOrId);
				if (!match) {
					throw new Error(
						`No project called ${nameOrId}. Run ic project list to see them.`,
					);
				}
				const tokenPath = `/organization/projects/${match.id}/tokens`;
				const minted = await session.ic.json<{ id: string; token: string }>(
					"POST",
					tokenPath,
					{
						token: session.token(tokenPath),
						body: {
							name: `ic on ${hostname()}`,
							ttl_seconds: PROJECT_TOKEN_DAYS * 86_400,
						},
					},
				);
				const config = loadConfig();
				const profile = config.profiles[name];
				if (!profile) throw new Error("Not signed in. Run: ic login");
				profile.project = {
					id: match.id,
					name: match.name,
					token: minted.token,
					token_id: minted.id,
				};
				saveConfig(config);
				process.stderr.write(`Now using ${match.name} (${match.id}).\n`);
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: {
				kind: "tuple",
				parameters: [{ brief: "Project name or id", parse: String, placeholder: "project" }],
			},
			flags: {
				profile: { kind: "parsed", parse: String, brief: "Which stored login", optional: true },
			},
		},
		docs: { brief: "Work in this project from now on" },
	});

	const current = buildCommand({
		func: function (this: CommandContext, flags: { profile?: string }) {
			const profile = loadConfig().profiles[flags.profile ?? "default"];
			if (!profile?.project) {
				process.stderr.write("No project selected. Run: ic project use <name>\n");
				process.exitCode = 3;
				return;
			}
			process.stdout.write(`${profile.project.name} (${profile.project.id})\n`);
		},
		parameters: {
			flags: {
				profile: { kind: "parsed", parse: String, brief: "Which stored login", optional: true },
			},
		},
		docs: { brief: "Print the project in use" },
	});

	// Returned as three leaves, not a route map: `buildTree` nests them from
	// their dotted ids exactly as it nests an operation's, so there is one code
	// path building the tree instead of two.
	return [
		{ id: "project.list", command: list },
		{ id: "project.use", command: use },
		{ id: "project.current", command: current },
	];
}
