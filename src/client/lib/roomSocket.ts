// How the page opens its room socket. The address and the subprotocol header are logged by the
// platform, so neither may carry the session token: the token is the socket's first message.
import { WS_PROTOCOL, type ClientHello } from "../../shared/protocol";

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
