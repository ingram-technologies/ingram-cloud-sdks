/**
 * Ingram Cloud /v1 tenant configuration as Pulumi dynamic resources.
 *
 * Replaces the per-app `scripts/register-*.ts` / `ensure-agent.ts` one-shots
 * with declarative resources, so IC wiring is a `pulumi up` and lives in state
 * instead of drifting in someone's shell history.
 *
 * Each resource talks to the IC REST API. `token` is the tenant-admin bearer;
 * keep it (and any credential input) a stack secret — it's marked as an
 * additional secret output so it's encrypted in state.
 *
 * Where each resource is meant to be declared:
 *   - **Agents** (`IcAgent`) — the `instructions` are app-owned *content*,
 *     so declare these in the APP repo's Pulumi program, sourced from the app's
 *     own spec module. Never copy prompts into the infra repo.
 *   - **Integrations / tenant config** (`IcMcpServer`, `IcOauthProvider`,
 *     `IcTelegramBot`, `IcWhatsAppConfig`, `IcWebhook`, `IcModelKey`) —
 *     tenant-level wiring; declare in the infra repo alongside DNS/DB/Vercel.
 *
 * Not modelled here, on purpose:
 *   - **Per-end-user actions** — creating users, binding deployments, pushing
 *     per-user connection tokens, minting user tokens — happen at app runtime.
 *   - **Attaching existing smiths to an agent** — a one-time backfill that
 *     mutates the live fleet; keep it as the app's migration script. New
 *     smiths attach at birth in app code.
 *   - **Slack app factory** — config-token rotation is stateful and app-driven.
 */
import * as pulumi from "@pulumi/pulumi";

/**
 * The /v1 API version this library targets. Bumping the IC API contract is a
 * library version bump — consumers pin behaviour by pinning this package.
 */
export const IC_API_VERSION = "2026-05-01";

// Shared IC REST call. Module-scope so Pulumi's closure serialization captures
// it into each provider's methods; uses only the global `fetch` (Node ≥18).
async function icRequest(
	baseUrl: string,
	token: string,
	method: string,
	path: string,
	body?: unknown,
	idempotencyKey?: string,
): Promise<any> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"IC-Api-Version": IC_API_VERSION,
	};
	if (body !== undefined) headers["Content-Type"] = "application/json";
	if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	if (!res.ok) {
		// Carry the status so `read` can tell "gone" (404) from a transient blip.
		const err: any = new Error(
			`IC ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`,
		);
		err.status = res.status;
		throw err;
	}
	return text ? JSON.parse(text) : {};
}

// Shared `diff` for the CRUD-scaffold providers: compare a fixed set of keys and
// build the Pulumi DiffResult. `replaceKeys` force a replace when changed;
// `scalarKeys` are in-place by reference equality; `listKeys` are in-place but
// compared by value (JSON). Each provider keeps its exact key set and its
// `deleteBeforeReplace` choice — this only removes the hand-rolled boilerplate.
function simpleDiff<T>(
	olds: T,
	news: T,
	opts: {
		replaceKeys?: readonly (keyof T)[];
		scalarKeys?: readonly (keyof T)[];
		listKeys?: readonly (keyof T)[];
		deleteBeforeReplace?: boolean;
	},
): pulumi.dynamic.DiffResult {
	const replaces = (opts.replaceKeys ?? []).filter(
		(k) => olds[k] !== news[k],
	) as string[];
	const scalarChanged = (opts.scalarKeys ?? []).some((k) => olds[k] !== news[k]);
	const listChanged = (opts.listKeys ?? []).some(
		(k) => JSON.stringify(olds[k] ?? null) !== JSON.stringify(news[k] ?? null),
	);
	return {
		changes: replaces.length > 0 || scalarChanged || listChanged,
		replaces,
		deleteBeforeReplace: opts.deleteBeforeReplace,
	};
}

// Shared `read` 404 handling: run a fetch, map a server-side 404 to `{ id: "" }`
// (so refresh prunes the resource and the next `up` recreates it) and rethrow any
// other error so a transient blip can't nuke state.
async function read404<T>(
	fetchFn: () => Promise<T>,
	onFound: (v: T) => pulumi.dynamic.ReadResult,
): Promise<pulumi.dynamic.ReadResult> {
	try {
		return onFound(await fetchFn());
	} catch (e: any) {
		if (e?.status === 404) return { id: "" };
		throw e;
	}
}

// Factory for the PUT-style providers (mcp, telegram, whatsapp, modelKey): they
// all reconcile by PUTting the desired body to a resource path and DELETE the
// same path to tear down. They differ only in (a) the path — a fixed singleton
// vs one keyed by an input field — (b) the request body, (c) which response
// fields become outputs, and (d) the diff key sets — all passed in here.
function makePutResource<T extends { baseUrl: string; token: string }>(cfg: {
	// Resource path for a given props (e.g. `/v1/tenant/mcp/<name>`). Also the id
	// on create (returned to Pulumi) and the DELETE target.
	path: (props: T) => string;
	// The id Pulumi tracks. Defaults to the path's last segment isn't reliable, so
	// it's explicit: a fixed singleton id, or the keying input field.
	id: (props: T) => string;
	body: (props: T) => unknown;
	// Shape the PUT response into the resource's extra outputs (merged over props).
	outs?: (props: T, res: any) => Record<string, unknown>;
	// Live-state read for `pulumi refresh`: map the GET response back onto the
	// diffable inputs, so server-side drift (e.g. a lost auth block) surfaces as a
	// plan diff instead of a clean "no changes". Optional; write-only fields
	// (secrets) can't round-trip and stay diff-by-state.
	readProps?: (props: T, res: any) => Partial<T>;
	diff: {
		replaceKeys?: readonly (keyof T)[];
		scalarKeys?: readonly (keyof T)[];
		listKeys?: readonly (keyof T)[];
		deleteBeforeReplace?: boolean;
	};
}): pulumi.dynamic.ResourceProvider {
	const put = async (i: T) => {
		const res = await icRequest(
			i.baseUrl,
			i.token,
			"PUT",
			cfg.path(i),
			cfg.body(i),
		);
		return { ...i, ...(cfg.outs ? cfg.outs(i, res) : {}) };
	};
	return {
		async create(i: T) {
			return { id: cfg.id(i), outs: await put(i) };
		},
		async update(_id: string, _olds: T, news: T) {
			return { outs: await put(news) };
		},
		async delete(_id: string, props: T) {
			await icRequest(props.baseUrl, props.token, "DELETE", cfg.path(props));
		},
		async diff(_id: string, olds: T, news: T) {
			return simpleDiff(olds, news, cfg.diff);
		},
		async read(id: string, props: T) {
			if (!cfg.readProps || !props?.baseUrl || !props?.token)
				return { id, props };
			return read404(
				() => icRequest(props.baseUrl, props.token, "GET", cfg.path(props)),
				(res) => ({ id, props: { ...props, ...cfg.readProps!(props, res) } }),
			);
		},
	};
}

// ─── Agent (POST/PATCH /v1/agents, publish version, rollout) ─────────
//
// An IC agent is a versioned agent persona that many users point at. The
// resource encodes the same idempotent flow the old `ensure-agent.ts` did:
// create-or-adopt by `slug` → publish a new immutable version ONLY when the
// content changed → roll that version out. `instructions` is app content, so
// this resource is declared in the app repo from the app's own spec module.
//
// `slug` is the immutable reconcile key (defaults to the Pulumi resource name);
// `name` is a free display label you can rename without churning the agent.

export interface AgentVariable {
	name: string;
	default?: string | null;
	description?: string | null;
	required?: boolean;
}

/** One skill reference in an agent's `skills` array. Omitted `version` follows
 *  the skill's `default_version` and is frozen at publish. Pair with
 *  {@link IcSkill}'s `skillId` output. */
export interface AgentSkillRef {
	skillId: string;
	version?: number;
}

// ── UI templates (MCP Apps, SEP-1865) ────────────────────────────────────────
//
// A tenant-authored interactive HTML bundle attached to an agent. The bytes ride
// a multipart upload to `/v1/agents/{aid}/ui`; the API stores them in blob
// storage and freezes the metadata ({ name, content_hash, csp, permissions,
// tool }) into the version snapshot on publish. Mirrors `UiResourceIn` /
// `UiResourceTool` from `@ingram-cloud/sdk/zod` (kept as local types so this
// package stays dependency-free).

/** CSP domain allowlists for the sandboxed iframe (the `_meta.ui.csp` shape). */
export interface UiCsp {
	connectDomains?: string[];
	resourceDomains?: string[];
	frameDomains?: string[];
	baseUriDomains?: string[];
}

/** A typed app-tool bound to a template (Rung 2): the host's model calls it and
 *  the template renders the result. */
export interface UiResourceTool {
	description: string;
	/** JSON Schema for the tool's arguments. */
	input_schema?: Record<string, unknown>;
	/** Scoped instruction the smith runs with when this tool is called. */
	instruction?: string | null;
	/** Writes gate through approval; reads flow freely. */
	mutating?: boolean;
}

/** One UI template declared on an `IcAgent`. Provide the HTML via `htmlPath`
 *  (read at `pulumi up`, so use an absolute path) or inline `html`. */
