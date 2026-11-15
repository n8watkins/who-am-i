// Who Am I? in the party room's real room class (n8watkins/n8-party-games, lobby/server/lobby-room.js
// at the commit pinned in scripts/party-room-checkout.mjs), driven with the fake Durable Object
// runtime the party room's own tests use (lobby/test/fake-room.js): fake sockets that keep every
// frame, fake storage that outlives an instance, the alarm, and the clock.
//
// The room is given the game and its real manifest, as a party site gives it: the party votes,
// the host goes through the settings step (and, in a party of four, two players take the spots),
// and the players play whole matches through the room, as their phones would: each input with an
// id, built from the snapshot that phone last got. The room is rebuilt over the same storage in
// the middle (an eviction or a deploy). Every frame any socket is sent is checked against the
// secret, as it is sent: a player, the audience and the big screen each by their own rule.
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
// The built module, as a party site imports it (the package's "." export), not the source.
import { game, manifest } from "../../party.js";
import type { RoomGameState } from "../../src/party/room-game";
import type { RoomView } from "../../src/shared/protocol";
import { getIdentity } from "../../src/worker/content";

declare module "vitest" {
  export interface ProvidedContext {
    partyRoomDir: string;
  }
}

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const kit = inject("partyRoomDir");
/* eslint-disable @typescript-eslint/no-explicit-any -- the party room is plain JavaScript */
const fake: any = await import(/* @vite-ignore */ `${kit}lobby/test/fake-room.js`);
const turns: any = await import(/* @vite-ignore */ `${kit}lobby/test/turn-game.js`);
const { createLobbyRoom }: any = await import(/* @vite-ignore */ `${kit}lobby/server/lobby-room.js`);

type Socket = { frames: string[]; closed: unknown; onSend: ((text: string) => void) | null; messages(): any[]; text(): string };
type Msg = { t: string; [key: string]: any };
type PlayerSnap = RoomView & { role: "player"; seat: number; match: string };
/** Who a socket is to the game: a player of a seat, the audience, or the big screen. */
type Role = { kind: "player"; seat: number } | { kind: "audience" } | { kind: "screen" };

beforeEach(fake.useFakeRuntime);
afterEach(fake.dropFakeRuntime);

const escaped = (text: string) => JSON.stringify(text).slice(1, -1);
const playerOf = (seat: number) => `seat-${seat}`;
const seatOf = (id: string | null | undefined) => (id ? Number(id.replace("seat-", "")) : null);
/** The room's options: the game's real manifest, as a party site's wall is built from it. */
const ROOM_OPTIONS = { players: manifest.players, manifest };

/** The room view a socket was last sent. */
const roomOf = (ws: Socket) => ws.messages().filter((m: Msg) => m.room).at(-1)?.room;

/**
 * The settings step, as the room shows it to everyone: the game's own fields. The host may send
 * `settings` (each a change, as their page would), then starts.
 */
async function chooseAndStart(r: any, host: Socket, others: Socket[], settings: object | null) {
  const { ctx, say } = r;
  expect(ctx.room.core.activity).toMatchObject({ kind: "settings", id: "who-am-i" });
  for (const w of [host, ...others]) {
    expect(roomOf(w), "every page shows the step").toMatchObject({ phase: "settings", choosing: { id: "who-am-i", fields: expect.any(Array) } });
    expect(roomOf(w).choosing.fields.map((f: { key: string }) => f.key)).toEqual(manifest.settings.map((f) => f.key));
  }
  // The first picks are the game's defaults, cleaned by game.settings.
  expect(ctx.room.core.activity.picks).toEqual(game.settings({}));
  if (settings) {
    say(host, { t: "settings", v: settings });
    await fake.settle();
    expect(ctx.room.core.activity.picks).toMatchObject(settings);
    // A choice that is not on offer is refused, to the host alone.
    say(host, { t: "settings", v: { timerSeconds: 45 } });
    await fake.settle();
    expect(host.messages().filter((m: Msg) => m.t === "settings-no").at(-1)).toMatchObject({ error: "bad_setting" });
  }
  // Nobody but the host may start it.
  for (const w of others) say(w, { t: "settings-start" });
  await fake.settle();
  expect(ctx.room.core.activity.kind).toBe("settings");
  say(host, { t: "settings-start" });
  await fake.settle();
  expect(ctx.room.core.activity.kind).toBe("game");
}

