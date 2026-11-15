import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import pkg from "../package.json";
import {
  CLIENT_VERSION,
  CLIENT_VERSION_HEADER,
  DEFAULT_SETTINGS,
  LEGACY_WS_PROTOCOL,
  LEGACY_WS_TOKEN_PREFIX,
  WS_CLOSE,
  WS_PROTOCOL,
  type ApiError,
  type CommandResponse,
  type JoinLookupResponse,
  type RoomView,
  type ServerMessage,
  type SessionResponse,
  type Settings,
  type ViewResponse,
} from "../src/shared/protocol";
import type { RoomState } from "../src/worker/engine";
import { HELLO_TIMEOUT_MS, MAX_SILENT_PER_CLIENT, MAX_SILENT_SOCKETS, type RoomDurableObject } from "../src/worker/room";
import { helloFrame } from "../src/client/lib/roomSocket";
import { PIN_DIRECTORY_NAME, PIN_TTL_MS, type PinDirectoryDurableObject } from "../src/worker/pin-directory";
import { RATE_LIMITS } from "../src/worker/rate-limiter";
import { signSession } from "../src/worker/session";

const BASE = "http://who-am-i.test";
let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

async function api<T>(path: string, init: RequestInit & { token?: string; ip?: string } = {}): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("CF-Connecting-IP", init.ip ?? freshIp());
  // Sent by current pages on create and join; tests of old pages remove it.
  if (!headers.has(CLIENT_VERSION_HEADER)) headers.set(CLIENT_VERSION_HEADER, CLIENT_VERSION);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const res = await SELF.fetch(`${BASE}${path}`, { ...init, headers });
  return { status: res.status, body: (await res.json()) as T };
}

