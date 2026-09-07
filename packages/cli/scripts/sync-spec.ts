/**
 * Refresh the committed OpenAPI snapshot.
 *
 * The snapshot is the CLI's command tree, so it is committed rather than
 * fetched at start-up: `ic` must work offline, must not add a network
 * round-trip to every invocation, and a change to the API's surface must be a
 * reviewable diff in this repo rather than a silent change in what `ic --help`
 * prints.
 *
 * Run: bun run sync-spec [baseUrl]
 */
const base = process.argv[2] ?? "https://api.cloud.ingram.tech";
const res = await fetch(`${base}/openapi.json`);
if (!res.ok) throw new Error(`GET ${base}/openapi.json → ${res.status}`);
const doc = (await res.json()) as Record<string, unknown>;
const version = res.headers.get("ic-api-version") ?? "";
await Bun.write(
	new URL("../openapi.json", import.meta.url),
	`${JSON.stringify({ ...doc, "x-ic-api-version": version }, null, "\t")}\n`,
);
const paths = Object.keys(doc.paths as object).length;
console.log(`snapshot: ${paths} paths, IC-Api-Version ${version || "(none sent)"}`);