/**
 * A party of Ann and Bo (seats 0 and 1) and a big screen, voted into Who Am I?: Ann, the host,
 * goes through the settings step (`settings`: what she changes there). Every frame is checked as
 * it is sent (`watch`), and Cy joins once the match is on: she watches as the audience.
 */
async function party(settings: object | null = null) {
  const r = await fake.openRoom(createLobbyRoom, game, ROOM_OPTIONS);
  const { ctx, connect } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const screen = await ctx.room.join({ as: "screen" });
  const ws: Record<string, Socket> = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
  const secrecy = watch(ctx, ws, { ann: { kind: "player", seat: 0 }, bo: { kind: "player", seat: 1 }, screen: { kind: "screen" } });
  await fake.voteTo(r, "settings", [ws.ann, 0], [ws.bo, 1]);
  await fake.settle();
  await chooseAndStart(r, ws.ann!, [ws.bo!, ws.screen!], settings);
  expect(ctx.room.core.activity).toMatchObject({ kind: "game", id: "who-am-i", seats: [0, 1] });
  if (settings) expect(stateOf(ctx)!.settings).toMatchObject(settings);
  const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
  const all = { ann: ws.ann!, bo: ws.bo!, screen: ws.screen!, cy: (await connect(cy.token)) as Socket };
  ws.cy = all.cy;
  secrecy.add("cy", all.cy, { kind: "audience" });
  return {
    ctx,
    say: r.say as (ws: Socket, msg: object) => void,
    sleepAndWake: r.sleepAndWake as () => Promise<void>,
    ws: all,
    secrecy,
  };
}

/** The game's state in the room right now, or null outside a game. */
const stateOf = (ctx: any): RoomGameState | null => (ctx.room.core.activity.kind === "game" ? ctx.room.core.activity.state : null);

/**
 * Checks every frame as the room sends it, against the game's state at that moment:
 * - a player is never sent the identity they are guessing (its id, name or a long alias) or a
 *   hint for it they did not ask for;
 * - the audience is sent both identities in every snapshot while a round is on, and never a
 *   hint, a typed question, a log or a player's own view;
 * - the big screen is never sent any identity, hint, typed question or log.
 * Records every identity the match assigned, to check the whole of each socket at the end.
 */
