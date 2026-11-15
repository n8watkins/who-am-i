// The page says which client it is when it creates or joins a game, so the Worker can turn away
// pages from before the socket change (they would put a fresh token in a logged header).
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_VERSION, CLIENT_VERSION_HEADER, DEFAULT_SETTINGS } from "../src/shared/protocol";
import { api } from "../src/client/lib/api";

describe("client API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks create and join with the client version", async () => {
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return Response.json({ ok: true, token: "t", playerId: "p", view: {} });
    });
    await api.createRoom({ nickname: "Alice", settings: DEFAULT_SETTINGS });
    await api.join("ABCDEF", "Bob");
    expect(seen.map((h) => h.get(CLIENT_VERSION_HEADER))).toEqual([CLIENT_VERSION, CLIENT_VERSION]);
  });
});
