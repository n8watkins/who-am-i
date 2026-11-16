// Pictures of identities. A picture only ever arrives inside an identity the server already lets
// this phone see (the opponent's during a round, both in the round summary), so these components
// never fetch anything on their own: they render what the view carries, or nothing.
import { useState } from "react";
import { PICTURE_HOST, type IdentityPicture, type PublicIdentity } from "../../shared/protocol";

/** The picture to show, or null: absent, from an unexpected host, or failed to load. */
export function usablePicture(identity: PublicIdentity | null | undefined, failed: string | null): IdentityPicture | null {
  const picture = identity?.picture;
  if (!picture) return null;
  if (!picture.imageUrl.startsWith(`https://${PICTURE_HOST}/`)) return null;
  return picture.imageUrl === failed ? null : picture;
}

/** Tracks the one picture address that failed to load, so the card falls back to text for it. */
export function usePictureFallback(): [failed: string | null, onError: (url: string) => void] {
  const [failed, setFailed] = useState<string | null>(null);
  return [failed, setFailed];
}

/**
 * The thumbnail itself. No referrer and no credentials go with the request, and the address is
 * Wikimedia's file address, so nothing in it says which room or player is looking.
 */
export function PictureImage({
  picture,
  name,
  className = "",
  onError,
}: {
  picture: IdentityPicture;
  name: string;
  className?: string;
  onError: (url: string) => void;
}) {
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  return (
    <img
      src={picture.imageUrl}
      alt={`Picture of ${name}`}
      referrerPolicy="no-referrer"
      decoding="async"
      loading="eager"
      draggable={false}
      onError={() => onError(picture.imageUrl)}
      onLoad={(event) => setFit(fitFor(event.currentTarget))}
      className={`block bg-paper ${fit === "cover" ? "object-cover object-top" : "object-contain"} ${className}`}
      data-testid="identity-picture"
    />
  );
}

/**
 * Portrait pictures close to the frame's 4:5 fill it (a little is trimmed off the bottom). Anything
 * wider or much taller is shown whole: character art is often two designs side by side, and a crop
 * could cut the subject out. The paper background fills the rest of the frame.
 */
function fitFor(img: HTMLImageElement): "contain" | "cover" {
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  return ratio >= 0.62 && ratio <= 0.9 ? "cover" : "contain";
}

/** "Picture: Author · CC BY-SA 4.0" (or "Image: © its owner, via Wikipedia"), opening the file's page in a new tab. */
export function PictureCredit({ picture, className = "" }: { picture: IdentityPicture; className?: string }) {
  const label = picture.free ? [picture.author, picture.license].filter(Boolean).join(" · ") : "© its owner, via Wikipedia";
  return (
    <a
      href={picture.filePage}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className={`inline-block max-w-full text-xs font-semibold [overflow-wrap:anywhere] text-muted underline decoration-line underline-offset-2 hover:text-brand-ink ${className}`}
      data-testid="picture-credit"
    >
      {picture.free ? "Picture: " : "Image: "}
      {label}
    </a>
  );
}