export interface UiTemplate {
	/** Template name (`[a-z0-9][a-z0-9_-]*`, ≤63) — the `ui://…/{name}` handle. */
	name: string;
	/** Absolute path to the HTML bundle. One of `htmlPath` / `html` is required. */
	htmlPath?: string;
	/** Inline HTML, as an alternative to `htmlPath`. */
	html?: string;
	csp?: UiCsp;
	/** Permissions-Policy-style host permissions the template requests. */
	permissions?: Record<string, unknown>;
	tool?: UiResourceTool;
}

interface ResolvedUiTemplate {
	name: string;
	bytes: Uint8Array;
	contentHash: string;
	csp?: UiCsp;
	permissions?: Record<string, unknown>;
	tool?: UiResourceTool;
}

// Read each template's HTML bundle (from `htmlPath` or inline `html`), hash the
// bytes with the same sha256-hex the API stores as `content_hash`, and carry the
// metadata through. Module-scope + node built-ins required inside so Pulumi's
// closure serialization captures it (the providers otherwise assume only global
// `fetch`).
function resolveUiTemplates(templates?: UiTemplate[]): ResolvedUiTemplate[] {
	if (!templates?.length) return [];
	const { createHash } = require("node:crypto");
	return templates.map((t) => {
		let bytes: Uint8Array;
		if (t.html !== undefined) bytes = Buffer.from(t.html, "utf8");
		else if (t.htmlPath) bytes = require("node:fs").readFileSync(t.htmlPath);
		else throw new Error(`uiTemplate "${t.name}": set htmlPath or html`);
		return {
			name: t.name,
			bytes,
			contentHash: createHash("sha256").update(bytes).digest("hex"),
			csp: t.csp,
			permissions: t.permissions,
			tool: t.tool,
		};
	});
}

// Multipart upload of one template to POST /v1/agents/{aid}/ui — the HTML `file`
// part plus a JSON `metadata` part. Not `icRequest` (that JSON-encodes the body);
// uses global FormData/File (Node ≥18).
async function uploadUiTemplate(
	baseUrl: string,
	token: string,
	aid: string,
	t: ResolvedUiTemplate,
): Promise<void> {
	const form = new FormData();
	form.set(
		"file",
		new File([new Uint8Array(t.bytes)], `${t.name}.html`, { type: "text/html" }),
	);
	const meta: Record<string, unknown> = { name: t.name };
	if (t.csp) meta.csp = t.csp;
	if (t.permissions) meta.permissions = t.permissions;
	if (t.tool) meta.tool = t.tool;
	form.set("metadata", JSON.stringify(meta));
	const res = await fetch(`${baseUrl}/v1/agents/${aid}/ui`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "IC-Api-Version": IC_API_VERSION },
		body: form,
	});
	if (!res.ok) {
		const err: any = new Error(
			`IC POST /v1/agents/${aid}/ui → ${res.status}: ${(await res.text()).slice(0, 400)}`,
		);
		err.status = res.status;
		throw err;
	}
}

// Reconcile the agent's UI templates against its draft `current` state: upload any
// whose bytes or metadata drifted (or are new), delete any the resource no longer
// declares. The draft this leaves behind is what the publish step snapshots.
const eq = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function syncUiTemplates(
	i: AgentInputs,
	id: string,
	current: Record<string, unknown>[],
): Promise<void> {
	const desired = resolveUiTemplates(i.uiTemplates);
	for (const t of desired) {
		const cur = current.find((e) => e?.name === t.name);
		const unchanged =
			cur &&
			cur.content_hash === t.contentHash &&
			eq(cur.tool, t.tool) &&
			eq(cur.csp, t.csp) &&
			eq(cur.permissions, t.permissions);
		if (!unchanged) await uploadUiTemplate(i.baseUrl, i.token, id, t);
	}
	for (const e of current) {
		const name = e?.name;
		if (typeof name === "string" && !desired.some((t) => t.name === name))
			await icRequest(
				i.baseUrl,
				i.token,
				"DELETE",
				`/v1/agents/${id}/ui/${encodeURIComponent(name)}`,
			);
	}
}

// Lower-case, hyphenate, trim — matches the API's slug derivation so a
// logical-name-derived slug lines up with what the server would compute.
function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 63) || "agent"
	);
}

interface AgentInputs {
	baseUrl: string;
	token: string;
	slug: string;
	name?: string;
	instructions?: string;
	model?: string;
	enabledHostedTools?: string[];
	mcpServers?: string[];
	vectorStoreIds?: string[];
	autoMemory?: boolean;
	memoryConsolidation?: boolean;
	variables?: AgentVariable[];
	skills?: AgentSkillRef[];
	uiTemplates?: UiTemplate[];
	publishNote?: string;
	rolloutPercent?: number;
}

// The draft body IC's create/patch expect (snake_case wire shape). `slug` is
// honoured on create and ignored on patch (it's immutable), so the display
// `name` defaults to the slug when none is given.
function agentBody(i: AgentInputs) {
	return {
		slug: i.slug,
		name: i.name ?? i.slug,
		instructions: i.instructions ?? null,
		model: i.model ?? null,
		enabled_hosted_tools: i.enabledHostedTools ?? [],
		mcp_servers: i.mcpServers ?? null,
		vector_store_ids: i.vectorStoreIds ?? [],
		auto_memory: i.autoMemory ?? null,
		memory_consolidation: i.memoryConsolidation ?? null,
		variables: i.variables ?? [],
		// Array.isArray, not `?? []`: during preview an unresolved Output (a
		// skill created in the same update) reaches diff as an unknown sentinel,
		// not an array — treat it as empty and let the real values drive `up`.
		skills: (Array.isArray(i.skills) ? i.skills : []).map((s) => ({
			skill_id: s.skillId,
			...(s.version != null ? { version: s.version } : {}),
		})),
	};
}

// The canonical content snapshot a signature is derived from: the snake_case
// wire shape IC stores on a published version. Both the camelCase resource inputs
// and a live version's `snapshot` map onto this one shape before signing, so the
// signature is computed exactly one way (and stays byte-stable across both paths).
interface UiResourceSnap {
	name: string;
	content_hash: string;
	tool?: unknown;
	csp?: unknown;
	permissions?: unknown;
}

interface AgentSnapshot {
	instructions?: string | null;
	model?: string | null;
	enabled_hosted_tools?: string[] | null;
	mcp_servers?: string[] | null;
	vector_store_ids?: string[] | null;
	auto_memory?: boolean | null;
	memory_consolidation?: boolean | null;
	variables?: AgentVariable[] | null;
	skills?: Array<{ skill_id: string; version?: number }> | null;
	ui_resources?: UiResourceSnap[] | null;
}

