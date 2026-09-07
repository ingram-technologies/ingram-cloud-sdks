import type { Session } from "./client";

/**
 * Resolve a positional argument to the id the API accepts.
 *
 * Placeholder: this is Task 10's job (a natural key, a prefix, or `last`
 * resolved against the API). For now every positional is already an id.
 */
export async function resolveRef(
	_session: Session,
	_paramName: string,
	raw: string,
): Promise<string> {
	return raw;
}
