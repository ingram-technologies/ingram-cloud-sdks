import { readFileSync } from "node:fs";

import type { Operation, SpecSchema } from "./spec";

/**
 * The bridge between an OpenAPI operation and a command's arguments.
 *
 * A request body's top-level properties become flags, so the common case is
 * `ic smiths create --external-id user_42` rather than hand-written JSON. The
 * shapes a flag cannot carry — a nested object, a union — take inline JSON,
 * and any value may be read from a file with `@path`, which is what makes
 * `--instructions @prompt.md` work.
 */

export interface FlagSpec {
	kind: "boolean" | "parsed";
	parse?: (s: string) => string;
	brief: string;
	optional: boolean;
	variadic?: boolean;
}

/** The flag name for a wire property: `external_id` → `external-id`. */
export const flagName = (property: string) => property.replace(/_/g, "-");

/** The wire property for a flag name. Inverse of {@link flagName}. */
export const propertyName = (flag: string) => flag.replace(/-/g, "_");

function briefFor(name: string, schema: SpecSchema, required: boolean): string {
	const type =
		schema.type === "array" ? `${schema.items?.type ?? "string"}[]` : schema.type;
	const parts = [schema.description?.split("\n")[0] ?? "", `(${type ?? "json"})`];
	if (required) parts.push("required");
	return parts.filter(Boolean).join(" ");
}

/** One flag per top-level body property, plus every query parameter. */
export function flagsForOperation(op: Operation): Record<string, FlagSpec> {
	const flags: Record<string, FlagSpec> = {};
	const props = op.body?.properties ?? {};
	const required = new Set(op.body?.required ?? []);
	for (const [name, schema] of Object.entries(props)) {
		flags[flagName(name)] = {
			kind: schema.type === "boolean" ? "boolean" : "parsed",
			parse: schema.type === "boolean" ? undefined : String,
			brief: briefFor(name, schema, required.has(name)),
			optional: true, // enforced at request time, so -f can supply it
			variadic: schema.type === "array",
		};
	}
	for (const p of op.queryParams) {
		flags[flagName(p.name)] = {
			kind: p.schema?.type === "boolean" ? "boolean" : "parsed",
			parse: p.schema?.type === "boolean" ? undefined : String,
			brief: briefFor(p.name, p.schema ?? {}, false),
			optional: true,
			variadic: p.schema?.type === "array",
		};
	}
	return flags;
}

/** `@path` reads a file; `@-` reads stdin. Anything else is itself. */
function resolveValue(raw: string): string {
	if (!raw.startsWith("@")) return raw;
	const path = raw.slice(1);
	return readFileSync(path === "-" ? 0 : path, "utf8");
}

function coerce(flag: string, schema: SpecSchema, value: unknown): unknown {
	if (typeof value === "boolean") return value;
	if (Array.isArray(value))
		return value.map((v) => coerce(flag, schema.items ?? {}, v));
	const raw = resolveValue(String(value));
	if (schema.type === "number" || schema.type === "integer") {
		const n = Number(raw);
		if (Number.isNaN(n)) throw new Error(`--${flag}: ${raw} is not a number.`);
		return n;
	}
	if (schema.type === "boolean") return raw === "true";
	if (schema.type === "string") return raw;
	// An object, a union, or a schema the document does not pin down: the
	// honest encoding is the JSON the caller means.
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`--${flag}: expected JSON, got ${raw.slice(0, 40)}`);
	}
}

/**
 * Build the request body from flag values, over an optional base read from a
 * file. Flags win, so `-f body.json --display-name Ada` is "that file, with
 * this one field changed".
 */
export function bodyFromFlags(
	op: Operation,
	flags: Record<string, unknown>,
	base: Record<string, unknown> = {},
): Record<string, unknown> {
	const props = op.body?.properties ?? {};
	const body: Record<string, unknown> = { ...base };
	for (const [flag, value] of Object.entries(flags)) {
		if (value === undefined) continue;
		const property = propertyName(flag);
		const schema = props[property];
		if (!schema) continue; // a query parameter, handled by the caller
		body[property] = coerce(flag, schema, value);
	}
	return body;
}

/** The query object from flag values: every query parameter the caller set. */
export function queryFromFlags(
	op: Operation,
	flags: Record<string, unknown>,
): Record<string, string> {
	const query: Record<string, string> = {};
	for (const p of op.queryParams) {
		const value = flags[flagName(p.name)];
		if (value !== undefined) query[p.name] = String(value);
	}
	return query;
}

/** Fill `{param}` placeholders from the positional arguments, in path order. */
export function fillPath(op: Operation, args: readonly string[]): string {
	let i = 0;
	return op.path.replace(/\{[^}]+\}/g, () => encodeURIComponent(args[i++] ?? ""));
}
