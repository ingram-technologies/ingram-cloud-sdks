import { IngramCloud } from "@ingram-cloud/sdk/client";

import { activeProfile, tokenFor } from "./config";
import type { Profile } from "./config";

/**
 * One authenticated client per invocation.
 *
 * The token is chosen per request rather than per client, because a single
 * command can touch both tiers — `ic project use` lists projects with the
 * organization key and mints a project token with it. The SDK takes a
 * function for exactly this.
 */
export interface Session {
	profile: Profile;
	ic: IngramCloud;
	/** The version the bundled snapshot was taken under. */
	apiVersion: string;
}

export function openSession(opts: { profile?: string; apiVersion: string }): Session {
	const profile = activeProfile(opts.profile);
	let path = "/";
	const ic = new IngramCloud({
		baseURL: profile.base_url,
		apiVersion: opts.apiVersion,
		token: () => tokenFor(profile, path),
	});
	// The SDK asks for the token immediately before each request, so recording
	// the path on the way in is enough to route it. Wrapping `request` keeps
	// that in one place instead of every call site passing a token.
	const inner = ic.request.bind(ic);
	ic.request = ((method: string, p: string, o?: object) => {
		path = p;
		return inner(method, p, o);
	}) as typeof ic.request;
	return { profile, ic, apiVersion: opts.apiVersion };
}
