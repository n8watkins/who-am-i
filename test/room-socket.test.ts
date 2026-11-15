// What the page puts on the wire when it opens a room socket: the address and the subprotocol
// header are logged by the platform, so neither may carry the session token.
import { describe, expect, it } from "vitest";
import { ClientHelloSchema, WS_PROTOCOL } from "../src/shared/protocol";
import { helloFrame, reloadOnce, ROOM_SOCKET_PROTOCOLS, roomSocketUrl } from "../src/client/lib/roomSocket";
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
