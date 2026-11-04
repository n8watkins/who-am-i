import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  WS_PROTOCOL,
  WS_TOKEN_PREFIX,
  type CommandResponse,
  type RoomView,
  type ServerMessage,
  type SessionResponse,
  type Settings,
} from "../src/shared/protocol";
import type { RoomState } from "../src/worker/engine";
import type { RoomDurableObject } from "../src/worker/room";
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
    body: JSON.stringify({ nickname: "Alice", settings: { ...DEFAULT_SETTINGS, firstPlayer: "host", ...settings } }),
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