// Canonical, name-sorted signature of an agent's frozen UI templates: each
// entry's name + content hash + tool/csp/permissions metadata. Both the resource
// inputs (hash computed from local bytes) and a published version's snapshot
// (hash already stored) map onto this shape, so a template edit moves the
// signature exactly one way.
function uiResourcesSig(list?: UiResourceSnap[] | null): unknown[] {
	return (list ?? [])
		.map((e) => ({
			name: e.name,
			content_hash: e.content_hash,
			tool: e.tool ?? null,
			csp: e.csp ?? null,
			permissions: e.permissions ?? null,
		}))
		.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Stable signature of the *content* that warrants a new published version
// (name and rollout% deliberately excluded — a rename/restage is not new content).
function agentContentSig(s: AgentSnapshot): string {
	const base: Record<string, unknown> = {
		instructions: s.instructions ?? null,
		model: s.model ?? null,
		tools: (s.enabled_hosted_tools ?? []).toSorted(),
		auto_memory: s.auto_memory ?? null,
		memory_consolidation: s.memory_consolidation ?? null,
		variables: s.variables ?? [],
	};
	// Only add the key when templates exist, so agents without any keep a
	// byte-identical signature to pre-uiTemplates releases (no spurious republish
	// on the first `up` after upgrading the library).
	const ui = uiResourcesSig(s.ui_resources);
	if (ui.length) base.ui_resources = ui;
	// Same discipline for mcp_servers: unset (= all) stays out of the signature.
	if (s.mcp_servers != null) base.mcp_servers = s.mcp_servers.toSorted();
	// And for vector stores: omit when empty so agents without any keep a
	// byte-identical signature to pre-vectorStoreIds releases.
	const vs = (s.vector_store_ids ?? []).toSorted();
	if (vs.length) base.vector_store_ids = vs;
	// Skills, deliberately NOT sorted: reference order is the run's index-ceiling
	// drop priority, so reordering the array is itself a content change worth a
	// new version, not a no-op like reordering hosted tools or vector stores is.
	const skills = s.skills ?? [];
	if (skills.length) base.skills = skills;
	return JSON.stringify(base);
}

// Map the camelCase resource inputs onto the canonical snapshot shape.
function inputsToSnapshot(i: {
	instructions?: string | null;
	model?: string | null;
	enabledHostedTools?: string[];
	mcpServers?: string[];
	vectorStoreIds?: string[];
	autoMemory?: boolean | null;
	memoryConsolidation?: boolean | null;
	variables?: AgentVariable[];
	skills?: AgentSkillRef[];
	uiTemplates?: UiTemplate[];
}): AgentSnapshot {
	return {
		instructions: i.instructions,
		model: i.model,
		enabled_hosted_tools: i.enabledHostedTools,
		mcp_servers: i.mcpServers,
		vector_store_ids: i.vectorStoreIds,
		auto_memory: i.autoMemory,
		memory_consolidation: i.memoryConsolidation,
		variables: i.variables,
		// Array.isArray, not `?? []`: during preview an unresolved Output (a
		// skill created in the same update) reaches diff as an unknown sentinel,
		// not an array — treat it as empty and let the real values drive `up`.
		skills: (Array.isArray(i.skills) ? i.skills : []).map((s) => ({
			skill_id: s.skillId,
			...(s.version != null ? { version: s.version } : {}),
		})),
		// Resolve each template's bytes and hash so a HTML edit shows up in the
		// signature (the API's `content_hash` uses the same sha256-hex).
		ui_resources: resolveUiTemplates(i.uiTemplates).map((t) => ({
			name: t.name,
			content_hash: t.contentHash,
			tool: t.tool,
			csp: t.csp,
			permissions: t.permissions,
		})),
	};
}

async function findAgentBySlug(baseUrl: string, token: string, slug: string) {
	const res = await icRequest(baseUrl, token, "GET", "/v1/agents?limit=200");
	return (res.data ?? []).find((b: any) => b.slug === slug) ?? null;
}

// Signature of the snapshot currently published as the active version, or null
// if nothing is published yet.
async function activeSnapshotSig(
	baseUrl: string,
	token: string,
	id: string,
	activeVersion: number | null | undefined,
): Promise<string | null> {
	if (!activeVersion) return null;
	const res = await icRequest(
		baseUrl,
		token,
		"GET",
		`/v1/agents/${id}/versions?limit=200`,
	);
	const v = (res.data ?? []).find((x: any) => x.version === activeVersion);
	if (!v) return null;
	// The version's `snapshot` is already the canonical snake_case shape.
	return agentContentSig(v.snapshot ?? {});
}

// Ensure the live agent matches desired: adopt-or-create, publish iff the
// content drifted from the active version, then roll out at `percent`.
async function reconcileAgent(i: AgentInputs, knownId?: string, priorSig?: string) {
	let id: string;
	if (!knownId) {
		const existing = await findAgentBySlug(i.baseUrl, i.token, i.slug);
		if (existing) {
			id = existing.id;
			await icRequest(
				i.baseUrl,
				i.token,
				"PATCH",
				`/v1/agents/${id}`,
				agentBody(i),
			);
		} else {
			// No idempotency key: Pulumi calls create once and tracks the id in
			// state, and the adopt-by-slug branch above covers re-runs and the
			// script→Pulumi migration. Keying on the slug would replay a stale
			// (possibly archived) create after a destroy+recreate within the 24h
			// idempotency window.
			const bp = await icRequest(
				i.baseUrl,
				i.token,
				"POST",
				"/v1/agents",
				agentBody(i),
			);
			id = bp.id;
		}
	} else {
		// Known id (update path): push the draft to the desired shape.
		id = knownId;
		await icRequest(i.baseUrl, i.token, "PATCH", `/v1/agents/${id}`, agentBody(i));
	}

	const bp = await icRequest(i.baseUrl, i.token, "GET", `/v1/agents/${id}`);
	// Reconcile UI templates against the draft before publishing so a template
	// change rides the same publish + rollout as an instruction change.
	await syncUiTemplates(
		i,
		id,
		(bp.draft?.ui_resources ?? []) as Record<string, unknown>[],
	);
	const desiredSig = agentContentSig(inputsToSnapshot(i));
	// On the create path we don't know the prior sig — compare to what's actually
	// published so adopting a script-made agent doesn't churn a needless version.
	const liveSig =
		priorSig ??
		(await activeSnapshotSig(i.baseUrl, i.token, id, bp.active_version));
	let version: number = bp.active_version ?? 0;
	if (!bp.active_version || liveSig !== desiredSig) {
		// Publishing snapshots the draft as the next immutable version and returns
		// its number. Only the *first* publish auto-activates; later ones go live
		// only via the rollout below — so take the version from the publish reply,
		// not from active_version (which hasn't advanced yet).
		const pub = await icRequest(
			i.baseUrl,
			i.token,
			"POST",
			`/v1/agents/${id}/versions`,
			{
				note: i.publishNote ?? null,
			},
		);
		version = pub.version;
	}
	// Always assert the rollout: it activates a freshly published version and is
	// an idempotent no-op when `version` is already the active one at `percent`.
	const percent = i.rolloutPercent ?? 100;
	await icRequest(i.baseUrl, i.token, "POST", `/v1/agents/${id}/rollout`, {
		version,
		percent,
	});
	return {
		...i,
		agentId: id,
		contentSig: desiredSig,
		activeVersion: version,
		rolloutPercent: percent,
	};
}

const agentProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: AgentInputs) {
		const outs = await reconcileAgent(i);
		return { id: outs.agentId, outs };
	},
	async update(id, olds: AgentInputs & { contentSig?: string }, news: AgentInputs) {
		const outs = await reconcileAgent(news, id, olds.contentSig);
		return { outs };
	},
	async delete(id, props: AgentInputs) {
		try {
			await icRequest(props.baseUrl, props.token, "DELETE", `/v1/agents/${id}`);
		} catch (e) {
			// A 409 is the API's `agent_in_use` precondition: an agent can't be archived
			// while smiths still run it. Surface that as an actionable message; the API's
			// own error (carrying the smith count) is appended. Any other error propagates
			// unwrapped.
			if ((e as { status?: number })?.status === 409)
				throw new Error(
					`Agent ${id} can't be archived while smiths still run it. Delete or ` +
						`re-point those smiths first, or set { retainOnDelete: true } on the ` +
						`resource to leave the agent in place. ${e}`,
					{ cause: e },
				);
			throw e;
		}
	},
	async diff(_id, olds: AgentInputs, news: AgentInputs) {
		// slug is the immutable reconcile key — changing it is a replace, not an
		// update (the old and new slugs differ, so create-before-delete is safe).
		if (olds.slug !== news.slug) return { changes: true, replaces: ["slug"] };
		// Compare the freshly-resolved desired signature to the one STORED at the
		// last apply — not a re-resolve of `olds`. A file-backed template edits the
		// same `htmlPath`, so re-reading `olds` would hash the new bytes and hide
		// the change; the stored `contentSig` froze the prior hash.
		const oldSig =
			(olds as AgentInputs & { contentSig?: string }).contentSig ??
			agentContentSig(inputsToSnapshot(olds));
		const contentChanged = oldSig !== agentContentSig(inputsToSnapshot(news));
		const nameChanged = (olds.name ?? olds.slug) !== (news.name ?? news.slug);
		const rolloutChanged =
			(olds.rolloutPercent ?? 100) !== (news.rolloutPercent ?? 100);
		return { changes: contentChanged || nameChanged || rolloutChanged };
	},
	// Adopt a agent a script already created (`pulumi import <id>`).
	async read(id, props: Partial<AgentInputs>) {
		return read404(
			() => icRequest(props.baseUrl!, props.token!, "GET", `/v1/agents/${id}`),
			(bp: any) => {
				if (!bp || !bp.id) return { id: "" };
				const d = bp.draft ?? {};
				return {
					id,
					props: {
						...props,
						slug: bp.slug ?? props.slug,
						name: bp.name,
						instructions: d.instructions ?? undefined,
						model: d.model ?? undefined,
						enabledHostedTools: d.enabled_hosted_tools ?? [],
						vectorStoreIds: d.vector_store_ids ?? [],
						autoMemory: d.auto_memory ?? undefined,
						memoryConsolidation: d.memory_consolidation ?? undefined,
						variables: d.variables ?? [],
						skills: (d.skills ?? []).map(
							(s: { skill_id: string; version?: number }) => ({
								skillId: s.skill_id,
								version: s.version,
							}),
						),
					} as any,
				};
			},
		);
	},
};