async function createRoom(settings: Partial<Settings> = {}) {
  const res = await api<SessionResponse>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ nickname: "Alice", settings: { ...DEFAULT_SETTINGS, firstPlayer: "host", turnFormat: "keep_going", ...settings } }),
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function joinRoom(code: string, nickname = "Bob") {
  return api<SessionResponse>(`/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ nickname }) });
}

let commandCounter = 0;
async function send(code: string, token: string, view: RoomView, type: string, extra: object = {}) {
  return api<CommandResponse>(`/api/rooms/${code}/commands`, {
    method: "POST",
    token,
    body: JSON.stringify({ type, commandId: `test-command-${++commandCounter}`, expectedVersion: view.version, ...extra }),
  });
}

async function startedRoom(settings: Partial<Settings> = {}) {
  const host = await createRoom(settings);
  const code = host.view.code;
  const guest = (await joinRoom(code)).body;
  let v = (await send(code, host.token, guest.view, "player.ready", { ready: true })).body.view;
  v = (await send(code, guest.token, v, "player.ready", { ready: true })).body.view;
  const started = (await send(code, host.token, v, "match.start")).body.view;
  return { code, host, guest, view: started };
}

/** Asks for a room socket the way the page does: no token in the address or the headers. */
function upgrade(code: string, protocols: string = WS_PROTOCOL, ip = freshIp()) {
  return SELF.fetch(`${BASE}/api/rooms/${code}/ws`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": protocols, "CF-Connecting-IP": ip },
  });
}

/** A socket that has not said who it is yet: it records every frame and its close code. */
async function rawSocket(code: string, protocols: string = WS_PROTOCOL, ip = freshIp()) {
  const res = await upgrade(code, protocols, ip);
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const frames: string[] = [];
  const waiters: (() => void)[] = [];
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  ws.addEventListener("message", (event) => {
    frames.push(event.data as string);
    waiters.splice(0).forEach((w) => w());
  });
  ws.accept();
  return { ws, frames, waiters, closed, protocol: res.headers.get("Sec-WebSocket-Protocol") };
}

/** Resolves with the close code, or null if the socket is still open after `ms`. */
const closeWithin = (closed: Promise<number>, ms = 1_000) =>
  Promise.race([closed, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openSocket(code: string, token: string) {
  const { ws, frames, waiters, protocol } = await rawSocket(code);
  expect(protocol).toBe(WS_PROTOCOL);
  ws.send(helloFrame(token));
  const next = async (predicate: (view: RoomView) => boolean): Promise<RoomView> => {
    for (let i = 0; i < 50; i++) {
      const match = frames
        .map((f) => JSON.parse(f) as ServerMessage)
        .find((m) => m.type === "state" && predicate(m.view));
      if (match && match.type === "state") return match.view;
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    throw new Error("timed out waiting for a matching frame");
  };
  return { ws, frames, next };
}

function roomStub(code: string): DurableObjectStub<RoomDurableObject> {
  return env.ROOMS.getByName(code);
}

describe("HTTP API", () => {
  it("creates a room with a 6 character code and a session token", async () => {
    const host = await createRoom();
    expect(host.view.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(host.token.split(".")).toHaveLength(3);
    expect(host.view.players).toHaveLength(1);
  });

  it("tells a page from before the socket change to reload instead of creating or joining", async () => {
    const oldPage = new Headers({ [CLIENT_VERSION_HEADER]: "" });
    const created = await api<ApiError>("/api/rooms", {
      method: "POST",
      headers: oldPage,
      body: JSON.stringify({ nickname: "Old", settings: DEFAULT_SETTINGS }),
    });
    expect(created.status).toBe(426);
    expect(created.body).toEqual({ ok: false, error: "outdated", message: "This page is out of date. Reload it and try again." });

    const host = await createRoom();
    const joined = await api<ApiError>(`/api/rooms/${host.view.code}/join`, { method: "POST", headers: oldPage, body: JSON.stringify({ nickname: "Old" }) });
    expect(joined.status).toBe(426);
    expect(joined.body.error).toBe("outdated");
    // No seat was taken: the room still has one player and a current page can still join.
    expect((await latestView(host.view.code, host.token)).players).toHaveLength(1);
    expect((await joinRoom(host.view.code)).status).toBe(200);
  });

  it("validates input with Zod", async () => {
    const res = await api<{ error: string }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ nickname: "", settings: DEFAULT_SETTINGS }),
    });
    expect(res.status).toBe(400);
    const bad = await api<{ error: string }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ nickname: "x", settings: { ...DEFAULT_SETTINGS, timerSeconds: 45 } }),
    });
    expect(bad.status).toBe(400);
  });

  it("shows a public preview without identities or player ids", async () => {
    const host = await createRoom({ packId: "actors" });
    const res = await api<{ preview: { hostNickname: string; full: boolean } }>(`/api/rooms/${host.view.code}`);
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({ hostNickname: "Alice", full: false });
    expect(JSON.stringify(res.body)).not.toContain(host.playerId);
  });

  it("caps rooms at two players", async () => {
    const host = await createRoom();
    expect((await joinRoom(host.view.code)).status).toBe(200);
    const third = await joinRoom(host.view.code, "Eve");
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ ok: false, error: "room_full" });
  });

  it("rejects missing, tampered and cross-room tokens", async () => {
    const one = await createRoom();
    const two = await createRoom();
    expect((await api(`/api/rooms/${one.view.code}/state`)).status).toBe(401);
    const tampered = one.token.slice(0, -2) + (one.token.endsWith("A") ? "BB" : "AA");
    expect((await api(`/api/rooms/${one.view.code}/state`, { token: tampered })).status).toBe(401);
    expect((await api(`/api/rooms/${one.view.code}/state`, { token: two.token })).status).toBe(401);
    // A token signed with a different secret is rejected.
    const forged = await signSession("a-completely-different-secret", {
      roomId: "x",
      code: one.view.code,
      playerId: one.playerId,
    });
    expect((await api(`/api/rooms/${one.view.code}/state`, { token: forged })).status).toBe(401);
    expect((await api(`/api/rooms/${one.view.code}/state`, { token: one.token })).status).toBe(200);
  });

  it("restores the same seat from the stored token after a refresh", async () => {
    const { code, guest } = await startedRoom();
    const res = await api<{ view: RoomView }>(`/api/rooms/${code}/state`, { token: guest.token });
    const me = res.body.view.players.find((p) => p.playerId === res.body.view.youId)!;
    expect(me.seat).toBe("B");
    expect(me.nickname).toBe("Bob");
  });

  it("rejects stale versions with 409 and returns the canonical state", async () => {
    const { code, host, guest, view } = await startedRoom();
    const requested = (await send(code, host.token, view, "turn.correct.request")).body.view;
    const confirm = await send(code, guest.token, requested, "turn.correct.confirm");
    expect(confirm.status).toBe(200);
    const again = await send(code, guest.token, requested, "turn.correct.confirm");
    expect(again.status).toBe(409);
    const body = again.body as unknown as { error: string; view: RoomView };
    expect(body.error).toBe("version_conflict");
    expect(body.view.players.find((p) => p.seat === "A")!.score).toBe(1);
  });

  it("answers a retried command id without applying it twice", async () => {
    const { code, host, guest, view } = await startedRoom();
    const requested = (await send(code, host.token, view, "turn.correct.request")).body.view;
    const body = JSON.stringify({ type: "turn.correct.confirm", commandId: "retry-me-please", expectedVersion: requested.version });
    const first = await api<CommandResponse>(`/api/rooms/${code}/commands`, { method: "POST", token: guest.token, body });
    const second = await api<CommandResponse>(`/api/rooms/${code}/commands`, { method: "POST", token: guest.token, body });
    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.view.players.find((p) => p.seat === "A")!.score).toBe(1);
  });

  it("rate-limits join attempts per client", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await api(`/api/rooms/ZZZZZZ/join`, { method: "POST", ip, body: JSON.stringify({ nickname: "x" }) });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("returns 404 for invalid codes and unknown rooms", async () => {
    expect((await api("/api/rooms/abc")).status).toBe(404);
    expect((await api("/api/rooms/ZZZZZY")).status).toBe(404);
  });
});

describe("version", () => {
  it("reports the package version and a dev commit for local builds", async () => {
    const res = await SELF.fetch(`${BASE}/api/version`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, name: "who-am-i", version: pkg.version, commit: "dev" });
  });
});

describe("WebSockets", () => {
  it("sends each socket only its own player's filtered view", async () => {
    const { code, host, guest } = await startedRoom({ packId: "actors" });
    const a = await openSocket(code, host.token);
    const b = await openSocket(code, guest.token);
    const viewA = await a.next((v) => v.players.every((p) => p.connected));
    const viewB = await b.next((v) => v.players.every((p) => p.connected));

    const stub = roomStub(code);
    const assignments = await runInDurableObject(stub, async (instance) => {
      return (instance as unknown as { room: RoomState }).room.round!.assignments;
    });
    const ownA = assignments[host.playerId]!;
    const ownB = assignments[guest.playerId]!;
    expect(viewA.opponentIdentity?.id).toBe(ownB);
    expect(viewB.opponentIdentity?.id).toBe(ownA);
    for (const frame of a.frames) expect(frame).not.toContain(ownA);
    for (const frame of b.frames) expect(frame).not.toContain(ownB);

    // Play A's turn and B's skip; the summary reveals both.
    let v = (await send(code, host.token, viewA, "turn.correct.request")).body.view;
    v = (await send(code, guest.token, v, "turn.correct.confirm")).body.view;
    await send(code, guest.token, v, "turn.skip");
    const summaryA = await a.next((view) => view.status === "round_summary");
    expect(summaryA.roundSummary!.entries.map((e) => e.identity.id).sort()).toEqual([ownA, ownB].sort());
    const beforeReveal = a.frames.filter((f) => !f.includes('"round_summary"'));
    for (const frame of beforeReveal) expect(frame).not.toContain(ownA);
    a.ws.close();
    b.ws.close();
  });

  it("marks a player disconnected when their socket closes", async () => {
    const { code, host, guest } = await startedRoom();
    const a = await openSocket(code, host.token);
    const b = await openSocket(code, guest.token);
    await a.next((v) => v.players.every((p) => p.connected));
    b.ws.close(1000, "bye");
    const view = await a.next((v) => v.players.some((p) => p.seat === "B" && !p.connected));
    expect(view.players.find((p) => p.seat === "B")!.disconnectedAt).not.toBeNull();
    a.ws.close();
  });

  it("shows a player as away while their page is hidden, until every tab is back", async () => {
    const { code, host, guest } = await startedRoom();
    const a = await openSocket(code, host.token);
    const b1 = await openSocket(code, guest.token);
    await a.next((v) => v.players.every((p) => p.connected));
    const guestOf = (v: RoomView) => v.players.find((p) => p.seat === "B")!;

    b1.ws.send("away");
    const away = await a.next((v) => guestOf(v).away);
    expect(guestOf(away).awaySince).not.toBeNull();

    // A second, visible tab means the player is here; closing it leaves only the hidden one.
    const b2 = await openSocket(code, guest.token);
    await a.next((v) => v.version > away.version && !guestOf(v).away);
    b2.ws.close(1000, "bye");
    const awayAgain = await a.next((v) => v.version > away.version + 1 && guestOf(v).away);
    expect(guestOf(awayAgain).connected).toBe(true);

    b1.ws.send("back");
    await a.next((v) => v.version > awayAgain.version && !guestOf(v).away);
    // Anything else on the socket is ignored.
    b1.ws.send("hello");
    a.ws.close();
    b1.ws.close();
  });

});

/** The room as stored, read from inside its Durable Object. */
const storedRoom = (code: string) =>
  runInDurableObject(roomStub(code), async (instance) => structuredClone((instance as unknown as { room: RoomState | null }).room));

const playerIn = async (code: string, playerId: string) => (await storedRoom(code))!.players.find((p) => p.id === playerId)!;

/** What each open socket in the room has recorded about who it belongs to. */
const attachments = (code: string) =>
  runInDurableObject(roomStub(code), async (_instance, state) => state.getWebSockets().map((ws) => ws.deserializeAttachment() as { playerId: string | null }));

describe("WebSocket handshake (the token is the first message, never the address or a header)", () => {
  it("sends a socket nothing about the room until its hello says whose seat it is", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const socket = await rawSocket(code);
    expect(socket.protocol).toBe(WS_PROTOCOL);
    expect(await attachments(code)).toEqual([expect.objectContaining({ playerId: null })]);

    // The room changes twice (a join, a ready) while the socket is silent: it hears none of it.
    const guest = (await joinRoom(code)).body;
    await send(code, guest.token, guest.view, "player.ready", { ready: true });
    await pause(200);
    expect(socket.frames).toEqual([]);
    expect((await playerIn(code, host.playerId)).connected).toBe(false);

    socket.ws.send(helloFrame(host.token));
    await expect.poll(() => socket.frames.length).toBeGreaterThan(0);
    const first = JSON.parse(socket.frames[0]!) as ServerMessage;
    expect(first.type === "state" && first.view.youId).toBe(host.playerId);
    expect((await playerIn(code, host.playerId)).connected).toBe(true);
    expect(await attachments(code)).toEqual([expect.objectContaining({ playerId: host.playerId })]);
    socket.ws.close();
  });

  it("closes a socket whose first message is anything but a hello, without acting on it", async () => {
    const { code, host } = await startedRoom();
    const before = await storedRoom(code);
    for (const first of ["sync", "away", "back", "hello", '{"type":"hello"}', JSON.stringify({ type: "hello", token: host.token, extra: 1 }), "{"]) {
      const socket = await rawSocket(code);
      socket.ws.send(first);
      expect(await closeWithin(socket.closed), `first message ${first}`).toBe(WS_CLOSE.reload);
      expect(socket.frames, `first message ${first}`).toEqual([]);
    }
    const after = await storedRoom(code);
    expect(after!.version).toBe(before!.version);
    expect(after!.players.map((p) => [p.connected, p.away ?? false])).toEqual(before!.players.map((p) => [p.connected, p.away ?? false]));
  });

  it("closes a socket whose hello carries a wrong token, without a word", async () => {
    const { code, host } = await startedRoom();
    const other = await createRoom();
    const before = await storedRoom(code);
    const roomId = before!.roomId;
    const [payload, signature] = host.token.split(".").slice(1);
    const wrong = [
      "nope",
      `v1.${payload}.${signature!.slice(0, -2)}AA`, // tampered signature
      other.token, // a real seat in another room
      await signSession("test-only-secret-not-for-production", { roomId: "an-older-room", code, playerId: host.playerId }), // an earlier room with this code
      await signSession("test-only-secret-not-for-production", { roomId, code, playerId: "nobody" }), // no such seat
      await signSession("test-only-secret-not-for-production", { roomId, code, playerId: host.playerId }, Date.now() - 2 * 24 * 60 * 60 * 1000), // expired
      await signSession("a-different-secret-entirely", { roomId, code, playerId: host.playerId }),
    ];
    for (const token of wrong) {
      const socket = await rawSocket(code);
      socket.ws.send(helloFrame(token));
      expect(await closeWithin(socket.closed)).toBe(WS_CLOSE.unauthorized);
      expect(socket.frames).toEqual([]);
    }
    expect((await storedRoom(code))!.version).toBe(before!.version);
  });

  it("tells a removed player's late hello that they were removed, and nothing else", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const guest = (await joinRoom(code)).body;
    await send(code, host.token, await latestView(code, host.token), "player.remove", { playerId: guest.playerId });
    const socket = await rawSocket(code);
    socket.ws.send(helloFrame(guest.token));
    expect(await closeWithin(socket.closed)).toBe(WS_CLOSE.removed);
    expect(socket.frames).toEqual([]);
  });

  it("ignores a second hello, and handles a signal sent right behind the hello in order", async () => {
    const { code, host, guest } = await startedRoom();
    const a = await openSocket(code, host.token);
    await a.next((v) => v.players.find((p) => p.seat === "A")!.connected);
    const b = await rawSocket(code);
    // A hidden page sends its hello and "away" back to back.
    b.ws.send(helloFrame(guest.token));
    b.ws.send("away");
    const guestAway = await a.next((v) => v.players.find((p) => p.seat === "B")!.connected && !!v.players.find((p) => p.seat === "B")!.away);
    expect(guestAway).toBeTruthy();
    b.ws.send(helloFrame(host.token));
    expect(await closeWithin(b.closed, 300)).toBeNull();
    expect((await attachments(code)).map((x) => x.playerId).sort()).toEqual([host.playerId, guest.playerId].sort());
    a.ws.close();
    b.ws.close();
  });

  it("handles a signal sent right behind the hello after it, even when the token check is slow", async () => {
    const { code, host, guest } = await startedRoom();
    const a = await openSocket(code, host.token);
    await a.next((v) => v.players.find((p) => p.seat === "A")!.connected);
    // Make the token check really yield, so the "away" arrives while it is still running.
    await runInDurableObject(roomStub(code), async (instance) => {
      const self = instance as unknown as { verifyToken: (token: string) => Promise<unknown> };
      const verify = self.verifyToken.bind(instance);
      self.verifyToken = async (token) => {
        await pause(150);
        return verify(token);
      };
    });
    const b = await rawSocket(code);
    b.ws.send(helloFrame(guest.token));
    b.ws.send("away");
    const guestOf = (v: RoomView) => v.players.find((p) => p.seat === "B")!;
    await a.next((v) => guestOf(v).connected && !!guestOf(v).away);
    expect(await closeWithin(b.closed, 100)).toBeNull();
    a.ws.close();
    b.ws.close();
  });

  it("keeps handling socket events while the PIN directory is slow", async () => {
    const host = await createRoom();
    const code = host.view.code;
    // The room has lost its PIN, so the host arriving asks the directory for a new one, which hangs.
    const stub = roomStub(code);
    let directoryCalls = 0;
    await runInDurableObject(stub, async (instance, state) => {
      const self = instance as unknown as { room: RoomState; pinDirectory: () => unknown };
      self.room = { ...self.room, pin: null };
      await state.storage.put("room", self.room);
      const slow = () => {
        directoryCalls++;
        return new Promise((resolve) => setTimeout(() => resolve(null), 5_000));
      };
      self.pinDirectory = () => ({ issue: slow, refresh: slow, release: slow });
    });
    const socket = await rawSocket(code);
    socket.ws.send(helloFrame(host.token));
    await expect.poll(() => socket.frames.length).toBeGreaterThan(0);
    await expect.poll(() => directoryCalls).toBeGreaterThan(0);
    // The directory has not answered; the page's next signals are handled anyway.
    const started = Date.now();
    socket.ws.send("away");
    await expect.poll(async () => (await playerIn(code, host.playerId)).away, { timeout: 2_000 }).toBe(true);
    socket.ws.send("sync");
    const framesBefore = socket.frames.length;
    await expect.poll(() => socket.frames.length, { timeout: 2_000 }).toBeGreaterThan(framesBefore);
    expect(Date.now() - started).toBeLessThan(2_000);
    socket.ws.close();
  });

  it("keeps handling socket events when a turn runs out at the hello while the PIN directory is slow", async () => {
    const { code, host } = await startedRoom({ timerSeconds: 60 });
    const stub = roomStub(code);
    // A due turn deadline, and a stale PIN, so applying the timeout makes the directory work.
    await runInDurableObject(stub, async (instance, state) => {
      const self = instance as unknown as { room: RoomState; pinDirectory: () => unknown };
      const room = structuredClone(self.room);
      for (const p of room.players) p.connected = true;
      room.turn!.deadline = Date.now() - 1;
      room.turn!.pausedRemainingMs = null;
      room.pin = { value: "1234", expiresAt: Date.now() + PIN_TTL_MS };
      await state.storage.put("room", room);
      self.room = room;
      const slow = () => new Promise((resolve) => setTimeout(() => resolve(null), 5_000));
      self.pinDirectory = () => ({ issue: slow, refresh: slow, release: slow });
    });
    const socket = await rawSocket(code);
    socket.ws.send(helloFrame(host.token));
    socket.ws.send("away");
    await expect.poll(async () => (await playerIn(code, host.playerId)).away, { timeout: 2_000 }).toBe(true);
    expect((await storedRoom(code))!.status).toBe("guessing_second");
    socket.ws.close();
  });

  it("marks a player gone when their socket closes while its hello is being stored", async () => {
    const host = await createRoom();
    const code = host.view.code;
    // Storing the hello's presence change takes a while, and the socket closes meanwhile.
    await runInDurableObject(roomStub(code), async (instance) => {
      const self = instance as unknown as { store: (...args: unknown[]) => Promise<void> };
      const store = self.store.bind(instance);
      let first = true;
      self.store = async (...args) => {
        if (first) {
          first = false;
          await pause(300);
        }
        return store(...args);
      };
    });
    const socket = await rawSocket(code);
    socket.ws.send(helloFrame(host.token));
    await pause(100);
    socket.ws.close();
    await pause(500);
    await expect.poll(async () => (await playerIn(code, host.playerId)).connected).toBe(false);
  });

  it("wakes up correct when the room sleeps between the open and the hello", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const socket = await rawSocket(code);
    await evictDurableObject(roomStub(code)); // hibernates the socket and drops the room from memory

    // Still nobody's: a change after the wake reaches it not at all.
    const guest = (await joinRoom(code)).body;
    await pause(100);
    expect(socket.frames).toEqual([]);
    expect(await attachments(code)).toEqual([expect.objectContaining({ playerId: null })]);

    await evictDurableObject(roomStub(code));
    socket.ws.send(helloFrame(host.token));
    await expect.poll(() => socket.frames.length).toBeGreaterThan(0);
    const view = (JSON.parse(socket.frames[0]!) as Extract<ServerMessage, { type: "state" }>).view;
    expect(view.youId).toBe(host.playerId);
    expect(view.players.map((p) => p.nickname)).toEqual(["Alice", guest.view.players[1]!.nickname]);
    expect((await playerIn(code, host.playerId)).connected).toBe(true);

    // And it stays the host's socket across another sleep.
    await evictDurableObject(roomStub(code));
    socket.ws.send("away");
    await expect.poll(async () => (await playerIn(code, host.playerId)).away).toBe(true);
    socket.ws.close();
  });

  it(`lets one client hold at most ${MAX_SILENT_PER_CLIENT} silent sockets: its newcomer pushes out its own oldest`, async () => {
    const host = await createRoom();
    const code = host.view.code;
    const ip = freshIp();
    const mine: Awaited<ReturnType<typeof rawSocket>>[] = [];
    for (let i = 0; i < MAX_SILENT_PER_CLIENT; i++) mine.push(await rawSocket(code, WS_PROTOCOL, ip));
    const someoneElse = await rawSocket(code);
    const newcomer = await rawSocket(code, WS_PROTOCOL, ip);
    expect(await closeWithin(mine[0]!.closed)).toBe(WS_CLOSE.helloTimeout);
    expect(mine[0]!.frames).toEqual([]);
    for (const s of [...mine.slice(1), someoneElse, newcomer]) expect(await closeWithin(s.closed, 50)).toBeNull();

    // A socket that says who it is no longer counts, so the client's next one pushes out no one.
    newcomer.ws.send(helloFrame(host.token));
    await expect.poll(() => newcomer.frames.length).toBeGreaterThan(0);
    const one = await rawSocket(code, WS_PROTOCOL, ip);
    for (const s of [...mine.slice(1), someoneElse, newcomer]) expect(await closeWithin(s.closed, 50)).toBeNull();
    for (const s of [...mine.slice(1), someoneElse, one, newcomer]) s.ws.close();
  });

  it("seats a real player whose hello lands after many opens from other clients", async () => {
    const { code, host } = await startedRoom();
    const player = await rawSocket(code);
    // Between the player's 101 and its hello, well past any small room-wide cap.
    const others: Awaited<ReturnType<typeof rawSocket>>[] = [];
    for (let i = 0; i < 20; i++) others.push(await rawSocket(code));
    player.ws.send(helloFrame(host.token));
    await expect.poll(() => player.frames.length).toBeGreaterThan(0);
    expect(JSON.parse(player.frames[0]!)).toMatchObject({ type: "state", view: { youId: host.playerId } });
    expect(await closeWithin(player.closed, 50)).toBeNull();
    for (const s of [...others, player]) s.ws.close();
  });

  it("does not interrupt a slow token check, however many sockets open meanwhile", async () => {
    const { code, host } = await startedRoom();
    await runInDurableObject(roomStub(code), async (instance) => {
      const self = instance as unknown as { verifyToken: (token: string) => Promise<unknown> };
      const verify = self.verifyToken.bind(instance);
      self.verifyToken = async (token) => {
        await pause(300);
        return verify(token);
      };
    });
    const ip = freshIp();
    const player = await rawSocket(code, WS_PROTOCOL, ip);
    player.ws.send(helloFrame(host.token));
    // Opens from the player's own address and from others, while its token is being checked.
    const others: Awaited<ReturnType<typeof rawSocket>>[] = [];
    for (let i = 0; i < 4; i++) others.push(await rawSocket(code, WS_PROTOCOL, ip));
    for (let i = 0; i < 10; i++) others.push(await rawSocket(code));
    await expect.poll(() => player.frames.length).toBeGreaterThan(0);
    expect(await closeWithin(player.closed, 50)).toBeNull();
    for (const s of [...others, player]) s.ws.close();
  });

  it(`at ${MAX_SILENT_SOCKETS} silent sockets in all, pushes out the greediest client's oldest, never a lone socket`, async () => {
    const host = await createRoom();
    const code = host.view.code;
    const greedyIp = freshIp();
    const greedy = [await rawSocket(code, WS_PROTOCOL, greedyIp), await rawSocket(code, WS_PROTOCOL, greedyIp)];
    const lone: Awaited<ReturnType<typeof rawSocket>>[] = [];
    for (let i = 0; i < MAX_SILENT_SOCKETS - greedy.length; i++) lone.push(await rawSocket(code));
    const newcomer = await rawSocket(code);
    expect(await closeWithin(greedy[0]!.closed)).toBe(WS_CLOSE.helloTimeout);
    for (const s of [greedy[1]!, ...lone, newcomer]) expect(await closeWithin(s.closed, 20)).toBeNull();

    // Now every client holds a single silent socket: nobody is pushed out, the newcomer is refused.
    const refused = await upgrade(code);
    expect(refused.status).toBe(429);
    for (const s of [greedy[1]!, ...lone, newcomer]) expect(await closeWithin(s.closed, 20)).toBeNull();
    expect(await attachments(code)).toHaveLength(MAX_SILENT_SOCKETS);
    for (const s of [greedy[1]!, ...lone, newcomer]) s.ws.close();
  });

  it("limits socket requests per client before the room is touched", async () => {
    const host = await createRoom();
    const ip = freshIp();
    const { limit } = RATE_LIMITS.socket;
    const statuses: number[] = [];
    for (let i = 0; i < limit + 5; i++) {
      const res = await upgrade(host.view.code, WS_PROTOCOL, ip);
      statuses.push(res.status);
      if (res.webSocket) {
        res.webSocket.accept();
        res.webSocket.close();
      } else if (res.status === 429) {
        expect(await res.json()).toMatchObject({ ok: false, error: "rate_limited" });
      }
    }
    expect(statuses.slice(0, limit).every((s) => s === 101)).toBe(true);
    expect(statuses.slice(limit)).toEqual(new Array(5).fill(429));
    // Another client is unaffected.
    const other = await rawSocket(host.view.code);
    other.ws.close();
  });

  it("still closes an old-handshake page with 4000 once its address is over the socket limit", async () => {
    const host = await createRoom();
    const ip = freshIp();
    const codes: (number | null)[] = [];
    for (let i = 0; i < RATE_LIMITS.socket.limit + 1; i++) {
      const old = await rawSocket(host.view.code, `${LEGACY_WS_PROTOCOL}, ${LEGACY_WS_TOKEN_PREFIX}${host.token}`, ip);
      codes.push(await closeWithin(old.closed));
    }
    // A 429 would make an old page retry every few seconds, its token in the header each time.
    expect(codes).toEqual(new Array(RATE_LIMITS.socket.limit + 1).fill(WS_CLOSE.roomClosed));
  });

  it("does not answer room-code guesses on the socket route faster than the lookup limit", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 80; i++) statuses.push((await upgrade("ZZZZZZ", WS_PROTOCOL, ip)).status);
    const { limit } = RATE_LIMITS.socket;
    expect(limit).toBeLessThanOrEqual(RATE_LIMITS.lookup.limit);
    expect(statuses.filter((s) => s === 404)).toHaveLength(limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(80 - limit);
    // Once limited, a real room answers the same way: the probe never reaches a room.
    const host = await createRoom();
    expect((await upgrade(host.view.code, WS_PROTOCOL, ip)).status).toBe(429);
  });

  it("closes silent sockets older than the hello timeout when the next socket arrives", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const silent: Awaited<ReturnType<typeof rawSocket>>[] = [];
    for (let i = 0; i < 3; i++) silent.push(await rawSocket(code));
    silent[0]!.ws.send(helloFrame(host.token));
    await expect.poll(() => silent[0]!.frames.length).toBeGreaterThan(0);
    const next = await rawSocket(code);

    // Once the silent ones are older than the timeout, the next request sweeps them out.
    await runInDurableObject(roomStub(code), async (_instance, state) => {
      for (const ws of state.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as { playerId: string | null; openedAt?: number };
        if (attachment.playerId === null) ws.serializeAttachment({ ...attachment, openedAt: Date.now() - HELLO_TIMEOUT_MS - 1 });
      }
    });
    const fresh = await rawSocket(code);
    for (const s of [...silent.slice(1), next]) {
      expect(await closeWithin(s.closed)).toBe(WS_CLOSE.helloTimeout);
      expect(s.frames).toEqual([]);
    }
    // The host's socket is untouched, and the silent sockets never counted as activity.
    expect(await closeWithin(silent[0]!.closed, 100)).toBeNull();
    expect(await attachments(code)).toHaveLength(2);
    silent[0]!.ws.close();
    fresh.ws.close();
  });

  it("does not let silent sockets keep an idle room alive", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const socket = await rawSocket(code);
    const stub = roomStub(code);
    await runInDurableObject(stub, async (instance, state) => {
      const self = instance as unknown as { room: RoomState };
      self.room = { ...self.room, lastActivityAt: 0 };
      await state.storage.put("room", self.room);
    });
    await runDurableObjectAlarm(stub);
    expect(await closeWithin(socket.closed)).toBe(WS_CLOSE.roomClosed);
    expect(socket.frames).toEqual([]);
    expect((await upgrade(code)).status).toBe(404);
  });

  it("refuses an upgrade for a room that does not exist, or with no handshake name", async () => {
    expect((await upgrade("ZZZZZZ")).status).toBe(404);
    const host = await createRoom();
    expect((await upgrade(host.view.code, "something.else")).status).toBe(400);
    expect((await SELF.fetch(`${BASE}/api/rooms/${host.view.code}/ws`, { headers: { Upgrade: "websocket" } })).status).toBe(400);
  });

  it("closes a page still on the old header handshake with the room-closed code, before it reaches the room", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const before = await storedRoom(code);
    // Exactly what pages built before v2 send.
    const old = await rawSocket(code, `${LEGACY_WS_PROTOCOL}, ${LEGACY_WS_TOKEN_PREFIX}${host.token}`);
    expect(old.protocol).toBe(LEGACY_WS_PROTOCOL); // a protocol it offered, so the browser opens and then sees the close
    expect(await closeWithin(old.closed)).toBe(WS_CLOSE.roomClosed);
    expect(old.frames).toEqual([]);
    // It never became the host's socket: the room did not change and holds no socket.
    expect((await storedRoom(code))!.version).toBe(before!.version);
    expect((await playerIn(code, host.playerId)).connected).toBe(false);
    expect(await attachments(code)).toEqual([]);
  });
});

