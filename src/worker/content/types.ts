import type { Difficulty, IdentityPicture, PackId } from "../../shared/protocol";

import { PICTURES } from "./pictures";

export type { Difficulty, IdentityPicture };

/** A guessable identity. Server-only: never import this module from client code. */
export interface Identity {
  id: string;
  canonicalName: string;
  aliases: string[];
  categoryId: string;
  tags: string[];
  difficulty: Difficulty;
  active: boolean;
  /** A Wikimedia-hosted picture and its credit, from pictures.json. Absent: the card stays text-only. */
  picture?: IdentityPicture;
  /** Exactly three hints, from vague to strong. Never contain the name or an alias. */
  hints: Hints;
}

export type Hints = readonly [string, string, string];

export type SourcePackId = Exclude<PackId, "mixed">;

/** Compact authoring form: [stable slug, canonical name, difficulty, aliases?, tags?]. */
export type IdentityRow = readonly [string, string, Difficulty, (readonly string[])?, (readonly string[])?];

/**
 * Builds a pack's identities. The id is `${packId}.${slug}`; slugs are stable once
 * published and must not be changed when a display name is corrected.
 */
export function definePack(packId: SourcePackId, rows: readonly IdentityRow[], hints: Readonly<Record<string, Hints>>): Identity[] {
  return rows.map(([slug, canonicalName, difficulty, aliases = [], tags = []]) => {
    const identityHints = hints[slug];
    if (!identityHints) throw new Error(`Missing hints for ${packId}.${slug}`);
    const id = `${packId}.${slug}`;
    const picture = PICTURES[id];
    return {
      id,
      canonicalName,
      aliases: [...aliases],
      categoryId: packId,
      tags: [...tags],
      difficulty,
      active: true,
      ...(picture ? { picture } : {}),
      hints: identityHints,
    };
  });
}
