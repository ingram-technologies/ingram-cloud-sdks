/**
 * The Ingram Cloud management-plane client: typed CRUD over the `/v1` REST
 * surface (smiths, agents, runs, deployments, tenant config, organization).
 *
 * The data plane is not here on purpose. Chat rides the OpenAI-compatible
 * surface via `@ingram-cloud/ai-sdk`; the native run stream returns the
 * raw SSE `Response` for the caller to pump (`smiths.runs.stream`).
 *
 * Method inputs are `z.input`-inferred from the same Zod schemas the API
 * validates requests with (`./zod/*`), and outputs are the `IC*` response
 * types — every import here is type-only, so the client pulls no Zod (or
 * anything else) in at runtime. Transport is the global `fetch`.
 *
 * Auth is a pluggable token seam: pass a static bearer, or a function that
 * mints one per request (e.g. a short-lived tenant-admin token). Smith-scoped
 * calls made with a tenant token name the acting smith per call via
 * `{ smith: "smt_…" }`, which rides the `IC-Smith-Id` header.
 *
 * ```ts
 * import { IngramCloud } from "@ingram-cloud/sdk/client";
 *
 * const ic = new IngramCloud({ token: process.env.INGRAM_CLOUD_TOKEN! });
 * const smith = await ic.smiths.create({ external_id: "user-42" });
 * const page = await ic.smiths.list({ limit: 50 });
 * ```
 */
import type { z } from "zod";
import type {
	ICAgent,
	ICAgentVersion,
	ICApproval,
	ICAuthorizeRequest,
	ICAutoreload,
	ICBalance,
	ICBudget,
	ICBudgetStatus,
	ICCatalogEntry,
	ICConnection,
	ICConversation,
	ICConversationItem,
	ICCustomer,
	ICDeployment,
	ICDeploymentCreated,
	ICDiscordApp,
	ICEmailConfig,
	ICEmbeddingList,
	ICEvent,
	ICFile,
	ICFileList,
	ICInboundEvent,
	ICLedgerEntry,
	ICMcpServer,
	ICMintedToken,
	ICModelCatalog,
	ICModelKey,
	ICOrgUsage,
	ICOrgUsageSeries,
	ICProject,
	ICAppInstall,
	ICProvider,
	ICRecallHit,
	ICRun,
	ICRunEvent,
	ICSchedule,
	ICSlackApp,
	ICSmith,
	ICSmithRevision,
	ICSpanIn,
	ICTelegramBot,
	ICToken,
	ICTrace,
	ICTraceDetail,
	ICUiResource,
	ICUsage,
	ICUsageBreakdown,
	ICUsageEvent,
	ICVectorStore,
	ICVectorStoreFile,
	ICVectorStoreFileBatch,
	ICVectorStoreSearchPage,
	ICWebhook,
	ICWebhookDelivery,
	ICWhatsAppConfig,
	ICWorkingMemory,
} from "./responses.js";
import type {
	AgentIn,
	AgentPatch,
	AttachIn,
	ImportIn,
	PublishIn,
	RolloutIn,
	UiResourceIn,
} from "./zod/agents.js";
import type {
	AutoreloadIn,
	CheckoutIn,
	CheckoutOut,
	ConfirmIn,
	ConfirmOut,
	PortalOut,
	RedeemIn,
	RedeemOut,
	ReloadIn,
	ReloadOut,
	SetupIn,
	SetupOut,
} from "./zod/billing.js";
import type { BudgetIn, BudgetPatch } from "./zod/budgets.js";
import type {
	AuthorizeIn,
	AuthorizeOut,
	ConnectionIn,
	ConnectionPatch,
} from "./zod/connections.js";
import type { ConversationCreate, ConversationUpdate } from "./zod/conversations.js";
import type { CustomerCreate, CustomerPatch } from "./zod/customers.js";
import type { DeploymentIn, DeploymentPatch } from "./zod/deployments.js";
import type { DiscordAppIn } from "./zod/discord.js";
import type { EmailConfigIn } from "./zod/email.js";
import type { McpServerIn } from "./zod/mcp.js";
import type { RecallBody, WorkingMemorySet } from "./zod/memories.js";
import type { ProjectIn, ProjectTokenIn, ProjectTokenOut } from "./zod/projects.js";
import type { RunIn, Submit } from "./zod/runs.js";
import type { Skill, SkillUpdateIn, SkillVersion } from "./zod/skills.js";
import type {
	VectorStoreFileBatchIn,
	VectorStoreFileIn,
	VectorStoreFileUpdate,
	VectorStoreIn,
	VectorStorePatch,
	VectorStoreSearchIn,
} from "./zod/vector-stores.js";
import type { ScheduleIn, SchedulePatch, ScheduleRunNowOut } from "./zod/schedules.js";
import type { SlackAppIn } from "./zod/slack.js";
import type { RestoreIn } from "./zod/smith-revisions.js";
import type { SmithCreate, SmithPatch } from "./zod/smiths.js";
import type { TelegramBotIn } from "./zod/telegram.js";
import type {
	AuthorizeCompleteIn,
	AuthorizeRedirectOut,
	HostedToolOut,
	ModelKeyConfiguredOut,
	ModelKeyIn,
	ProviderConfiguredOut,
	ProviderIn,
	TokenIn,
	WebhookCreateOut,
	WebhookIn,
	WebhookPatch,
	WebhookRedeliverOut,
	WebhookRotateIn,
	WebhookRotateOut,
} from "./zod/tenant.js";
import type { WhatsAppConfigIn } from "./zod/whatsapp.js";

export const DEFAULT_BASE_URL = "https://api.cloud.ingram.tech";

/** The `/v1` API version this client pins (`IC-Api-Version`). */
export const DEFAULT_API_VERSION = "2026-05-01";

/** A cursor-paginated `/v1` list page, normalized so a missing cursor reads as
 *  a terminal page. Pass `next_cursor` straight back as `cursor`. */
export interface ICPage<T> {
	data: T[];
	next_cursor: string | null;
	has_more: boolean;
}

/** An OpenAI-dialect list page (`object:"list"` — files, vector stores,
 *  conversations). Page forward by passing `last_id` back as `after`. */
export interface ICOaiList<T> {
	object: "list";
	data: T[];
	first_id: string | null;
	last_id: string | null;
	has_more: boolean;
}

/** A non-2xx `/v1` response: HTTP status + the error envelope's `code`.
 *  `message` carries the full context (method, path, status); `detail` is the
 *  envelope's bare `error.message`, suitable for user-facing copy. */
export class ICError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly requestId?: string,
		public readonly detail?: string,
	) {
		super(message);
		this.name = "ICError";
	}
}

export interface IngramCloudOptions {
	/** Bearer token, or a function minting one per request (e.g. a short-lived
	 *  tenant-admin token). */
	token: string | (() => string | Promise<string>);
	/** API origin. Default {@link DEFAULT_BASE_URL}. */
	baseURL?: string;
	/** Override the pinned `IC-Api-Version`. */
	apiVersion?: string;
	/** Custom transport (tests, in-process apps). Default: global `fetch`. */
	fetch?: (url: string, init: RequestInit) => Response | Promise<Response>;
	/** Extra `RequestInit` merged into every request (e.g. Next's
	 *  `{ cache: "no-store" }`). */
	requestInit?: RequestInit;
}

