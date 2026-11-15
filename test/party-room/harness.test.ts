// Who Am I? in the party room's real room class (n8watkins/n8-party-games, lobby/server/lobby-room.js
// at the commit pinned in scripts/party-room-checkout.mjs), driven with the fake Durable Object
// runtime the party room's own tests use (lobby/test/fake-room.js): fake sockets that keep every
// frame, fake storage that outlives an instance, the alarm, and the clock.
//
// Two players play a whole match through the room, as their phones would: each input with an id,
// built from the snapshot that phone last got. The room is rebuilt over the same storage in the
// middle (an eviction or a deploy). Every frame any socket is sent is checked against the secret.
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { game } from "../../party";
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
const { createLobbyRoom }: any = await import(/* @vite-ignore */ `${kit}lobby/server/lobby-room.js`);

type Socket = { frames: string[]; closed: unknown; onSend: ((text: string) => void) | null; messages(): any[]; text(): string };
type Msg = { t: string; [key: string]: any };
type PlayerSnap = RoomView & { role: "player"; seat: number; match: string };

beforeEach(fake.useFakeRuntime);
afterEach(fake.dropFakeRuntime);

const escaped = (text: string) => JSON.stringify(text).slice(1, -1);
const playerOf = (seat: number) => `seat-${seat}`;
const seatOf = (id: string | null | undefined) => (id ? Number(id.replace("seat-", "")) : null);

/**
 * A party of Ann and Bo (seats 0 and 1) and a big screen, voted into Who Am I? (`which`: the
 * game, or a variant of it). Every frame is checked as it is sent (`watch`), and Cy joins as a
 * watcher once the match is on.
 */