export interface IcAgentArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/**
	 * Immutable, tenant-unique reconcile key (`[a-z0-9-]`). This is what the
	 * resource adopts on across runs. Defaults to the Pulumi resource name
	 * (slugified); set it explicitly to decouple the key from the resource name.
	 * Changing it replaces the agent.
	 */
	slug?: pulumi.Input<string>;
	/** Free display label (mutable, not unique). Defaults to the slug. */
	name?: pulumi.Input<string>;
	/** The persona/instruction template (may contain `{{ variables }}`). */
	instructions?: pulumi.Input<string>;
	model?: pulumi.Input<string>;
	enabledHostedTools?: pulumi.Input<string[]>;
	/** Scope runs to these registered MCP servers (by name). Omitted = all. */
	mcpServers?: pulumi.Input<string[]>;
	/**
	 * Vector store ids (`vs_…`) whose contents this agent can retrieve over. Folds
	 * into the content signature like `enabledHostedTools`, so a change publishes and
	 * rolls out a new version. Pair with {@link IcVectorStore} to IaC the stores.
	 */
	vectorStoreIds?: pulumi.Input<string[]>;
	autoMemory?: pulumi.Input<boolean>;
	/** Opt into observational-memory consolidation (background, billed). Default off. */
	memoryConsolidation?: pulumi.Input<boolean>;
	variables?: pulumi.Input<AgentVariable[]>;
	/**
	 * Skills (`skl_…`) attached to the agent, in order. Order is not cosmetic: a
	 * run whose skills together exceed the search-index ceiling keeps them in
	 * this order and drops the rest, so it is the survival priority. Folds into
	 * the content signature unsorted, unlike `enabledHostedTools`/`vectorStoreIds`
	 * — reordering is itself a content change. Pair with {@link IcSkill}'s
	 * `skillId` output.
	 */
	skills?: pulumi.Input<AgentSkillRef[]>;
	/**
	 * MCP Apps UI templates attached to the agent. Each template's HTML bundle is
	 * uploaded when its bytes or metadata change, and its name + content hash +
	 * metadata fold into the content signature — so a template edit publishes and
	 * rolls out a new version like an instruction change. Provide the HTML via an
	 * absolute `htmlPath` or inline `html`.
	 */
	uiTemplates?: pulumi.Input<UiTemplate[]>;
	/** Release note recorded when a new version is published. */
	publishNote?: pulumi.Input<string>;
	/** Rollout percentage for the published version (default 100). */
	rolloutPercent?: pulumi.Input<number>;
}

export class IcAgent extends pulumi.dynamic.Resource {
	/** The `agt_…` id (same as `.id`, exposed for convenience). */
	public readonly agentId!: pulumi.Output<string>;
	/** The version number currently rolled out. */
	public readonly activeVersion!: pulumi.Output<number>;
	constructor(name: string, args: IcAgentArgs, opts?: pulumi.CustomResourceOptions) {
		super(
			agentProvider,
			name,
			{
				instructions: undefined,
				model: undefined,
				enabledHostedTools: undefined,
				mcpServers: undefined,
				vectorStoreIds: undefined,
				autoMemory: undefined,
				memoryConsolidation: undefined,
				variables: undefined,
				skills: undefined,
				uiTemplates: undefined,
				publishNote: undefined,
				rolloutPercent: undefined,
				agentId: undefined,
				activeVersion: undefined,
				contentSig: undefined,
				...args,
				// Default the reconcile key to the (stable) resource name when the
				// caller doesn't pin one — kept after ...args so it always resolves.
				slug: args.slug ?? slugify(name),
			},
			{ ...opts, additionalSecretOutputs: ["token"] },
		);
	}
}

// ─── Skill (POST/GET/DELETE /v1/skills, immutable versions) ─────────────────
//
// An Agent Skills bundle: a folder anchored by SKILL.md, uploaded whole and
// versioned server-side. Declared by LOCAL DIRECTORY, like a vector store's
// files and a UI template's htmlPath — the bytes are read at `pulumi up` and
// their combined hash tracks drift, so editing any file in the folder publishes
// a new version and moves `default_version` to it. Pair with {@link IcAgent}'s
// `skills` to put it in front of a fleet.

/** One file of a skill bundle, resolved from disk. */
interface ResolvedSkillFile {
	/** Path relative to the bundle root, including the root directory itself —
	 *  the shape `/v1/skills` expects on each part's filename. */
	rel: string;
	bytes: Uint8Array;
}

/** Walk a skill directory into the parts the upload sends.
 *
 *  `require` inline rather than a top-level import: Pulumi serializes a dynamic
 *  provider's closure, and this is the idiom the vector-store resource next door
 *  already uses to read local files. */
function resolveSkillFiles(dir: string): ResolvedSkillFile[] {
	if (!dir) throw new Error("skill: `path` is required");
	const fs = require("node:fs");
	const nodePath = require("node:path");
	const root = nodePath.basename(nodePath.resolve(dir));
	const out: ResolvedSkillFile[] = [];
	const walk = (at: string, prefix: string): void => {
		for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
			const full = nodePath.join(at, entry.name);
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(full, rel);
			else if (entry.isFile())
				out.push({ rel: `${root}/${rel}`, bytes: fs.readFileSync(full) });
		}
	};
	walk(nodePath.resolve(dir), "");
	if (!out.some((f) => f.rel === `${root}/SKILL.md`))
		throw new Error(`skill: ${dir} has no SKILL.md`);
	return out.toSorted((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** A content signature over the whole bundle — what `diff` compares. */
function skillSig(dir?: string): string {
	if (!dir) return "";
	const { createHash } = require("node:crypto");
	const hash = createHash("sha256");
	for (const file of resolveSkillFiles(dir)) {
		hash.update(file.rel);
		hash.update(file.bytes);
	}
	return hash.digest("hex");
}

/** Upload a bundle as repeated `files[]` parts. Not `icRequest` (that
 *  JSON-encodes); uses global FormData/File (Node ≥18), like `uploadFile`. */
async function uploadSkillBundle(
	baseUrl: string,
	token: string,
	path: string,
	dir: string,
): Promise<any> {
	const form = new FormData();
	for (const file of resolveSkillFiles(dir))
		form.append("files[]", new File([file.bytes as any], file.rel));
	const res = await fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"IC-Api-Version": IC_API_VERSION,
		},
		body: form,
	});
	const text = await res.text();
	if (!res.ok) {
		const err: any = new Error(
			`IC POST ${path} → ${res.status}: ${text.slice(0, 400)}`,
		);
		err.status = res.status;
		throw err;
	}
	return text ? JSON.parse(text) : {};
}

interface SkillInputs {
	baseUrl: string;
	token: string;
	path: string;
	skillId?: string;
	version?: number;
	contentSig?: string;
}

const skillProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: SkillInputs) {
		const skill = await uploadSkillBundle(i.baseUrl, i.token, "/v1/skills", i.path);
		return {
			id: skill.id,
			outs: {
				...i,
				skillId: skill.id,
				version: skill.default_version,
				contentSig: skillSig(i.path),
			},
		};
	},
	async update(id, _olds: SkillInputs, news: SkillInputs) {
		// A version is immutable, so an edited bundle is a new one — and the
		// default has to move, or nothing that resolves by default would see it.
		const published = await uploadSkillBundle(
			news.baseUrl,
			news.token,
			`/v1/skills/${id}/versions`,
			news.path,
		);
		await icRequest(news.baseUrl, news.token, "POST", `/v1/skills/${id}`, {
			default_version: published.version,
		});
		return {
			outs: {
				...news,
				skillId: id,
				version: published.version,
				contentSig: skillSig(news.path),
			},
		};
	},
	async delete(id, props: SkillInputs) {
		await icRequest(props.baseUrl, props.token, "DELETE", `/v1/skills/${id}`);
	},
	async diff(_id, olds: SkillInputs, news: SkillInputs) {
		// Compare against the sig STORED at the last apply, not a re-resolve of
		// olds: olds.path points at the same folder, whose bytes have already
		// changed, so re-reading it would hide the change (same reasoning as the
		// agent and vector-store diffs).
		const changed = (olds.contentSig ?? "") !== skillSig(news.path);
		return { changes: changed };
	},
	async read(id, props: Partial<SkillInputs>) {
		return read404(
			() => icRequest(props.baseUrl!, props.token!, "GET", `/v1/skills/${id}`),
			(skill: any) => {
				if (!skill || !skill.id) return { id: "" };
				return {
					id,
					props: {
						...props,
						skillId: skill.id,
						version: skill.default_version,
					} as any,
				};
			},
		);
	},
};

export interface IcSkillArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/**
	 * Absolute path to the skill's directory — the folder anchored by `SKILL.md`,
	 * whose basename is the skill's name. Read at `pulumi up`; edit any file in it
	 * and a new immutable version is published and made the default.
	 */
	path: pulumi.Input<string>;
}

export class IcSkill extends pulumi.dynamic.Resource {
	/** The `skl_…` id (same as `.id`, exposed for convenience). */
	public readonly skillId!: pulumi.Output<string>;
	/** The version this stack last published, and the current `default_version`. */
	public readonly version!: pulumi.Output<number>;
	constructor(name: string, args: IcSkillArgs, opts?: pulumi.CustomResourceOptions) {
		super(
			skillProvider,
			name,
			{ skillId: undefined, version: undefined, contentSig: undefined, ...args },
			{ ...opts, additionalSecretOutputs: ["token"] },
		);
	}
}

// ─── Vector store (POST/GET/DELETE /v1/vector_stores, local-file attach) ─────
//
// A tenant knowledge base: metadata plus source files that IC ingests + chunks
// for retrieval. Files are declared by LOCAL PATH (à la uiTemplates' `htmlPath`):
// each file's bytes are uploaded to `/v1/files` (purpose `assistants`) then
// attached, and the bytes' sha256 tracks drift — edit a file and it re-uploads +
// re-attaches, remove it and it detaches. Attaching kicks off async ingest
// server-side; this resource returns once the file is attached (`in_progress`),
// it does NOT block on indexing (mirrors the fire-and-forget UI-template upload).
// Pair with {@link IcAgent}'s `vectorStoreIds` to let an agent retrieve over it.

