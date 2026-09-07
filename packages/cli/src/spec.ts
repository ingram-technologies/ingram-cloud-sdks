import { createRequire } from "node:module";

/**
 * The committed OpenAPI snapshot, and the shape the rest of the CLI reads it
 * as.
 *
 * Everything the command tree knows comes from here. Nothing else in the CLI
 * parses OpenAPI.
 */

export interface SpecSchema {
	type?: string;
	format?: string;
	enum?: string[];
	items?: SpecSchema;
	properties?: Record<string, SpecSchema>;
	required?: string[];
	description?: string;
	nullable?: boolean;
	$ref?: string;
	oneOf?: SpecSchema[];
	anyOf?: SpecSchema[];
}

export interface SpecParameter {
	name: string;
	in: "path" | "query" | "header";
	required?: boolean;
	description?: string;
	schema?: SpecSchema;
}

export interface Operation {
	/** The dotted `operationId` — the command's name. */
	id: string;
	method: string;
	/** The full path, `{param}` placeholders intact. */
	path: string;
	summary: string;
	description: string;
	pathParams: SpecParameter[];
	queryParams: SpecParameter[];
	/** The JSON request body schema, its own top-level `$ref` resolved, or
	 *  null. Nested `$ref`s (a property, an array's `items`) are left as-is —
	 *  the flag builder that reads this only looks at top-level properties. */
	body: SpecSchema | null;
	/** Request media types other than JSON — a multipart upload, say. */
	requestMediaTypes: string[];
	/** Response media types other than JSON, across all 2xx responses. */
	responseMediaTypes: string[];
}

export interface Spec {
	paths: Record<string, Record<string, RawOperation>>;
	components?: { schemas?: Record<string, SpecSchema> };
	"x-ic-api-version"?: string;
}

interface RawOperation {
	operationId?: string;
	summary?: string;
	description?: string;
	security?: Array<Record<string, unknown>>;
	parameters?: SpecParameter[];
	requestBody?: { content?: Record<string, { schema?: SpecSchema }> };
	responses?: Record<string, { content?: Record<string, unknown> }>;
}

const require_ = createRequire(import.meta.url);

let cached: Spec | null = null;

/** The snapshot, read once per process. */
export function loadSpec(): Spec {
	if (!cached) cached = require_("../openapi.json") as Spec;
	return cached;
}

/** Resolve a `$ref` one level; the emitted document never nests them deeper
 *  than a component reference. */
function deref(spec: Spec, schema: SpecSchema | undefined): SpecSchema | null {
	if (!schema) return null;
	if (!schema.$ref) return schema;
	const name = schema.$ref.split("/").pop() ?? "";
	return spec.components?.schemas?.[name] ?? null;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * Every operation the CLI can offer as a command: one that takes a bearer
 * token and names itself.
 *
 * An operation without `bearerAuth` is reached by a provider, a browser or a
 * cron, never by this tool — `ic api` still reaches it. An operation without
 * an `operationId` has no name to be a command; the API's emitted-document
 * test prevents such a snapshot from shipping.
 */
export function operations(spec: Spec): Operation[] {
	const out: Operation[] = [];
	for (const [path, methods] of Object.entries(spec.paths)) {
		for (const [method, raw] of Object.entries(methods)) {
			if (!HTTP_METHODS.has(method)) continue;
			if (!raw.operationId) continue;
			if (!(raw.security ?? []).some((s) => "bearerAuth" in s)) continue;
			const params = raw.parameters ?? [];
			const content = raw.requestBody?.content ?? {};
			const responseTypes = new Set<string>();
			for (const [code, r] of Object.entries(raw.responses ?? {}))
				if (code.startsWith("2"))
					for (const t of Object.keys(r.content ?? {}))
						if (t !== "application/json") responseTypes.add(t);
			out.push({
				id: raw.operationId,
				method,
				path,
				summary: raw.summary ?? raw.operationId,
				description: raw.description ?? "",
				pathParams: params.filter((p) => p.in === "path"),
				queryParams: params.filter((p) => p.in === "query"),
				body: deref(spec, content["application/json"]?.schema),
				requestMediaTypes: Object.keys(content).filter(
					(t) => t !== "application/json",
				),
				responseMediaTypes: [...responseTypes],
			});
		}
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}
