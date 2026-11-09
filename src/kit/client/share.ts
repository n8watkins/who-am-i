// Party kit: sharing a result card. The card is uploaded private when the share dialog opens;
// tapping Share or Copy link makes it public in the same tap (so a messenger's link preview,
// which some phones fetch while you pick a contact, already sees it), and cancelling the share
// sheet makes it private again. Stop sharing takes it down at any time.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreatedCard } from "../shared/share-cards";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The Web Share sheet when there is one, else (or if it is refused) a copied link. */
export async function shareLink(data: { url: string; title: string; text: string }, mode: "share" | "copy"): Promise<ShareOutcome> {
  if (mode === "share" && canNativeShare()) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // NotAllowedError and friends: fall back to copying.
    }
  }
  return (await copyText(data.url)) ? "copied" : "failed";
}

export async function setCardVisibility(card: CreatedCard, isPublic: boolean): Promise<void> {
  const res = await fetch(`/api/share/${encodeURIComponent(card.id)}/visibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerKey: card.ownerKey, public: isPublic }),
  });
  if (!res.ok) throw new Error("Could not change who can see the card.");
}

export type ShareCardStatus = "idle" | "preparing" | "ready" | "error";

export interface ShareCardHandle {
  status: ShareCardStatus;
  previewUrl: string | null;
  card: CreatedCard | null;
  isPublic: boolean;
  outcome: ShareOutcome | null;
  /** Paints and uploads the card, private. */
  prepare: () => void;
  /** Call straight from the tap handler: it publishes and opens the share sheet (or copies) together. */
  share: (mode: "share" | "copy") => void;
  stop: () => Promise<void>;
}

/**
 * `paint` draws the card in the browser; `upload` sends it to the game's own authenticated route,
 * which returns the private card. `text` is what the share sheet says next to the link.
 */
export function useShareCard(options: {
  paint: () => Promise<{ blob: Blob; previewUrl: string }>;
  upload: (png: Blob) => Promise<CreatedCard>;
  title: string;
  text: string;
}): ShareCardHandle {
  const [status, setStatus] = useState<ShareCardStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [card, setCard] = useState<CreatedCard | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const prepare = useCallback(() => {
    if (status === "preparing" || status === "ready") return;
    setStatus("preparing");
    setOutcome(null);
    void (async () => {
      try {
        const painted = await optionsRef.current.paint();
        setPreviewUrl(painted.previewUrl);
        setCard(await optionsRef.current.upload(painted.blob));
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
  }, [status]);

  const share = useCallback(
    (mode: "share" | "copy") => {
      if (!card) return;
      // Both start inside the tap, so the share sheet keeps the user gesture it needs.
      const publishing = setCardVisibility(card, true);
      const sharing = shareLink({ url: card.url, title: optionsRef.current.title, text: optionsRef.current.text }, mode);
      void (async () => {
        const result = await sharing;
        const published = await publishing.then(
          () => true,
          () => false,
        );
        if (result === "cancelled" || result === "failed" || !published) {
          if (published) await setCardVisibility(card, false).catch(() => undefined);
          setIsPublic(false);
          setOutcome(published ? result : "failed");
          return;
        }
        setIsPublic(true);
        setOutcome(result);
      })();
    },
    [card],
  );

  const stop = useCallback(async () => {
    if (!card) return;
    await setCardVisibility(card, false);
    setIsPublic(false);
    setOutcome(null);
  }, [card]);

  return { status, previewUrl, card, isPublic, outcome, prepare, share, stop };
}
