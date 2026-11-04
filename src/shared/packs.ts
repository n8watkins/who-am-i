// Pack metadata that is safe for the client: names and descriptions only, never identities.
import type { PackId } from "./protocol";

export interface PackMeta {
  id: PackId;
  name: string;
  description: string;
  emoji: string;
}

export const PACK_META: Record<PackId, PackMeta> = {
  mixed: {
    id: "mixed",
    name: "Mixed",
    description: "A bit of everything, drawn from every pack.",
    emoji: "\u{1F3B2}",
  },
  actors: {
    id: "actors",
    name: "Actors",
    description: "Film and TV stars, past and present.",
    emoji: "\u{1F3AC}",
  },
  "movie-characters": {
    id: "movie-characters",
    name: "Movie Characters",
    description: "Heroes, villains and icons of the big screen.",
    emoji: "\u{1F37F}",
  },
  "historical-figures": {
    id: "historical-figures",
    name: "Historical Figures",
    description: "Leaders, scientists, artists and explorers.",
    emoji: "\u{1F3DB}\u{FE0F}",
  },
  "video-games": {
    id: "video-games",
    name: "Video Games",
    description: "Characters from classic and modern games.",
    emoji: "\u{1F3AE}",
  },
  "brand-mascots": {
    id: "brand-mascots",
    name: "Brand Mascots",
    description: "The faces behind cereals, snacks and ads.",
    emoji: "\u{1F36A}",
  },
  "anime-cartoons": {
    id: "anime-cartoons",
    name: "Anime & Cartoons",
    description: "Animated favorites from TV and comics.",
    emoji: "\u{1F4FA}",
  },
};

export const PACK_ORDER: PackId[] = [
  "mixed",
  "actors",
  "movie-characters",
  "historical-figures",
  "video-games",
  "brand-mascots",
  "anime-cartoons",
];
