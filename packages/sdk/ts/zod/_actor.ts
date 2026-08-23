/**
 * The acting principal — who a run or an event is attributable to.
 *
 * Resolved from the authenticated caller at the point of action and stamped on
 * the record it produced; never inferred afterwards. Every event a run produces
 * inherits the run's actor, so a whole turn is attributable to one identity.
 */
import { z } from "zod";

export const Actor = z
	.object({
		/** `smith` — a smith acted (a smith-bound token, or the smith itself on an
		 *  autonomous turn); `tenant` — a tenant-admin token acted on a smith's
		 *  behalf; `operator` — Ingram staff acted through the operator console. */
		kind: z.enum(["smith", "tenant", "operator"]),
		/** The smith id, tenant id, or operator email, per `kind`. */
		id: z.string(),
		/** `jti` of the token that authorized the action. Empty when no token
		 *  acted — a scheduled or channel-driven turn the platform ran itself, or a
		 *  console session, which signs a short-lived per-request token that is never
		 *  registered. Read it with `email`: both empty means the platform acted. */
		token_id: z.string(),
		/** The human behind the action, when one is named — the signed-in console user
		 *  or the Ingram operator. Empty for a machine caller (an API token, a smith
		 *  acting for itself) and for autonomous work.
		 *
		 *  This is what makes a config change attributable to a *person* rather than to
		 *  the tenant they share: console mutations all carry `kind: "tenant"`, so
		 *  without this every colleague's action looked identical. Defaulted rather than
		 *  optional so records written before it existed read as "no human named"
		 *  instead of failing to parse. */
		email: z.string().default(""),
	})
	.meta({ id: "Actor" });

export type ICActor = z.infer<typeof Actor>;
