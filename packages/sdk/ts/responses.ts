/**
 * TypeScript types for the `/v1` JSON response bodies — the consumer-facing
 * companion to the wire schemas, imported by API consumers (e.g. the console) to
 * type the JSON they read back.
 *
 * The `IC*` types are `z.infer`red from the hand-authored Zod in
 * `./zod/<resource>` (the wire's source of truth) and re-exported here as
 * **types** — so this module stays Zod-free for `import type` consumers. Only the
 * list-envelope generics ({@link ICList}/{@link ICPaginatedResponse}) are
 * declared inline, since they're generic over any resource.
 */

/** The standard list envelope — a `data` array and nothing else. Most list
 *  endpoints return this. */
export interface ICList<T> {
	data: T[];
}

/** A cursor-paginated list. The endpoints that page (smiths, memories,
 *  customers) add `has_more`, and some a `next_cursor`; the rest return the
 *  plain {@link ICList}. */
export interface ICPaginatedResponse<T> {
	data: T[];
	has_more: boolean;
	next_cursor?: string | null;
}

/** One embedded input from `POST /v1/embeddings`, on the OpenAI wire. */
export interface ICEmbedding {
	object: "embedding";
	index: number;
	embedding: number[];
}

/** The `POST /v1/embeddings` response — the OpenAI `list`-of-`embedding` shape.
 *  Declared inline (not `z.infer`red) because that route is a hand-shaped
 *  OpenAI-compatible front door with no Zod on the API side to share. */
export interface ICEmbeddingList {
	object: "list";
	data: ICEmbedding[];
	model: string;
	usage: { prompt_tokens: number; total_tokens: number };
}

// ── Re-exported from the hand-authored Zod source of truth (./zod/*) ──────────
export type {
	ICAgent,
	ICAgentVariable,
	ICAgentVersion,
	ICUiResource,
	ICUiResourceTool,
} from "./zod/agents.js";
export type { ICApproval } from "./zod/approvals.js";
export type {
	ICAutoreload,
	ICBalance,
	ICLedgerEntry,
	ICOrgUsage,
	ICOrgUsageProject,
	ICOrgUsageSeries,
} from "./zod/billing.js";
export type { ICBudget, ICBudgetStatus } from "./zod/budgets.js";
export type { ICCatalogEntry } from "./zod/catalog.js";
export type { ICConnection } from "./zod/connections.js";
export type { ICConversation, ICConversationItem } from "./zod/conversations.js";
export type { ICCustomer } from "./zod/customers.js";
export type {
	ICDeployment,
	ICDeploymentCreated,
	ICInboundEvent,
} from "./zod/deployments.js";
export type { ICDiscordApp } from "./zod/discord.js";
export type { ICEmailConfig } from "./zod/email.js";
export type { ICFile, ICFileList } from "./zod/files.js";
export type { ICMcpServer, ICMcpTool, ICApprovalRule } from "./zod/mcp.js";
export type { ICWorkingMemory, ICRecallHit } from "./zod/memories.js";
export type {
	ICSpanKind,
	ICSpan,
	ICSpanIn,
	ICSpanNode,
	ICTrace,
	ICTraceDetail,
	ICUsageBreakdown,
	ICUsageEvent,
} from "./zod/observability.js";
export type { ICProject, ICAppInstall } from "./zod/projects.js";
export type { ICActor } from "./zod/_actor.js";
export type {
	ICRun,
	ICRunUsage,
	ICRunWarning,
	ICInputMessage,
	ICRunEvent,
} from "./zod/runs.js";
export type { ICSchedule } from "./zod/schedules.js";
export type { ICSkill, ICSkillVersion, ICSkillReference } from "./zod/skills.js";
export type { ICSlackApp } from "./zod/slack.js";
export type { ICSmith } from "./zod/smiths.js";
export type { ICSmithRevision } from "./zod/smith-revisions.js";
export type { ICTelegramBot } from "./zod/telegram.js";
export type {
	ICEvent,
	ICWebhook,
	ICWebhookDelivery,
	ICToken,
	ICMintedToken,
	ICUsage,
	ICModel,
	ICModelProvider,
	ICModelCatalog,
	ICModelKey,
	ICProvider,
	ICAuthorizeRequest,
} from "./zod/tenant.js";
export type { ICWhatsAppConfig } from "./zod/whatsapp.js";
export type {
	ICVectorStore,
	ICVectorStoreFile,
	ICVectorStoreFileBatch,
	ICVectorStoreSearchPage,
	ICVectorStoreAttributes,
	ICVectorStoreFilter,
} from "./zod/vector-stores.js";
