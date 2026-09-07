import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Session } from "./client";
import type { Operation } from "./spec";

/**
 * Turning what a person types into the id the API wants.
 *
 * Nobody retypes `smt_1CeiMLuPbyEaUASpW5BbxU`. Three shorter forms are
 * accepted, in this order of precedence:
 *
 *  1. **An id** — `smt_…`, or the bare base58 body of one.
 *  2. **A natural key** — the value the caller already knows: a smith's
 *     `external_id`, an agent's slug, a project's name. Matched exactly,
 *     server-side where a filter exists.
 *  3. **A prefix** — git-style abbreviation. Ids are base58 over a UUIDv7, so
 *     the timestamp leads and ids minted at different times diverge early
 *     (measured on this fleet: same second shares nine characters, same day
 *     three, same month two). Six characters is unambiguous in practice, and
 *     two matches is an error rather than a guess.
 *
 * Plus `last` and `last~N`, the newest of a listable resource.
 *
 * Precedence matters because base58 excludes `_`, so an `external_id` like
 * `user_42` can never be a prefix; the only overlap is a natural key made
 * only of base58 characters, and the exact lookup wins it.
 */

export type RefKind = "id" | "key" | "prefix" | "position";

// The id758 alphabet: base58, i.e. `[1-9A-HJ-NP-Za-km-z]` — no `0`, `O`, `I`
// or lowercase `l`, which is also what keeps `last`/`last~N` from ever
// looking like a prefix (the leading `l` is not in the alphabet).
const BASE58 = "1-9A-HJ-NP-Za-km-z";
const ID_RE = new RegExp(`^[a-z]{3,5}_[${BASE58}]{21,22}$`);
const BARE_ID_RE = new RegExp(`^[${BASE58}]{21,22}$`);
const POSITION_RE = /^last(~\d+)?$/;
const PREFIX_RE = new RegExp(`^[${BASE58}]{4,20}$`);

/** Classify a positional argument before it is resolved. */
export function classifyRef(value: string): RefKind {
	if (ID_RE.test(value) || BARE_ID_RE.test(value)) return "id";
	if (POSITION_RE.test(value)) return "position";
	if (PREFIX_RE.test(value)) return "prefix";
	return "key";
}

/**
 * The one id among `ids` whose body (the part after the first `_`, or the
 * whole string if there is none) starts with `prefix`. `null` when nothing
 * matches; throws, naming every match, when more than one does — a silent
 * "pick the newest" would act on a resource the caller never named.
 */
export function pickPrefixMatch(ids: readonly string[], prefix: string): string | null {
	const matches = ids.filter((id) => {
		const body = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
		return body.startsWith(prefix);
	});
	if (matches.length === 0) return null;
	if (matches.length > 1) {
		throw new Error(
			`"${prefix}" matches more than one id: ${matches.join(", ")}. Use more characters.`,
		);
	}
	return matches[0] as string;
}

export interface CacheEntry {
	id: string;
	resource: string;
	label?: string;
	/** Epoch millis; the sole ordering key for "newest first". */
	seen_at: number;
}

const CACHE_CAP = 5000;

/** Newest first, deduplicated by id (the newer sighting of a duplicate
 *  wins), truncated to `cap`. */
export function mergeCache(
	existing: readonly CacheEntry[],
	added: readonly CacheEntry[],
	cap = CACHE_CAP,
): CacheEntry[] {
	const byId = new Map<string, CacheEntry>();
	for (const entry of [...existing, ...added]) {
		const prev = byId.get(entry.id);
		if (!prev || entry.seen_at >= prev.seen_at) byId.set(entry.id, entry);
	}
	const merged = [...byId.values()];
	merged.sort((a, b) => b.seen_at - a.seen_at);
	return merged.slice(0, cap);
}

type Env = Record<string, string | undefined>;

