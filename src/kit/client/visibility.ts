// Party kit: tells the room server when this page is hidden or visible again, so other players
// see "away" instead of a silent stall. Game-agnostic: the caller supplies how to send.
import { PRESENCE_AWAY, PRESENCE_BACK, type PresenceSignal } from "../shared/presence";

export function visibilitySignal(doc: Document = document): PresenceSignal {
  return doc.visibilityState === "hidden" ? PRESENCE_AWAY : PRESENCE_BACK;
}

/**
 * Calls `send` with "away" or "back" whenever the page's visibility changes, and on `pagehide`
 * (some phones skip visibilitychange when the browser is closed). Returns an unsubscribe function.
 */
export function watchVisibility(send: (signal: PresenceSignal) => void, doc: Document = document): () => void {
  let last: PresenceSignal | null = null;
  const report = (signal: PresenceSignal) => {
    if (signal === last) return;
    last = signal;
    send(signal);
  };
  const onChange = () => report(visibilitySignal(doc));
  const onHide = () => report(PRESENCE_AWAY);
  doc.addEventListener("visibilitychange", onChange);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onChange);
  return () => {
    doc.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("pageshow", onChange);
  };
}