async function party(which: typeof game = game) {
  const r = await fake.openRoom(createLobbyRoom, which, { players: { min: 2, max: 2 } });
  const { ctx, connect } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const screen = await ctx.room.join({ as: "screen" });
  const ws: Record<string, Socket> = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
  const secrecy = watch(ctx, ws);
  await fake.voteIn(r, [ws.ann, 0], [ws.bo, 1]);
  await fake.settle();
  expect(ctx.room.core.activity).toMatchObject({ kind: "game", id: "who-am-i", seats: [0, 1] });
  const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
  const all = { ann: ws.ann!, bo: ws.bo!, screen: ws.screen!, cy: (await connect(cy.token)) as Socket };
  ws.cy = all.cy;
  secrecy.add("cy", all.cy);
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
 * Checks every frame as the room sends it, against the game's state at that moment: a player is
 * never sent the identity they are guessing (its id, name or a long alias) or a hint for it they
 * did not ask for; the screen and a watcher are never sent any identity, hint, typed question or
 * log. Records every identity the match assigned, to check the whole of each socket at the end.
 */
function watch(ctx: any, sockets: Record<string, Socket>) {
  let last: RoomGameState | null = null;
  const assigned = new Map<string, number>();
  const questions = new Set<string>();
  const checked = { frames: 0 };
  // The room catches what a socket's send throws, so a failed check is kept, not thrown.
  const problems: string[] = [];
  const mustNotHave = (text: string, secret: string, what: string) => {
    if (text.includes(secret)) problems.push(`${what}: ${secret}`);
  };
  const checkPlayer = (seat: number, text: string) => {
    const state = stateOf(ctx) ?? last;
    if (!state) return;
    last = state;
    const round = state.match.room.round;
    if (!round) return; // a round's summary is its reveal
    for (const s of state.match.seats) assigned.set(round.assignments[playerOf(s)]!, s);
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
  const checkWatcher = (who: string, text: string) => {
    const key = /"(log|opponentIdentity|roundSummary|identity|identities|assignments|youId)"/.exec(text);
    if (key) problems.push(`${who} was sent ${key[0]}`);
    for (const id of assigned.keys()) {
      const identity = getIdentity(id);
      for (const secret of [identity.id, identity.canonicalName, ...identity.hints].map(escaped)) mustNotHave(text, secret, `${who} was sent an identity`);
    }
    for (const question of questions) mustNotHave(text, escaped(question), `${who} was sent a question`);
  };
  const add = (who: string, ws: Socket) => {
    ws.onSend = (text) => {
      checked.frames++;
      if (who === "ann") checkPlayer(0, text);
      else if (who === "bo") checkPlayer(1, text);
      else {
        const state = stateOf(ctx);
        if (state?.match.room.round) for (const s of state.match.seats) assigned.set(state.match.room.round.assignments[playerOf(s)]!, s);
        checkWatcher(who, text);
      }
    };
  };
  for (const [who, ws] of Object.entries(sockets)) add(who, ws);
  return {
    add,
    checked,
    assigned,
    questions,
    problems,
    /** After the match: every frame each watcher was ever sent, against every identity the match used; and no problem seen on the way. */
    finalCheck() {
      for (const who of ["screen", "cy"]) checkWatcher(who, sockets[who]!.text());
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

describe("Who Am I? in the party room", () => {
  it("plays a whole match through the real room class, rebuilt in the middle, and nobody is sent what they must not see", async () => {
    const r = await party();
    const { ctx, say, ws, secrecy } = r;
    expect(game.tickHz).toBe(0);
    // No timer runs for a turn-based game, and with no turn timer there is no deadline.
    expect(ctx.room.timer).toBeNull();

    // Each phone starts on its own view: the other's identity, never its own; the screen and Cy get the screen's.
    const start = (w: Socket) => w.messages().find((m: Msg) => m.t === "start");
    const state0 = stateOf(ctx)!;
    expect(start(ws.ann).s).toMatchObject({ role: "player", seat: 0, youId: "seat-0", match: "first_to_3", opponentIdentity: { id: state0.match.room.round!.assignments["seat-1"] } });
    expect(start(ws.bo).s).toMatchObject({ role: "player", seat: 1, opponentIdentity: { id: state0.match.room.round!.assignments["seat-0"] } });
    expect(start(ws.screen).s).toMatchObject({ role: "screen", turn: { questionCount: 0 } });
    expect(ws.cy.messages().find((m: Msg) => m.t === "snap")).toMatchObject({ full: true, s: { role: "screen" } });
    expect(start(ws.ann).room).toMatchObject({ phase: "playing", game: { id: "who-am-i", turns: true } });

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

    // The room is rebuilt over the same storage, as after an eviction or a deploy, mid-match.
    const before = game.serialize(stateOf(ctx)!);
    const sent = Object.values(ws).map((w) => w.frames.length);
    await r.sleepAndWake();
    expect(game.serialize(stateOf(ctx)!)).toBe(before);
    // Nobody is sent anything for the wake itself.
    expect(Object.values(ws).map((w) => w.frames.length)).toEqual(sent);

    // The rest of the match, as the phones see it: Ann is always right, Bo always gives up.
    let guard = 0;
    while (ctx.room.core.activity.kind === "game" && guard++ < 200) {
      const s = ann.snap();
      if (s.status === "round_summary") {
        bo.send("round.next");
      } else if (s.turn?.phase === "pending_confirm") {
        bySeat[1 - seatOf(s.turn.playerId)!]!.send("turn.correct.confirm");
      } else if (s.turn) {
        const seat = seatOf(s.turn.playerId)!;
        if (seat === 0) ann.send("turn.correct.request");
        else bo.send(s.settings.turnFormat === "trade" && !s.turn.moveAsked ? "turn.pass" : "turn.skip");
      }
      await step();
    }
    expect(ctx.room.core.activity.kind).toBe("lobby");

    // The end: everyone hears it, with a result that names nobody's identity, and Ann has the night's points.
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.result).toMatchObject({ winnerSeat: 0, tie: false, scores: [{ seat: 0, score: 3 }, { seat: 1, score: expect.any(Number) }] });
    expect(end.last.rows[0]).toMatchObject({ seat: 0, place: 1, points: 3 });
    expect(ctx.room.core.members[0].points).toBe(3);
    // The last tap twice is still answered, and never applied twice.
    for (const p of [ann, bo]) expect(p.answers().every((m: Msg) => m.t === "ack" || m.error !== "game_error")).toBe(true);

    secrecy.finalCheck();
    expect(secrecy.assigned.size).toBeGreaterThanOrEqual(6);
    expect(secrecy.checked.frames).toBeGreaterThan(100);
    fake.expectNoRoomSeed(ctx.room.core, Object.values(ws));
  });

  it("wakes at the turn timer, pauses it while a phone is hidden or gone, and the room's alarm follows", async () => {
    // The room passes no settings yet: a variant of the game with a 60 second timer.
    const timed = { ...game, create: (input: Parameters<typeof game.create>[0]) => game.create({ ...input, settings: { timerSeconds: 60, turnFormat: "keep_going" } }) };
    const { ctx, say, ws, secrecy } = await party(timed);
    const ann = phone("ann", ws.ann, say);
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
    // Nothing ticks while it is paused, however long.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(seatOf(ann.snap().turn!.playerId)).toBe(second);

    // Back: it runs on from 50 seconds.
    say(waiting, { t: "back" });
    await fake.settle();
    const resumed = lastSnap(ws.screen) as unknown as { turn: { deadline: number } };
    expect(resumed.turn.deadline).toBe(Date.now() + 50_000);

    // The phone drops: the seat is held (no grace runs out: Infinity), and the timer pauses again.
    ctx.room.webSocketClose(waiting, 1006, "");
    await fake.settle();
    expect(lastSnap(ws.screen)).toMatchObject({ turn: { deadline: null } });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ctx.room.core.activity.kind).toBe("game");
    secrecy.finalCheck();
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
    expect(note).toMatchObject({ why: "left", seat: 1, text: "Bo left the party, so who-am-i ended." });
    expect(ws.ann.messages().flatMap((m: Msg) => (m.t === "ev" ? m.ev : []))).toContainEqual({ k: "abandoned", seat: 1 });
    const end = ws.screen.messages().find((m: Msg) => m.t === "end");
    expect(end.result).toMatchObject({ winnerSeat: 0, abandonedBy: 1 });
    expect(end.last.rows).toEqual([expect.objectContaining({ seat: 0, place: 1, points: 3 })]);
    expect(end.last.early).toMatchObject({ seat: 1, why: "left" });
    secrecy.finalCheck();
  });

  it("is refused nothing by the room: its definition has no problems", async () => {
    const { gameProblems }: any = await import(/* @vite-ignore */ `${kit}party-kit/src/core/turns.js`);
    expect(gameProblems(game)).toEqual([]);
  });
});
