/**
 * Hand-authored Zod schemas for the `files` resource — the wire's source of
 * truth, mapped onto the OpenAI **Files API** so an OpenAI client library talks
 * to it unchanged.
 *
 * The File object is exactly OpenAI's (`status`/`status_details` included, inert
 * upstream and here). Upload is `multipart/form-data`, so there is no `In`
 * schema — the route reads the form directly. The list uses OpenAI's `list`
 * envelope with `after`/`limit`/`order` paging and enumerates Files-API uploads
 * only; files inlined into a conversation stay reachable by id but are not
 * listed.
 */
import { z } from "zod";
import { oaiListOut } from "./_page.js";

/** OpenAI's upload purposes. Vector-store source files are `assistants`. */
export const FilePurpose = z.enum([
	"assistants",
	"batch",
	"fine-tune",
	"vision",
	"user_data",
	"evals",
]);

/** The OpenAI File object. */
export const FileOut = z
	.object({
		id: z.string(),
		object: z.literal("file"),
		bytes: z.number().int(),
		/** Unix seconds, like every OpenAI object. */
		created_at: z.number().int(),
		filename: z.string(),
		purpose: z.string(),
		/** Deprecated upstream; always `processed` here. */
		status: z.literal("processed"),
		status_details: z.null(),
	})
	.meta({ id: "FileOut" });

/** Files, in OpenAI's `list` envelope (not the IC cursor page). */
export const FileListOut = oaiListOut(FileOut, "FileListOut");

/** The delete acknowledgement, in OpenAI's `*.deleted` shape. */
export const FileDeleted = z
	.object({
		id: z.string(),
		object: z.literal("file"),
		deleted: z.literal(true),
	})
	.meta({ id: "FileDeleted" });

export type ICFile = z.infer<typeof FileOut>;
export type ICFileList = z.infer<typeof FileListOut>;
