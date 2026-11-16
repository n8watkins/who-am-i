// Pictures for identities: one Wikimedia-hosted thumbnail and its credit per identity, keyed by
// identity id. Server-only, like the packs: a picture reaches a phone only inside the view that
// already carries that identity's name (see publicIdentity in ../view.ts).
//
// Nothing here is copied into the site: the phone loads the thumbnail straight from
// upload.wikimedia.org with no referrer. Real people use a free photo or portrait from Wikimedia
// Commons, chosen by hand. Characters use the lead image of their own English Wikipedia article
// (free: false when that image is non-free); character images belong to their owners.
//
// The data is picture-data.ts, one identity per line:
//   "pack.slug": [thumbnail, file page, author or null, licence, free]
// To pull one picture the same day, delete its line there: that identity goes back to the text
// card. To turn every picture off without a code change, set the Worker variable PICTURES to "off"
// (see README, "Pictures").
import type { IdentityPicture } from "../../shared/protocol";
import { PICTURE_DATA } from "./picture-data";

/** Worker variables this module reads. */
export interface PicturesEnv {
  /** "off" turns every picture off (text-only cards); anything else, or unset, leaves them on. */
  PICTURES?: string;
}

/**
 * Reads the PICTURES variable: "off" (any case, any spaces) turns pictures off, anything else
 * leaves them on. Whoever builds a view passes the result to it (viewFor's `pictures`), so there
 * is no module state for one room or runtime to forget to set.
 */
export function picturesOn(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "off";
}

export const PICTURES: Readonly<Record<string, IdentityPicture>> = Object.fromEntries(
  Object.entries(PICTURE_DATA).map(([id, [imageUrl, filePage, author, license, free]]) => [id, { imageUrl, filePage, author, license, free }]),
);
