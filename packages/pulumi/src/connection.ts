/**
 * Connection helper — resolves the IC `{ baseUrl, token }` pair once so a Pulumi
 * program can spread it into every resource:
 *
 *   const conn = connectionFromConfig();
 *   new ic.IcAgent("assistant", { ...conn, name: "…", instructions: "…" });
 *
 * Resolution order (first hit wins):
 *   baseUrl: `ingram-cloud:baseUrl` config → IC_BASE_URL → CLOUD_BASE_URL → prod
 *   token:   `ingram-cloud:token` secret config → INGRAM_CLOUD_TOKEN → CLOUD_API_KEY
 *
 * The env fallbacks bridge the two naming conventions already in the fleet
 * (thornhill's INGRAM_CLOUD_TOKEN, integrain's CLOUD_API_KEY). The returned
 * token is always a secret Output so it stays encrypted in state.
 */
import * as pulumi from "@pulumi/pulumi";

export const DEFAULT_BASE_URL = "https://api.cloud.ingram.tech";

export interface IcConnection {
	baseUrl: pulumi.Input<string>;
	token: pulumi.Input<string>;
}

export function connectionFromConfig(cfg?: pulumi.Config): IcConnection {
	const c = cfg ?? new pulumi.Config("ingram-cloud");
	const baseUrl =
		c.get("baseUrl") ??
		process.env.IC_BASE_URL ??
		process.env.CLOUD_BASE_URL ??
		DEFAULT_BASE_URL;
	const tokenFromCfg = c.getSecret("token");
	const token =
		tokenFromCfg ??
		pulumi.secret(
			process.env.INGRAM_CLOUD_TOKEN ?? process.env.CLOUD_API_KEY ?? "",
		);
	return { baseUrl, token };
}
