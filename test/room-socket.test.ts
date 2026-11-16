// What the page puts on the wire when it opens a room socket: the address and the subprotocol
// header are logged by the platform, so neither may carry the session token.
import { describe, expect, it } from "vitest";
import { ClientHelloSchema, WS_CLOSE, WS_PROTOCOL } from "../src/shared/protocol";
import { closeAction, helloFrame, reloadOnce, ROOM_SOCKET_PROTOCOLS, roomSocketUrl, SocketLife } from "../src/client/lib/roomSocket";
import { signSession } from "../src/worker/session";

describe("room socket", () => {
  it("builds an address and headers with no token in them, and puts the token in the hello", async () => {
    const token = await signSession("test-only-secret-not-for-production", { roomId: "room-1", code: "ABCDEF", playerId: "player-1" });
    const url = roomSocketUrl({ protocol: "https:", host: "whoami.example" }, "ABCDEF");
    expect(url).toBe("wss://whoami.example/api/rooms/ABCDEF/ws");
    expect(roomSocketUrl({ protocol: "http:", host: "127.0.0.1:8788" }, "ABCDEF")).toBe("ws://127.0.0.1:8788/api/rooms/ABCDEF/ws");
    expect(ROOM_SOCKET_PROTOCOLS).toEqual([WS_PROTOCOL]);
    const onTheWire = [url, ...ROOM_SOCKET_PROTOCOLS].join("\n");
    for (const piece of [token, ...token.split(".").filter((p) => p.length > 8)]) expect(onTheWire).not.toContain(piece);

    expect(ClientHelloSchema.parse(JSON.parse(helloFrame(token)))).toEqual({ type: "hello", token });
  });

  it("reloads once for an out-of-date page, and not again within a minute", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let reloads = 0;
    const reload = () => void reloads++;
    expect(reloadOnce(storage, reload, 1_000_000)).toBe(true);
    expect(reloadOnce(storage, reload, 1_030_000)).toBe(false);
    expect(reloads).toBe(1);
    expect(reloadOnce(storage, reload, 1_000_000 + 61_000)).toBe(true);
    expect(reloads).toBe(2);
  });

  it("ends the page on each fatal close code, reloads on 4004, and reconnects on anything else", () => {
    expect(closeAction(WS_CLOSE.roomClosed)).toEqual({ type: "end", reason: "expired" });
    expect(closeAction(WS_CLOSE.leftRoom)).toEqual({ type: "end", reason: "left" });
    expect(closeAction(WS_CLOSE.removed)).toEqual({ type: "end", reason: "removed" });
    expect(closeAction(WS_CLOSE.reload)).toEqual({ type: "reload" });
    for (const code of [WS_CLOSE.unauthorized, WS_CLOSE.helloTimeout, 1000, 1001, 1006, 1011]) expect(closeAction(code)).toEqual({ type: "reconnect" });
  });

  it("never connects again once the page has ended, not even when the tab comes back", () => {
    for (const code of [WS_CLOSE.roomClosed, WS_CLOSE.leftRoom, WS_CLOSE.removed, WS_CLOSE.reload]) {
      const life = new SocketLife();
      expect(life.mayConnect()).toBe(true);
      expect(life.onClose(code).type).not.toBe("reconnect");
      expect(life.mayConnect()).toBe(false);
      expect(life.onVisible(true, true)).toBe(false);
      // A late close of an older socket does not bring it back either.
      expect(life.onClose(1006)).toEqual({ type: "ignore" });
    }
    // An end decided elsewhere (an HTTP 401, say) counts the same.
    const life = new SocketLife();
    life.end();
    expect(life.mayConnect()).toBe(false);
    expect(life.onVisible(true, true)).toBe(false);
  });

  it("reconnects when the tab comes back only while it is visible and the socket is closed", () => {
    const life = new SocketLife();
    expect(life.onVisible(true, true)).toBe(true);
    expect(life.onVisible(false, true)).toBe(false);
    expect(life.onVisible(true, false)).toBe(false);
  });

  it("backs off until the room has welcomed a socket, so one that opens and drops cannot spin", () => {
    const life = new SocketLife();
    const delays = Array.from({ length: 7 }, () => {
      expect(life.onClose(1006)).toEqual({ type: "reconnect" });
      return life.nextDelay();
    });
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    // Opening is not enough: only the room's first view starts the backoff over.
    life.welcomed();
    expect(life.nextDelay()).toBe(500);
    // At most about ten tries in a minute for a socket that opens and is dropped every time.
    const flapping = new SocketLife();
    let elapsed = 0;
    let tries = 0;
    while (elapsed < 60_000) {
      elapsed += flapping.nextDelay();
      tries++;
    }
    expect(tries).toBeLessThanOrEqual(12);
  });

  it("never reloads when there is nowhere to remember it, so it cannot loop", () => {
    let reloads = 0;
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(reloadOnce(blocked, () => void reloads++)).toBe(false);
    expect(reloadOnce(null, () => void reloads++)).toBe(false);
    expect(reloads).toBe(0);
  });
});
