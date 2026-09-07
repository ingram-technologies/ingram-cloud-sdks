import { hostname } from "node:os";

import { ICError } from "@ingram-cloud/sdk/client";
import { buildCommand } from "@stricli/core";
import type { CommandContext } from "@stricli/core";

import { openSession } from "../client.js";
import type { Session } from "../client.js";
import { loadConfig, saveConfig } from "../config.js";
import { reportError } from "../errors.js";
import { print } from "../output.js";

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

/**
 * Find a project by id, then by exact name — both server-side, never a
 * client-side scan. `/organization/projects` is keyset-paginated; matching
 * against one page silently misses a project past the first 50 (a false
 * "no project called that" for `use`) and truncates `list`'s table with no
 * hint more exist. An id lookup 404s cheaply when `nameOrId` isn't one; a
 * name is unique per organization among live projects, so `?name=` is exact.
 */
async function findProject(
	session: Session,
	nameOrId: string,
): Promise<ProjectRow | null> {
	const byId = `/organization/projects/${nameOrId}`;
	try {
		return await session.ic.json<ProjectRow>("GET", byId, {
			token: session.token(byId),
		});
	} catch (error) {
		if (!(error instanceof ICError) || error.status !== 404) throw error;
	}
	const byName = "/organization/projects";
	const page = await session.ic.json<{ data: ProjectRow[] }>("GET", byName, {
		token: session.token(byName),
		query: { name: nameOrId },
	});
	return page.data[0] ?? null;
}

export function projectCommands(apiVersion: string) {
	const list = buildCommand({
		func: async function (
			this: CommandContext,
			flags: { json?: boolean; profile?: string },
		) {
			try {
				const profile = flags.profile ?? "default";
				const session = openSession({ profile: flags.profile, apiVersion });
				const path = "/organization/projects";
				// Keyset-paginated; an org past the first page must not see a
				// silently truncated table with no hint more projects exist.
				const rows: ProjectRow[] = [];
				let cursor: string | undefined;
				for (;;) {
					const page = await session.ic.json<{
						data: ProjectRow[];
						next_cursor?: string | null;
						has_more?: boolean;
					}>("GET", path, {
						token: session.token(path),
						query: cursor ? { cursor } : {},
					});
					rows.push(...page.data);
					const next = page.has_more
						? (page.next_cursor ?? undefined)
						: undefined;
					if (!next || next === cursor) break;
					cursor = next;
				}
				print(
					{ data: rows },
					{
						json: flags.json === true,
						tty: process.stdout.isTTY === true,
						profile,
					},
				);
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			flags: {
				json: {
					kind: "boolean",
					brief: "Print the raw response",
					optional: true,
				},
				profile: {
					kind: "parsed",
					parse: String,
					brief: "Which stored login",
					optional: true,
				},
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
				const match = await findProject(session, nameOrId);
				if (!match) {
					throw new Error(
						`No project called ${nameOrId}. Run ic project list to see them.`,
					);
				}
				const config = loadConfig();
				const profile = config.profiles[name];
				if (!profile) throw new Error("Not signed in. Run: ic login");

				// A previous `use` (of this project or another) left a live,
				// admin-scoped token minted for this machine; drop it before
				// minting the next one rather than accumulating one per switch.
				const stale = profile.project;
				if (stale) {
					const revokePath = `/organization/projects/${stale.id}/tokens/${stale.token_id}`;
					try {
						await session.ic.request("DELETE", revokePath, {
							token: session.token(revokePath),
						});
					} catch {
						process.stderr.write(
							`Could not revoke the previous token for ${stale.name}; it will expire on its own.\n`,
						);
					}
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
				parameters: [
					{
						brief: "Project name or id",
						parse: String,
						placeholder: "project",
					},
				],
			},
			flags: {
				profile: {
					kind: "parsed",
					parse: String,
					brief: "Which stored login",
					optional: true,
				},
			},
		},
		docs: { brief: "Work in this project from now on" },
	});

	const current = buildCommand({
		func: function (this: CommandContext, flags: { profile?: string }) {
			try {
				const profile = loadConfig().profiles[flags.profile ?? "default"];
				if (!profile?.project) {
					// The same message and the same exit code (3) as tokenFor's own
					// "No project selected" — reportError, not a hand-rolled second
					// path, so the two can't drift apart.
					throw new Error("No project selected. Run: ic project use <name>");
				}
				process.stdout.write(
					`${profile.project.name} (${profile.project.id})\n`,
				);
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			flags: {
				profile: {
					kind: "parsed",
					parse: String,
					brief: "Which stored login",
					optional: true,
				},
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
