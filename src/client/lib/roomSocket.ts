// How the page opens its room socket. The address and the subprotocol header are logged by the
// platform, so neither may carry the session token: the token is the socket's first message.
import { WS_CLOSE, WS_PROTOCOL, type ClientHello } from "../../shared/protocol";

/** Why the room is over for this page. */
export type FatalReason = "expired" | "unauthorized" | "left" | "removed" | "outdated";

export type CloseAction = { type: "end"; reason: FatalReason } | { type: "reload" } | { type: "reconnect" };

/** What a socket close with this code means for the page. */
export function closeAction(code: number): CloseAction {
  if (code === WS_CLOSE.roomClosed) return { type: "end", reason: "expired" };
  if (code === WS_CLOSE.leftRoom) return { type: "end", reason: "left" };
  if (code === WS_CLOSE.removed) return { type: "end", reason: "removed" };
  // The room no longer speaks this page's handshake: load the new page, once.
  if (code === WS_CLOSE.reload) return { type: "reload" };
  // Anything else, including a refused token (WS_CLOSE.unauthorized), reconnects after the
  // session is checked over HTTP, which ends a seat that is really gone.
  return { type: "reconnect" };
}

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 8_000;

/**
 * The page's side of its room connection: whether it may still connect, and how long to wait
 * before the next try. Once the room is over for the page (a fatal close, or a fatal answer
 * over HTTP) it never connects again, not even when the tab comes back into view.
 */
export class SocketLife {
  private ended = false;
  private retry = 0;

  mayConnect(): boolean {
    return !this.ended;
  }

  /** The room is over for this page. */
  end(): void {
    this.ended = true;
  }

  /**
   * The room sent this socket its first view. Only this starts the backoff over: a socket that
   * opens and is dropped before the room welcomes it keeps backing off.
   */
  welcomed(): void {
    this.retry = 0;
  }

  /** The wait before the next try: 0.5 s doubling to 8 s. */
  nextDelay(): number {
    const delay = Math.min(FIRST_RETRY_MS * 2 ** this.retry, MAX_RETRY_MS);
    this.retry += 1;
    return delay;
  }

  /** A close of the current socket. "ignore" once the page has ended. */
  onClose(code: number): CloseAction | { type: "ignore" } {
    if (this.ended) return { type: "ignore" };
    const action = closeAction(code);
    if (action.type !== "reconnect") this.end();
    return action;
  }

  /** The tab came back: true when the page should connect now (and start its backoff over). */
  onVisible(visible: boolean, socketClosed: boolean): boolean {
    if (this.ended || !visible || !socketClosed) return false;
    this.retry = 0;
    return true;
  }
}

/** The socket address for a room. It names the room, never the player. */
export function roomSocketUrl(page: { protocol: string; host: string }, code: string): string {
  const scheme = page.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${page.host}/api/rooms/${encodeURIComponent(code)}/ws`;
}

/** The subprotocols the page offers: the handshake's name only. */
export const ROOM_SOCKET_PROTOCOLS: readonly string[] = [WS_PROTOCOL];

/** The first frame on a new socket, which tells the room whose seat it is. */
export function helloFrame(token: string): string {
  return JSON.stringify({ type: "hello", token } satisfies ClientHello);
}

const RELOAD_KEY = "whoami:reloaded-for-socket";
/** A second "reload" close this soon after the first means reloading did not help. */
const RELOAD_GUARD_MS = 60_000;

/**
 * Called when the room closes the socket because this page speaks an older handshake.
 * Reloads at most once a minute and returns false when it did not, so a page never loops;
 * the caller then shows the out-of-date screen.
 */
export interface ReloadMemory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function reloadOnce(storage: ReloadMemory | null, reload: () => void, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    // Storage is blocked, so nothing would stop a loop: leave the reload to the person.
    return false;
  }
  reload();
  return true;
}