describe("alarms", () => {
  it("times out a turn from the alarm exactly once", async () => {
    const { code, host } = await startedRoom({ timerSeconds: 60 });
    const a = await openSocket(code, host.token);
    const stub = roomStub(code);
    // Both players must be connected for the clock to run; simulate the guest's connection.
    await runInDurableObject(stub, async (instance, state) => {
      const self = instance as unknown as { room: RoomState };
      const room = structuredClone(self.room);
      for (const p of room.players) p.connected = true;
      room.turn!.deadline = Date.now() - 1;
      room.turn!.pausedRemainingMs = null;
      await state.storage.put("room", room);
      self.room = room;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const after = await a.next((v) => v.status === "guessing_second");
    expect(after.turnResults[host.playerId]).toBe("timed_out");
    await runDurableObjectAlarm(stub);
    const res = await api<{ view: RoomView }>(`/api/rooms/${code}/state`, { token: host.token });
    expect(res.body.view.status).toBe("guessing_second");
    expect(res.body.view.players.find((p) => p.seat === "A")!.skips).toBe(1);
    a.ws.close();
  });

  it("deletes an idle room", async () => {
    const host = await createRoom();
    const stub = roomStub(host.view.code);
    await runInDurableObject(stub, async (instance, state) => {
      const self = instance as unknown as { room: RoomState };
      self.room = { ...self.room, lastActivityAt: 0 };
      await state.storage.put("room", self.room);
    });
    await runDurableObjectAlarm(stub);
    expect((await api(`/api/rooms/${host.view.code}`)).status).toBe(404);
    expect((await api(`/api/rooms/${host.view.code}/state`, { token: host.token })).status).toBe(401);
  });
});

const latestView = async (code: string, token: string) => (await api<ViewResponse>(`/api/rooms/${code}/state`, { token })).body.view;

describe("PINs", () => {
  const lookUp = (value: string, ip?: string) => api<JoinLookupResponse>(`/api/join/${value}`, { ip });
  const pinOf = (view: RoomView) => {
    expect(view.pin).toMatch(/^\d{4}$/);
    return view.pin!;
  };
  const roomState = (code: string) =>
    runInDurableObject(env.ROOMS.getByName(code), async (_room: RoomDurableObject, state) => (await state.storage.get<RoomState>("room"))!);
  const unusedPin = async () => {
    for (let n = 0; ; n++) {
      const pin = String(n).padStart(4, "0");
      if (!(await env.PINS.getByName(PIN_DIRECTORY_NAME).resolve(pin))) return pin;
    }
  };

  it("resolves to the room preview and nothing else", async () => {
    const host = await createRoom();
    const res = await lookUp(pinOf(host.view));
    expect(res.status).toBe(200);
    expect(res.body.preview.code).toBe(host.view.code);
    expect(res.body.preview.hostNickname).toBe("Alice");
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(host.playerId);
    expect(text).not.toContain(host.token);
    expect(Object.keys(res.body).sort()).toEqual(["ok", "preview"]);
  });

  it("answers unknown, malformed, released and expired PINs identically (S11)", async () => {
    const released = await createRoom();
    const expired = await createRoom();
    const expiredPin = pinOf(expired.view);
    await send(released.view.code, released.token, released.view, "player.leave");
    await runInDurableObject(env.PINS.getByName(PIN_DIRECTORY_NAME), async (_d: PinDirectoryDurableObject, state) => {
      state.storage.sql.exec("UPDATE pins SET expires_at = ? WHERE pin = ?", Date.now() - PIN_TTL_MS, expiredPin);
    });
    const misses = await Promise.all([await unusedPin(), pinOf(released.view), expiredPin, "12", "ZZZZZZ"].map((value) => lookUp(value)));
    for (const miss of misses) {
      expect(miss.status).toBe(404);
      expect(miss.body).toEqual(misses[0]!.body);
    }
  });

  it("revokes the PIN when the room fills, and reissues a new one when the seat frees", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const first = pinOf(host.view);
    await openSocket(code, host.token); // A new PIN needs the host's lobby to be open.
    const guest = (await joinRoom(code)).body;
    expect(guest.view.pin).toBeNull();
    expect((await lookUp(first)).status).toBe(404);
    const removed = (await send(code, host.token, await latestView(code, host.token), "player.remove", { playerId: guest.playerId })).body.view;
    const second = pinOf(removed);
    expect(second).not.toBe(first);
    expect((await lookUp(second)).body.preview.code).toBe(code);
  });

  it("gives no PIN once the match starts, and a new one after a player leaves it", async () => {
    const { code, host, guest, view } = await startedRoom();
    expect(view.pin).toBeNull();
    await openSocket(code, host.token);
    const left = (await send(code, guest.token, await latestView(code, host.token), "player.leave")).body.view;
    expect(left.pin).toBeNull();
    const state = await latestView(code, host.token);
    expect(state.status).toBe("lobby");
    pinOf(state);
  });

  it("lets only the host swap the PIN, which ends the old one", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const first = pinOf(host.view);
    const renewed = await api<ViewResponse>(`/api/rooms/${code}/pin`, { method: "POST", token: host.token });
    expect(renewed.status).toBe(200);
    expect(pinOf(renewed.body.view)).not.toBe(first);
    expect((await lookUp(first)).status).toBe(404);
    const guest = (await joinRoom(code)).body;
    const denied = await api<ApiError>(`/api/rooms/${code}/pin`, { method: "POST", token: guest.token });
    expect(denied.status).toBe(403);
    const full = await api<ApiError>(`/api/rooms/${code}/pin`, { method: "POST", token: host.token });
    expect(full.status).toBe(409);
  });

  it("refreshes while the host is connected and drops the PIN once they are gone", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const stub = env.ROOMS.getByName(code);
    const pin = pinOf(host.view);
    const nearExpiry = async () =>
      runInDurableObject(stub, async (room: RoomDurableObject, state) => {
        const current = (await state.storage.get<RoomState>("room"))!;
        const next = { ...current, pin: { value: pin, expiresAt: Date.now() + 1000 } };
        await state.storage.put("room", next);
        (room as unknown as { room: RoomState }).room = next;
      });

    const socket = await openSocket(code, host.token);
    await nearExpiry();
    await runDurableObjectAlarm(stub);
    expect((await roomState(code)).pin!.expiresAt).toBeGreaterThan(Date.now() + PIN_TTL_MS - 5000);

    socket.ws.close();
    await vi.waitFor(async () => expect((await roomState(code)).players[0]!.connected).toBe(false));
    await nearExpiry();
    await runDurableObjectAlarm(stub);
    expect((await roomState(code)).pin!.value).toBe(pin);
    await runInDurableObject(stub, async (room: RoomDurableObject, state) => {
      const current = (await state.storage.get<RoomState>("room"))!;
      const next = { ...current, pin: { value: pin, expiresAt: Date.now() - 1 } };
      await state.storage.put("room", next);
      (room as unknown as { room: RoomState }).room = next;
    });
    await runDurableObjectAlarm(stub);
    expect((await roomState(code)).pin).toBeNull();
  });

  it("keeps working with no PIN when the directory fails", async () => {
    const original = env.PINS.getByName;
    env.PINS.getByName = () => {
      throw new Error("directory down");
    };
    try {
      const host = await createRoom();
      expect(host.view.pin).toBeNull();
      expect((await joinRoom(host.view.code)).status).toBe(200);
    } finally {
      env.PINS.getByName = original;
    }
  });

  it("limits lookups per client, and counts a whole IPv6 /48 as one", async () => {
    const short = RATE_LIMITS.pin_short.limit;
    const prefix = `2001:db8:${++ipCounter}`;
    for (let i = 0; i < short; i++) expect((await lookUp("0000", `${prefix}:${i}::1`)).status).not.toBe(429);
    expect((await lookUp("0000", `${prefix}:ffff:1:2:3:4`)).status).toBe(429);
    expect((await lookUp("0000", `2001:db8:${++ipCounter}:7::1`)).status).not.toBe(429);
  });
});

