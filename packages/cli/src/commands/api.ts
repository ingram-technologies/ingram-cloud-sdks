import { readFileSync } from "node:fs";

import { buildCommand } from "@stricli/core";
import type { Command, CommandContext } from "@stricli/core";

import { openSession } from "../client.js";
import { reportError } from "../errors.js";

/**
 * The escape hatch: any `/v1` path, including one with no command of its own
 * (a route the spec carries but Task 7's snapshot predates, an endpoint this
 * package's author hasn't wired a command for yet). Prints the response body
 * unchanged — no table, no id-cache write, no JSON pretty-printing — because
 * this command's whole point is "exactly what the server sent".
 */
export function apiCommand(apiVersion: string): Command<CommandContext> {
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			method: string,
			path: string,
		) {
			try {
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const query: Record<string, string> = {};
				for (const kv of (values.query as string[] | undefined) ?? []) {
					const i = kv.indexOf("=");
					if (i < 0) throw new Error(`--query ${kv}: expected key=value`);
					query[kv.slice(0, i)] = kv.slice(i + 1);
				}
				const body = values.body
					? (JSON.parse(
							readFileSync(
								values.body === "-" ? 0 : (values.body as string),
								"utf8",
							),
						) as unknown)
					: undefined;
				const normalized = `/${path.replace(/^\/?(v1\/)?/, "")}`;
				const res = await session.ic.request(method.toUpperCase(), normalized, {
					token: session.token(normalized),
					query,
					...(body !== undefined ? { body } : {}),
				});
				if (res.status === 204) return;
				const contentType = res.headers.get("content-type") ?? "";
				if (/^(text\/|application\/(json|.*\+json))/i.test(contentType)) {
					const text = await res.text();
					process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
					return;
				}
				// "Unchanged" means bytes, not text: res.text() UTF-8-decodes,
				// which corrupts a genuinely binary response — this command must
				// reach any /v1 path, including one that returns one.
				process.stdout.write(new Uint8Array(await res.arrayBuffer()));
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			positional: {
				kind: "tuple",
				parameters: [
					{ brief: "HTTP method", parse: String, placeholder: "METHOD" },
					{
						brief: "A /v1 path, with or without the /v1",
						parse: String,
						placeholder: "path",
					},
				],
			} as never,
			flags: {
				body: {
					kind: "parsed",
					parse: String,
					brief: "Read the request body from a JSON file, or - for stdin",
					optional: true,
				},
				query: {
					kind: "parsed",
					parse: String,
					variadic: true,
					brief: "A query parameter, key=value; repeatable",
					optional: true,
				},
				profile: {
					kind: "parsed",
					parse: String,
					brief: "Which stored login to use",
					optional: true,
				},
				"api-version": {
					kind: "parsed",
					parse: String,
					brief: "Override the pinned IC-Api-Version",
					optional: true,
				},
			} as never,
			aliases: { f: "body" },
		},
		docs: {
			brief: "Call any /v1 path directly",
			fullDescription:
				"Reaches any /v1 endpoint, including one with no command of its own. " +
				"Prints the response body unchanged.",
		},
	});
}