function watch(ctx: any, sockets: Record<string, Socket>, roles: Record<string, Role>) {
  let last: RoomGameState | null = null;
  const assigned = new Map<string, number>();
  const questions = new Set<string>();
  const checked = { frames: 0, audienceSnaps: 0 };
  const known = new Map<string, { ws: Socket; role: Role }>();
  // The room catches what a socket's send throws, so a failed check is kept, not thrown.
  const problems: string[] = [];
  const mustNotHave = (text: string, secret: string, what: string) => {
    if (text.includes(secret)) problems.push(`${what}: ${secret}`);
  };
  const record = (state: RoomGameState | null) => {
    const round = state?.match.room.round;
    if (round) for (const s of state.match.seats) assigned.set(round.assignments[playerOf(s)]!, s);
  };
  const checkPlayer = (seat: number, text: string) => {
    const state = stateOf(ctx) ?? last;
    if (!state) return;
    last = state;
    const round = state.match.room.round;
    if (!round) return; // a round's summary is its reveal
    record(state);
    const own = getIdentity(round.assignments[playerOf(seat)]!);
    const theirs = getIdentity(round.assignments[playerOf(state.match.seats.find((s) => s !== seat)!)]!);
    const allowed = [theirs.canonicalName, ...theirs.aliases, ...theirs.hints].map(escaped);
    for (const secret of [own.id, own.canonicalName, ...own.aliases.filter((a) => a.length >= 4)].map(escaped)) {
      if (!allowed.some((a) => a.includes(secret))) mustNotHave(text, secret, `seat ${seat} was sent their own identity`);
    }
    const asked = round.hintsUsed?.[playerOf(seat)] ?? 0;
    own.hints.forEach((hint, i) => {
      if (i >= asked && !allowed.some((a) => a.includes(escaped(hint)))) mustNotHave(text, escaped(hint), `seat ${seat} was sent a hint they did not ask for`);
    });
  };
  const checkAudience = (who: string, text: string) => {
    const state = stateOf(ctx);
    record(state);
    // The game's frames hold no log, hint list or player's own view (the room's own frames name the
    // settings step's fields, `hints` among them).
    const key = fake.GAME_FRAME.test(text) && /"(log|hints|youId|opponentIdentity|roundSummary|assignments|usedIdentityIds)"/.exec(text);
    if (key) problems.push(`${who} was sent ${key[0]}`);
    for (const question of questions) mustNotHave(text, escaped(question), `${who} was sent a question`);
    const round = state?.match.room.round;
    const shown = round ? state.match.seats.map((s) => getIdentity(round.assignments[playerOf(s)]!)) : [];
    const names = shown.flatMap((i) => [i.canonicalName, ...i.aliases]).map(escaped);
    for (const id of assigned.keys()) {
      for (const hint of getIdentity(id).hints.map(escaped)) if (!names.some((n) => n.includes(hint))) mustNotHave(text, hint, `${who} was sent a hint`);
    }
    if (/^\{"t":"(start|snap)"/.test(text) && round) {
      checked.audienceSnaps++;
      if (!/"role":"audience"/.test(text)) problems.push(`${who} was not sent the audience's view`);
      for (const identity of shown) if (!text.includes(escaped(identity.canonicalName))) problems.push(`${who} was not sent ${identity.id}`);
    }
  };
  const checkScreen = (who: string, text: string) => {
    record(stateOf(ctx));
    const key = /"(log|opponentIdentity|roundSummary|identity|identities|reveal|assignments|youId)"/.exec(text);
    if (key) problems.push(`${who} was sent ${key[0]}`);
    for (const id of assigned.keys()) {
      const identity = getIdentity(id);
      for (const secret of [identity.id, identity.canonicalName, ...identity.hints].map(escaped)) mustNotHave(text, secret, `${who} was sent an identity`);
    }
    for (const question of questions) mustNotHave(text, escaped(question), `${who} was sent a question`);
  };
  const add = (who: string, ws: Socket, role: Role) => {
    known.set(who, { ws, role });
    ws.onSend = (text) => {
      checked.frames++;
      if (role.kind === "player") checkPlayer(role.seat, text);
      else if (role.kind === "audience") checkAudience(who, text);
      else checkScreen(who, text);
    };
  };
  for (const [who, ws] of Object.entries(sockets)) add(who, ws, roles[who]!);
  return {
    add,
    checked,
    assigned,
    questions,
    problems,
    /**
     * After the match: every frame the big screen was ever sent, against every identity the match
     * used; the audience was sent every one of them; and no problem was seen on the way.
     */
    finalCheck() {
      for (const [who, { ws, role }] of known) {
        if (role.kind === "screen") checkScreen(who, ws.text());
        if (role.kind === "audience") for (const id of assigned.keys()) expect(ws.text(), `${who} saw ${id}`).toContain(escaped(getIdentity(id).canonicalName));
      }
      expect(problems).toEqual([]);
      expect(checked.frames).toBeGreaterThan(10);
    },
  };
}

/** The snapshot a phone last got (start or snap), as its page would hold it. */
function lastSnap(ws: Socket): PlayerSnap {
  const msgs = ws.messages().filter((m: Msg) => m.t === "start" || m.t === "snap");
  return msgs.at(-1)!.s;
}

/** A phone: sends an engine command with an id, as the room view does, built from its last snapshot. */
function phone(name: string, ws: Socket, say: (ws: Socket, msg: object) => void) {
  let n = 0;
  return {
    ws,
    snap: () => lastSnap(ws),
    send(type: string, extra: object = {}, id = `${name}-input-${++n}`) {
      const s = lastSnap(ws);
      const data = { type, commandId: id, expectedVersion: s.version, ...extra };
      say(ws, { t: "in", d: data, id });
      return { id, data };
    },
    /** The same input again, as a double tap or a resend after a reconnect would. */
    again(sent: { id: string; data: object }) {
      say(ws, { t: "in", d: sent.data, id: sent.id });
    },
    answers: () => ws.messages().filter((m: Msg) => m.t === "ack" || (m.t === "error" && m.id !== undefined)),
  };
}

/** Plays on until the room is back in the lobby: `winner` is always right, the other always gives up. */
async function playOut(ctx: any, players: Record<number, ReturnType<typeof phone>>, winner: number) {
  const seats = Object.keys(players).map(Number);
  const loser = seats.find((s) => s !== winner)!;
  let guard = 0;
  while (ctx.room.core.activity.kind === "game" && guard++ < 200) {
    const s = players[winner]!.snap();
    if (s.status === "round_summary") {
      players[loser]!.send("round.next");
    } else if (s.turn?.phase === "pending_confirm") {
      players[seats.find((seat) => seat !== seatOf(s.turn!.playerId))!]!.send("turn.correct.confirm");
    } else if (s.turn) {
      const seat = seatOf(s.turn.playerId)!;
      if (seat === winner) players[winner]!.send("turn.correct.request");
      else players[loser]!.send(s.settings.turnFormat === "trade" && !s.turn.moveAsked ? "turn.pass" : "turn.skip");
    }
    await fake.settle();
  }
  expect(ctx.room.core.activity.kind).toBe("lobby");
}

describe("Who Am I? in the party room", () => {
  it("plays a whole match through the real room class, rebuilt in the middle, and nobody is sent what they must not see", async () => {
    const r = await party();
    const { ctx, say, ws, secrecy } = r;
    expect(game.tickHz).toBe(0);
    // No timer runs for a turn-based game, and with no turn timer there is no deadline.
    expect(ctx.room.timer).toBeNull();

    // Each phone starts on its own view: the other's identity, never its own; the screen gets the screen's, Cy the audience's.
    const start = (w: Socket) => w.messages().find((m: Msg) => m.t === "start");
    const state0 = stateOf(ctx)!;
    expect(start(ws.ann).s).toMatchObject({ role: "player", seat: 0, youId: "seat-0", match: "first_to_3", opponentIdentity: { id: state0.match.room.round!.assignments["seat-1"] } });
    expect(start(ws.bo).s).toMatchObject({ role: "player", seat: 1, opponentIdentity: { id: state0.match.room.round!.assignments["seat-0"] } });
    expect(start(ws.screen).s).toMatchObject({ role: "screen", turn: { questionCount: 0 } });
    const joined = ws.cy.messages().find((m: Msg) => m.t === "snap");
    expect(joined).toMatchObject({ full: true, s: { role: "audience", identities: [{ seat: 0 }, { seat: 1 }] } });
    expect(joined.s.identities.map((i: { identity: { id: string } }) => i.identity.id)).toEqual([state0.match.room.round!.assignments["seat-0"], state0.match.room.round!.assignments["seat-1"]]);
    // The room's view of the game: turn-based, laid out upright, and Cy watching it.
    expect(start(ws.ann).room).toMatchObject({ phase: "playing", game: { id: "who-am-i", turns: true, upright: true } });

    const ann = phone("ann", ws.ann, say);
    const bo = phone("bo", ws.bo, say);
    const bySeat = [ann, bo];
    const step = async () => {
      await fake.settle();
    };

    // Round 1 by hand: a typed question and its answer, a hint, a refused tap, and a double-tapped confirm.
    const guesser = seatOf(ann.snap().turn!.playerId)!;
    const g = bySeat[guesser]!;
    const a = bySeat[1 - guesser]!;
    g.send("turn.ask", { text: "Am I a real person?" });
    secrecy.questions.add("Am I a real person?");
    await step();
    expect(g.answers().at(-1)).toMatchObject({ t: "ack" });
    const asked = a.snap().turn!.log.find((e) => e.kind === "question")!;
    expect(asked).toMatchObject({ text: "Am I a real person?", answer: null });
    a.send("turn.answer", { questionId: asked.id, answer: "yes" });
    await step();
    expect(g.snap().turn!.log[0]).toMatchObject({ kind: "question", answer: "yes" });
    // The answerer may not guess: the game says no, to that phone only.
    a.send("turn.correct.request");
    await step();
    expect(a.answers().at(-1)).toMatchObject({ t: "error", error: "forbidden" });
    // The audience may not play at all: the room says no.
    const cy = phone("cy", ws.cy, say);
    const tried = cy.send("turn.hint", {}, "cy-input-1");
    await step();
    expect(cy.answers().find((m: Msg) => m.id === tried.id)).toMatchObject({ t: "error", error: "not_in_game" });
    g.send("turn.hint");
    await step();
    expect(g.snap().turn!.log.some((e) => e.kind === "hint")).toBe(true);
    // The screen saw the count go up, and nothing of the question.
    expect(lastSnap(ws.screen)).toMatchObject({ role: "screen", turn: { questionCount: 1 } });
    g.send("turn.correct.request");
    await step();
    const confirm = a.send("turn.correct.confirm");
    a.again(confirm);
    await step();
    expect(a.answers().filter((m: Msg) => m.id === confirm.id)).toEqual([
      { t: "ack", id: confirm.id },
      { t: "ack", id: confirm.id },
    ]);
    expect(stateOf(ctx)!.match.room.players.find((p) => p.id === playerOf(guesser))!.score).toBe(1);
    // Between rounds the audience sees the reveal and the scores.
    if (stateOf(ctx)!.match.room.status === "round_summary") {
      expect(lastSnap(ws.cy)).toMatchObject({ role: "audience", reveal: { roundIndex: 1 }, scores: expect.arrayContaining([{ seat: guesser, score: 1 }]) });
    }

    // The room is rebuilt over the same storage, as after an eviction or a deploy, mid-match.
    const before = game.serialize(stateOf(ctx)!);
    const sent = Object.values(ws).map((w) => w.frames.length);
    await r.sleepAndWake();
    expect(game.serialize(stateOf(ctx)!)).toBe(before);
    // Nobody is sent anything for the wake itself.
    expect(Object.values(ws).map((w) => w.frames.length)).toEqual(sent);

    // The rest of the match, as the phones see it: Ann is always right, Bo always gives up.
    await playOut(ctx, { 0: ann, 1: bo }, 0);

    // The end: everyone hears it, with a result that names nobody's identity, and Ann has the night's points.
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.result).toEqual([
      { seat: 0, score: 3 },
      { seat: 1, score: expect.any(Number) },
    ]);
    // The room's card shows each score beside the place; Cy watched, so she is not on it.
    expect(end.last.rows).toEqual([
      expect.objectContaining({ seat: 0, place: 1, points: 3, score: 3 }),
      expect.objectContaining({ seat: 1, place: 2, points: 2, score: end.result[1].score }),
    ]);
    expect(ctx.room.core.members[0].points).toBe(3);
    expect(ctx.room.core.members.find((m: { name: string } | null) => m?.name === "Cy").points).toBe(0);
    // The last tap twice is still answered, and never applied twice.
    for (const p of [ann, bo]) expect(p.answers().every((m: Msg) => m.t === "ack" || m.error !== "game_error")).toBe(true);

    secrecy.finalCheck();
    expect(secrecy.assigned.size).toBeGreaterThanOrEqual(6);
    expect(secrecy.checked.frames).toBeGreaterThan(100);
    // Every round on, Cy was sent the audience's view with both identities (how many snapshots depends on the draw).
    expect(secrecy.checked.audienceSnaps).toBeGreaterThanOrEqual(3);
    fake.expectNoRoomSeed(ctx.room.core, Object.values(ws));
  });

  it("takes the host's settings: a 60 second timer wakes the room, pauses while a phone is hidden or gone, and a phone that never comes back ends it", async () => {
    const { ctx, say, ws, secrecy } = await party({ timerSeconds: 60, turnFormat: "keep_going", match: "first_to_5" });
    const ann = phone("ann", ws.ann, say);
    expect(ann.snap()).toMatchObject({ match: "first_to_5", settings: { timerSeconds: 60, turnFormat: "keep_going" } });
    const first = seatOf(ann.snap().turn!.playerId)!;
    const deadline = ann.snap().turn!.deadline!;
    expect(ctx.alarm.at).toBe(deadline);

    await vi.advanceTimersByTimeAsync(deadline - Date.now());
    const events = (w: Socket) => w.messages().filter((m: Msg) => m.t === "ev").flatMap((m: Msg) => m.ev);
    for (const w of [ws.ann, ws.bo, ws.screen, ws.cy]) expect(events(w!)).toEqual([{ k: "timed_out", seat: first }]);
    const second = 1 - first;
    expect(seatOf(ann.snap().turn!.playerId)).toBe(second);
    const next = ann.snap().turn!.deadline!;
    expect(next).toBe(deadline + 60_000);
    expect(ctx.alarm.at).toBe(next);

    // The waiting player's page is hidden: the timer stops, everyone sees it paused.
    const waiting = first === 0 ? ws.ann : ws.bo;
    await vi.advanceTimersByTimeAsync(10_000);
    say(waiting, { t: "away" });
    await fake.settle();
    expect(lastSnap(ws.screen)).toMatchObject({ turn: { deadline: null, pausedRemainingMs: 50_000 } });
    expect(ctx.room.core.members[first].away).toBe(true);
    // Nothing ticks while it is paused.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(seatOf(ann.snap().turn!.playerId)).toBe(second);

    // Back: it runs on from 50 seconds.
    say(waiting, { t: "back" });
    await fake.settle();
    const resumed = lastSnap(ws.screen) as unknown as { turn: { deadline: number } };
    expect(resumed.turn.deadline).toBe(Date.now() + 50_000);

    // The phone drops: the seat is held for a minute, and the timer pauses again.
    ctx.room.webSocketClose(waiting, 1006, "");
    await fake.settle();
    expect(lastSnap(ws.screen)).toMatchObject({ turn: { deadline: null } });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(ctx.room.core.activity.kind).toBe("game");
    // It is not back after a minute: it forfeits, with nobody tapping, and the player who stayed wins.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.last.early).toMatchObject({ seat: first, why: "gone" });
    expect(end.last.rows).toEqual([expect.objectContaining({ seat: second, place: 1, points: 3 })]);
    secrecy.finalCheck();
  });

  describe("a phone locked for 90 seconds in the middle of a match", () => {
    /**
     * Ann's phone locks: her page says `away` and keeps its socket, as the room's page does during
     * a turn-based game. `keepAlive` is whether her locked page goes on sending its keep-alive
     * (the runtime answers it, so the room sees when it was last heard); a browser that freezes a
     * locked page stops it. Everyone else's keep-alive goes on. The phone locks two minutes into
     * the match, after the room's wake-up for the settings step's time limit (90 seconds after it
     * opened) has rung: that alarm, still set when the match starts, would wake the room too.
     */
    async function locked(keepAlive: boolean) {
      const r = await party();
      const { ctx, say, ws } = r;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(ctx.room.core.activity.kind).toBe("game");
      const lockedAt = Date.now();
      ctx.getWebSocketAutoResponseTimestamp = (w: Socket) => (w === ws.ann && !keepAlive ? new Date(lockedAt) : new Date(Date.now()));
      say(ws.ann, { t: "away" });
      await fake.settle();
      expect(ctx.room.core.members[0]).toMatchObject({ connected: true, away: true });
      return r;
    }

    it("with its keep-alive going: the socket lives, she is away, not dropped, and plays on", async () => {
      const { ctx, say, ws, secrecy } = await locked(true);
      const bo = phone("bo", ws.bo, say);
      for (let t = 0; t < 9; t++) {
        await vi.advanceTimersByTimeAsync(10_000);
        bo.send("turn.hint"); // whatever it is answered, an input makes the room look for silent sockets
        await fake.settle();
      }
      expect(ws.ann.closed).toBeNull();
      expect(ctx.room.core.members[0]).toMatchObject({ connected: true, away: true });
      say(ws.ann, { t: "back" });
      await fake.settle();
      expect(ctx.room.core.activity.kind).toBe("game");
      secrecy.finalCheck();
    });

    it("with its keep-alive stopped and the other player tapping: her silent socket is closed after a minute, and she forfeits", async () => {
      const { ctx, say, ws, secrecy } = await locked(false);
      const bo = phone("bo", ws.bo, say);
      await vi.advanceTimersByTimeAsync(55_000);
      bo.send("turn.hint");
      await fake.settle();
      expect(ctx.room.core.activity.kind).toBe("game");
      await vi.advanceTimersByTimeAsync(10_000);
      bo.send("turn.hint");
      await fake.settle();
      expect(ws.ann.closed).toMatchObject({ code: 1001, reason: "silent" });
      expect(ctx.room.core.activity.kind).toBe("lobby");
      const end = ws.screen.messages().find((m: Msg) => m.t === "end");
      expect(end.last.early).toMatchObject({ seat: 0, why: "gone" });
      expect(end.last.rows).toEqual([expect.objectContaining({ seat: 1, place: 1, points: 3 })]);
      secrecy.finalCheck();
    });

    it("with its keep-alive stopped and nobody touching the room: nothing wakes it, and she plays on when she unlocks", async () => {
      const { ctx, say, ws, secrecy } = await locked(false);
      // No turn timer, nobody taps, and the settings step's own wake-up is long past: no alarm is due.
      expect(ctx.alarm.at === null || ctx.alarm.at - Date.now() > 90_000).toBe(true);
      await vi.advanceTimersByTimeAsync(90_000);
      say(ws.ann, { t: "back" });
      await fake.settle();
      expect(ws.ann.closed).toBeNull();
      expect(ctx.room.core.activity.kind).toBe("game");
      expect(ctx.room.core.members[0]).toMatchObject({ connected: true, away: false });
      secrecy.finalCheck();
    });

    it("whose socket the phone closes: she is dropped, and forfeits a minute after the close whatever anyone does", async () => {
      const { ctx, ws, secrecy } = await locked(true);
      await vi.advanceTimersByTimeAsync(5_000);
      ctx.room.webSocketClose(ws.ann, 1006, "");
      await fake.settle();
      expect(ctx.room.core.members[0]).toMatchObject({ connected: false });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(ctx.room.core.activity.kind).toBe("game");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(ctx.room.core.activity.kind).toBe("lobby");
      expect(ws.screen.messages().find((m: Msg) => m.t === "end").last.early).toMatchObject({ seat: 0, why: "gone" });
      secrecy.finalCheck();
    });
  });

  it("ends the match when a player leaves the party: the one who stayed wins, and the last frames keep the secret", async () => {
    const { ctx, say, ws, secrecy } = await party();
    const ann = phone("ann", ws.ann, say);
    // One round played, then Bo leaves in the middle of the next.
    let guard = 0;
    while (stateOf(ctx)!.match.room.roundIndex < 2 && guard++ < 20) {
      const s = ann.snap();
      if (s.status === "round_summary") ann.send("round.next");
      else if (s.turn?.phase === "pending_confirm") phone("bo2", ws.bo, say).send("turn.correct.confirm");
      else if (s.turn) (seatOf(s.turn.playerId) === 0 ? ann : phone("bo3", ws.bo, say)).send(seatOf(s.turn.playerId) === 0 ? "turn.correct.request" : "turn.skip");
      await fake.settle();
    }
    expect(stateOf(ctx)!.match.room.round).not.toBeNull();
    say(ws.bo, { t: "leave" });
    await fake.settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const note = ws.ann.messages().find((m: Msg) => m.t === "note" && m.k === "ended");
    expect(note).toMatchObject({ why: "left", seat: 1, text: "Bo left the party, so Who Am I? ended." });
    expect(ws.ann.messages().flatMap((m: Msg) => (m.t === "ev" ? m.ev : []))).toContainEqual({ k: "abandoned", seat: 1 });
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.result[0]).toMatchObject({ seat: 0, score: expect.any(Number) });
    expect(end.last.rows).toEqual([expect.objectContaining({ seat: 0, place: 1, points: 3, score: end.result[0].score })]);
    expect(end.last.early).toMatchObject({ seat: 1, why: "left" });
    secrecy.finalCheck();
  });

  it("gives the one who stayed the win when the other forfeits, though the stayer's page was hidden meanwhile", async () => {
    const { ctx, say, ws, secrecy } = await party();
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await fake.settle();
    // Ann waits a little, then switches to another app; her socket stays open and keeps its keep-alive.
    await vi.advanceTimersByTimeAsync(5_000);
    say(ws.ann, { t: "away" });
    await fake.settle();
    expect(ctx.room.core.members[0]).toMatchObject({ connected: true, away: true });
    await vi.advanceTimersByTimeAsync(56_000);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.last.early).toMatchObject({ seat: 1, why: "gone" });
    expect(end.last.rows).toEqual([expect.objectContaining({ seat: 0, place: 1, points: 3 })]);
    expect(ctx.room.core.members[0].points).toBe(3);
    secrecy.finalCheck();
  });

  it("gives nobody the win when a player leaves while the other's phone has been gone a while", async () => {
    const { ctx, say, ws, secrecy } = await party();
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await fake.settle();
    // Gone 40 seconds: past the 30 that make him absent, short of the minute that would forfeit him.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(ctx.room.core.activity.kind).toBe("game");
    say(ws.ann, { t: "leave" });
    await fake.settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.last.early).toMatchObject({ seat: 0, why: "left" });
    expect(end.last.rows).toEqual([]);
    expect(ctx.room.core.members[1]?.points ?? 0).toBe(0);
    secrecy.finalCheck();
  });

  it("plays in a party of four: two take the spots, the other two watch as the audience, and only the players place", async () => {
    const r = await turns.spotsFor4(createLobbyRoom, game, ROOM_OPTIONS);
    const { ctx, say, ws } = r;
    const secrecy = watch(ctx, ws, { ann: { kind: "audience" }, bo: { kind: "player", seat: 1 }, cy: { kind: "audience" }, di: { kind: "player", seat: 3 }, screen: { kind: "screen" } });
    // The step offers the game's settings and two spots on the wall.
    expect(roomOf(ws.ann).choosing).toMatchObject({ id: "who-am-i", spots: [{ seat: null }, { seat: null }] });
    // Ann is the host and does not play: Bo and Di take the spots; Cy steps onto one first and off again.
    await turns.standOn(r, ws.bo, 1, 0);
    await turns.standOn(r, ws.cy, 2, 1);
    await turns.stepOff(r, ws.cy, 2, 1);
    await turns.standOn(r, ws.di, 3, 1);
    expect(ctx.room.core.activity.seats).toEqual([1, 3]);
    await chooseAndStart(r, ws.ann, [ws.bo, ws.cy, ws.di, ws.screen], { match: "first_to_3", hints: false });
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [1, 3] });

    // Each device starts on its own view: the players each other's identity, Ann and Cy both, the screen neither.
    const start = (w: Socket) => w.messages().find((m: Msg) => m.t === "start");
    const round = stateOf(ctx)!.match.room.round!;
    expect(start(ws.bo).s).toMatchObject({ role: "player", seat: 1, opponentIdentity: { id: round.assignments["seat-3"] } });
    expect(start(ws.di).s).toMatchObject({ role: "player", seat: 3, opponentIdentity: { id: round.assignments["seat-1"] } });
    for (const w of [ws.ann, ws.cy]) expect(start(w).s).toMatchObject({ role: "audience", identities: [{ seat: 1, identity: { id: round.assignments["seat-1"] } }, { seat: 3, identity: { id: round.assignments["seat-3"] } }] });
    expect(start(ws.screen).s).toMatchObject({ role: "screen" });

    // The audience coming and going is nothing to the game.
    const version = stateOf(ctx)!.match.room.version;
    say(ws.cy, { t: "away" });
    await fake.settle();
    say(ws.cy, { t: "back" });
    await fake.settle();
    expect(stateOf(ctx)!.match.room.version).toBe(version);

    await playOut(ctx, { 1: phone("bo", ws.bo, say), 3: phone("di", ws.di, say) }, 3);
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.last.rows).toEqual([expect.objectContaining({ seat: 3, place: 1, points: 3, score: 3 }), expect.objectContaining({ seat: 1, place: 2, points: 2, score: 0 })]);
    expect([0, 2].map((seat) => ctx.room.core.members[seat].points)).toEqual([0, 0]);
    secrecy.finalCheck();
    // Ann and Cy, every round on (how many snapshots depends on the draw).
    expect(secrecy.checked.audienceSnaps).toBeGreaterThanOrEqual(6);
    fake.expectNoRoomSeed(ctx.room.core, Object.values(ws));
  });

  it("is refused nothing by the room: its definition and its settings have no problems", async () => {
    const { gameProblems }: any = await import(/* @vite-ignore */ `${kit}party-kit/src/core/turns.js`);
    const { settingsProblems, settingFields }: any = await import(/* @vite-ignore */ `${kit}party-kit/src/core/settings.js`);
    expect(gameProblems(game)).toEqual([]);
    expect(settingsProblems(game, manifest.settings)).toEqual([]);
    // Every field the manifest names reaches the step as it is written.
    expect(settingFields(manifest.settings).fields.map((f: { key: string }) => f.key)).toEqual(manifest.settings.map((f) => f.key));
  });
});
