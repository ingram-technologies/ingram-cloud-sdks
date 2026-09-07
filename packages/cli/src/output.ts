import { recordSeen } from "./ids";

/**
 * How a response reaches the reader.
 *
 * A terminal gets a table or a field list; a pipe gets the response body
 * unchanged. That rule means `ic smiths list` is readable by hand and
 * `ic smiths list | jq` works with no flag — the same bargain `gh` makes, and
 * the reason a coding agent driving this tool needs no special mode.
 */

const PREFERRED = ["id", "external_id", "slug", "name", "status", "created_at"];

const isScalar = (v: unknown) =>
	v === null || ["string", "number", "boolean"].includes(typeof v);

/** Columns worth showing: the preferred ones that exist, then the rest, minus
 *  anything that is not a scalar (a table cannot show an object honestly). */
function columnsFor(rows: readonly Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	for (const row of rows)
		for (const [k, v] of Object.entries(row)) if (isScalar(v)) seen.add(k);
	const rest = [...seen].filter((c) => !PREFERRED.includes(c));
	return [...PREFERRED.filter((c) => seen.has(c)), ...rest];
}

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function renderList(rows: readonly Record<string, unknown>[]): string {
	if (rows.length === 0) return "No results.";
	const columns = columnsFor(rows);
	const width = columns.map((c) =>
		Math.max(c.length, ...rows.map((r) => cell(r[c]).length)),
	);
	const line = (cells: string[]) =>
		cells
			.map((s, i) => s.padEnd(width[i] ?? 0))
			.join("  ")
			.trimEnd();
	return [
		line(columns.map((c) => c.toUpperCase())),
		...rows.map((r) => line(columns.map((c) => cell(r[c])))),
	].join("\n");
}

export function renderObject(value: Record<string, unknown>, indent = ""): string {
	const keys = Object.keys(value);
	const pad = Math.max(0, ...keys.map((k) => k.length + 1));
	const lines: string[] = [];
	for (const key of keys) {
		const v = value[key];
		if (v && typeof v === "object" && !Array.isArray(v)) {
			lines.push(`${indent}${key}:`);
			lines.push(renderObject(v as Record<string, unknown>, `${indent}  `));
		} else {
			lines.push(
				`${indent}${`${key}:`.padEnd(pad)} ${Array.isArray(v) ? v.join(", ") : cell(v)}`.trimEnd(),
			);
		}
	}
	return lines.join("\n");
}

/** Write a response the way this destination wants it. `profile`, when
 *  given, also feeds the id cache (`recordSeen`) — omit it only for a
 *  response that never carries an id worth remembering. */
export function print(
	value: unknown,
	opts: { json: boolean; tty: boolean; profile?: string },
): void {
	if (opts.profile) recordSeen(opts.profile, value);
	if (opts.json || !opts.tty) {
		process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
		return;
	}
	if (isScalar(value)) {
		process.stdout.write(`${cell(value)}\n`);
		return;
	}
	const page = value as { data?: unknown };
	if (Array.isArray(page?.data)) {
		process.stdout.write(`${renderList(page.data as Record<string, unknown>[])}\n`);
		return;
	}
	if (Array.isArray(value)) {
		process.stdout.write(`${renderList(value as Record<string, unknown>[])}\n`);
		return;
	}
	process.stdout.write(`${renderObject(value as Record<string, unknown>)}\n`);
}
