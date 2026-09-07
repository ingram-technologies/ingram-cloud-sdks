import type { Command, CommandContext } from "@stricli/core";

import {
	agentsUiContentCommand,
	agentsUiPutCommand,
	filesContentCommand,
	filesUploadCommand,
} from "./commands/files";
import {
	compatStreamCommand,
	runEventsCommand,
	runStreamCommand,
} from "./commands/runs";
import {
	skillsCreateCommand,
	skillsVersionsContentCommand,
	skillsVersionsCreateCommand,
} from "./commands/skills";
import type { Operation } from "./spec";

/**
 * Operations whose command is hand-written, keyed by `operationId`.
 *
 * An operation lands here only when JSON in, JSON out is the wrong shape for
 * it: a multipart upload, a byte download, a stream. `app.test.ts` checks
 * both directions — an override naming an operation that no longer exists,
 * and an operation with a non-JSON media type that has no override — so this
 * map cannot quietly fall behind the API.
 */
export type OverrideFactory = (
	op: Operation,
	apiVersion: string,
) => Command<CommandContext>;

export const OVERRIDES: Record<string, OverrideFactory> = {
	// 4 multipart uploads
	"files.upload": filesUploadCommand,
	"skills.create": skillsCreateCommand,
	"skills.versions.create": skillsVersionsCreateCommand,
	"agents.ui.put": agentsUiPutCommand,

	// 3 byte downloads
	"files.content": filesContentCommand,
	"skills.versions.content": skillsVersionsContentCommand,
	"agents.ui.content": agentsUiContentCommand,

	// 5 streams
	"smiths.runs.create": runStreamCommand,
	"smiths.runs.events": runEventsCommand,
	"smiths.runs.replay": runStreamCommand,
	"completions.create": compatStreamCommand,
	"responses.create": compatStreamCommand,
};