/** One source file on an {@link IcVectorStore}, provided by local path. */
export interface VectorStoreFile {
	/** Absolute path to the file to ingest (read at `pulumi up`, like `htmlPath`). */
	path: string;
	/** Per-file chunking override (the `chunking_strategy` wire shape); defaults to
	 *  the server default (`auto`). */
	chunkingStrategy?: Record<string, unknown>;
}

interface VectorStoreInputs {
	baseUrl: string;
	token: string;
	name?: string;
	description?: string;
	metadata?: Record<string, unknown>;
	files?: VectorStoreFile[];
}

interface ResolvedVsFile {
	path: string;
	bytes: Uint8Array;
	contentHash: string;
	chunkingStrategy?: Record<string, unknown>;
}

/** The per-file state stored as an output so `update` can reconcile attachments:
 *  which local path maps to which uploaded `file_…` id, and its last-seen hash. */
interface VsFileState {
	path: string;
	contentHash: string;
	fileId: string;
}

// Read each declared file's bytes and hash them (same sha256-hex the API keys
// files by) so an edit shows up in the file signature. Module-scope + node
// built-ins required inside for Pulumi's closure serialization.
function resolveVsFiles(files?: VectorStoreFile[]): ResolvedVsFile[] {
	if (!files?.length) return [];
	const { createHash } = require("node:crypto");
	return files.map((f) => {
		if (!f.path) throw new Error("vectorStore file: `path` is required");
		const bytes: Uint8Array = require("node:fs").readFileSync(f.path);
		return {
			path: f.path,
			bytes,
			contentHash: createHash("sha256").update(bytes).digest("hex"),
			chunkingStrategy: f.chunkingStrategy,
		};
	});
}

// Multipart upload of one file to POST /v1/files (purpose `assistants`, the
// vector-store source purpose) → the new `file_…` id. Not `icRequest` (that
// JSON-encodes the body); uses global FormData/File (Node ≥18).
async function uploadFile(
	baseUrl: string,
	token: string,
	bytes: Uint8Array,
	filename: string,
): Promise<string> {
	const form = new FormData();
	form.set(
		"file",
		new File([new Uint8Array(bytes)], filename, {
			type: "application/octet-stream",
		}),
	);
	form.set("purpose", "assistants");
	const res = await fetch(`${baseUrl}/v1/files`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "IC-Api-Version": IC_API_VERSION },
		body: form,
	});
	if (!res.ok) {
		const err: any = new Error(
			`IC POST /v1/files → ${res.status}: ${(await res.text()).slice(0, 400)}`,
		);
		err.status = res.status;
		throw err;
	}
	return ((await res.json()) as { id: string }).id;
}

const vsBasename = (p: string) => p.split(/[\\/]/).pop() || p;

// The store's mutable fields (POST /v1/vector_stores on create, POST
// /v1/vector_stores/{id} to modify). Only send keys the caller set.
function vsBody(i: VectorStoreInputs) {
	const body: Record<string, unknown> = {};
	if (i.name !== undefined) body.name = i.name;
	if (i.description !== undefined) body.description = i.description;
	if (i.metadata !== undefined) body.metadata = i.metadata;
	return body;
}

// Upload one file's bytes and attach the resulting id to the store.
async function attachVsFile(
	i: VectorStoreInputs,
	id: string,
	f: ResolvedVsFile,
): Promise<VsFileState> {
	const fileId = await uploadFile(i.baseUrl, i.token, f.bytes, vsBasename(f.path));
	await icRequest(i.baseUrl, i.token, "POST", `/v1/vector_stores/${id}/files`, {
		file_id: fileId,
		...(f.chunkingStrategy ? { chunking_strategy: f.chunkingStrategy } : {}),
	});
	return { path: f.path, contentHash: f.contentHash, fileId };
}

// Reconcile attachments against the declared set: (re)upload+attach any new-or-
// changed file, detach any whose path was dropped or whose bytes changed. Returns
// the new file-state list to store as an output. The store-file id IS the
// `file_…` id, so detach targets `/files/{fileId}`.
async function syncVsFiles(
	i: VectorStoreInputs,
	id: string,
	prior: VsFileState[],
): Promise<VsFileState[]> {
	const desired = resolveVsFiles(i.files);
	const byPath = new Map(prior.map((p) => [p.path, p]));
	const next: VsFileState[] = [];
	for (const f of desired) {
		const cur = byPath.get(f.path);
		if (cur && cur.contentHash === f.contentHash) {
			next.push(cur); // unchanged bytes — keep the existing attachment
			continue;
		}
		if (cur)
			// bytes changed → detach the stale file before re-uploading
			await icRequest(
				i.baseUrl,
				i.token,
				"DELETE",
				`/v1/vector_stores/${id}/files/${cur.fileId}`,
			);
		next.push(await attachVsFile(i, id, f));
	}
	const keep = new Set(desired.map((f) => f.path));
	for (const p of prior)
		if (!keep.has(p.path))
			await icRequest(
				i.baseUrl,
				i.token,
				"DELETE",
				`/v1/vector_stores/${id}/files/${p.fileId}`,
			);
	return next;
}

// Canonical, path-sorted signature of the declared files (path + content hash +
// chunking), so a file edit/add/remove is exactly one diff. Empty ⇒ "[]".
function vsFilesSig(files?: VectorStoreFile[]): string {
	return JSON.stringify(
		resolveVsFiles(files)
			.map((f) => ({
				path: f.path,
				content_hash: f.contentHash,
				chunking: f.chunkingStrategy ?? null,
			}))
			.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
	);
}

const vectorStoreProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: VectorStoreInputs) {
		const res = await icRequest(
			i.baseUrl,
			i.token,
			"POST",
			"/v1/vector_stores",
			vsBody(i),
		);
		const fileState = await syncVsFiles(i, res.id, []);
		return {
			id: res.id,
			outs: {
				...i,
				vectorStoreId: res.id,
				fileState,
				filesSig: vsFilesSig(i.files),
			},
		};
	},
	async update(
		id,
		olds: VectorStoreInputs & { fileState?: VsFileState[] },
		news: VectorStoreInputs,
	) {
		const body = vsBody(news);
		if (Object.keys(body).length)
			await icRequest(
				news.baseUrl,
				news.token,
				"POST",
				`/v1/vector_stores/${id}`,
				body,
			);
		const fileState = await syncVsFiles(news, id, olds.fileState ?? []);
		return {
			outs: {
				...news,
				vectorStoreId: id,
				fileState,
				filesSig: vsFilesSig(news.files),
			},
		};
	},
	async delete(id, props: VectorStoreInputs) {
		await icRequest(
			props.baseUrl,
			props.token,
			"DELETE",
			`/v1/vector_stores/${id}`,
		);
	},
	async diff(
		_id,
		olds: VectorStoreInputs & { filesSig?: string },
		news: VectorStoreInputs,
	) {
		const scalarChanged =
			(olds.name ?? undefined) !== (news.name ?? undefined) ||
			(olds.description ?? undefined) !== (news.description ?? undefined);
		const metaChanged =
			JSON.stringify(olds.metadata ?? null) !==
			JSON.stringify(news.metadata ?? null);
		// Compare against the sig STORED at the last apply (not a re-resolve of olds):
		// a file-backed path edits the same bytes, so re-reading olds would hash the
		// new bytes and hide the change (same reasoning as the agent diff).
		const oldSig = olds.filesSig ?? vsFilesSig(olds.files);
		const filesChanged = oldSig !== vsFilesSig(news.files);
		return { changes: scalarChanged || metaChanged || filesChanged };
	},
	// Adopt a store a script already created (`pulumi import <id>`). Local file
	// attachments can't be reconstructed from the server (no local paths), so this
	// recovers only the store's own fields; declare `files` to (re)assert them.
	async read(id, props: Partial<VectorStoreInputs>) {
		return read404(
			() =>
				icRequest(
					props.baseUrl!,
					props.token!,
					"GET",
					`/v1/vector_stores/${id}`,
				),
			(vs: any) => {
				if (!vs || !vs.id) return { id: "" };
				return {
					id,
					props: {
						...props,
						name: vs.name ?? undefined,
						description: vs.description ?? undefined,
						metadata: vs.metadata ?? undefined,
					} as any,
				};
			},
		);
	},
};

export interface IcVectorStoreArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/** Display name. */
	name?: pulumi.Input<string>;
	description?: pulumi.Input<string>;
	/** Arbitrary key/value metadata stored on the vector store. */
	metadata?: pulumi.Input<Record<string, unknown>>;
	/**
	 * Source files to ingest, each declared by an absolute local `path` (read at
	 * `pulumi up`, like a UI template's `htmlPath`). A file's sha256 tracks drift:
	 * edit it and it re-uploads + re-attaches, remove it and it detaches. Attaching
	 * starts async ingest server-side; this resource does not block on indexing.
	 */
	files?: pulumi.Input<VectorStoreFile[]>;
}

export class IcVectorStore extends pulumi.dynamic.Resource {
	/** The `vs_…` id (same as `.id`, exposed for convenience). */
	public readonly vectorStoreId!: pulumi.Output<string>;
	constructor(
		name: string,
		args: IcVectorStoreArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			vectorStoreProvider,
			name,
			{
				name: undefined,
				description: undefined,
				metadata: undefined,
				files: undefined,
				vectorStoreId: undefined,
				fileState: undefined,
				filesSig: undefined,
				...args,
			},
			{ ...opts, additionalSecretOutputs: ["token"] },
		);
	}
}