/** The id cache's path — `$XDG_CACHE_HOME` (not `$XDG_CONFIG_HOME`, which
 *  `config.ts` uses for the credentials file) on unix, `%LOCALAPPDATA%` (not
 *  `%APPDATA%`) on Windows: a cache belongs where the OS expects disposable,
 *  regenerable state, not alongside the login. */
export function cachePath(
	profile: string,
	env: Env = process.env,
	platform = process.platform,
): string {
	const dir =
		platform === "win32"
			? join(
					env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
					"ingram-cloud",
				)
			: join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ingram-cloud");
	return join(dir, `${profile}-ids.json`);
}

const isCacheEntry = (v: unknown): v is CacheEntry =>
	!!v &&
	typeof v === "object" &&
	typeof (v as CacheEntry).id === "string" &&
	typeof (v as CacheEntry).resource === "string" &&
	typeof (v as CacheEntry).seen_at === "number";

/** A read failure — no file yet, corrupt JSON, no permission, or a shape a
 *  future or older `ic` version wrote differently — is an empty cache, never
 *  an error: the cache is an optimisation, not a dependency. A malformed
 *  entry surfacing as a `pickPrefixMatch`/`proposeIdCompletions` crash later
 *  would defeat that guarantee just as surely as throwing here would. */
export function readCache(profile: string, env: Env = process.env): CacheEntry[] {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(cachePath(profile, env), "utf8"),
		);
		return Array.isArray(parsed) ? parsed.filter(isCacheEntry) : [];
	} catch {
		return [];
	}
}

export function writeCache(
	profile: string,
	entries: readonly CacheEntry[],
	env: Env = process.env,
): void {
	try {
		const path = cachePath(profile, env);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const capped = mergeCache([], entries, CACHE_CAP);
		// 0600 from the start, matching config.ts's credentials file — cached
		// ids and labels are not secret, but there is no reason to make them
		// world-readable either.
		writeFileSync(path, `${JSON.stringify(capped)}\n`, { mode: 0o600 });
	} catch {
		// Never the reason a command fails — see readCache.
	}
}

/**
 * One entry per distinct *path position*, not per parameter name: the
 * generic command tree reuses short parameter names across unrelated
 * resources (`pid` is a smith under `/v1/smiths/{pid}` and a project under
 * `/v1/organization/projects/{pid}`; `cid` is a customer and a connection;
 * `id` is a file, an app, a response and a skill; `tid` is a project token
 * and a tenant token). Keying on the path segment that precedes the
 * placeholder — the collection the id lives in — is what tells those apart;
 * a flat map keyed by parameter name cannot.
 *
 * `exactQuery` names the query parameter that does a server-side exact match
 * (`docs/api.md`'s "Filtering" section — currently only smiths' `external_id`
 * and projects' `name`, matching `commands/project.ts`'s own lookup). Every
 * other resource falls back to listing and matching `slug` then `name`
 * client-side.
 *
 * `literal: true` marks a resource whose canonical identifier *is* the
 * string the caller types — a provider slug, a model id, a version number, a
 * suppressed email address, an MCP server or sandbox secret name. There is no
 * id form to resolve to, so `id`/`key`/`prefix` all pass the value through
 * unchanged; only `last`/`last~N` needs a listing.
 */
interface ResourceRule {
	resource: string;
	exactQuery?: string;
	literal?: boolean;
}