/** Per-call options accepted by every method. */
export interface RequestOptions {
	/** Acting smith for smith-scoped calls made with a tenant token
	 *  (`IC-Smith-Id` header). */
	smith?: string;
	/** Per-call bearer override (e.g. a minted per-principal token). */
	token?: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

/** Query params: skipped when `undefined`/`null`/`""`. Typed as `object` so
 *  the concrete per-endpoint option interfaces assign without index
 *  signatures; values are stringified. */
type Query = object;

interface FullRequestOptions extends RequestOptions {
	query?: Query;
	body?: unknown;
	/** Pass-through body (multipart uploads); no JSON content-type is set. */
	rawBody?: RequestInit["body"];
}

/** Common cursor-pagination query params. */
export interface PageOpts {
	cursor?: string;
	limit?: number;
}

const enc = encodeURIComponent;

/** Attempts per request, including the first. Small on purpose: the server
 *  tells us when to come back, so this is a bound on pathological cases, not
 *  a backoff strategy. */
const MAX_ATTEMPTS = 4;

/** Longest we will sit out one `Retry-After`. A server (or an intermediary that
 *  never heard of this API) can name an hour; a client library must not silently
 *  block a caller for one. Past this we stop retrying and surface the refusal, so
 *  the caller decides. */
const MAX_WAIT_MS = 60_000;

/**
 * How long this response says to wait, or null if it does not say — which is
 * itself the answer: a 402 carries no `Retry-After` because the wallet will not
 * refill because we asked twice.
 *
 * RFC 9110 allows both forms, and intermediaries do send the date one, so parse
 * both. Anything unparseable is "no usable instruction", never a zero-delay
 * hammer at an upstream that is already struggling.
 */
function retryAfterMs(res: Response, now: number): number | null {
	const raw = res.headers.get("retry-after")?.trim();
	if (!raw) return null;
	const seconds = Number(raw);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
	if (!Number.isFinite(ms)) return null;
	return Math.max(0, ms);
}

/** Retry only what retrying can fix, and only when told how long to wait. */
function retryDelay(res: Response, now: number): number | null {
	if (res.status !== 429 && res.status !== 503) return null;
	const ms = retryAfterMs(res, now);
	return ms === null || ms > MAX_WAIT_MS ? null : ms;
}

/** The `Retry-After` wait, abortable: a caller cancelling mid-wait should not
 *  sit out the rest of a Retry-After that can be tens of seconds — reject as
 *  soon as `signal` fires, the same way an aborted `transport()` call would. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
	if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function qs(query: Query | undefined): string {
	if (!query) return "";
	const p = new URLSearchParams();
	for (const [k, v] of Object.entries(query) as [string, unknown][]) {
		if (v === undefined || v === null || v === "") continue;
		p.set(k, String(v));
	}
	const s = p.toString();
	return s ? `?${s}` : "";
}

/** One file of a bundle, as the caller holds it. The path is relative to — and
 *  includes — the skill's root directory, e.g. `invoice-review/SKILL.md`. */
export interface SkillFileInput {
	path: string;
	content: string | Blob | Uint8Array;
}

/** A bundle to upload: its files, or the whole thing zipped. */
export type SkillBundle = SkillFileInput[] | Blob;

/** Build the multipart body `/v1/skills` accepts.
 *
 *  The path rides the part's *filename*, slashes and all — that is how the
 *  bundle's directory structure survives a multipart body. `FormData` in Node,
 *  Bun and browsers all pass it through verbatim. */
function bundleForm(bundle: SkillBundle): FormData {
	const form = new FormData();
	if (bundle instanceof Blob) {
		form.append("file", bundle, "bundle.zip");
		return form;
	}
	for (const file of bundle) {
		// A `Uint8Array`'s buffer type is generic (and may be a `SharedArrayBuffer`),
		// which `Blob`'s constructor does not accept — copy into a fresh one, whose
		// buffer is always a plain `ArrayBuffer`.
		const part =
			typeof file.content === "string" || file.content instanceof Blob
				? file.content
				: new Uint8Array(file.content);
		const blob =
			part instanceof Blob
				? part
				: new Blob([part], { type: mediaTypeFor(file.path) });
		form.append("files[]", blob, file.path);
	}
	return form;
}

/** A `Blob` built from a string has no type of its own; the server falls back to
 *  `application/octet-stream` when a part carries none, which would make every
 *  text file non-indexable. Name the common ones from the extension. */
function mediaTypeFor(path: string): string {
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	const known: Record<string, string> = {
		md: "text/markdown",
		markdown: "text/markdown",
		txt: "text/plain",
		json: "application/json",
		yaml: "text/yaml",
		yml: "text/yaml",
		csv: "text/csv",
		py: "text/x-python",
		sh: "text/x-shellscript",
		js: "text/javascript",
		ts: "text/typescript",
		html: "text/html",
	};
	return known[ext] ?? "application/octet-stream";
}

export class IngramCloud {
	private readonly token: IngramCloudOptions["token"];
	private readonly base: string;
	private readonly apiVersion: string;
	private readonly transport: (
		url: string,
		init: RequestInit,
	) => Response | Promise<Response>;
	private readonly requestInit: RequestInit;

	constructor(opts: IngramCloudOptions) {
		this.token = opts.token;
		this.base = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
		this.transport = opts.fetch ?? ((url, init) => fetch(url, init));
		this.requestInit = opts.requestInit ?? {};
	}

