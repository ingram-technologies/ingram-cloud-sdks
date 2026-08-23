/**
 * Hand-authored Zod schemas for the `conversations` resource — the wire's source
 * of truth, mapped onto the OpenAI **Conversations API** so an OpenAI client
 * library talks to it unchanged.
 *
 * One source, three outputs: the API imports these into its `createRoute`
 * definitions (validation + emitted OpenAPI), and the consumer-facing `IC*`
 * types are `z.infer`red here and re-exported by `../responses`.
 *
 * Standards mapping: the object matches OpenAI's `conversation`
 * (`id`/`object`/`created_at`/`metadata`); `title`, `smith_id`, and `updated_at`
 * are documented IC extensions OpenAI omits (OpenAI has no title and no list
 * endpoint, both of which a console conversation list needs). `created_at`/
 * `updated_at` are unix-second integers like every OpenAI object, not the ISO
 * strings the native `ic_*` resources use. Items are read-only and reconstructed
 * from the conversation's runs — they accrue from `/v1/responses`, not a write
 * endpoint.
 */
import { z } from "zod";
import { oaiListOut } from "./_page.js";

/** A conversation — the OpenAI Conversations object + IC extensions. */
export const ConversationOut = z
	.object({
		id: z.string(),
		object: z.literal("conversation"),
		/** Unix seconds, like every OpenAI object. */
		created_at: z.number().int(),
		/** Unix seconds of the last run in the conversation (IC extension). */
		updated_at: z.number().int(),
		/** Auto-set from the first user turn of a Responses-API run that names this
		 *  conversation; null until then. Set it yourself any time. IC extension. */
		title: z.string().nullable(),
		/** The smith that owns this conversation. IC extension. */
		smith_id: z.string(),
		metadata: z.record(z.string(), z.unknown()),
	})
	.meta({ id: "ConversationOut" });

/** The conversation list, in OpenAI's `list` envelope (page with `?after=`). */
export const ConversationListOut = oaiListOut(ConversationOut, "ConversationListOut");

/** The delete acknowledgement, in OpenAI's `*.deleted` shape. */
export const ConversationDeleted = z
	.object({
		id: z.string(),
		object: z.literal("conversation.deleted"),
		deleted: z.literal(true),
	})
	.meta({ id: "ConversationDeleted" });

/** One reconstructed item in a conversation. Modelled loosely on the Responses
 *  output items: a `message` carries `content` parts (`input_text`/`output_text`);
 *  the tool-step items mirror their wire shapes — `function_call`
 *  (`call_id`/`name`/`arguments`) and `function_call_output` (`call_id`/`output`) for
 *  client-side tools, `mcp_call` (`name`/`arguments`/`output`/`server_label`) for a
 *  tool the run loop executed server-side. */
export const ConversationItem = z
	.object({
		id: z.string(),
		type: z.string(),
		role: z.string().optional(),
		status: z.string().optional(),
		content: z.array(z.record(z.string(), z.unknown())).optional(),
		// Tool-step fields (present on function_call / function_call_output / mcp_call).
		call_id: z.string().optional(),
		name: z.string().optional(),
		arguments: z.string().optional(),
		output: z.string().optional(),
		server_label: z.string().optional(),
	})
	.meta({ id: "ConversationItem" });

/** A conversation's items, in OpenAI's `list` envelope (not the IC cursor page). */
export const ConversationItemListOut = oaiListOut(
	ConversationItem,
	"ConversationItemListOut",
);

/** Create body — OpenAI accepts `metadata`; `title` is the IC extension. */
export const ConversationCreate = z
	.object({
		title: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.meta({ id: "ConversationCreate" });

/** Update body — set the title and/or merge metadata. */
export const ConversationUpdate = z
	.object({
		title: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.meta({ id: "ConversationUpdate" });

// ── Inferred consumer-facing types (re-exported by ../responses) ─────────────

export type ICConversation = z.infer<typeof ConversationOut>;
export type ICConversationItem = z.infer<typeof ConversationItem>;