const RESOURCES: Record<string, ResourceRule> = {
	"/v1/smiths": { resource: "smith", exactQuery: "external_id" },
	"/v1/smiths/{pid}/connections": { resource: "connection" },
	"/v1/smiths/{pid}/runs": { resource: "run" },
	"/v1/smiths/{pid}/schedules": { resource: "schedule" },
	"/v1/smiths/{pid}/revisions": { resource: "revision", literal: true },
	"/v1/smiths/{pid}/model_keys": { resource: "provider", literal: true },
	"/v1/agents": { resource: "agent" },
	"/v1/agents/{aid}/ui": { resource: "UI template", literal: true },
	"/v1/approvals": { resource: "approval" },
	"/v1/budgets": { resource: "budget" },
	"/v1/catalog": { resource: "catalog entry", literal: true },
	"/v1/conversations": { resource: "conversation" },
	"/v1/customers": { resource: "customer" },
	"/v1/deployments": { resource: "deployment" },
	"/v1/files": { resource: "file" },
	"/v1/inbound_events": { resource: "inbound event" },
	"/v1/models": { resource: "model", literal: true },
	"/v1/oauth/authorize-requests": { resource: "oauth authorize request" },
	"/v1/organization/apps": { resource: "app" },
	"/v1/organization/projects": { resource: "project", exactQuery: "name" },
	"/v1/organization/projects/{pid}/tokens": { resource: "project token" },
	"/v1/responses": { resource: "response" },
	"/v1/runs": { resource: "run" },
	"/v1/skills": { resource: "skill" },
	"/v1/skills/{id}/versions": { resource: "skill version", literal: true },
	"/v1/tenant/mcp": { resource: "MCP server", literal: true },
	"/v1/tenant/model_keys": { resource: "provider", literal: true },
	"/v1/tenant/providers": { resource: "provider", literal: true },
	"/v1/tenant/sandbox_secrets": { resource: "sandbox secret", literal: true },
	"/v1/tenant/email/suppressions": { resource: "suppressed address", literal: true },
	"/v1/tenant/tokens": { resource: "tenant token" },
	"/v1/tenant/webhooks": { resource: "webhook" },
	"/v1/tenant/webhooks/{wid}/deliveries": { resource: "webhook delivery" },
	"/v1/traces": { resource: "trace" },
	"/v1/vector_stores": { resource: "vector store" },
	"/v1/vector_stores/{vsId}/file_batches": { resource: "file batch" },
	"/v1/vector_stores/{vsId}/files": { resource: "vector store file" },
};

/** Every prefix minted by the API's own `newId()` (`api/src/ids.ts`) that
 *  names exactly one resource, for `recordSeen`'s classification — not used
 *  for validation, since an `id`-shaped value is always accepted as-is
 *  regardless of which resource it names.
 *
 *  `tok` is deliberately absent: `api/src/tokens.ts` mints both a project
 *  token and a tenant token as `newId("tok")`, with nothing in the id itself
 *  telling them apart. Guessing which one a cached `tok_…` id is would let a
 *  prefix lookup for one silently return the other; leaving it unlabelled
 *  means `resolveRef`'s cache filter (keyed on the resource string) never
 *  matches a `tok_…` entry, so a token prefix always falls back to a live,
 *  correctly-scoped scan instead. */
const PREFIX_RESOURCE: Record<string, string> = {
	smt: "smith",
	agt: "agent",
	proj: "project",
	run: "run",
	cus: "customer",
	con: "connection",
	cnv: "conversation",
	apr: "approval",
	trc: "trace",
	dep: "deployment",
	whk: "webhook",
	whd: "webhook delivery",
	file: "file",
	skl: "skill",
	vs: "vector store",
	vsfb: "file batch",
	sch: "schedule",
	iev: "inbound event",
	bgt: "budget",
	app: "app",
};

/** The `RESOURCES` lookup key for one path parameter: the path up to (not
 *  including) its placeholder, with every *earlier* placeholder left intact
 *  — known purely from the operation's shape, no request needed. */
function templateFor(op: Operation, paramName: string): string {
	const idx = op.path.indexOf(`{${paramName}}`);
	if (idx < 0) throw new Error(`${op.id} has no path parameter named ${paramName}.`);
	return op.path.slice(0, idx).replace(/\/$/, "");
}

/** `templateFor`'s path, with every earlier placeholder substituted by its
 *  already-resolved id — the collection this parameter's value actually
 *  lives in, ready to list. */
