/**
 * Hand-authored Zod schemas for the `connections` resource — per-smith OAuth
 * grants under `/v1/smiths/:pid/connections`. The wire's source of truth,
 * replacing the loose generated shapes for this resource.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red from them here and re-exported by `../responses`. No
 * Zod is pulled into a type-only consumer — `responses.ts` re-exports these as
 * `export type`.
 *
 * SECURITY INVARIANT: `ConnectionOut` NEVER carries the secret credential
 * material — only `id`, `provider`, `scopes`, `status`, `expires_at`,
 * `metadata`, `created_at`. The handler's `toPublic` serializer is validated
 * against this schema.
 *
 * `.meta({ id })` names the component so the emitted OpenAPI references it as
 * `#/components/schemas/<id>` rather than inlining it.
 */
import { z } from "zod";
import { pageOut } from "./_page.js";

/** OAuth token material the tenant pushes in; IC stores it encrypted and never
 *  echoes it back. Only `kind: "oauth_tokens"` is accepted. */
export const Credential = z
	.object({
		kind: z.string().optional(),
		access_token: z.string().nullish(),
		refresh_token: z.string().nullish(),
		expires_at: z.string().nullish(),
		token_uri: z.string().nullish(),
	})
	.meta({ id: "Credential" });

/** A connection WITHOUT the secret credential material. */
export const ConnectionOut = z
	.object({
		id: z.string(),
		provider: z.string(),
		scopes: z.array(z.string()),
		status: z.string(),
		expires_at: z.string().nullable(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		created_at: z.string().nullable(),
	})
	.meta({ id: "ConnectionOut" });

export const ConnectionListOut = pageOut(ConnectionOut, "ConnectionListOut");

// ── Request bodies ──────────────────────────────────────────────────────────

export const ConnectionIn = z
	.object({
		provider: z.string(),
		scopes: z.array(z.string()).optional(),
		credential: Credential,
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.meta({ id: "ConnectionIn" });

export const ConnectionPatch = z
	.object({
		scopes: z.array(z.string()).nullish(),
		credential: Credential.nullish(),
		status: z.string().nullish(),
		metadata: z.record(z.string(), z.unknown()).nullish(),
	})
	.meta({ id: "ConnectionPatch" });

/** The `authorize` 200 body: the minted authorize URL + echoed provider. */
export const AuthorizeOut = z
	.object({ authorize_url: z.string().nullable(), provider: z.string() })
	.meta({ id: "AuthorizeOut" });

/** Body for the OAuth consent broker: `POST …/connections/authorize`. */
export const AuthorizeIn = z
	.object({
		provider: z.string(),
		return_url: z.string().nullish(),
		mcp_server: z.string().nullish(),
	})
	.meta({ id: "AuthorizeIn" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICConnection = z.infer<typeof ConnectionOut>;