// ─── MCP server (PUT /v1/tenant/mcp/{name}) ──────────────────────────────────

interface ApprovalRule {
	match: string;
	require?: string;
}

interface McpInputs {
	baseUrl: string;
	token: string;
	serverName: string;
	url?: string;
	/** Stamp from a curated catalog preset (e.g. "stripe") instead of a raw url. */
	catalog?: string;
	authKind: string;
	authProvider?: string;
	/** oauth: whose OAuth client brokers consent — "tenant" | "platform". */
	clientMode?: string;
	secret?: string;
	/** Default-deny tool gate: only these tool names reach a run. Omit = expose all. */
	toolAllowlist?: string[];
	/** IC-side approval gating, independent of the server's destructiveHint. */
	approvalPolicy?: ApprovalRule[];
}

function mcpBody(i: McpInputs) {
	const auth: Record<string, unknown> = { kind: i.authKind };
	if (i.authProvider) auth.provider = i.authProvider;
	if (i.clientMode) auth.client_mode = i.clientMode;
	if (i.secret) auth.secret = i.secret;
	const body: Record<string, unknown> = { auth };
	if (i.url) body.url = i.url;
	if (i.catalog) body.catalog = i.catalog;
	if (i.toolAllowlist !== undefined) body.tool_allowlist = i.toolAllowlist;
	if (i.approvalPolicy !== undefined) body.approval_policy = i.approvalPolicy;
	return body;
}

const mcpProvider = makePutResource<McpInputs>({
	path: (i) => `/v1/tenant/mcp/${encodeURIComponent(i.serverName)}`,
	id: (i) => i.serverName,
	body: mcpBody,
	outs: (_i, res) => ({
		toolsDiscovered: res.tools_discovered ?? 0,
		discoveryError: res.discovery_error ?? null,
	}),
	// `pulumi refresh` round-trips the security-relevant fields, so a live auth
	// downgrade (e.g. oauth silently reverting to none) shows up as a diff and the
	// next `up` re-pushes the declared config. Catalog presets supply url/auth
	// server-side — omitted inputs are correct there, so nothing is overlaid.
	readProps: (i, res) => {
		if (i.catalog) return {};
		return {
			url: res.url ?? i.url,
			authKind: res.auth?.kind ?? i.authKind,
			authProvider: res.auth?.provider ?? undefined,
		};
	},
	diff: {
		replaceKeys: ["serverName"],
		scalarKeys: [
			"url",
			"catalog",
			"authKind",
			"authProvider",
			"clientMode",
			"secret",
			"token",
			"baseUrl",
		],
		// Arrays compare by value, not reference.
		listKeys: ["toolAllowlist", "approvalPolicy"],
		deleteBeforeReplace: true,
	},
});

export interface IcMcpServerArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/** Registry name — the `{name}` in `/v1/tenant/mcp/{name}`. */
	serverName: pulumi.Input<string>;
	/** Server URL. Optional when `catalog` is set (the preset supplies it). */
	url?: pulumi.Input<string>;
	/** Stamp from a curated catalog preset (e.g. "stripe"); copied down at enable. */
	catalog?: pulumi.Input<string>;
	authKind?: pulumi.Input<string>; // none | bearer | oauth (default bearer)
	authProvider?: pulumi.Input<string>;
	/** oauth only: "tenant" (your own OAuth client) | "platform" (Ingram-owned). */
	clientMode?: pulumi.Input<string>;
	secret?: pulumi.Input<string>;
	/** Default-deny: only these tool names reach a run. Omit to expose all discovered. */
	toolAllowlist?: pulumi.Input<string[]>;
	/** IC-side approval gating by tool-name glob, e.g. `[{ match: "create_refund" }]`. */
	approvalPolicy?: pulumi.Input<{ match: string; require?: string }[]>;
}

export class IcMcpServer extends pulumi.dynamic.Resource {
	public readonly toolsDiscovered!: pulumi.Output<number>;
	public readonly discoveryError!: pulumi.Output<string | undefined>;
	constructor(
		name: string,
		args: IcMcpServerArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			mcpProvider,
			name,
			{
				authKind: args.catalog ? undefined : "bearer",
				url: undefined,
				catalog: undefined,
				authProvider: undefined,
				clientMode: undefined,
				secret: undefined,
				toolAllowlist: undefined,
				approvalPolicy: undefined,
				toolsDiscovered: undefined,
				discoveryError: undefined,
				...args,
			},
			{ ...opts, additionalSecretOutputs: ["token", "secret"] },
		);
	}
}

// ─── Telegram bot (PUT /v1/tenant/telegram) ──────────────────────────────────

interface TelegramInputs {
	baseUrl: string;
	token: string;
	botToken: string;
}

const telegramProvider = makePutResource<TelegramInputs>({
	path: () => "/v1/tenant/telegram",
	id: () => "telegram",
	body: (i) => ({ bot_token: i.botToken }),
	outs: (_i, res) => ({
		botUsername: res.bot_username,
		botId: res.bot_id,
		webhookUrl: res.webhook_url,
	}),
	diff: { scalarKeys: ["botToken", "token", "baseUrl"] },
});

export interface IcTelegramBotArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	botToken: pulumi.Input<string>;
}

export class IcTelegramBot extends pulumi.dynamic.Resource {
	public readonly botUsername!: pulumi.Output<string>;
	public readonly webhookUrl!: pulumi.Output<string>;
	constructor(
		name: string,
		args: IcTelegramBotArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			telegramProvider,
			name,
			{
				botUsername: undefined,
				botId: undefined,
				webhookUrl: undefined,
				...args,
			},
			{ ...opts, additionalSecretOutputs: ["token", "botToken"] },
		);
	}
}

// ─── OAuth client provider (PUT /v1/tenant/providers/{provider}) ─────────────
//
// The tenant-level provider record an `oauth`-kind MCP server names via
// `authProvider`. Two refresh modes, chosen by what you set:
//   - IC-driven: `clientId` + `clientSecret` (+ `tokenUri`) — IC exchanges the
//     stored refresh token at the token endpoint itself.
//   - Webhook delegation: `refreshWebhook` and NO client secret — IC POSTs
//     `{ connection_id }` to the tenant near expiry and the tenant PATCHes a
//     fresh pair back; the tenant owns the token format entirely.

interface OauthProviderInputs {
	baseUrl: string;
	token: string;
	provider: string;
	refreshWebhook?: string;
	clientId?: string;
	clientSecret?: string;
	tokenUri?: string;
	scopesAllowed?: string[];
	authorizeUrl?: string;
}

const oauthProviderResource = makePutResource<OauthProviderInputs>({
	path: (i) => `/v1/tenant/providers/${encodeURIComponent(i.provider)}`,
	id: (i) => i.provider,
	body: (i) => ({
		refresh_webhook: i.refreshWebhook,
		client_id: i.clientId,
		// Key presence is meaningful on the wire: an omitted `client_secret`
		// keeps the stored one, a sent value (even null) replaces it. Only send
		// the key when the input is set so a webhook-mode provider never
		// clobbers— or phantom-clears — a secret.
		...(i.clientSecret !== undefined ? { client_secret: i.clientSecret } : {}),
		token_uri: i.tokenUri,
		scopes_allowed: i.scopesAllowed,
		authorize_url: i.authorizeUrl,
	}),
	diff: {
		replaceKeys: ["provider"],
		scalarKeys: [
			"refreshWebhook",
			"clientId",
			"clientSecret",
			"tokenUri",
			"authorizeUrl",
			"token",
			"baseUrl",
		],
		listKeys: ["scopesAllowed"],
		deleteBeforeReplace: true,
	},
});

export interface IcOauthProviderArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/** Provider key — the `{provider}` in `/v1/tenant/providers/{provider}`;
	 *  what an oauth-kind `IcMcpServer` names via `authProvider`. */
	provider: pulumi.Input<string>;
	/** Webhook-delegation mode: IC POSTs `{ connection_id }` here when a stored
	 *  token nears expiry and the tenant PATCHes a fresh pair back. Set this
	 *  WITHOUT `clientSecret` (a stored secret switches IC to IC-driven mode). */
	refreshWebhook?: pulumi.Input<string>;
	clientId?: pulumi.Input<string>;
	/** IC-driven refresh mode: IC exchanges the refresh token at `tokenUri`. */
	clientSecret?: pulumi.Input<string>;
	tokenUri?: pulumi.Input<string>;
	scopesAllowed?: pulumi.Input<string[]>;
	/** Delegated connector consent (#123): the connector OAuth authorize
	 *  endpoint 302s end-users to this tenant-hosted page (`?request_id=…`)
	 *  instead of rendering the built-in connect-token page. */
	authorizeUrl?: pulumi.Input<string>;
}

export class IcOauthProvider extends pulumi.dynamic.Resource {
	constructor(
		name: string,
		args: IcOauthProviderArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			oauthProviderResource,
			name,
			{
				refreshWebhook: undefined,
				clientId: undefined,
				clientSecret: undefined,
				tokenUri: undefined,
				scopesAllowed: undefined,
				authorizeUrl: undefined,
				...args,
			},
			{ ...opts, additionalSecretOutputs: ["token", "clientSecret"] },
		);
	}
}