	/** Low-level escape hatch: an authenticated `/v1` call (path without the
	 *  `/v1` prefix). Throws {@link ICError} on a non-2xx. */
	async request(
		method: string,
		path: string,
		opts: FullRequestOptions = {},
	): Promise<Response> {
		const token =
			opts.token ??
			(typeof this.token === "function" ? await this.token() : this.token);
		const headers: Record<string, string> = {
			accept: "application/json",
			"ic-api-version": this.apiVersion,
			authorization: `Bearer ${token}`,
			...(opts.body !== undefined && opts.rawBody === undefined
				? { "content-type": "application/json" }
				: {}),
			...(opts.smith ? { "ic-smith-id": opts.smith } : {}),
			...opts.headers,
		};
		let res!: Response;
		for (let attempt = 1; ; attempt++) {
			res = await this.transport(`${this.base}/v1${path}${qs(opts.query)}`, {
				...this.requestInit,
				method,
				headers,
				body:
					opts.rawBody ??
					(opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
				signal: opts.signal,
			});
			if (res.ok || attempt >= MAX_ATTEMPTS) break;
			const wait = retryDelay(res, Date.now());
			if (wait === null) break;
			await sleep(wait, opts.signal);
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			let code = `http_${res.status}`;
			let detail: string | undefined;
			try {
				const parsed = JSON.parse(body) as {
					error?: { code?: string; message?: string };
				};
				code = parsed.error?.code ?? code;
				detail = parsed.error?.message;
			} catch {}
			const requestId = res.headers.get("x-request-id") ?? undefined;
			throw new ICError(
				res.status,
				code,
				`IC ${method} ${path} → ${res.status} ${code}: ${detail ?? body.slice(0, 300)}${requestId ? ` [${requestId}]` : ""}`,
				requestId,
				detail,
			);
		}
		return res;
	}

	/** {@link request}, parsed as JSON. */
	async json<T>(
		method: string,
		path: string,
		opts: FullRequestOptions = {},
	): Promise<T> {
		const res = await this.request(method, path, opts);
		return res.json() as Promise<T>;
	}

	private async page<T>(
		path: string,
		query: Query | undefined,
		opts?: RequestOptions,
	): Promise<ICPage<T>> {
		const r = await this.json<Partial<ICPage<T>>>("GET", path, { ...opts, query });
		return {
			data: r.data ?? [],
			next_cursor: r.next_cursor ?? null,
			has_more: r.has_more ?? false,
		};
	}

	private async data<T>(
		method: string,
		path: string,
		opts: FullRequestOptions = {},
	): Promise<T[]> {
		const r = await this.json<{ data?: T[] }>(method, path, opts);
		return r.data ?? [];
	}

	private async empty(
		method: string,
		path: string,
		opts: FullRequestOptions = {},
	): Promise<void> {
		await this.request(method, path, opts);
	}

	// ── Smiths ──────────────────────────────────────────────────────────────

	readonly smiths = {
		list: (
			query?: PageOpts & {
				agent_id?: string;
				customer_id?: string;
				external_id?: string;
				external_id_prefix?: string;
			},
			opts?: RequestOptions,
		) => this.page<ICSmith>("/smiths", query, opts),
		create: (body: z.input<typeof SmithCreate>, opts?: RequestOptions) =>
			this.json<ICSmith>("POST", "/smiths", { ...opts, body }),
		get: (pid: string, opts?: RequestOptions) =>
			this.json<ICSmith>("GET", `/smiths/${enc(pid)}`, opts),
		update: (
			pid: string,
			body: z.input<typeof SmithPatch>,
			opts?: RequestOptions,
		) => this.json<ICSmith>("PATCH", `/smiths/${enc(pid)}`, { ...opts, body }),
		delete: (pid: string, opts?: RequestOptions) =>
			this.empty("DELETE", `/smiths/${enc(pid)}`, opts),

		memory: {
			get: (pid: string, opts?: RequestOptions) =>
				this.json<ICWorkingMemory>("GET", `/smiths/${enc(pid)}/memory`, opts),
			set: (
				pid: string,
				body: z.input<typeof WorkingMemorySet>,
				opts?: RequestOptions,
			) =>
				this.json<ICWorkingMemory>("PUT", `/smiths/${enc(pid)}/memory`, {
					...opts,
					body,
				}),
			recall: (
				pid: string,
				body: z.input<typeof RecallBody>,
				opts?: RequestOptions,
			) =>
				this.data<ICRecallHit>("POST", `/smiths/${enc(pid)}/memory/recall`, {
					...opts,
					body,
				}),
		},

		revisions: {
			list: (pid: string, query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICSmithRevision>(
					`/smiths/${enc(pid)}/revisions`,
					query,
					opts,
				),
			restore: (
				pid: string,
				version: number,
				body: z.input<typeof RestoreIn> = {},
				opts?: RequestOptions,
			) =>
				this.json<ICSmithRevision>(
					"POST",
					`/smiths/${enc(pid)}/revisions/${version}/restore`,
					{
						...opts,
						body,
					},
				),
		},

		connections: {
			list: (
				pid: string,
				query?: PageOpts & { provider?: string },
				opts?: RequestOptions,
			) =>
				this.page<ICConnection>(`/smiths/${enc(pid)}/connections`, query, opts),
			get: (pid: string, cid: string, opts?: RequestOptions) =>
				this.json<ICConnection>(
					"GET",
					`/smiths/${enc(pid)}/connections/${enc(cid)}`,
					opts,
				),
			create: (
				pid: string,
				body: z.input<typeof ConnectionIn>,
				opts?: RequestOptions,
			) =>
				this.json<ICConnection>("POST", `/smiths/${enc(pid)}/connections`, {
					...opts,
					body,
				}),
			update: (
				pid: string,
				cid: string,
				body: z.input<typeof ConnectionPatch>,
				opts?: RequestOptions,
			) =>
				this.json<ICConnection>(
					"PATCH",
					`/smiths/${enc(pid)}/connections/${enc(cid)}`,
					{ ...opts, body },
				),
			delete: (pid: string, cid: string, opts?: RequestOptions) =>
				this.empty(
					"DELETE",
					`/smiths/${enc(pid)}/connections/${enc(cid)}`,
					opts,
				),
			refresh: (pid: string, cid: string, opts?: RequestOptions) =>
				this.json<ICConnection>(
					"POST",
					`/smiths/${enc(pid)}/connections/${enc(cid)}/refresh`,
					opts,
				),
			/** Mint a hosted-consent authorize URL the end user is sent to. */
			authorize: (
				pid: string,
				body: z.input<typeof AuthorizeIn>,
				opts?: RequestOptions,
			) =>
				this.json<z.infer<typeof AuthorizeOut>>(
					"POST",
					`/smiths/${enc(pid)}/connections/authorize`,
					{
						...opts,
						body,
					},
				),
		},

		/** End-user BYOK (#170): a smith's own provider keys, resolved ahead of the
		 *  tenant's so the end-user's provider account is billed. Never read back. */
		modelKeys: {
			list: (pid: string, opts?: RequestOptions) =>
				this.data<ICModelKey>("GET", `/smiths/${enc(pid)}/model_keys`, opts),
			put: (
				pid: string,
				provider: string,
				body: z.input<typeof ModelKeyIn>,
				opts?: RequestOptions,
			) =>
				this.json<z.infer<typeof ModelKeyConfiguredOut>>(
					"PUT",
					`/smiths/${enc(pid)}/model_keys/${enc(provider)}`,
					{ ...opts, body },
				),
			delete: (pid: string, provider: string, opts?: RequestOptions) =>
				this.empty(
					"DELETE",
					`/smiths/${enc(pid)}/model_keys/${enc(provider)}`,
					opts,
				),
		},

		schedules: {
			list: (pid: string, query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICSchedule>(`/smiths/${enc(pid)}/schedules`, query, opts),
			create: (
				pid: string,
				body: z.input<typeof ScheduleIn>,
				opts?: RequestOptions,
			) =>
				this.json<ICSchedule>("POST", `/smiths/${enc(pid)}/schedules`, {
					...opts,
					body,
				}),
			update: (
				pid: string,
				sid: string,
				body: z.input<typeof SchedulePatch>,
				opts?: RequestOptions,
			) =>
				this.json<ICSchedule>(
					"PATCH",
					`/smiths/${enc(pid)}/schedules/${enc(sid)}`,
					{ ...opts, body },
				),
			delete: (pid: string, sid: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/smiths/${enc(pid)}/schedules/${enc(sid)}`, opts),
			runNow: (pid: string, sid: string, opts?: RequestOptions) =>
				this.json<z.infer<typeof ScheduleRunNowOut>>(
					"POST",
					`/smiths/${enc(pid)}/schedules/${enc(sid)}/run_now`,
					opts,
				),
		},

		runs: {
			list: (
				pid: string,
				query?: PageOpts & { status?: string },
				opts?: RequestOptions,
			) => this.page<ICRun>(`/smiths/${enc(pid)}/runs`, query, opts),
			/** Non-streaming run: returns the completed (or paused) run record. */
			create: (
				pid: string,
				body: Omit<z.input<typeof RunIn>, "stream">,
				opts?: RequestOptions,
			) =>
				this.json<ICRun>("POST", `/smiths/${enc(pid)}/runs`, {
					...opts,
					body: { ...body, stream: false },
				}),
			/** Streaming run: returns the raw SSE `Response`, body unconsumed. */
			stream: (
				pid: string,
				body: Omit<z.input<typeof RunIn>, "stream">,
				opts?: RequestOptions,
			) =>
				this.request("POST", `/smiths/${enc(pid)}/runs`, {
					...opts,
					body: { ...body, stream: true },
				}),
			get: (pid: string, rid: string, opts?: RequestOptions) =>
				this.json<ICRun>("GET", `/smiths/${enc(pid)}/runs/${enc(rid)}`, opts),
			/** Resume a paused run (approval decision, tool result, cancel). */
			submit: (
				pid: string,
				rid: string,
				body: z.input<typeof Submit>,
				opts?: RequestOptions,
			) =>
				this.json<ICRun>(
					"POST",
					`/smiths/${enc(pid)}/runs/${enc(rid)}/submit`,
					{ ...opts, body },
				),
			/** Re-run a recorded run's input as a fresh run. */
			replay: (pid: string, rid: string, opts?: RequestOptions) =>
				this.json<ICRun>(
					"POST",
					`/smiths/${enc(pid)}/runs/${enc(rid)}/replay`,
					{ ...opts, body: {} },
				),
			/** The recorded run events (the SSE replay endpoint, parsed). */
			events: async (
				pid: string,
				rid: string,
				opts?: RequestOptions,
			): Promise<ICRunEvent[]> => {
				const res = await this.request(
					"GET",
					`/smiths/${enc(pid)}/runs/${enc(rid)}/events`,
					opts,
				);
				const text = await res.text();
				const out: ICRunEvent[] = [];
				for (const block of text.split(/\r?\n\r?\n/)) {
					let seq = 0;
					let type = "";
					let data = "";
					for (const line of block.split(/\r?\n/)) {
						if (line.startsWith("id:")) seq = Number(line.slice(3).trim());
						else if (line.startsWith("event:")) type = line.slice(6).trim();
						else if (line.startsWith("data:")) data += line.slice(5).trim();
					}
					if (!data) continue;
					try {
						out.push({
							seq,
							type,
							data: JSON.parse(data),
							created_at: null,
						});
					} catch {}
				}
				return out;
			},
		},
	};

	// ── Runs (tenant-wide feed) ─────────────────────────────────────────────

	readonly runs = {
		list: (
			query?: PageOpts & {
				smith_id?: string;
				agent_id?: string;
				status?: string;
			},
			opts?: RequestOptions,
		) => this.page<ICRun>("/runs", query, opts),
		trace: (rid: string, opts?: RequestOptions) =>
			this.json<ICTraceDetail>("GET", `/runs/${enc(rid)}/trace`, opts),
	};

	// ── Agents ──────────────────────────────────────────────────────────────

	readonly agents = {
		list: (query?: PageOpts, opts?: RequestOptions) =>
			this.page<ICAgent>("/agents", query, opts),
		create: (body: z.input<typeof AgentIn>, opts?: RequestOptions) =>
			this.json<ICAgent>("POST", "/agents", { ...opts, body }),
		get: (aid: string, opts?: RequestOptions) =>
			this.json<ICAgent>("GET", `/agents/${enc(aid)}`, opts),
		update: (
			aid: string,
			body: z.input<typeof AgentPatch>,
			opts?: RequestOptions,
		) => this.json<ICAgent>("PATCH", `/agents/${enc(aid)}`, { ...opts, body }),
		delete: (aid: string, opts?: RequestOptions) =>
			this.empty("DELETE", `/agents/${enc(aid)}`, opts),

		versions: {
			list: (aid: string, query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICAgentVersion>(`/agents/${enc(aid)}/versions`, query, opts),
			/** Snapshot the draft as the next immutable version. */
			publish: (
				aid: string,
				body: z.input<typeof PublishIn> = {},
				opts?: RequestOptions,
			) =>
				this.json<ICAgentVersion>("POST", `/agents/${enc(aid)}/versions`, {
					...opts,
					body,
				}),
		},

		/** Point smiths at a version (`percent < 100` stages a sticky rollout). */
		rollout: (
			aid: string,
			body: z.input<typeof RolloutIn>,
			opts?: RequestOptions,
		) =>
			this.json<ICAgent>("POST", `/agents/${enc(aid)}/rollout`, {
				...opts,
				body,
			}),
		/** Seed a new agent from an existing smith's effective config. */
		import: (body: z.input<typeof ImportIn>, opts?: RequestOptions) =>
			this.json<ICAgent>("POST", "/agents/import", { ...opts, body }),
		/** Adopt existing smiths onto this agent. */
		attach: (aid: string, body: z.input<typeof AttachIn>, opts?: RequestOptions) =>
			this.json<{
				attached: { smith_id: string; override_keys: string[] }[];
				count: number;
			}>("POST", `/agents/${enc(aid)}/attach`, { ...opts, body }),

		/** MCP Apps UI templates (SEP-1865) attached to the agent's draft. */
		ui: {
			list: (aid: string, opts?: RequestOptions) =>
				this.data<ICUiResource>("GET", `/agents/${enc(aid)}/ui`, opts),
			get: (aid: string, name: string, opts?: RequestOptions) =>
				this.json<ICUiResource>(
					"GET",
					`/agents/${enc(aid)}/ui/${enc(name)}`,
					opts,
				),
			/** Upload/replace a template — `html` is the bundle, `meta` its
			 *  `UiResourceIn` sidecar. Replaces by name. */
			put: (
				aid: string,
				html: string | Blob,
				meta: z.input<typeof UiResourceIn>,
				opts?: RequestOptions,
			) => {
				const form = new FormData();
				form.append(
					"file",
					html instanceof Blob
						? html
						: new Blob([html], { type: "text/html" }),
					`${meta.name}.html`,
				);
				form.append("metadata", JSON.stringify(meta));
				return this.json<ICUiResource>("POST", `/agents/${enc(aid)}/ui`, {
					...opts,
					rawBody: form,
				});
			},
			/** The template's HTML bundle — the same bytes the agent's MCP endpoint
			 *  serves, so a host can render a panel without vendoring a copy.
			 *  Tenant-authed: call it server-side and proxy to your chat UI. */
			content: (aid: string, name: string, opts?: RequestOptions) =>
				this.request("GET", `/agents/${enc(aid)}/ui/${enc(name)}/content`, {
					...opts,
					headers: { accept: "text/html", ...opts?.headers },
				}).then((r) => r.text()),
			delete: (aid: string, name: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/agents/${enc(aid)}/ui/${enc(name)}`, opts),
		},
	};

	// ── Conversations (smith-scoped: pass `{ smith }` with a tenant token) ──

	readonly conversations = {
		/** OpenAI `list` envelope; page forward with `after: page.last_id`. */
		list: (
			query?: { limit?: number; order?: "asc" | "desc"; after?: string },
			opts?: RequestOptions,
		) =>
			this.json<ICOaiList<ICConversation>>("GET", "/conversations", {
				...opts,
				query,
			}),
		create: (
			body: z.input<typeof ConversationCreate> = {},
			opts?: RequestOptions,
		) => this.json<ICConversation>("POST", "/conversations", { ...opts, body }),
		get: (cnvId: string, opts?: RequestOptions) =>
			this.json<ICConversation>("GET", `/conversations/${enc(cnvId)}`, opts),
		/** OpenAI-style modify — a POST, not a PATCH. */
		update: (
			cnvId: string,
			body: z.input<typeof ConversationUpdate>,
			opts?: RequestOptions,
		) =>
			this.json<ICConversation>("POST", `/conversations/${enc(cnvId)}`, {
				...opts,
				body,
			}),
		delete: (cnvId: string, opts?: RequestOptions) =>
			this.empty("DELETE", `/conversations/${enc(cnvId)}`, opts),
		/** The faithful transcript (message / function_call / mcp_call items). */
		items: (
			cnvId: string,
			query?: { order?: "asc" | "desc"; limit?: number },
			opts?: RequestOptions,
		) =>
			this.data<ICConversationItem>("GET", `/conversations/${enc(cnvId)}/items`, {
				...opts,
				query,
			}),
	};

	// ── Approvals / events ──────────────────────────────────────────────────

	readonly approvals = {
		list: (query?: PageOpts & { status?: string }, opts?: RequestOptions) =>
			this.page<ICApproval>("/approvals", query, opts),
		get: (aprId: string, opts?: RequestOptions) =>
			this.json<ICApproval>("GET", `/approvals/${enc(aprId)}`, opts),
	};

	readonly events = {
		list: (
			query?: PageOpts & { type?: string; smith_id?: string },
			opts?: RequestOptions,
		) => this.page<ICEvent>("/events", query, opts),
	};

	/** What arrived, before anything interpreted it — including arrivals that
	 *  matched no smith (`smith_id: ""`). The `iev_` ids `deployment.inbound`
	 *  carries resolve here. */
	readonly inboundEvents = {
		list: (
			query?: PageOpts & { source?: string; smith_id?: string; since?: string },
			opts?: RequestOptions,
		) => this.page<ICInboundEvent>("/inbound_events", query, opts),
		get: (ievId: string, opts?: RequestOptions) =>
			this.json<ICInboundEvent>("GET", `/inbound_events/${enc(ievId)}`, opts),
	};

	// ── Customers / budgets ─────────────────────────────────────────────────

	readonly customers = {
		list: (query?: PageOpts, opts?: RequestOptions) =>
			this.page<ICCustomer>("/customers", query, opts),
		create: (body: z.input<typeof CustomerCreate>, opts?: RequestOptions) =>
			this.json<ICCustomer>("POST", "/customers", { ...opts, body }),
		get: (cid: string, opts?: RequestOptions) =>
			this.json<ICCustomer>("GET", `/customers/${enc(cid)}`, opts),
		update: (
			cid: string,
			body: z.input<typeof CustomerPatch>,
			opts?: RequestOptions,
		) =>
			this.json<ICCustomer>("PATCH", `/customers/${enc(cid)}`, { ...opts, body }),
		delete: (cid: string, opts?: RequestOptions) =>
			this.empty("DELETE", `/customers/${enc(cid)}`, opts),
	};

	readonly budgets = {
		list: (query?: PageOpts, opts?: RequestOptions) =>
			this.page<ICBudget>("/budgets", query, opts),
		create: (body: z.input<typeof BudgetIn>, opts?: RequestOptions) =>
			this.json<ICBudget>("POST", "/budgets", { ...opts, body }),
		get: (bid: string, opts?: RequestOptions) =>
			this.json<ICBudget>("GET", `/budgets/${enc(bid)}`, opts),
		update: (
			bid: string,
			body: z.input<typeof BudgetPatch>,
			opts?: RequestOptions,
		) => this.json<ICBudget>("PATCH", `/budgets/${enc(bid)}`, { ...opts, body }),
		delete: (bid: string, opts?: RequestOptions) =>
			this.empty("DELETE", `/budgets/${enc(bid)}`, opts),
		status: (bid: string, opts?: RequestOptions) =>
			this.json<ICBudgetStatus>("GET", `/budgets/${enc(bid)}/status`, opts),
	};

	// ── Deployments (smith/agent bound to a messaging surface) ──────────────

	readonly deployments = {
		list: (
			query?: PageOpts & { target_type?: "smith" | "agent"; target_id?: string },
			opts?: RequestOptions,
		) => this.page<ICDeployment>("/deployments", query, opts),
		create: (body: z.input<typeof DeploymentIn>, opts?: RequestOptions) =>
			this.json<ICDeploymentCreated>("POST", "/deployments", { ...opts, body }),
		get: (depId: string, opts?: RequestOptions) =>
			this.json<ICDeployment>("GET", `/deployments/${enc(depId)}`, opts),
		update: (
			depId: string,
			body: z.input<typeof DeploymentPatch>,
			opts?: RequestOptions,
		) =>
			this.json<ICDeployment>("PATCH", `/deployments/${enc(depId)}`, {
				...opts,
				body,
			}),
		delete: (depId: string, opts?: RequestOptions) =>
			this.empty("DELETE", `/deployments/${enc(depId)}`, opts),
	};

	// ── Catalog (Ingram-curated MCP integration presets) ────────────────────

	readonly catalog = {
		list: (opts?: RequestOptions) =>
			this.data<ICCatalogEntry>("GET", "/catalog", opts),
		get: (slug: string, opts?: RequestOptions) =>
			this.json<ICCatalogEntry>("GET", `/catalog/${enc(slug)}`, opts),
	};

	// ── Embeddings ──────────────────────────────────────────────────────────

	/** Embed one string or a batch on the OpenAI-compatible wire. Pure tenant
	 *  compute — no smith runs. Omit `model` for the project default. Reach for
	 *  the `openai` SDK instead if you already hold one; this is the same route. */
	readonly embeddings = {
		create: (
			body: { input: string | string[]; model?: string },
			opts?: RequestOptions,
		) => this.json<ICEmbeddingList>("POST", "/embeddings", { ...opts, body }),
	};

	// ── Observability ───────────────────────────────────────────────────────

	readonly traces = {
		list: (
			query?: PageOpts & {
				smith_id?: string;
				app_id?: string;
				status?: string;
				since?: string;
			},
			opts?: RequestOptions,
		) => this.page<ICTrace>("/traces", query, opts),
		get: (traceId: string, opts?: RequestOptions) =>
			this.json<ICTraceDetail>("GET", `/traces/${enc(traceId)}`, opts),
		/** Push spans from your own runtime or an OTel exporter. The tenant comes
		 *  from the token; a smith-scoped token may only attribute to its own smith.
		 *  Unknown `kind`s land as `runtime_event` rather than erroring. Returns the
		 *  number written. */
		ingest: (spans: ICSpanIn[], opts?: RequestOptions) =>
			this.json<{ accepted: number }>("POST", "/traces:ingest", {
				...opts,
				body: { spans },
			}),
	};

	readonly usage = {
		/** Token/cost/run totals grouped by app, smith, model, or customer. */
		breakdown: (
			query?: {
				group_by?: "app" | "smith" | "model" | "customer";
				from?: string;
				to?: string;
				period?: string;
				smith_id?: string;
				customer_id?: string;
			},
			opts?: RequestOptions,
		) => this.json<ICUsageBreakdown>("GET", "/usage", { ...opts, query }),
		/** The raw billable-usage event ledger (keyset-paginated, newest first) — the
		 *  per-event rows the breakdown aggregates. */
		events: (
			query?: PageOpts & {
				smith_id?: string;
				meter?: string;
				customer_id?: string;
				from?: string;
				to?: string;
			},
			opts?: RequestOptions,
		) => this.page<ICUsageEvent>("/usage/events", query, opts),
	};

	// ── Files (the OpenAI Files API) ─────────────────────────────────────────

	readonly files = {
		/** Multipart upload. `file` is a `File`/`Blob`; `purpose` defaults to
		 *  `assistants` (the vector-store source purpose). */
		upload: (
			file: Blob,
			opts?: { filename?: string; purpose?: string } & RequestOptions,
		) => {
			const form = new FormData();
			form.set(
				"file",
				file,
				opts?.filename ?? (file instanceof File ? file.name : "file"),
			);
			form.set("purpose", opts?.purpose ?? "assistants");
			return this.json<ICFile>("POST", "/files", { ...opts, rawBody: form });
		},
		/** Uploads only (OpenAI `list` envelope); inline files stay unlisted. */
		list: (
			query?: {
				purpose?: string;
				after?: string;
				limit?: number;
				order?: "asc" | "desc";
			},
			opts?: RequestOptions,
		) => this.json<ICFileList>("GET", "/files", { ...opts, query }),
		get: (id: string, opts?: RequestOptions) =>
			this.json<ICFile>("GET", `/files/${enc(id)}`, opts),
		/** The raw bytes `Response` (follows the presigned-URL redirect). */
		content: (id: string, opts?: RequestOptions) =>
			this.request("GET", `/files/${enc(id)}/content`, opts),
		delete: (id: string, opts?: RequestOptions) =>
			this.json<{ id: string; deleted: true }>(
				"DELETE",
				`/files/${enc(id)}`,
				opts,
			),
	};

	// ── Vector stores (the OpenAI Vector Stores API) ─────────────────────────

	readonly vectorStores = {
		create: (body: z.input<typeof VectorStoreIn>, opts?: RequestOptions) =>
			this.json<ICVectorStore>("POST", "/vector_stores", { ...opts, body }),
		list: (
			query?: {
				limit?: number;
				order?: "asc" | "desc";
				after?: string;
				before?: string;
			},
			opts?: RequestOptions,
		) =>
			this.json<ICOaiList<ICVectorStore>>("GET", "/vector_stores", {
				...opts,
				query,
			}),
		get: (vsId: string, opts?: RequestOptions) =>
			this.json<ICVectorStore>("GET", `/vector_stores/${enc(vsId)}`, opts),
		/** Modify (OpenAI uses `POST`, not `PATCH`). */
		update: (
			vsId: string,
			body: z.input<typeof VectorStorePatch>,
			opts?: RequestOptions,
		) =>
			this.json<ICVectorStore>("POST", `/vector_stores/${enc(vsId)}`, {
				...opts,
				body,
			}),
		delete: (vsId: string, opts?: RequestOptions) =>
			this.json<{ id: string; deleted: true }>(
				"DELETE",
				`/vector_stores/${enc(vsId)}`,
				opts,
			),
		search: (
			vsId: string,
			body: z.input<typeof VectorStoreSearchIn>,
			opts?: RequestOptions,
		) =>
			this.json<ICVectorStoreSearchPage>(
				"POST",
				`/vector_stores/${enc(vsId)}/search`,
				{
					...opts,
					body,
				},
			),

		files: {
			create: (
				vsId: string,
				body: z.input<typeof VectorStoreFileIn>,
				opts?: RequestOptions,
			) =>
				this.json<ICVectorStoreFile>(
					"POST",
					`/vector_stores/${enc(vsId)}/files`,
					{
						...opts,
						body,
					},
				),
			list: (
				vsId: string,
				query?: {
					limit?: number;
					order?: "asc" | "desc";
					after?: string;
					before?: string;
					filter?: string;
				},
				opts?: RequestOptions,
			) =>
				this.json<ICOaiList<ICVectorStoreFile>>(
					"GET",
					`/vector_stores/${enc(vsId)}/files`,
					{ ...opts, query },
				),
			get: (vsId: string, fileId: string, opts?: RequestOptions) =>
				this.json<ICVectorStoreFile>(
					"GET",
					`/vector_stores/${enc(vsId)}/files/${enc(fileId)}`,
					opts,
				),
			update: (
				vsId: string,
				fileId: string,
				body: z.input<typeof VectorStoreFileUpdate>,
				opts?: RequestOptions,
			) =>
				this.json<ICVectorStoreFile>(
					"POST",
					`/vector_stores/${enc(vsId)}/files/${enc(fileId)}`,
					{ ...opts, body },
				),
			delete: (vsId: string, fileId: string, opts?: RequestOptions) =>
				this.json<{ id: string; deleted: true }>(
					"DELETE",
					`/vector_stores/${enc(vsId)}/files/${enc(fileId)}`,
					opts,
				),
		},

		fileBatches: {
			create: (
				vsId: string,
				body: z.input<typeof VectorStoreFileBatchIn>,
				opts?: RequestOptions,
			) =>
				this.json<ICVectorStoreFileBatch>(
					"POST",
					`/vector_stores/${enc(vsId)}/file_batches`,
					{ ...opts, body },
				),
			get: (vsId: string, batchId: string, opts?: RequestOptions) =>
				this.json<ICVectorStoreFileBatch>(
					"GET",
					`/vector_stores/${enc(vsId)}/file_batches/${enc(batchId)}`,
					opts,
				),
			cancel: (vsId: string, batchId: string, opts?: RequestOptions) =>
				this.json<ICVectorStoreFileBatch>(
					"POST",
					`/vector_stores/${enc(vsId)}/file_batches/${enc(batchId)}/cancel`,
					opts,
				),
			files: (
				vsId: string,
				batchId: string,
				query?: {
					limit?: number;
					order?: "asc" | "desc";
					after?: string;
					filter?: string;
				},
				opts?: RequestOptions,
			) =>
				this.json<{ data: ICVectorStoreFile[]; has_more: boolean }>(
					"GET",
					`/vector_stores/${enc(vsId)}/file_batches/${enc(batchId)}/files`,
					{ ...opts, query },
				),
		},
	};

	// ── Agent Skills — a folder anchored by SKILL.md, versioned, attached to
	// agents. Upload takes either the bundle's files as path/content pairs, or
	// the whole bundle as a zip Blob — the same two shapes /v1/skills accepts.
	// Both are runtime-agnostic: nothing here touches a filesystem. ───────────

	readonly skills = {
		list: (opts?: RequestOptions) =>
			this.json<{ object: "list"; data: z.infer<typeof Skill>[] }>(
				"GET",
				"/skills",
				opts,
			),
		get: (id: string, opts?: RequestOptions) =>
			this.json<z.infer<typeof Skill>>("GET", `/skills/${enc(id)}`, opts),
		create: (bundle: SkillBundle, opts?: RequestOptions) =>
			this.json<z.infer<typeof Skill>>("POST", "/skills", {
				...opts,
				rawBody: bundleForm(bundle),
			}),
		/** Move `default_version` to an existing version. */
		update: (
			id: string,
			body: z.input<typeof SkillUpdateIn>,
			opts?: RequestOptions,
		) =>
			this.json<z.infer<typeof Skill>>("POST", `/skills/${enc(id)}`, {
				...opts,
				body,
			}),
		delete: (id: string, opts?: RequestOptions) =>
			this.request("DELETE", `/skills/${enc(id)}`, opts).then(() => undefined),
		versions: {
			list: (id: string, opts?: RequestOptions) =>
				this.json<{ object: "list"; data: z.infer<typeof SkillVersion>[] }>(
					"GET",
					`/skills/${enc(id)}/versions`,
					opts,
				),
			get: (id: string, version: number, opts?: RequestOptions) =>
				this.json<z.infer<typeof SkillVersion>>(
					"GET",
					`/skills/${enc(id)}/versions/${version}`,
					opts,
				),
			create: (id: string, bundle: SkillBundle, opts?: RequestOptions) =>
				this.json<z.infer<typeof SkillVersion>>(
					"POST",
					`/skills/${enc(id)}/versions`,
					{ ...opts, rawBody: bundleForm(bundle) },
				),
			delete: (id: string, version: number, opts?: RequestOptions) =>
				this.request(
					"DELETE",
					`/skills/${enc(id)}/versions/${version}`,
					opts,
				).then(() => undefined),
			/** One file's bytes, or — with no `path` — the whole version as a zip.
			 *  The raw `Response` (matching `files.content`), so a caller streams it
			 *  through rather than buffering the whole zip into memory. */
			content: (
				id: string,
				version: number,
				path?: string,
				opts?: RequestOptions,
			) =>
				this.request(
					"GET",
					`/skills/${enc(id)}/versions/${version}/content${
						path ? `?path=${encodeURIComponent(path)}` : ""
					}`,
					opts,
				),
		},
	};

	// ── Tenant config ───────────────────────────────────────────────────────

	readonly tenant = {
		usage: (opts?: RequestOptions) =>
			this.json<ICUsage>("GET", "/tenant/usage", opts),
		models: (opts?: RequestOptions) =>
			this.json<ICModelCatalog>("GET", "/tenant/models", opts),
		hostedTools: (opts?: RequestOptions) =>
			this.data<z.infer<typeof HostedToolOut>>(
				"GET",
				"/tenant/hosted_tools",
				opts,
			),

		tokens: {
			list: (query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICToken>("/tenant/tokens", query, opts),
			/** Mint a tenant-admin or smith token (secret shown once). */
			create: (body: z.input<typeof TokenIn>, opts?: RequestOptions) =>
				this.json<ICMintedToken>("POST", "/tenant/tokens", { ...opts, body }),
			revoke: (tid: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/tenant/tokens/${enc(tid)}`, opts),
		},

		webhooks: {
			list: (query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICWebhook>("/tenant/webhooks", query, opts),
			/** Returns the signing `secret` exactly once. */
			create: (body: z.input<typeof WebhookIn>, opts?: RequestOptions) =>
				this.json<z.infer<typeof WebhookCreateOut>>(
					"POST",
					"/tenant/webhooks",
					{ ...opts, body },
				),
			update: (
				wid: string,
				body: z.input<typeof WebhookPatch>,
				opts?: RequestOptions,
			) =>
				this.json<{ id: string }>("PATCH", `/tenant/webhooks/${enc(wid)}`, {
					...opts,
					body,
				}),
			delete: (wid: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/tenant/webhooks/${enc(wid)}`, opts),
			/** Rotate the signing secret, returning the new one exactly once. Pass
			 *  `grace_seconds` to keep the old secret accepted during an overlap window. */
			rotateSecret: (
				wid: string,
				body?: z.input<typeof WebhookRotateIn>,
				opts?: RequestOptions,
			) =>
				this.json<z.infer<typeof WebhookRotateOut>>(
					"POST",
					`/tenant/webhooks/${enc(wid)}/rotate_secret`,
					{ ...opts, body: body ?? {} },
				),
			test: (wid: string, opts?: RequestOptions) =>
				this.json<{ delivered: boolean }>(
					"POST",
					`/tenant/webhooks/${enc(wid)}/test`,
					opts,
				),
			/** The persisted delivery attempts for a webhook (durable retry audit trail). */
			deliveries: (wid: string, query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICWebhookDelivery>(
					`/tenant/webhooks/${enc(wid)}/deliveries`,
					query,
					opts,
				),
			/** Force a fresh delivery attempt for one record (e.g. after the endpoint recovers). */
			redeliver: (wid: string, did: string, opts?: RequestOptions) =>
				this.json<z.infer<typeof WebhookRedeliverOut>>(
					"POST",
					`/tenant/webhooks/${enc(wid)}/deliveries/${enc(did)}/redeliver`,
					opts,
				),
		},

		providers: {
			list: (opts?: RequestOptions) =>
				this.data<ICProvider>("GET", "/tenant/providers", opts),
			get: (provider: string, opts?: RequestOptions) =>
				this.json<ICProvider>(
					"GET",
					`/tenant/providers/${enc(provider)}`,
					opts,
				),
			put: (
				provider: string,
				body: z.input<typeof ProviderIn>,
				opts?: RequestOptions,
			) =>
				this.json<z.infer<typeof ProviderConfiguredOut>>(
					"PUT",
					`/tenant/providers/${enc(provider)}`,
					{
						...opts,
						body,
					},
				),
			delete: (provider: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/tenant/providers/${enc(provider)}`, opts),
		},

		modelKeys: {
			list: (opts?: RequestOptions) =>
				this.data<ICModelKey>("GET", "/tenant/model_keys", opts),
			/** Store a BYOK model-provider key (never read back). */
			put: (
				provider: string,
				body: z.input<typeof ModelKeyIn>,
				opts?: RequestOptions,
			) =>
				this.json<z.infer<typeof ModelKeyConfiguredOut>>(
					"PUT",
					`/tenant/model_keys/${enc(provider)}`,
					{
						...opts,
						body,
					},
				),
			delete: (provider: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/tenant/model_keys/${enc(provider)}`, opts),
		},

		mcp: {
			list: (query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICMcpServer>("/tenant/mcp", query, opts),
			get: (name: string, opts?: RequestOptions) =>
				this.json<ICMcpServer>("GET", `/tenant/mcp/${enc(name)}`, opts),
			/** Register or replace a server (full replace; probes `tools/list`). */
			put: (
				name: string,
				body: z.input<typeof McpServerIn>,
				opts?: RequestOptions,
			) =>
				this.json<ICMcpServer>("PUT", `/tenant/mcp/${enc(name)}`, {
					...opts,
					body,
				}),
			refresh: (name: string, opts?: RequestOptions) =>
				this.json<ICMcpServer>(
					"POST",
					`/tenant/mcp/${enc(name)}/refresh`,
					opts,
				),
			delete: (name: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/tenant/mcp/${enc(name)}`, opts),
		},

		telegram: {
			get: (opts?: RequestOptions) =>
				this.json<ICTelegramBot>("GET", "/tenant/telegram", opts),
			put: (body: z.input<typeof TelegramBotIn>, opts?: RequestOptions) =>
				this.json<ICTelegramBot>("PUT", "/tenant/telegram", { ...opts, body }),
			delete: (opts?: RequestOptions) =>
				this.empty("DELETE", "/tenant/telegram", opts),
		},

		slack: {
			get: (opts?: RequestOptions) =>
				this.json<ICSlackApp>("GET", "/tenant/slack", opts),
			put: (body: z.input<typeof SlackAppIn>, opts?: RequestOptions) =>
				this.json<ICSlackApp>("PUT", "/tenant/slack", { ...opts, body }),
			delete: (opts?: RequestOptions) =>
				this.empty("DELETE", "/tenant/slack", opts),
		},

		discord: {
			get: (opts?: RequestOptions) =>
				this.json<ICDiscordApp>("GET", "/tenant/discord", opts),
			put: (body: z.input<typeof DiscordAppIn>, opts?: RequestOptions) =>
				this.json<ICDiscordApp>("PUT", "/tenant/discord", { ...opts, body }),
			delete: (opts?: RequestOptions) =>
				this.empty("DELETE", "/tenant/discord", opts),
		},

		whatsapp: {
			get: (opts?: RequestOptions) =>
				this.json<ICWhatsAppConfig>("GET", "/tenant/whatsapp", opts),
			put: (body: z.input<typeof WhatsAppConfigIn>, opts?: RequestOptions) =>
				this.json<ICWhatsAppConfig>("PUT", "/tenant/whatsapp", {
					...opts,
					body,
				}),
			delete: (opts?: RequestOptions) =>
				this.empty("DELETE", "/tenant/whatsapp", opts),
		},

		email: {
			get: (opts?: RequestOptions) =>
				this.json<ICEmailConfig>("GET", "/tenant/email", opts),
			put: (body: z.input<typeof EmailConfigIn>, opts?: RequestOptions) =>
				this.json<ICEmailConfig>("PUT", "/tenant/email", { ...opts, body }),
			delete: (opts?: RequestOptions) =>
				this.empty("DELETE", "/tenant/email", opts),
		},
	};

	// ── Delegated connector consent (connector OAuth, #123) ─────────────────
	// Tenant-admin token. The tenant's hosted consent page (the provider's
	// `authorize_url`) reads the pending request, then completes or declines it
	// server-to-server; the returned `redirect_url` is where to 302 the browser.

	readonly oauth = {
		authorizeRequests: {
			get: (requestId: string, opts?: RequestOptions) =>
				this.json<ICAuthorizeRequest>(
					"GET",
					`/oauth/authorize-requests/${enc(requestId)}`,
					opts,
				),
			complete: (
				requestId: string,
				body: z.input<typeof AuthorizeCompleteIn>,
				opts?: RequestOptions,
			) =>
				this.json<z.infer<typeof AuthorizeRedirectOut>>(
					"POST",
					`/oauth/authorize-requests/${enc(requestId)}/complete`,
					{ ...opts, body },
				),
			decline: (requestId: string, opts?: RequestOptions) =>
				this.json<z.infer<typeof AuthorizeRedirectOut>>(
					"POST",
					`/oauth/authorize-requests/${enc(requestId)}/decline`,
					opts,
				),
		},
	};

	// ── Organization (org token: projects, tokens, billing) ─────────────────

	readonly organization = {
		/** Platform credits — the org wallet that funds every project's runs.
		 *  Amounts are integer minor units of the wallet's `currency`. */
		billing: {
			balance: (opts?: RequestOptions) =>
				this.json<ICBalance>("GET", "/organization/billing/balance", opts),
			/** Money in (top-ups, grants, codes) and out (usage debits), newest first. */
			ledger: (
				query?: PageOpts & { direction?: "credit" | "debit" },
				opts?: RequestOptions,
			) => this.page<ICLedgerEntry>("/organization/billing/ledger", query, opts),
			/** Per-project draw for a calendar month (`period`, `YYYY-MM`). */
			usage: (query?: { period?: string }, opts?: RequestOptions) =>
				this.json<ICOrgUsage>("GET", "/organization/billing/usage", {
					...opts,
					query,
				}),
			/** Daily per-project draw over a rolling window of `days`. */
			usageSeries: (query?: { days?: number }, opts?: RequestOptions) =>
				this.json<ICOrgUsageSeries>(
					"GET",
					"/organization/billing/usage/series",
					{
						...opts,
						query,
					},
				),
			/** Open a Stripe Checkout Session to top up; send the user to its `url`. */
			checkout: (body: z.input<typeof CheckoutIn>, opts?: RequestOptions) =>
				this.json<z.infer<typeof CheckoutOut>>(
					"POST",
					"/organization/billing/checkout",
					{ ...opts, body },
				),
			/** Add a card with no charge, unlocking the one-time welcome credit. */
			setup: (body: z.input<typeof SetupIn>, opts?: RequestOptions) =>
				this.json<z.infer<typeof SetupOut>>(
					"POST",
					"/organization/billing/setup",
					{
						...opts,
						body,
					},
				),
			redeem: (body: z.input<typeof RedeemIn>, opts?: RequestOptions) =>
				this.json<z.infer<typeof RedeemOut>>(
					"POST",
					"/organization/billing/redeem",
					{ ...opts, body },
				),
			/** Credit a returning Checkout Session. Safe to call twice — the ledger
			 *  keys on the session id, so it can't double-credit. */
			confirm: (body: z.input<typeof ConfirmIn>, opts?: RequestOptions) =>
				this.json<z.infer<typeof ConfirmOut>>(
					"POST",
					"/organization/billing/confirm",
					{ ...opts, body },
				),
			autoreload: {
				get: (opts?: RequestOptions) =>
					this.json<ICAutoreload>(
						"GET",
						"/organization/billing/autoreload",
						opts,
					),
				put: (body: z.input<typeof AutoreloadIn>, opts?: RequestOptions) =>
					this.json<ICAutoreload>("PUT", "/organization/billing/autoreload", {
						...opts,
						body,
					}),
			},
			/** Charge the saved card now. `amount_cents` defaults to the auto-reload amount. */
			reload: (body?: z.input<typeof ReloadIn>, opts?: RequestOptions) =>
				this.json<z.infer<typeof ReloadOut>>(
					"POST",
					"/organization/billing/reload",
					{ ...opts, body: body ?? {} },
				),
			/** A Stripe billing-portal URL for managing cards and invoices. */
			portal: (query: { return_url: string }, opts?: RequestOptions) =>
				this.json<z.infer<typeof PortalOut>>(
					"GET",
					"/organization/billing/portal",
					{
						...opts,
						query,
					},
				),
		},

		projects: {
			list: (query?: PageOpts & { name?: string }, opts?: RequestOptions) =>
				this.page<ICProject>("/organization/projects", query, opts),
			create: (body: z.input<typeof ProjectIn>, opts?: RequestOptions) =>
				this.json<ICProject>("POST", "/organization/projects", {
					...opts,
					body,
				}),
			get: (pid: string, opts?: RequestOptions) =>
				this.json<ICProject>("GET", `/organization/projects/${enc(pid)}`, opts),
			delete: (pid: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/organization/projects/${enc(pid)}`, opts),
			tokens: {
				create: (
					pid: string,
					body: z.input<typeof ProjectTokenIn>,
					opts?: RequestOptions,
				) =>
					this.json<z.infer<typeof ProjectTokenOut>>(
						"POST",
						`/organization/projects/${enc(pid)}/tokens`,
						{
							...opts,
							body,
						},
					),
				delete: (pid: string, tid: string, opts?: RequestOptions) =>
					this.empty(
						"DELETE",
						`/organization/projects/${enc(pid)}/tokens/${enc(tid)}`,
						opts,
					),
			},
		},

		/** Third-party apps linked through the authorization server. */
		apps: {
			list: (query?: PageOpts, opts?: RequestOptions) =>
				this.page<ICAppInstall>("/organization/apps", query, opts),
			/** Disconnect: revokes every token the app holds. */
			delete: (id: string, opts?: RequestOptions) =>
				this.empty("DELETE", `/organization/apps/${enc(id)}`, opts),
		},
	};
}
