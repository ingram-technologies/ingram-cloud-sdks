import type { Command, CommandContext } from "@stricli/core";

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

export const OVERRIDES: Record<string, OverrideFactory> = {};