// ─── WhatsApp number (PUT /v1/tenant/whatsapp) ───────────────────────────────

interface WhatsAppInputs {
	baseUrl: string;
	token: string;
	phoneNumberId: string;
	accessToken: string;
	wabaId: string;
}

const whatsappProvider = makePutResource<WhatsAppInputs>({
	path: () => "/v1/tenant/whatsapp",
	id: () => "whatsapp",
	body: (i) => ({
		phone_number_id: i.phoneNumberId,
		access_token: i.accessToken,
		waba_id: i.wabaId,
	}),
	outs: (_i, res) => ({
		displayPhoneNumber: res.display_phone_number,
		webhookUrl: res.webhook_url,
	}),
	diff: {
		scalarKeys: ["phoneNumberId", "accessToken", "wabaId", "token", "baseUrl"],
	},
});

export interface IcWhatsAppConfigArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	phoneNumberId: pulumi.Input<string>;
	accessToken: pulumi.Input<string>;
	/** The WhatsApp Business Account id — IC subscribes its app to it so inbound flows. */
	wabaId: pulumi.Input<string>;
}

export class IcWhatsAppConfig extends pulumi.dynamic.Resource {
	public readonly displayPhoneNumber!: pulumi.Output<string>;
	public readonly webhookUrl!: pulumi.Output<string>;
	constructor(
		name: string,
		args: IcWhatsAppConfigArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			whatsappProvider,
			name,
			{
				displayPhoneNumber: undefined,
				webhookUrl: undefined,
				...args,
			},
			{
				...opts,
				additionalSecretOutputs: ["token", "accessToken"],
			},
		);
	}
}

// ─── Email channel config (PUT /v1/tenant/email) ─────────────────────────────
//
// Configures the tenant's Cloudflare-backed agent email channel — the BYO
// transport IC sends/receives agent mail through (the agent's own inbox). IC
// returns `inbound_secret` ONCE at configure time; capture it so it's stable in
// state and the operator can wire it into the inbound worker. Omit `inboundSecret`
// to let IC generate one. The API token is never returned on read, so a token
// change is driven by input diff, not refresh.

interface EmailInputs {
	baseUrl: string;
	token: string;
	cloudflareAccountId: string;
	cloudflareApiToken: string;
	fromDomain: string;
	displayName?: string;
	inboundSecret?: string;
}

const emailProvider = makePutResource<EmailInputs>({
	path: () => "/v1/tenant/email",
	id: () => "email",
	body: (i) => ({
		cloudflare_account_id: i.cloudflareAccountId,
		cloudflare_api_token: i.cloudflareApiToken,
		from_domain: i.fromDomain,
		display_name: i.displayName,
		inbound_secret: i.inboundSecret,
	}),
	outs: (i, res) => ({
		// IC generates inbound_secret when we don't supply one — capture it so it's
		// stable in state (and wireable into the inbound worker).
		inboundSecret: res.inbound_secret ?? i.inboundSecret,
		inboundUrl: res.inbound_url,
		configured: res.configured,
	}),
	// inboundSecret excluded — IC may generate it, so it's an output, not drift.
	diff: {
		scalarKeys: [
			"cloudflareAccountId",
			"cloudflareApiToken",
			"fromDomain",
			"displayName",
			"token",
			"baseUrl",
		],
	},
});

export interface IcEmailArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/** Cloudflare account that owns the sending domain + Email-Sending token. */
	cloudflareAccountId: pulumi.Input<string>;
	/** Email-Sending-scoped Cloudflare API token (secret). */
	cloudflareApiToken: pulumi.Input<string>;
	/** The verified sending domain (e.g. `mail.thornhill.app`). */
	fromDomain: pulumi.Input<string>;
	/** Optional friendly From name. */
	displayName?: pulumi.Input<string>;
	/** Optional HMAC for inbound-worker verification; IC generates one if omitted. */
	inboundSecret?: pulumi.Input<string>;
}

export class IcEmail extends pulumi.dynamic.Resource {
	public readonly inboundSecret!: pulumi.Output<string>;
	public readonly inboundUrl!: pulumi.Output<string>;
	public readonly configured!: pulumi.Output<boolean>;
	constructor(name: string, args: IcEmailArgs, opts?: pulumi.CustomResourceOptions) {
		super(
			emailProvider,
			name,
			{
				displayName: undefined,
				inboundSecret: undefined,
				inboundUrl: undefined,
				configured: undefined,
				...args,
			},
			{
				...opts,
				additionalSecretOutputs: [
					"token",
					"cloudflareApiToken",
					"inboundSecret",
				],
			},
		);
	}
}

// ─── Event webhook (POST /v1/tenant/webhooks) ────────────────────────────────
//
// IC returns the signing secret ONCE at create and never on read, so this
// resource owns the subscription (url + events). `secret` is a create-only
// secret output: it's populated when Pulumi creates the webhook, and absent
// after an `import` (adopting one a script already made) — in that case the app
// keeps the secret it was given at original creation. Changing `url` replaces
// (and rotates the secret); changing `events` is an in-place PATCH.

interface WebhookInputs {
	baseUrl: string;
	token: string;
	url: string;
	events: string[];
}

const webhookProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: WebhookInputs) {
		const res = await icRequest(i.baseUrl, i.token, "POST", "/v1/tenant/webhooks", {
			url: i.url,
			events: i.events,
			active: true,
		});
		return { id: res.id, outs: { ...i, secret: res.secret } };
	},
	async update(id, olds: WebhookInputs & { secret?: string }, news: WebhookInputs) {
		await icRequest(
			news.baseUrl,
			news.token,
			"PATCH",
			`/v1/tenant/webhooks/${id}`,
			{
				events: news.events,
			},
		);
		// The signing secret survives an events PATCH on IC's side; carry the
		// create-time output forward so an update never blanks consumers that
		// flow `secret` into app config.
		return { outs: { ...news, secret: olds.secret } };
	},
	async delete(id, props: WebhookInputs) {
		await icRequest(
			props.baseUrl,
			props.token,
			"DELETE",
			`/v1/tenant/webhooks/${id}`,
		);
	},
	async diff(_id, olds: WebhookInputs, news: WebhookInputs) {
		const replaces = olds.url !== news.url ? ["url"] : [];
		const eventsChanged =
			JSON.stringify((olds.events ?? []).toSorted()) !==
			JSON.stringify((news.events ?? []).toSorted());
		return { changes: replaces.length > 0 || eventsChanged, replaces };
	},
	// Enables `pulumi import` of a webhook a script already created (id is the
	// import id). The signing secret is intentionally not recoverable.
	async read(id, props: Partial<WebhookInputs>) {
		const list = await icRequest(
			props.baseUrl!,
			props.token!,
			"GET",
			"/v1/tenant/webhooks?limit=200",
		);
		const hit = (list.data ?? []).find((w: any) => w.id === id);
		// Absent from the list → gone server-side; empty id lets refresh prune it.
		if (!hit) return { id: "" };
		return { id, props: { ...props, url: hit.url, events: hit.events } as any };
	},
};

export interface IcWebhookArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	url: pulumi.Input<string>;
	events: pulumi.Input<string[]>;
}

export class IcWebhook extends pulumi.dynamic.Resource {
	/** The signing secret — present only when Pulumi created the webhook. */
	public readonly secret!: pulumi.Output<string | undefined>;
	constructor(
		name: string,
		args: IcWebhookArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			webhookProvider,
			name,
			{ secret: undefined, ...args },
			{
				...opts,
				additionalSecretOutputs: ["token", "secret"],
			},
		);
	}
}

// ─── BYOK model key (PUT /v1/tenant/model_keys/{provider}) ───────────────────

interface ModelKeyInputs {
	baseUrl: string;
	token: string;
	provider: string;
	apiKey: string;
	providerBaseUrl?: string;
}

const modelKeyProvider = makePutResource<ModelKeyInputs>({
	path: (i) => `/v1/tenant/model_keys/${encodeURIComponent(i.provider)}`,
	id: (i) => i.provider,
	body: (i) => ({ api_key: i.apiKey, base_url: i.providerBaseUrl ?? null }),
	diff: {
		replaceKeys: ["provider"],
		scalarKeys: ["apiKey", "providerBaseUrl", "token", "baseUrl"],
		deleteBeforeReplace: true,
	},
});

export interface IcModelKeyArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/** Provider id, e.g. `openai`, `anthropic`. */
	provider: pulumi.Input<string>;
	apiKey: pulumi.Input<string>;
	/** Optional override base URL (OpenAI-compatible backends). */
	providerBaseUrl?: pulumi.Input<string>;
}

export class IcModelKey extends pulumi.dynamic.Resource {
	constructor(
		name: string,
		args: IcModelKeyArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			modelKeyProvider,
			name,
			{ providerBaseUrl: undefined, ...args },
			{ ...opts, additionalSecretOutputs: ["token", "apiKey"] },
		);
	}
}

