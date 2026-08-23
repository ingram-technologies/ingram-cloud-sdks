/**
 * Agent Skills (#175) — a folder anchored by SKILL.md, per the Agent Skills
 * specification, stored as an immutable version and attached to an agent.
 *
 * A version's bytes never appear on the wire: `files` lists each path with its
 * size and content hash, so a tenant can see exactly what they installed.
 */
import { z } from "zod";

/** One file in a skill version, as the caller uploaded it. */
export const SkillFile = z
	.object({
		path: z.string(),
		size: z.number().int(),
		sha256: z.string(),
		media_type: z.string(),
	})
	.meta({ id: "SkillFile" });

/** One published agent version that froze a reference to this skill version.
 *  A frozen reference is the only kind that blocks a delete, so this is the
 *  list a `409 skill_in_use` would name. */
export const SkillReference = z
	.object({ agent_id: z.string(), version: z.number().int() })
	.meta({ id: "SkillReference" });

/** An immutable published version of a skill. */
export const SkillVersion = z
	.object({
		skill_id: z.string(),
		version: z.number().int(),
		description: z.string(),
		license: z.string().nullable(),
		compatibility: z.unknown().nullable(),
		metadata: z.record(z.string(), z.unknown()).nullable(),
		references: z.array(z.string()),
		scripts: z.array(z.string()),
		assets: z.array(z.string()),
		files: z.array(SkillFile),
		/** Published agent versions holding this one frozen. Always present, `[]`
		 *  when nothing does. */
		referenced_by: z.array(SkillReference),
		bytes: z.number().int(),
		created_at: z.string(),
	})
	.meta({ id: "SkillVersion" });

/** The skill resource. `default_version` is what an agent gets when it names none. */
export const Skill = z
	.object({
		id: z.string(),
		object: z.literal("skill"),
		name: z.string(),
		description: z.string(),
		default_version: z.number().int(),
		created_at: z.string(),
		updated_at: z.string(),
	})
	.meta({ id: "Skill" });

export const SkillListOut = z
	.object({ object: z.literal("list"), data: z.array(Skill) })
	.meta({ id: "SkillListOut" });

export const SkillVersionListOut = z
	.object({ object: z.literal("list"), data: z.array(SkillVersion) })
	.meta({ id: "SkillVersionListOut" });

/** Move the skill's `default_version` to an existing version. */
export const SkillUpdateIn = z
	.object({ default_version: z.number().int().positive() })
	.meta({ id: "SkillUpdateIn" });

/** One skill reference in an agent's `skills` config. Omitted `version` resolves
 *  to the skill's `default_version` and is frozen at publish. */
export const SkillRef = z
	.object({
		skill_id: z.string(),
		version: z.number().int().positive().optional(),
	})
	.meta({ id: "SkillRef" });

export type ICSkill = z.infer<typeof Skill>;
export type ICSkillVersion = z.infer<typeof SkillVersion>;
export type ICSkillReference = z.infer<typeof SkillReference>;
