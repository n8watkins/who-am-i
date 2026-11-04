import { PACK_META } from "../../shared/packs";
import type { PackId, PackInfo } from "../../shared/protocol";
import { actors } from "./actors";
import { animeCartoons } from "./anime-cartoons";
import { brandMascots } from "./brand-mascots";
import { historicalFigures } from "./historical-figures";
import { movieCharacters } from "./movie-characters";
import type { Identity, SourcePackId } from "./types";
import { videoGames } from "./video-games";

export type { Identity, SourcePackId } from "./types";

export const SOURCE_PACKS: Record<SourcePackId, Identity[]> = {
  actors,
  "movie-characters": movieCharacters,
  "historical-figures": historicalFigures,
  "video-games": videoGames,
  "brand-mascots": brandMascots,
  "anime-cartoons": animeCartoons,
};

/** Relative weights for the Mixed pack: a source pack is picked by weight, then an identity from it. */
export const MIXED_WEIGHTS: Record<SourcePackId, number> = {
  actors: 1,
  "movie-characters": 1.2,
  "historical-figures": 1,
  "video-games": 1,
  "brand-mascots": 0.6,
  "anime-cartoons": 1,
};

const ALL_IDENTITIES = Object.values(SOURCE_PACKS).flat();
const BY_ID = new Map(ALL_IDENTITIES.map((i) => [i.id, i]));

export function getIdentity(id: string): Identity {
  const identity = BY_ID.get(id);
  if (!identity) throw new Error(`Unknown identity ${id}`);
  return identity;
}

/** All active identities a pack can produce (Mixed covers every source pack). */
export function packIdentities(packId: PackId): Identity[] {
  const list = packId === "mixed" ? ALL_IDENTITIES : SOURCE_PACKS[packId];
  return list.filter((i) => i.active);
}

export function packInfo(packId: PackId): PackInfo {
  const meta = PACK_META[packId];
  return { id: packId, name: meta.name, description: meta.description, size: packIdentities(packId).length };
}

export const ALL_PACK_IDENTITIES = ALL_IDENTITIES;