function runtimeCollectionPath(
	op: Operation,
	paramName: string,
	resolvedIds: readonly string[],
): string {
	let path = templateFor(op, paramName);
	for (const [i, p] of op.pathParams.entries()) {
		if (p.name === paramName) break;
		path = path.split(`{${p.name}}`).join(resolvedIds[i] ?? "");
	}
	return path;
}

interface ListPage {
	data?: Array<Record<string, unknown>>;
	next_cursor?: string | null;
	has_more?: boolean;
}

/** Cursor-paginate a list endpoint up to `limit` rows — a bound, not a
 *  promise the whole collection fits: prefix and position resolution only
 *  ever need the newest handful, and a project's full history must never be
 *  the cost of typing `last`. */
async function listRows(
	session: Session,
	path: string,
	token: string,
	query: Record<string, string>,
	limit: number,
): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await session.ic.json<ListPage>("GET", path, {
			token,
			query: { ...query, ...(cursor ? { cursor } : {}) },
		});
		rows.push(...(page.data ?? []));
		if (rows.length >= limit) break;
		const next = page.has_more ? (page.next_cursor ?? undefined) : undefined;
		if (!next || next === cursor) break;
		cursor = next;
	}
	return rows;
}

const rowId = (row: Record<string, unknown>): string | undefined =>
	typeof row.id === "string" ? row.id : undefined;

/** How many rows a prefix or position lookup is willing to page through
 *  before giving up — the bound that keeps an abbreviation from walking the
 *  whole table. Lists are assumed newest-first (every list endpoint in this
 *  API defaults that way, and the OpenAI-dialect ones accept `order=desc`
 *  explicitly, sent here whenever it might help and ignored harmlessly by
 *  endpoints that don't take it). */
const SCAN_LIMIT = 500;

export interface RefContext {
	session: Session;
	/** The stored-login profile name, for the id cache file — not on
	 *  `Session` itself, since a profile is chosen by name before a session
	 *  ever opens. */
	profile: string;
	op: Operation;
	/** This path parameter's index in `op.pathParams`. */
	paramIndex: number;
	/** Ids already resolved for the earlier path parameters, same order. */
	resolvedIds: readonly string[];
}

/**
 * Resolve one positional to the id the API accepts.
 *
 * `id` returns as-is (no server round trip — the caller already knows it).
 * `position` lists the resource newest-first and takes the Nth. `key` uses
 * the server-side filter where the parameter's resource has one, else lists
 * and matches `slug` then `name`. `prefix` checks the id cache first, then
 * falls back to a bounded newest-first scan.
 */
export async function resolveRef(ctx: RefContext, raw: string): Promise<string> {
	const kind = classifyRef(raw);
	if (kind === "id") return raw;

	const param = ctx.op.pathParams[ctx.paramIndex];
	if (!param)
		throw new Error(
			`${ctx.op.id} has no path parameter at position ${ctx.paramIndex}.`,
		);
	const template = templateFor(ctx.op, param.name);
	const rule = RESOURCES[template];
	if (!rule) {
		throw new Error(
			`ic does not know how to look up ${ctx.op.id}'s ${param.name} by ${kind}; pass the id itself.`,
		);
	}
	if (rule.literal && kind !== "position") return raw;

	const listPath = runtimeCollectionPath(ctx.op, param.name, ctx.resolvedIds).replace(
		/^\/v1/,
		"",
	);
	const token = ctx.session.token(listPath);

	if (kind === "key") {
		if (rule.exactQuery) {
			const rows = await listRows(
				ctx.session,
				listPath,
				token,
				{ [rule.exactQuery]: raw },
				1,
			);
			const id = rows[0] && rowId(rows[0]);
			if (!id)
				throw new Error(`No ${rule.resource} with ${rule.exactQuery} ${raw}.`);
			return id;
		}
		const rows = await listRows(ctx.session, listPath, token, {}, SCAN_LIMIT);
		const match = rows.find((r) => r.slug === raw || r.name === raw);
		const id = match && rowId(match);
		if (!id) throw new Error(`No ${rule.resource} named ${raw}.`);
		return id;
	}

	if (kind === "prefix") {
		const cached = pickPrefixMatch(
			readCache(ctx.profile)
				.filter((e) => e.resource === rule.resource)
				.map((e) => e.id),
			raw,
		);
		if (cached) return cached;
		const rows = await listRows(
			ctx.session,
			listPath,
			token,
			{ order: "desc" },
			SCAN_LIMIT,
		);
		const ids = rows.map(rowId).filter((id): id is string => id !== undefined);
		const match = pickPrefixMatch(ids, raw);
		if (!match)
			throw new Error(
				`No ${rule.resource} id starts with "${raw}" in the most recent ${SCAN_LIMIT}.`,
			);
		return match;
	}

	// position: "last" or "last~N", 0-indexed from the newest.
	const offset = Number(/^last~(\d+)$/.exec(raw)?.[1] ?? "0");
	const rows = await listRows(
		ctx.session,
		listPath,
		token,
		{ order: "desc" },
		offset + 1,
	);
	const id = rows[offset] && rowId(rows[offset] as Record<string, unknown>);
	if (!id) throw new Error(`Fewer than ${offset + 1} ${rule.resource}(s) exist.`);
	return id;
}

