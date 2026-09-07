import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import type { SkillBundle, SkillFileInput } from "@ingram-cloud/sdk/client";
import { buildCommand } from "@stricli/core";
import type { Command, CommandContext } from "@stricli/core";

import { openSession } from "../client.js";
import { deliverDownload, filenameFromDisposition } from "./files.js";
import { reportError } from "../errors.js";
import { proposeIdCompletions, resolveRef, resourceForParam } from "../ids.js";
import { print } from "../output.js";
import { fillPath } from "../params.js";
import type { Operation } from "../spec.js";

/**
 * A skill bundle upload and its zip download — `/v1/skills` and
 * `/v1/skills/{id}/versions` both accept the same two shapes (`files[]` or a
 * zip), which is what `@ingram-cloud/sdk`'s `SkillBundle` already models;
 * this only has to turn a filesystem path into one.
 */

const COMMON = {
	json: {
		kind: "boolean" as const,
		brief: "Print the raw response, even on a terminal",
		optional: true,
	},
	profile: {
		kind: "parsed" as const,
		parse: String,
		brief: "Which stored login to use",
		optional: true,
	},
	"api-version": {
		kind: "parsed" as const,
		parse: String,
		brief: "Override the pinned IC-Api-Version",
		optional: true,
	},
};

/** Every file under `dir`, as `SkillFileInput[]` rooted at `dir`'s own name —
 *  the same rooting `skills.versions.content` hands back on download, so a
 *  downloaded bundle re-uploads unchanged. */
function walkBundleDir(dir: string): SkillFileInput[] {
	const root = basename(dir.replace(/[/\\]+$/, ""));
	const out: SkillFileInput[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile())
				out.push({
					path: `${root}/${relative(dir, full).split(sep).join("/")}`,
					content: readFileSync(full),
				});
		}
	};
	walk(dir);
	return out;
}

/** A directory is walked into `files[]`; anything else is handed to the API
 *  whole, as a zip. */
function loadBundle(path: string): SkillBundle {
	if (statSync(path).isDirectory()) return walkBundleDir(path);
	return new Blob([readFileSync(path)]);
}

/** `skills.create` — `POST /v1/skills`, multipart bundle in. */
export function skillsCreateCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			bundlePath: string,
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;
				const path = op.path.replace(/^\/v1/, "");
				const result = await session.ic.skills.create(loadBundle(bundlePath), {
					token: session.token(path),
				});
				print(result, { json: values.json === true, tty, profile });
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: {
				kind: "tuple",
				parameters: [
					{
						brief: "A directory to walk, or a .zip, of the skill bundle",
						parse: String,
						placeholder: "bundle",
					},
				],
			} as never,
			flags: { ...COMMON } as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/** `skills.versions.create` — `POST /v1/skills/{id}/versions`, same bundle shape. */
export function skillsVersionsCreateCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			rawId: string,
			bundlePath: string,
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;
				const id = await resolveRef(
					{ session, profile, op, paramIndex: 0, resolvedIds: [] },
					rawId,
				);
				const path = fillPath(op, [id]).replace(/^\/v1/, "");
				const result = await session.ic.skills.versions.create(
					id,
					loadBundle(bundlePath),
					{ token: session.token(path) },
				);
				print(result, { json: values.json === true, tty, profile });
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: {
				kind: "tuple",
				parameters: [
					{
						brief: "Skill id",
						parse: String,
						placeholder: "id",
						proposeCompletions: (partial: string) =>
							proposeIdCompletions(resourceForParam(op, "id"), partial),
					},
					{
						brief: "A directory to walk, or a .zip, of the skill bundle",
						parse: String,
						placeholder: "bundle",
					},
				],
			} as never,
			flags: { ...COMMON } as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/** `skills.versions.content` — `GET /v1/skills/{id}/versions/{v}/content`,
 *  one file with `--path`, else the whole version as a zip. */
export function skillsVersionsContentCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			rawId: string,
			rawVersion: string,
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;
				const id = await resolveRef(
					{ session, profile, op, paramIndex: 0, resolvedIds: [] },
					rawId,
				);
				const version = await resolveRef(
					{ session, profile, op, paramIndex: 1, resolvedIds: [id] },
					rawVersion,
				);
				const filePath = values.path as string | undefined;
				const path = fillPath(op, [id, version]).replace(/^\/v1/, "");
				const res = await session.ic.skills.versions.content(
					id,
					Number(version),
					filePath,
					{ token: session.token(path) },
				);
				const bytes = new Uint8Array(await res.arrayBuffer());
				deliverDownload(bytes, {
					output: values.output as string | undefined,
					tty,
					suggestedName: filenameFromDisposition(
						res.headers.get("content-disposition"),
					),
					fallbackName: filePath
						? basename(filePath)
						: `${id}-v${version}.zip`,
				});
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: {
				kind: "tuple",
				parameters: [
					{
						brief: "Skill id",
						parse: String,
						placeholder: "id",
						proposeCompletions: (partial: string) =>
							proposeIdCompletions(resourceForParam(op, "id"), partial),
					},
					{ brief: "Version number", parse: String, placeholder: "version" },
				],
			} as never,
			flags: {
				path: {
					kind: "parsed",
					parse: String,
					brief: "One file's path inside the bundle, instead of the whole zip",
					optional: true,
				},
				output: {
					kind: "parsed",
					parse: String,
					brief: "Write to this path instead of stdout",
					optional: true,
				},
				...COMMON,
			} as never,
			aliases: { o: "output" },
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}
