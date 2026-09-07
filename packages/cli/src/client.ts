import { IngramCloud } from "@ingram-cloud/sdk/client";

import { activeProfile, tokenFor } from "./config";
import type { Profile } from "./config";

/**
 * One authenticated client per invocation.
 *
 * The token is chosen per request rather than per client, because a single
 * command can touch both tiers — `ic project use` lists projects with the
 * organization key and mints a project token with it. `RequestOptions.token`
 * is the SDK's own per-call override, so `token(path)` picks the tier and the
 * caller passes it alongside the path it already has — no shared mutable
 * state to route between concurrent calls on one session.
 */
export interface Session {
	profile: Profile;
	ic: IngramCloud;
	/** The version the bundled snapshot was taken under. */
	apiVersion: string;
	/** The bearer token for a given `/v1` path, org key or project token. */
	token: (path: string) => string;
}

export function openSession(opts: { profile?: string; apiVersion: string }): Session {
	const profile = activeProfile(opts.profile);
	const ic = new IngramCloud({
		baseURL: profile.base_url,
		apiVersion: opts.apiVersion,
		// A session always names its token per call via `token(path)`; this is
		// only reached if some future call site forgets to.
		token: () => tokenFor(profile, "/"),
	});
	return {
		profile,
		ic,
		apiVersion: opts.apiVersion,
		token: (path) => tokenFor(profile, path),
	};
}