function walk(value: unknown, seenAt: number, out: CacheEntry[]): void {
	if (Array.isArray(value)) {
		for (const item of value) walk(item, seenAt, out);
		return;
	}
	if (!value || typeof value !== "object") return;
	const obj = value as Record<string, unknown>;
	if (typeof obj.id === "string") {
		const label = [obj.external_id, obj.slug, obj.name].find(
			(v): v is string => typeof v === "string",
		);
		const prefix = obj.id.includes("_") ? obj.id.slice(0, obj.id.indexOf("_")) : "";
		out.push({
			id: obj.id,
			resource: PREFIX_RESOURCE[prefix] ?? (prefix || "id"),
			...(label ? { label } : {}),
			seen_at: seenAt,
		});
	}
	for (const v of Object.values(obj)) walk(v, seenAt, out);
}

/**
 * Remember every id a response mentioned, for `prefix` and cheap `last`
 * lookups later. An object counts as an entry the moment it has a string
 * `id` field; its label is the first of `external_id` / `slug` / `name`
 * present alongside that `id` — an id with none of those is still worth
 * caching (`pickPrefixMatch` only needs the id), it just has no label to
 * show. Called from `print`, so every command that shows a response also
 * feeds the cache the next command might abbreviate against.
 */
export function recordSeen(
	profile: string,
	value: unknown,
	env: Env = process.env,
): void {
	const entries: CacheEntry[] = [];
	walk(value, Date.now(), entries);
	if (entries.length === 0) return;
	writeCache(profile, mergeCache(readCache(profile, env), entries, CACHE_CAP), env);
}

/**
 * Completions for one path parameter, from the id cache alone — a tab press
 * must never block on the network. `resource` is the label `RESOURCES`
 * assigns that parameter's collection (or `undefined` for one this module
 * does not know, which then proposes nothing rather than guessing). Matches
 * on either the id or its cached label, so typing the start of a smith's
 * `external_id` still surfaces its `smt_…` id.
 */
export function proposeIdCompletions(
	resource: string | undefined,
	partial: string,
	profile = "default",
): string[] {
	if (!resource) return [];
	return readCache(profile)
		.filter(
			(e) =>
				e.resource === resource &&
				(e.id.startsWith(partial) || (e.label?.startsWith(partial) ?? false)),
		)
		.map((e) => e.id);
}

/** The resource `RESOURCES` assigns a path parameter, for `proposeIdCompletions` —
 *  exported so `generic.ts` can compute it once per command, at build time. */
export function resourceForParam(op: Operation, paramName: string): string | undefined {
	try {
		return RESOURCES[templateFor(op, paramName)]?.resource;
	} catch {
		return undefined;
	}
}
