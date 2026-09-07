/**
 * One rendering for every failure, and an exit code a script can branch on.
 *
 * `1` is the API refusing, `2` is the caller misusing the tool, `3` is "you
 * are not signed in" — separated because the third is the only one a wrapper
 * script can fix by itself.
 */

interface ApiFailure {
	status?: number;
	code?: string;
	requestId?: string;
	detail?: string;
	message: string;
}

export function messageFor(error: unknown): string {
	const e = error as ApiFailure;
	const head = e.detail ?? e.message;
	const parts = [head];
	if (e.code) parts.push(`(${e.code})`);
	if (e.requestId) parts.push(`request ${e.requestId}`);
	return parts.join(" ");
}

export function exitCodeFor(error: unknown): number {
	const e = error as ApiFailure;
	if (/Not signed in|No project selected/.test(e.message ?? "")) return 3;
	if (e.status) return 1;
	return 2;
}

/** Print a failure to stderr and return the process exit code. */
export function reportError(error: unknown): number {
	process.stderr.write(`error: ${messageFor(error)}\n`);
	return exitCodeFor(error);
}
