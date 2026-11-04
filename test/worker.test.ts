import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  WS_PROTOCOL,
  WS_TOKEN_PREFIX,
  type ApiError,
  type CommandResponse,
  type JoinLookupResponse,
  type MeResponse,
  type RoomView,
  type ServerMessage,
  type SessionResponse,
  type Settings,
  type ViewResponse,
} from "../src/shared/protocol";
import type { RoomState } from "../src/worker/engine";
import type { RoomDurableObject } from "../src/worker/room";
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

async function openSocket(code: string, token: string) {
  const res = await SELF.fetch(`${BASE}/api/rooms/${code}/ws`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${WS_PROTOCOL}, ${WS_TOKEN_PREFIX}${token}` },
  });
  expect(res.status).toBe(101);
  expect(res.headers.get("Sec-WebSocket-Protocol")).toBe(WS_PROTOCOL);
  const ws = res.webSocket!;
  const frames: string[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (event) => {
    frames.push(event.data as string);
    waiters.splice(0).forEach((w) => w());
  });
  ws.accept();
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

  it("refuses sockets without a valid token", async () => {
    const host = await createRoom();
    const res = await SELF.fetch(`${BASE}/api/rooms/${host.view.code}/ws`, {
      headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${WS_PROTOCOL}, ${WS_TOKEN_PREFIX}nope` },
    });
    expect(res.status).toBe(401);
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

  it("limits lookups per client, and counts a whole IPv6 /64 as one", async () => {
    const short = RATE_LIMITS.pin_short.limit;
    const ip = `2001:db8:${++ipCounter}:7`;
    for (let i = 0; i < short; i++) expect((await lookUp("0000", `${ip}::${i}`)).status).not.toBe(429);
    expect((await lookUp("0000", `${ip}:1:2:3:4`)).status).toBe(429);
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

describe("GitHub sign-in", () => {
  const AUTH = env as unknown as Record<string, string | undefined>;
  const configure = () => {
    AUTH.GITHUB_CLIENT_ID = "client-id";
    AUTH.GITHUB_CLIENT_SECRET = "client-secret";
  };
  const reset = () => {
    delete AUTH.GITHUB_CLIENT_ID;
    delete AUTH.GITHUB_CLIENT_SECRET;
    vi.unstubAllGlobals();
  };
  const get = (path: string, headers: Record<string, string> = {}) =>
    SELF.fetch(`${BASE}${path}`, { redirect: "manual", headers: { "CF-Connecting-IP": freshIp(), ...headers } });
  const cookiesFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]!);
  const pendingFrom = async (next = "/new") => {
    const start = await get(`/api/auth/github/start?next=${encodeURIComponent(next)}`);
    return { state: new URL(start.headers.get("Location")!).searchParams.get("state")!, cookie: cookiesFrom(start)[0]! };
  };
  const fakeGitHub = (id = 77) =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("/access_token")
        ? Response.json({ access_token: "token" })
        : Response.json({ id, login: "octo", name: "Octo Cat", avatar_url: "https://example.test/a.png" }),
    );

  it("hides sign-in until it is configured", async () => {
    const res = await api<MeResponse>("/api/me");
    expect(res.body).toEqual({ ok: true, signInAvailable: false, user: null });
    expect((await get("/api/auth/github/start")).headers.get("Location")).toBe("/?signin=failed");
  });

  it("signs in, reports the account, and signs out", async () => {
    configure();
    fakeGitHub();
    try {
      const { state, cookie } = await pendingFrom();
      const done = await get(`/api/auth/github/callback?code=c&state=${state}`, { Cookie: cookie });
      expect(done.status).toBe(302);
      expect(done.headers.get("Location")).toBe("/new");
      const account = cookiesFrom(done).find((c) => c.startsWith("whoami_account="))!;
      expect(done.headers.getSetCookie().join()).toContain("HttpOnly");
      const me = await api<MeResponse>("/api/me", { headers: { Cookie: account } });
      expect(me.body.user).toEqual({ login: "octo", name: "Octo Cat", avatarUrl: "https://example.test/a.png" });
      const out = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Cookie: account } });
      expect(out.headers.getSetCookie()[0]).toContain("Max-Age=0");
    } finally {
      reset();
    }
  });

  it("updates the same account on a second sign-in and stores no token", async () => {
    configure();
    fakeGitHub(78);
    try {
      for (let i = 0; i < 2; i++) {
        const { state, cookie } = await pendingFrom();
        await get(`/api/auth/github/callback?code=c&state=${state}`, { Cookie: cookie });
      }
      const rows = await env.DB.prepare("SELECT * FROM users WHERE github_id = 78").all();
      expect(rows.results).toHaveLength(1);
      expect(JSON.stringify(rows.results)).not.toContain("token");
    } finally {
      reset();
    }
  });

  it("rejects a mismatched state and a forged account cookie", async () => {
    configure();
    try {
      const { cookie } = await pendingFrom();
      const bad = await get("/api/auth/github/callback?code=c&state=wrong", { Cookie: cookie });
      expect(bad.headers.get("Location")).toBe("/?signin=failed");
      const me = await api<MeResponse>("/api/me", { headers: { Cookie: "whoami_account=a1.e30.AAAA" } });
      expect(me.body.user).toBeNull();
    } finally {
      reset();
    }
  });

  it("never redirects to another site after sign-in", async () => {
    configure();
    fakeGitHub(79);
    try {
      for (const next of ["https://evil.test", "//evil.test", "/\\evil.test"]) {
        const { state, cookie } = await pendingFrom(next);
        const done = await get(`/api/auth/github/callback?code=c&state=${state}`, { Cookie: cookie });
        expect(done.headers.get("Location")).toBe("/");
      }
    } finally {
      reset();
    }
  });

  it("does not accept a room token as an account", async () => {
    const host = await createRoom();
    const me = await api<MeResponse>("/api/me", { headers: { Cookie: `whoami_account=${host.token}` } });
    expect(me.body.user).toBeNull();
  });
});

describe("measured difficulty", () => {
  it("records each identity's real result with no player or room data", async () => {
    const { code, host, guest, view } = await startedRoom();
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM identity_plays").first<{ n: number }>())!.n;
    let v = (await send(code, host.token, view, "turn.correct.request")).body.view;
    v = (await send(code, guest.token, v, "turn.correct.confirm")).body.view;
    await send(code, guest.token, v, "turn.skip");
    await vi.waitFor(async () => {
      const rows = await env.DB.prepare("SELECT * FROM identity_plays ORDER BY id DESC LIMIT 2").all<Record<string, unknown>>();
      const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM identity_plays").first<{ n: number }>())!.n;
      expect(count).toBe(before + 2);
      expect(rows.results.map((r) => r.result).sort()).toEqual(["correct", "skipped"]);
      const text = JSON.stringify(rows.results);
      for (const secret of [host.playerId, guest.playerId, code]) expect(text).not.toContain(secret);
    });
  });
});
