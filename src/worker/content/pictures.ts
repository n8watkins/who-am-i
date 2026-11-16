// Pictures for identities: one Wikimedia-hosted thumbnail and its credit per identity, keyed by
// identity id. Server-only, like the packs: a picture reaches a phone only inside the view that
// already carries that identity's name (see publicIdentity in ../view.ts).
//
// Nothing here is copied into the site: the phone loads the thumbnail straight from
// upload.wikimedia.org with no referrer. Real people use a free photo or portrait from Wikimedia
// Commons, chosen by hand. Characters use the lead image of their own English Wikipedia article
// (free: false when that image is non-free); character images belong to their owners.
//
// The data is pictures.json, one identity per line:
//   "pack.slug": [thumbnail, file page, author or null, licence, free]
// To pull one picture the same day, delete its line there (mind the comma on the line before when
// it is the last one): that identity goes back to the text card. To turn every picture off without
// a code change, set the Worker variable PICTURES to "off" (see README, "Pictures").
import type { IdentityPicture } from "../../shared/protocol";
import data from "./pictures.json" with { type: "json" };

/** Worker variables this module reads. */
export interface PicturesEnv {
  /** "off" turns every picture off (text-only cards); anything else, or unset, leaves them on. */
  PICTURES?: string;
}

let enabled = true;

/** Applies the PICTURES variable. Called by each room when it starts. */
export function configurePictures(value: string | undefined): void {
  enabled = value?.trim().toLowerCase() !== "off";
}

export function picturesEnabled(): boolean {
  return enabled;
}

type Entry = readonly [imageUrl: string, filePage: string, author: string | null, license: string, free: boolean];

const ENTRIES = data as unknown as Record<string, Entry>;

export const PICTURES: Readonly<Record<string, IdentityPicture>> = Object.fromEntries(
  Object.entries(ENTRIES).map(([id, [imageUrl, filePage, author, license, free]]) => [id, { imageUrl, filePage, author, license, free }]),
);
