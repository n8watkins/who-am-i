// Party kit: presence beyond "connected". A player whose phone locked, or who switched to another
// app, still has a live socket for a while but is not looking at the game. Clients report that
// with two plain socket messages, and every game treats an away player like a briefly absent one.

/** Socket message a client sends when its page is hidden (phone locked, another app or tab). */
export const PRESENCE_AWAY = "away";
/** Socket message a client sends when its page is visible again. */
export const PRESENCE_BACK = "back";
export type PresenceSignal = typeof PRESENCE_AWAY | typeof PRESENCE_BACK;

export function isPresenceSignal(message: unknown): message is PresenceSignal {
  return message === PRESENCE_AWAY || message === PRESENCE_BACK;
}

export interface PresenceFields {
  connected: boolean;
  /** When the last connection closed, while disconnected. */
  disconnectedAt: number | null;
  /** Connected, but the page is hidden. */
  away?: boolean;
  /** When the player went away, while away. */
  awaySince?: number | null;
}

export type Presence = "here" | "away" | "offline";

export function presenceOf(p: PresenceFields): Presence {
  if (!p.connected) return "offline";
  return p.away ? "away" : "here";
}

/** Since when the player has been unable to act (offline or away), or null while they are here. */
export function absentSince(p: PresenceFields): number | null {
  if (!p.connected) return p.disconnectedAt;
  return p.away ? (p.awaySince ?? null) : null;
}

/** A player with several sockets (two tabs) is away only when every open one is hidden. */
export function allAway(sockets: readonly { away: boolean }[]): boolean {
  return sockets.length > 0 && sockets.every((s) => s.away);
}
