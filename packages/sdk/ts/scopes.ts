/**
 * The closed permission vocabulary a smith token may carry, in mint order.
 *
 * It lives here rather than in the API because it is wire contract: a caller
 * minting a token has to name the scopes it wants (`permissions` is required —
 * there is no "grant everything" default), and the console's token form needs
 * the same list to offer full access. One definition, so a new scope reaches
 * every minting surface at once instead of drifting into a stale copy.
 *
 * Not in here: the admin markers (`tenant:*`, `operator:*`) and the account key
 * (`organization:*`). Those are postures, not permissions — they are never a
 * legal `permissions` entry, and the API refuses them as unknown scopes.
 */
export const V1_SCOPES = [
	"runs:read",
	"runs:write",
	"conversations:read",
	"conversations:write",
	"memories:read",
	"memories:write",
	"connections:read",
	"connections:write",
	"deployments:read",
	"deployments:write",
	"schedules:read",
	"schedules:write",
	"approvals:read",
	"approvals:write",
	"traces:read",
	"traces:write",
	"usage:read",
	"usage:write",
	"customers:read",
	"customers:write",
	"files:read",
	"files:write",
	"vector_stores:read",
	"vector_stores:write",
	// Smith-level provider keys (#170, end-user BYOK): an end-user sets their own
	// key; a tenant token manages any of its smiths' keys.
	"model_keys:read",
	"model_keys:write",
	// Agent Skills (#175): a tenant's skill bundles and their immutable versions.
	"skills:read",
	"skills:write",
	// Embeddings: the stateless text→vector compute endpoint (POST /v1/embeddings).
	// Write-only — it produces a result, it reads no stored state.
	"embeddings:write",
] as const;

export type V1Scope = (typeof V1_SCOPES)[number];

/** The read half of the vocabulary — the scope set for a token that must not
 *  change anything. Derived, so it cannot fall behind {@link V1_SCOPES}. */
export const V1_READ_SCOPES: readonly V1Scope[] = V1_SCOPES.filter(
	(s): s is Extract<V1Scope, `${string}:read`> => s.endsWith(":read"),
);