describe("player.remove", () => {
  it("lets the host remove the guest, closes their socket with its own code and ends their session", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const guest = (await joinRoom(code)).body;
    const socket = await openSocket(code, guest.token);
    const closed = new Promise<number>((resolve) => socket.ws.addEventListener("close", (e) => resolve(e.code)));
    const res = await send(code, host.token, await latestView(code, host.token), "player.remove", { playerId: guest.playerId });
    expect(res.status).toBe(200);
    expect(res.body.view.players.map((p) => p.nickname)).toEqual(["Alice"]);
    expect(res.body.view.notices).not.toContain("opponent_left");
    expect(await closed).toBe(4002);
    expect((await api(`/api/rooms/${code}/state`, { token: guest.token })).status).toBe(403);
  });

  it("tells a removed player why, even if they missed the socket close", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const guest = (await joinRoom(code)).body;
    await send(code, host.token, await latestView(code, host.token), "player.remove", { playerId: guest.playerId });
    const res = await api<ApiError>(`/api/rooms/${code}/state`, { token: guest.token });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("removed");
  });

  it("is host-only, lobby-only and cannot target the host", async () => {
    const host = await createRoom();
    const code = host.view.code;
    const guest = (await joinRoom(code)).body;
    const asGuest = await send(code, guest.token, guest.view, "player.remove", { playerId: host.playerId });
    expect(asGuest.status).toBe(403);
    const self = await send(code, host.token, guest.view, "player.remove", { playerId: host.playerId });
    expect(self.status).toBe(409);
    const started = await startedRoom();
    const midGame = await send(started.code, started.host.token, started.view, "player.remove", { playerId: started.guest.playerId });
    expect(midGame.status).toBe(409);
  });
});
