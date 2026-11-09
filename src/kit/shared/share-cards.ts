// Party kit: shareable result cards. A game paints a 1200x630 PNG in the browser (so every
// nickname, accent and emoji renders with the phone's own fonts), uploads it privately, and it
// becomes public only while the player shares it. Its title and description come from the server.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const CARD_MAX_BYTES = 400_000;
export const CARD_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Public pages live at /s/:id; ids are 22 base64url characters (128 random bits). */
export const SHARE_PATH_PREFIX = "/s/";
export const CARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export interface CreatedCard {
  ok: true;
  id: string;
  /** Proves ownership to publish, unpublish or preview the card. Kept only in the sharer's page. */
  ownerKey: string;
  /** The public page that link previews read. */
  url: string;
}

export interface PublicCard {
  ok: true;
  id: string;
  title: string;
  description: string;
  imageUrl: string;
}

export interface CardVisibilityRequest {
  ownerKey: string;
  public: boolean;
}

export const cardImagePath = (id: string) => `/api/share/${id}/image.png`;
