import type { PackId } from "../../shared/protocol";

export type Difficulty = "easy" | "medium" | "hard";

/** A guessable identity. Server-only: never import this module from client code. */
export interface Identity {
  id: string;
  canonicalName: string;
  aliases: string[];
  categoryId: string;
  tags: string[];
  difficulty: Difficulty;
  active: boolean;
  imageUrl?: string;
}

export type SourcePackId = Exclude<PackId, "mixed">;

/** Compact authoring form: [stable slug, canonical name, difficulty, aliases?, tags?]. */
export type IdentityRow = readonly [string, string, Difficulty, (readonly string[])?, (readonly string[])?];

/**
 * Builds a pack's identities. The id is `${packId}.${slug}`; slugs are stable once
 * published and must not be changed when a display name is corrected.
 */
export function definePack(packId: SourcePackId, rows: readonly IdentityRow[]): Identity[] {
  return rows.map(([slug, canonicalName, difficulty, aliases = [], tags = []]) => ({
    id: `${packId}.${slug}`,
    canonicalName,
    aliases: [...aliases],
    categoryId: packId,
    tags: [...tags],
    difficulty,
    active: true,
  }));
}
