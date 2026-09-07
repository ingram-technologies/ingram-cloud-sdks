import { buildCommand, proposeCompletions } from "@stricli/core";
import { buildInstallCommand } from "@stricli/auto-complete";
import type { Command, CommandContext } from "@stricli/core";

import type { Leaf } from "../tree.js";

/**
 * Shell tab-completion, in two pieces.
 *
 * `ic shell completion` edits `~/.bashrc` (`@stricli/auto-complete`'s own
 * `buildInstallCommand`) to register a `complete -F` function that shells out
 * to `ic complete -- $COMP_LINE` on every tab press. `complete` — hidden,
 * not under `shell`, because it is bash's entry point, not a person's — is
 * this package's other half: it hands the raw words to stricli's own
 * `proposeCompletions`, which walks the same command tree `ic` itself
 * dispatches on (so a positional's `proposeCompletions` — the id cache
 * lookup in `ids.ts` — is reached exactly the way it would be reached by a
 * real invocation) and prints one candidate per line for bash's `COMPREPLY`.
 *
 * `buildIc` is imported lazily inside the command body rather than at module
 * scope: `app.ts` builds the whole tree, including this leaf, so a top-level
 * import here would be circular. The call happens only once a real
 * completion request runs, by which time the cycle has already resolved.
 */

const completeCommand = buildCommand({
	func: async function (
		this: CommandContext,
		_flags: Record<string, never>,
		...words: string[]
	) {
		const { buildIc } = await import("../app");
		// stricli keeps a positional array's own leading `--` (the marker that
		// told *it* to stop parsing flags) as the array's first element rather
		// than consuming it, and `COMP_LINE` includes the program name itself
		// (`ic …`) ahead of that — strip both, the same way `bin.ts` starts
		// after argv[0..1], so the app's own tree sees only its real words.
		let rawInputs = words;
		if (rawInputs[0] === "--") rawInputs = rawInputs.slice(1);
		if (rawInputs[0] === "ic") rawInputs = rawInputs.slice(1);
		const completions = await proposeCompletions(buildIc(), rawInputs, { process });
		for (const c of completions) process.stdout.write(`${c.completion}\n`);
	},
	parameters: {
		positional: {
			kind: "array",
			parameter: { brief: "COMP_LINE, word by word", parse: String },
		},
		flags: {},
	},
	docs: { brief: "Print completions for one partial command line (used by bash)" },
});

// `buildInstallCommand`'s context (`StricliAutoCompleteContext`) additionally
// wants `process.env`, which the real context passed to `run()` in `bin.ts`
// always has (it is Node's own `process`) but the tree's declared
// `CommandContext` does not promise. The cast is the same bargain
// `flags as never` already makes elsewhere in this package: correct at
// runtime, wider than stricli's structural types can express here.
const installCommand = buildInstallCommand("ic", {
	bash: "ic complete --",
}) as unknown as Command<CommandContext>;

/** The `shell.*` leaves: `ic shell completion` (visible) plus the `complete`
 *  hidden entry point it wires bash to call. */
export function shellCommands(): Leaf[] {
	return [
		{ id: "shell.completion", command: installCommand },
		{ id: "complete", command: completeCommand, hidden: true },
	];
}
