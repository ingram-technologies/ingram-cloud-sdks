import { readFileSync, writeFileSync } from "node:fs";

import { buildCommand } from "@stricli/core";
import type { Command, CommandContext } from "@stricli/core";

import { openSession } from "../client";
import { reportError } from "../errors";
import { proposeIdCompletions, resolveRef, resourceForParam } from "../ids";
import { print } from "../output";
import { fillPath } from "../params";
import type { Operation } from "../spec";

/**
 * Plain single-file uploads and downloads — the shapes JSON cannot carry that
 * are not a skill bundle (`skills.ts` has those). `files.upload`/`files.content`
 * are the OpenAI Files API; `agents.ui.put`/`agents.ui.content` are an MCP
 * Apps UI template's HTML, which rides the same multipart-in/bytes-out shape.
 */

/** Flags every command in this file carries, alongside its own. */
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

/** `filename="…"` (plain or RFC 5987 `filename*=`) out of a `Content-Disposition`
 *  header — the server's own name for the bytes, when it sent one. */
export function filenameFromDisposition(header: string | null): string | null {
	if (!header) return null;
	const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
	if (star?.[1]) {
		try {
			return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
		} catch {
			// fall through to the plain form
		}
	}
	const plain = /filename="?([^";]+)"?/i.exec(header);
	if (!plain?.[1]) return null;
	// The plain filename= param is never itself percent-encoded per RFC 6266,
	// but this API's files route sends one that is (encodeURIComponent, not
	// filename*=) — decode it, falling back to the raw value for a server
	// that sends a genuinely unencoded name with a stray % in it.
	try {
		return decodeURIComponent(plain[1].trim());
	} catch {
		return plain[1].trim();
	}
}

/**
 * Deliver a download the way the destination wants it. `-o` always wins. With
 * no `-o`: a pipe gets the raw bytes on stdout (the `gh`/`curl -O` bargain
 * `output.ts` already makes for JSON); a terminal never gets bytes printed at
 * it — it gets the file saved under the server's suggested name (or
 * `fallbackName` when the response named none) and told where to find it.
 */
export function deliverDownload(
	bytes: Uint8Array,
	opts: {
		output?: string;
		tty: boolean;
		suggestedName: string | null;
		fallbackName: string;
	},
): void {
	const target =
		opts.output ?? (opts.tty ? (opts.suggestedName ?? opts.fallbackName) : null);
	if (target === null) {
		process.stdout.write(bytes);
		return;
	}
	writeFileSync(target, bytes);
	process.stderr.write(
		`Saved ${bytes.length} bytes to ${target}. Use -o <path> to choose the name, or pipe/redirect for the raw bytes on stdout.\n`,
	);
}

const outputFlag = {
	output: {
		kind: "parsed" as const,
		parse: String,
		brief: "Write to this path instead of stdout",
		optional: true,
	},
};

/** `files.upload` — `POST /v1/files`, multipart, `file` + optional `purpose`. */
export function filesUploadCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			filePath: string,
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
				const bytes = readFileSync(filePath);
				const blob = new Blob([bytes]);
				const filename = filePath.split(/[/\\]/).pop() ?? "file";
				const result = await session.ic.files.upload(blob, {
					filename,
					purpose: values.purpose as string | undefined,
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
						brief: "Path to the file to upload",
						parse: String,
						placeholder: "file",
					},
				],
			} as never,
			flags: {
				purpose: {
					kind: "parsed",
					parse: String,
					brief: "OpenAI-compatible purpose (default: assistants)",
					optional: true,
				},
				...COMMON,
			} as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/** `files.content` — `GET /v1/files/{id}/content`, bytes out. */