// ─── Project (POST/GET/DELETE /v1/organization/projects) ─────────────────────
//
// A project IS a tenant — one isolation boundary in your account. Declared with
// an ORGANIZATION key (`organization:*`), not a project token: this resource
// provisions the tenant a project token then administers. Adopt-or-create by
// `projectName`, so re-running reconciles (mirrors IcAgent's slug adoption).

interface ProjectInputs {
	baseUrl: string;
	token: string;
	projectName: string;
}

async function findProjectByName(baseUrl: string, token: string, name: string) {
	const res = await icRequest(
		baseUrl,
		token,
		"GET",
		`/v1/organization/projects?name=${encodeURIComponent(name)}`,
	);
	return (res.data ?? [])[0] ?? null;
}

const projectProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: ProjectInputs) {
		const existing = await findProjectByName(i.baseUrl, i.token, i.projectName);
		const proj =
			existing ??
			(await icRequest(i.baseUrl, i.token, "POST", "/v1/organization/projects", {
				name: i.projectName,
			}));
		return { id: proj.id, outs: { ...i, projectId: proj.id } };
	},
	async update(id, _olds: ProjectInputs, news: ProjectInputs) {
		// Nothing mutable server-side (a name change is a replace); just re-assert.
		return { outs: { ...news, projectId: id } };
	},
	async delete(id, props: ProjectInputs) {
		await icRequest(
			props.baseUrl,
			props.token,
			"DELETE",
			`/v1/organization/projects/${encodeURIComponent(id)}`,
		);
	},
	async diff(_id, olds: ProjectInputs, news: ProjectInputs) {
		return simpleDiff(olds, news, {
			replaceKeys: ["projectName"],
			scalarKeys: ["token", "baseUrl"],
			deleteBeforeReplace: false,
		});
	},
	async read(id, props: Partial<ProjectInputs>) {
		return read404(
			() =>
				icRequest(
					props.baseUrl!,
					props.token!,
					"GET",
					`/v1/organization/projects/${encodeURIComponent(id)}`,
				),
			(p: any) => ({
				id,
				props: { ...props, projectName: p.name, projectId: p.id } as any,
			}),
		);
	},
};

export interface IcProjectArgs {
	baseUrl: pulumi.Input<string>;
	/** An **organization** key (`organization:*`), NOT a project token. */
	token: pulumi.Input<string>;
	/** Adopt-by-name reconcile key (defaults to the Pulumi resource name). */
	projectName?: pulumi.Input<string>;
}

export class IcProject extends pulumi.dynamic.Resource {
	/** The project id — this is the TENANT a project token is bound to. */
	public readonly projectId!: pulumi.Output<string>;
	constructor(
		name: string,
		args: IcProjectArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			projectProvider,
			name,
			{ ...args, projectName: args.projectName ?? name, projectId: undefined },
			{ ...opts, additionalSecretOutputs: ["token"] },
		);
	}
}

// ─── Project token (POST/DELETE /v1/organization/projects/{id}/tokens) ───────
//
// Mints a tenant-admin (`tenant:*`) token bound to one project and exposes it as
// a SECRET output, so the platform stack can drop it straight into the app's env
// (a Vercel env var, a DO app secret, …). Re-minted on any input change; revoked
// on destroy. Declared with the same organization key as IcProject.

interface ProjectTokenInputs {
	baseUrl: string;
	token: string;
	project: string;
	tokenName?: string;
	ttlSeconds?: number;
}

const projectTokenProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: ProjectTokenInputs) {
		const res = await icRequest(
			i.baseUrl,
			i.token,
			"POST",
			`/v1/organization/projects/${encodeURIComponent(i.project)}/tokens`,
			{ name: i.tokenName, ttl_seconds: i.ttlSeconds },
		);
		return {
			id: res.id,
			outs: { ...i, tokenId: res.id, projectToken: res.token, sub: res.sub },
		};
	},
	async delete(id, props: ProjectTokenInputs) {
		await icRequest(
			props.baseUrl,
			props.token,
			"DELETE",
			`/v1/organization/projects/${encodeURIComponent(props.project)}/tokens/${encodeURIComponent(id)}`,
		);
	},
	async diff(_id, olds: ProjectTokenInputs, news: ProjectTokenInputs) {
		// The token value can't be edited in place — any change re-mints. Mint the
		// new one before revoking the old so dependents can switch over first
		// (so every input is a replace key, none in-place).
		return simpleDiff(olds, news, {
			replaceKeys: ["project", "tokenName", "ttlSeconds", "token", "baseUrl"],
			deleteBeforeReplace: false,
		});
	},
};

export interface IcProjectTokenArgs {
	baseUrl: pulumi.Input<string>;
	/** An **organization** key (`organization:*`), NOT a project token. */
	token: pulumi.Input<string>;
	/** The project id to mint for — typically an `IcProject().projectId`. */
	project: pulumi.Input<string>;
	tokenName?: pulumi.Input<string>;
	ttlSeconds?: pulumi.Input<number>;
}

export class IcProjectToken extends pulumi.dynamic.Resource {
	/** The minted `tenant:*` token (secret) — feed this into the app's env. */
	public readonly projectToken!: pulumi.Output<string>;
	public readonly tokenId!: pulumi.Output<string>;
	constructor(
		name: string,
		args: IcProjectTokenArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			projectTokenProvider,
			name,
			{
				...args,
				tokenName: args.tokenName ?? name,
				tokenId: undefined,
				projectToken: undefined,
				sub: undefined,
			},
			{ ...opts, additionalSecretOutputs: ["token", "projectToken"] },
		);
	}
}

// ─── Hosted page (POST/DELETE /v1/deployments, kind: "web") ──────────────────
//
// A `web` deployment is a private, shareable page that runs an agent — each
// visitor gets their own smith. It's self-addressed by its `dep_` id, so there
// is no provider setup: create posts the deployment and reads back `page_url`,
// the link to share. The API has no update path for a web deployment's metadata
// (title/greeting/password), so any change to those — or to the target agent —
// replaces the deployment (and mints a fresh page_url); instructions change on
// the agent, not here, so that's rare. Declare it in the APP repo next to the
// `IcAgent` it fronts.

interface WebPageInputs {
	baseUrl: string;
	token: string;
	/** The `agt_…` id this page runs (mints a smith per visitor). */
	agentId: string;
	/** Page title shown in the tab + header. */
	title?: string;
	/** First-message greeting shown before the visitor types. */
	greeting?: string;
	/** Optional shared password gating the page (write-only). */
	password?: string;
}

const webPageProvider: pulumi.dynamic.ResourceProvider = {
	async create(i: WebPageInputs) {
		const body: any = {
			target: { type: "agent", id: i.agentId },
			kind: "web",
			provider_metadata: {
				...(i.title ? { title: i.title } : {}),
				...(i.greeting ? { greeting: i.greeting } : {}),
			},
		};
		if (i.password) body.secrets = { password: i.password };
		const res = await icRequest(
			i.baseUrl,
			i.token,
			"POST",
			"/v1/deployments",
			body,
		);
		return {
			id: res.id,
			outs: { ...i, deploymentId: res.id, pageUrl: res.page_url },
		};
	},
	async update(_id, olds: WebPageInputs & { pageUrl?: string }, news: WebPageInputs) {
		// No web-metadata PATCH on the API — diff marks every field as a replace, so
		// this path is only reached for a no-op refresh. Carry outputs forward.
		return { outs: { ...news, deploymentId: _id, pageUrl: olds.pageUrl } };
	},
	async delete(id, props: WebPageInputs) {
		await icRequest(props.baseUrl, props.token, "DELETE", `/v1/deployments/${id}`);
	},
	async diff(_id, olds: WebPageInputs, news: WebPageInputs) {
		return simpleDiff(olds, news, {
			replaceKeys: ["agentId", "title", "greeting", "password"],
		});
	},
	async read(id, props: Partial<WebPageInputs>) {
		return read404(
			() =>
				icRequest(props.baseUrl!, props.token!, "GET", `/v1/deployments/${id}`),
			(dep: any) => ({
				id,
				props: {
					...props,
					title: dep.provider_metadata?.title,
					greeting: dep.provider_metadata?.greeting,
					deploymentId: id,
					pageUrl: dep.page_url,
				} as any,
			}),
		);
	},
};

export interface IcWebPageArgs {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
	/** The `agt_…` id this page runs. Typically an `IcAgent().agentId`. */
	agentId: pulumi.Input<string>;
	title?: pulumi.Input<string>;
	greeting?: pulumi.Input<string>;
	/** Optional shared password gating the page. */
	password?: pulumi.Input<string>;
}

export class IcWebPage extends pulumi.dynamic.Resource {
	/** The `dep_…` deployment id (same as `.id`, exposed for convenience). */
	public readonly deploymentId!: pulumi.Output<string>;
	/** The shareable page URL (e.g. `https://cloud.ingram.tech/hosted/dep_…`). */
	public readonly pageUrl!: pulumi.Output<string>;
	constructor(
		name: string,
		args: IcWebPageArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			webPageProvider,
			name,
			{ deploymentId: undefined, pageUrl: undefined, ...args },
			{ ...opts, additionalSecretOutputs: ["token", "password"] },
		);
	}
}
