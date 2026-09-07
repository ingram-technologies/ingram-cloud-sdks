import { readFileSync } from "node:fs";

import { buildCommand } from "@stricli/core";
import type { Command, CommandContext } from "@stricli/core";

import { openSession } from "./client";
import { reportError } from "./errors";
import { proposeIdCompletions, resolveRef, resourceForParam } from "./ids";
import { print } from "./output";
import { bodyFromFlags, fillPath, flagsForOperation, queryFromFlags } from "./params";
import type { Operation } from "./spec";

/**
 * Every operation that is plain JSON in and JSON out becomes a command this
 * way — one function, not 190 hand-written files.
 *
 * What the caller types maps onto the operation mechanically: path parameters
 * are positionals in path order, the body's properties and the query
 * parameters are flags. The shapes this cannot express — an upload, a
 * download, a stream — are claimed by an override in `overrides.ts` before
 * this is reached.
 */

/** Flags every command carries. Names chosen to not collide with any wire
 *  property; `app.test.ts` fails if the API ever introduces one that does. */
export const COMMON_FLAGS = {
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
	body: {
		kind: "parsed" as const,
		parse: String,
		brief: "Read the request body from a JSON file, or - for stdin",
		optional: true,
	},
	"all-pages": {
		kind: "boolean" as const,
		brief: "Follow every page of a list",
		optional: true,
	},
	yes: {
		kind: "boolean" as const,
		brief: "Do not ask before a delete",
		optional: true,
	},
};

export const COMMON_FLAG_NAMES = new Set(Object.keys(COMMON_FLAGS));

async function confirm(question: string): Promise<boolean> {
	process.stderr.write(`${question} [y/N] `);
	for await (const chunk of process.stdin) {
		return /^y(es)?$/i.test(String(chunk).trim());
	}
	return false;
}

export function genericCommand(
	op: Operation,
	apiVersion: string,
): Command<CommandContext> {
	const flags = { ...flagsForOperation(op), ...COMMON_FLAGS };
	return buildCommand({
		func: async function (
			this: CommandContext,
			values: Record<string, unknown>,
			...args: string[]
		) {
			try {
				const profile = (values.profile as string | undefined) ?? "default";
				const session = openSession({
					profile: values.profile as string | undefined,
					apiVersion:
						(values["api-version"] as string | undefined) ?? apiVersion,
				});
				const tty = process.stdout.isTTY === true;

				if (op.method === "delete" && tty && !values.yes) {
					const target = args.join(" ") || op.path;
					if (!(await confirm(`Delete ${target}?`))) {
						process.stderr.write("Cancelled.\n");
						return;
					}
				}

				// A positional may be a natural key, a prefix or `last`; the API
				// only ever accepts an id.
				const ids: string[] = [];
				for (const [i] of op.pathParams.entries())
					ids.push(
						await resolveRef(
							{ session, profile, op, paramIndex: i, resolvedIds: ids },
							args[i] ?? "",
						),
					);

				const fileBody = values.body
					? (JSON.parse(
							readFileSync(
								values.body === "-" ? 0 : (values.body as string),
								"utf8",
							),
						) as Record<string, unknown>)
					: {};
				const body = op.body ? bodyFromFlags(op, values, fileBody) : undefined;
				const query = queryFromFlags(op, values);
				const path = fillPath(op, ids).replace(/^\/v1/, "");

				const token = session.token(path);

				if (values["all-pages"] && op.method === "get") {
					const rows: unknown[] = [];
					let cursor: string | undefined;
					for (;;) {
						const page = await session.ic.json<{
							data?: unknown[];
							next_cursor?: string | null;
							has_more?: boolean;
						}>("GET", path, {
							token,
							query: { ...query, ...(cursor ? { cursor } : {}) },
						});
						rows.push(...(page.data ?? []));
						const next = page.has_more
							? (page.next_cursor ?? undefined)
							: undefined;
						if (!next) break;
						// A server bug returning the same cursor twice would otherwise
						// loop forever, re-fetching one page and growing rows without end.
						if (next === cursor)
							throw new Error(
								`${path}: the next page's cursor did not advance.`,
							);
						cursor = next;
					}
					print({ data: rows }, { json: values.json === true, tty, profile });
					return;
				}

				const res = await session.ic.request(op.method.toUpperCase(), path, {
					token,
					query,
					...(body && Object.keys(body).length ? { body } : {}),
				});
				if (res.status === 204) return;
				print(await res.json(), { json: values.json === true, tty, profile });
			} catch (error) {
				process.exitCode = reportError(error);
			}
		},
		parameters: {
			// A tuple, one parameter per path segment — `op` is read once, when
			// this command is built (`app.ts` calls `genericCommand` per
			// operation), so the length is already fixed by then. A tuple over
			// the old shared "array" parameter is what lets each position offer
			// its own completions: a run's positional proposes cached run ids,
			// a smith's proposes smiths, never one one-size-fits-all list.
			// `func`'s rest parameter is declared `...args: string[]`, an
			// unbounded array, because its true length is only known once `op`
			// is read — so stricli's own conditional type for a "tuple"
			// positional (which needs that length in the *type*, not just the
			// value) can never match it structurally. The cast is the same
			// bargain `flags as never` below already makes: correct at runtime
			// (stricli itself only reads `.length` off `parameters`), wider than
			// the static types can express for a command built from data.
			positional: {
				kind: "tuple",
				parameters: op.pathParams.map((p) => ({
					brief: p.description ?? p.name,
					parse: String,
					placeholder: p.name,
					proposeCompletions: (partial: string) =>
						proposeIdCompletions(resourceForParam(op, p.name), partial),
				})),
			} as never,
			flags: flags as never,
		},
		docs: {
			brief: op.summary,
			fullDescription: [op.summary, op.description].filter(Boolean).join("\n\n"),
		},
	});
}