export function filesContentCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			rawId: string,
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
				const res = await session.ic.files.content(id, {
					token: session.token(fillPath(op, [id]).replace(/^\/v1/, "")),
				});
				const bytes = new Uint8Array(await res.arrayBuffer());
				deliverDownload(bytes, {
					output: values.output as string | undefined,
					tty,
					suggestedName: filenameFromDisposition(
						res.headers.get("content-disposition"),
					),
					fallbackName: id,
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
						brief: "File id",
						parse: String,
						placeholder: "id",
						proposeCompletions: (partial: string) =>
							proposeIdCompletions(resourceForParam(op, "id"), partial),
					},
				],
			} as never,
			flags: { ...outputFlag, ...COMMON } as never,
			aliases: { o: "output" },
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/** `agents.ui.put` — `POST /v1/agents/{aid}/ui`, multipart, `file` (the
 *  template HTML) + `metadata` (JSON `{name, csp?, permissions?, tool?}`). */
export function agentsUiPutCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			rawAid: string,
			name: string,
			filePath: string,
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;
				const aid = await resolveRef(
					{ session, profile, op, paramIndex: 0, resolvedIds: [] },
					rawAid,
				);
				const meta: Record<string, unknown> = { name };
				if (values.csp !== undefined)
					meta.csp = JSON.parse(values.csp as string);
				if (values.permissions !== undefined)
					meta.permissions = JSON.parse(values.permissions as string);
				if (values.tool !== undefined)
					meta.tool = JSON.parse(values.tool as string);
				if (values["prefers-border"] !== undefined)
					meta.prefers_border = values["prefers-border"];
				if (values.domain !== undefined) meta.domain = values.domain;

				const path = fillPath(op, [aid]).replace(/^\/v1/, "");
				const html = readFileSync(filePath, "utf8");
				// The SDK's own ic.agents.ui.put already builds this exact
				// multipart shape — reuse it rather than a second copy that could
				// drift from the SDK's if the sidecar shape ever changes.
				const result = await session.ic.agents.ui.put(
					aid,
					html,
					meta as never,
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
						brief: "Agent id",
						parse: String,
						placeholder: "aid",
						proposeCompletions: (partial: string) =>
							proposeIdCompletions(resourceForParam(op, "aid"), partial),
					},
					{ brief: "Template name", parse: String, placeholder: "name" },
					{
						brief: "Path to the template HTML",
						parse: String,
						placeholder: "file",
					},
				],
			} as never,
			flags: {
				csp: {
					kind: "parsed",
					parse: String,
					brief: "JSON content-security-policy sidecar",
					optional: true,
				},
				permissions: {
					kind: "parsed",
					parse: String,
					brief: "JSON host-permissions map",
					optional: true,
				},
				tool: {
					kind: "parsed",
					parse: String,
					brief: "JSON tool binding for the template",
					optional: true,
				},
				"prefers-border": {
					kind: "boolean",
					brief: "Ask the host to draw its own border",
					optional: true,
				},
				domain: {
					kind: "parsed",
					parse: String,
					brief: "A stable sandbox origin for the panel",
					optional: true,
				},
				...COMMON,
			} as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}

/** `agents.ui.content` — `GET /v1/agents/{aid}/ui/{name}/content`, bytes out.
 *  The server never sends a `Content-Disposition` here, so the fallback name
 *  is always `<name>.html`. */
export function agentsUiContentCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			rawAid: string,
			name: string,
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;
				const aid = await resolveRef(
					{ session, profile, op, paramIndex: 0, resolvedIds: [] },
					rawAid,
				);
				const path = fillPath(op, [aid, name]).replace(/^\/v1/, "");
				const res = await session.ic.request("GET", path, {
					token: session.token(path),
					headers: { accept: "text/html" },
				});
				const bytes = new Uint8Array(await res.arrayBuffer());
				deliverDownload(bytes, {
					output: values.output as string | undefined,
					tty,
					suggestedName: filenameFromDisposition(
						res.headers.get("content-disposition"),
					),
					fallbackName: `${name}.html`,
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
						brief: "Agent id",
						parse: String,
						placeholder: "aid",
						proposeCompletions: (partial: string) =>
							proposeIdCompletions(resourceForParam(op, "aid"), partial),
					},
					{
						brief: "Template name",
						parse: String,
						placeholder: "name",
						proposeCompletions: (partial: string) =>
							proposeIdCompletions(resourceForParam(op, "name"), partial),
					},
				],
			} as never,
			flags: { ...outputFlag, ...COMMON } as never,
			aliases: { o: "output" },
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}
