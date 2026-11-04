// Pack metadata that is safe for the client: names and descriptions only, never identities.
import type { PackId } from "./protocol";

export interface PackMeta {
  id: PackId;
  name: string;
  description: string;
}

export const PACK_META: Record<PackId, PackMeta> = {
  mixed: {
    id: "mixed",
    name: "Mixed",
    description: "A bit of everything, drawn from every pack.",
  },
  actors: {
    id: "actors",
    name: "Actors",
    description: "Film and TV stars, past and present.",
  },
  "movie-characters": {
    id: "movie-characters",
    name: "Movie Characters",
    description: "Heroes, villains and icons of the big screen.",
  },
  "historical-figures": {
    id: "historical-figures",
    name: "Historical Figures",
    description: "Leaders, scientists, artists and explorers.",
  },
  "video-games": {
    id: "video-games",
    name: "Video Games",
    description: "Characters from classic and modern games.",
  },
  "brand-mascots": {
    id: "brand-mascots",
    name: "Brand Mascots",
    description: "The faces behind cereals, snacks and ads.",
  },
  "anime-cartoons": {
    id: "anime-cartoons",
    name: "Anime & Cartoons",
    description: "Animated favorites from TV and comics.",
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
