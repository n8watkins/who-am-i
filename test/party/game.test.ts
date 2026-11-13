// The party adapter (src/party/game.ts), in plain Node: the game in the shape the party kit will
// host, and the secrecy rules at that edge.
import { describe, expect, it } from "vitest";
import { game, manifest, type Carry, type GameState, type Sources } from "../../src/party/game";
import { DEFAULT_SETTINGS, HINTS_PER_TURN, type Settings } from "../../src/shared/protocol";
import { getIdentity } from "../../src/worker/content";

const START = 1_000_000;
const SEATS = [
  { seat: 4, name: "Bob" },
  { seat: 1, name: "Alice" },
];

/** Seeded randomness (mulberry32) and counting ids, so every run plays the same match. */
function seeded(seed: number): Sources {
  let a = seed >>> 0;
  let n = 0;
  return {
    random: () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    newId: () => `id-${seed}-${++n}`,
  };
}

let commands = 0;
function command(state: GameState, type: string, extra: object = {}) {
  return { type, commandId: `party-test-${++commands}`, expectedVersion: state.room.version, ...extra };
}

function start(settings: Partial<Settings> = {}, opts: { seed?: number; carry?: Carry | null; now?: number } = {}) {
  const sources = seeded(opts.seed ?? 3);
  const state = game.create({ seats: SEATS, settings: { ...DEFAULT_SETTINGS, ...settings }, now: opts.now ?? START, carry: opts.carry, sources });
  return { state, sources };
}

const seatOfPlayer = (id: string | undefined) => (id ? Number(id.replace("seat-", "")) : null);
const turnSeat = (state: GameState) => seatOfPlayer(state.room.turn?.playerId);
const otherSeat = (state: GameState, seat: number) => state.seats.find((s) => s !== seat)!;
const assignmentOf = (state: GameState, seat: number) => state.room.round?.assignments[`seat-${seat}`];

describe("manifest and game", () => {
  it("describe a two-player, phone-upright game the kit can list", () => {
    expect(manifest.id).toBe("who-am-i");
    expect(game.id).toBe(manifest.id);
    expect(manifest.players).toEqual({ min: 2, max: 2, solo: false });
    expect(manifest.devices.sideways).toBe(false);
    expect([game.minSeats, game.maxSeats, game.tickHz]).toEqual([2, 2, 0]);
    expect(game.bots).toBe(false);
  });

  it("checks settings and fills in the defaults", () => {
    expect(game.settings(undefined)).toEqual({ ok: true, settings: DEFAULT_SETTINGS });
    expect(game.settings({ ...DEFAULT_SETTINGS, timerSeconds: 45 })).toMatchObject({ ok: false, error: "bad_request" });
    expect(() => game.create({ seats: SEATS, settings: { packId: "nope" }, now: START })).toThrow();
  });

  it("takes exactly two seats", () => {
    expect(() => game.create({ seats: [SEATS[0]!], now: START })).toThrow("exactly two seats");
    expect(() => game.create({ seats: [...SEATS, { seat: 7, name: "Cy" }], now: START })).toThrow("exactly two seats");
  });
});

describe("create", () => {
  it("starts the match at once with both seats connected, lower seat first as host", () => {
    const { state } = start({ firstPlayer: "host" });
    expect(state.seats).toEqual([1, 4]);
    expect(state.room.status).toBe("guessing_first");
    expect(state.room.players.every((p) => p.connected)).toBe(true);
    expect(turnSeat(state)).toBe(1);
    const alice = game.snapshot(state, START, { role: "player", seat: 1 });
    expect("youId" in alice && alice.opponentIdentity?.id).toBe(assignmentOf(state, 4));
  });

  it("draws identities from its own randomness, not from anything the room sends", () => {
    const a = start({}, { seed: 1 }).state;
    const b = start({}, { seed: 2 }).state;
    expect([assignmentOf(a, 1), assignmentOf(a, 4)]).not.toEqual([assignmentOf(b, 1), assignmentOf(b, 4)]);
    expect(() => game.create({ seats: SEATS, now: START })).not.toThrow();
  });
});

describe("input", () => {
  it("answers ok or with a clear error", () => {
    const { state, sources } = start({ firstPlayer: "host", turnFormat: "keep_going" });
    expect(game.input(state, 9, command(state, "turn.skip"), START, sources)).toMatchObject({ ok: false, error: "forbidden" });
    expect(game.input(state, 1, { type: "turn.skip" }, START, sources)).toMatchObject({ ok: false, error: "bad_request" });
    expect(game.input(state, 4, command(state, "turn.skip"), START, sources)).toMatchObject({ ok: false, error: "forbidden" });
    expect(game.input(state, 1, { ...command(state, "turn.skip"), expectedVersion: 0 }, START, sources)).toMatchObject({
      ok: false,
      error: "version_conflict",
    });
    expect(game.input(state, 1, command(state, "turn.hint"), START, sources)).toEqual({ ok: true, duplicate: false });
  });

  it("applies a repeated command once", () => {
    const { state, sources } = start({ firstPlayer: "host" });
    const hint = command(state, "turn.hint");
    expect(game.input(state, 1, hint, START, sources)).toEqual({ ok: true, duplicate: false });
    const version = state.room.version;
    expect(game.input(state, 1, hint, START, sources)).toEqual({ ok: true, duplicate: true });
    expect(state.room.version).toBe(version);
    expect(state.room.turn?.hintsUsed).toBe(1);
  });

  it("leaves the lobby, settings, seats and rematches to the party room", () => {
    const { state, sources } = start();
    for (const type of ["match.start", "match.rematch", "match.change_settings", "player.leave", "player.ready"]) {
      expect(game.input(state, 1, command(state, type, type === "player.ready" ? { ready: true } : {}), START, sources)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
    }
    const settings = command(state, "settings.update", { settings: DEFAULT_SETTINGS });
    expect(game.input(state, 1, settings, START, sources)).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("timer, tick and presence", () => {
  it("puts the turn deadline on nextDeadline and ends the turn at tick", () => {
    const { state, sources } = start({ firstPlayer: "host", timerSeconds: 60, turnFormat: "keep_going" });
    const deadline = game.nextDeadline(state);
    expect(deadline).toBe(START + 60_000);
    expect(game.tick(state, deadline! - 1, sources)).toEqual([]);
    expect(game.tick(state, deadline!, sources)).toEqual([{ k: "timed_out", seat: 1 }]);
    expect(state.room.round?.results["seat-1"]).toBe("timed_out");
    expect(turnSeat(state)).toBe(4);
  });

  it("ends a turn that ran out before taking a late move", () => {
    const { state, sources } = start({ firstPlayer: "host", timerSeconds: 60, turnFormat: "keep_going" });
    const late = START + 61_000;
    // The move was made against the state before the timeout, so it is refused as stale.
    expect(game.input(state, 1, command(state, "turn.hint"), late, sources)).toMatchObject({ ok: false, error: "version_conflict" });
    expect(state.room.round?.results["seat-1"]).toBe("timed_out");
  });

  it("pauses the timer while a phone is gone or away, and reports only real changes", () => {
    const { state, sources } = start({ firstPlayer: "host", timerSeconds: 60 });
    expect(game.presence(state, 4, { connected: true, away: false }, START + 1_000, sources)).toBe(false);
    expect(game.presence(state, 4, { connected: true, away: true }, START + 1_000, sources)).toBe(true);
    expect(game.nextDeadline(state)).toBeNull();
    expect(state.room.turn?.pausedRemainingMs).toBe(59_000);
    expect(game.presence(state, 4, { connected: true, away: false }, START + 5_000, sources)).toBe(true);
    expect(game.nextDeadline(state)).toBe(START + 64_000);
    expect(game.presence(state, 4, { connected: false, away: false }, START + 6_000, sources)).toBe(true);
    expect(game.nextDeadline(state)).toBeNull();
    expect(game.presence(state, 9, { connected: false, away: false }, START, sources)).toBe(false);
  });

  it("lets the host confirm their own guess once the other phone has been gone 30 seconds", () => {
    const { state, sources } = start({ firstPlayer: "host" });
    expect(game.input(state, 1, command(state, "turn.correct.request"), START, sources).ok).toBe(true);
    game.presence(state, 4, { connected: false, away: false }, START, sources);
    expect(game.input(state, 1, command(state, "turn.correct.override"), START + 29_000, sources)).toMatchObject({ ok: false });
    expect(game.input(state, 1, command(state, "turn.correct.override"), START + 30_000, sources)).toMatchObject({ ok: true });
  });
});

/** One guessing turn the quick way: the guesser is right, or gives up when `skip`. */
function playTurn(state: GameState, now: number, sources: Sources, skip = false) {
  const seat = turnSeat(state)!;
  if (skip) {
    expect(game.input(state, seat, command(state, "turn.skip"), now, sources).ok).toBe(true);
    return;
  }
  expect(game.input(state, seat, command(state, "turn.correct.request"), now, sources).ok).toBe(true);
  expect(game.input(state, otherSeat(state, seat), command(state, "turn.correct.confirm"), now, sources).ok).toBe(true);
}

/** Plays one round to its end, every guesser right. */
function solveRound(state: GameState, now: number, sources: Sources) {
  while (state.room.round) playTurn(state, now, sources);
}

/** Plays to the match summary: `skipSeat` always gives up, and with no skipper everyone gives up. */
function finishMatch(state: GameState, now: number, sources: Sources, opts: { skipSeat?: number } = {}) {
  while (!game.isOver(state)) {
    if (state.room.status === "round_summary") {
      expect(game.input(state, 1, command(state, "round.next"), now, sources).ok).toBe(true);
      continue;
    }
    playTurn(state, now, sources, opts.skipSeat === undefined || turnSeat(state) === opts.skipSeat);
  }
}

describe("the end of a match", () => {
  it("gives places, a result with no identity, and a carry for the rematch", () => {
    const { state, sources } = start({ firstPlayer: "host", turnFormat: "keep_going" });
    expect(game.standings(state)).toEqual([]);
    expect(game.carry(state)).toBeNull();
    finishMatch(state, START, sources, { skipSeat: 4 });
    expect(game.isOver(state)).toBe(true);
    expect(game.result(state)).toEqual({
      winnerSeat: 1,
      tie: false,
      rounds: 5,
      scores: [
        { seat: 1, score: 5 },
        { seat: 4, score: 0 },
      ],
    });
    expect(game.standings(state)).toEqual([
      { seat: 1, place: 1 },
      { seat: 4, place: 2 },
    ]);
    const carry = game.carry(state)!;
    expect(carry).toMatchObject({ seats: [1, 4], winnerSeat: 1, tie: false, firstSeat: 1 });
    expect(carry.usedIdentityIds).toHaveLength(10);
  });

  it("shares first place after a tie", () => {
    const { state, sources } = start({ firstPlayer: "host", turnFormat: "keep_going", matchType: "rounds" });
    finishMatch(state, START, sources);
    expect(game.result(state)).toMatchObject({ tie: true, winnerSeat: null, rounds: 10 });
    expect(game.standings(state)).toEqual([
      { seat: 1, place: 1 },
      { seat: 4, place: 1 },
    ]);
  });

  it("starts a rematch from the carry: the loser first, no identity from the last match", () => {
    const first = start({ firstPlayer: "host", turnFormat: "keep_going", packId: "brand-mascots" });
    finishMatch(first.state, START, first.sources, { skipSeat: 4 });
    const carry = game.carry(first.state)!;
    const { state } = start({ firstPlayer: "host", turnFormat: "keep_going", packId: "brand-mascots" }, { carry, seed: 9 });
    expect(state.room.status).toBe("guessing_first");
    expect(turnSeat(state)).toBe(4);
    for (const seat of state.seats) expect(carry.usedIdentityIds).not.toContain(assignmentOf(state, seat));
    expect(state.room.players.every((p) => p.score === 0)).toBe(true);
  });

  it("ignores a carry from two other seats", () => {
    const first = start({ firstPlayer: "host", turnFormat: "keep_going" });
    finishMatch(first.state, START, first.sources, { skipSeat: 4 });
    const carry = { ...game.carry(first.state)!, seats: [1, 7] as [number, number] };
    const { state } = start({ firstPlayer: "host" }, { carry });
    expect(turnSeat(state)).toBe(1);
    expect(state.room.usedIdentityIds).toHaveLength(2);
  });
});

describe("serialize and restore", () => {
  it("round-trips a match in progress", () => {
    const { state, sources } = start({ timerSeconds: 90 });
    game.input(state, turnSeat(state)!, command(state, "turn.hint"), START, sources);
    const restored = game.restore(game.serialize(state));
    expect(restored).toEqual(state);
    expect(game.snapshot(restored, START, { role: "player", seat: 1 })).toEqual(game.snapshot(state, START, { role: "player", seat: 1 }));
  });

  it("refuses anything that is not a saved game", () => {
    expect(() => game.restore("{}")).toThrow("Not a saved Who Am I? game");
    expect(() => game.restore(JSON.stringify({ room: { schema: 1 }, seats: [1] }))).toThrow();
    expect(() => game.restore("not json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Secrecy at the edge: every state a scripted match reaches is checked from every viewer.

const escaped = (text: string) => JSON.stringify(text).slice(1, -1);

function identityTexts(id: string): string[] {
  const identity = getIdentity(id);
  return [identity.id, escaped(identity.canonicalName), ...identity.hints.map(escaped)];
}

interface SecrecyLog {
  states: number;
  /** Every identity this match assigned, to check the screen against. */
  assigned: Set<string>;
  /** Every typed question, which a screen never shows either. */
  questions: Set<string>;
}

function checkSecrecy(state: GameState, now: number, log: SecrecyLog) {
  log.states++;
  const round = state.room.round;
  if (round) for (const id of Object.values(round.assignments)) log.assigned.add(id);

  for (const seat of state.seats) {
    const json = JSON.stringify(game.snapshot(state, now, { role: "player", seat }));
    const own = assignmentOf(state, seat);
    if (!own) continue; // No round in progress: a finished round's summary is the reveal.
    const identity = getIdentity(own);
    const opponent = getIdentity(assignmentOf(state, otherSeat(state, seat))!);
    expect(json, `seat ${seat} sees their own identity id`).not.toContain(identity.id);
    expect(json, `seat ${seat} sees their own identity name`).not.toContain(escaped(identity.canonicalName));
    // Hints for their own identity arrive one at a time, only when asked for. A hint whose words
    // also sit inside one of the opponent's hints is skipped: the player may see those.
    const revealed = round?.hintsUsed[`seat-${seat}`] ?? 0;
    identity.hints.forEach((hint, i) => {
      if (i < revealed || opponent.hints.some((theirs) => theirs.includes(hint))) return;
      expect(json, `seat ${seat} sees their unrequested hint ${i + 1}`).not.toContain(escaped(hint));
    });
  }

  for (const viewer of [{ role: "screen" } as const, { role: "player", seat: 99 } as const]) {
    const json = JSON.stringify(game.snapshot(state, now, viewer));
    for (const id of log.assigned) for (const text of identityTexts(id)) expect(json, "a screen sees an identity").not.toContain(text);
    for (const question of log.questions) expect(json, "a screen sees a question").not.toContain(escaped(question));
    expect(json).not.toMatch(/"(log|opponentIdentity|roundSummary|identity|assignments|usedIdentityIds)"/);
  }
}

/** Plays a whole match with every kind of move, checking secrecy after each one. Returns what happened. */
function scriptedMatch(settings: Partial<Settings>, seed: number) {
  const { state, sources } = start(settings, { seed });
  const pick = seeded(seed + 100).random;
  const log: SecrecyLog = { states: 0, assigned: new Set(), questions: new Set() };
  const happened = new Set<string>();
  let now = START;
  let movesThisRound = 0;
  checkSecrecy(state, now, log);

  const act = (seat: number, type: string, extra: object = {}) => {
    const result = game.input(state, seat, command(state, type, extra), now, sources);
    if (result.ok) happened.add(type);
    checkSecrecy(state, now, log);
    return result.ok;
  };

  for (let step = 0; step < 2_000 && !game.isOver(state); step++) {
    now += 1_000;
    if (state.room.status === "round_summary") {
      movesThisRound = 0;
      act(state.seats[step % 2]!, "round.next");
      continue;
    }
    const guesser = turnSeat(state)!;
    const other = otherSeat(state, guesser);
    const turn = state.room.turn!;
    const pending = turn.log.find((e) => e.kind === "question" && e.answer === null);
    movesThisRound++;

    if (turn.phase === "pending_confirm") {
      act(other, pick() < 0.4 ? "turn.correct.reject" : "turn.correct.confirm");
    } else if (pending) {
      act(other, "turn.answer", { questionId: pending.id, answer: ["yes", "no", "sort_of", "dont_know"][Math.floor(pick() * 4)] });
    } else if (movesThisRound > 12) {
      act(guesser, pick() < 0.8 ? "turn.correct.request" : "turn.skip");
    } else {
      const roll = pick();
      if (roll < 0.2) {
        const text = `Is it question ${step}?`;
        if (act(guesser, "turn.ask", { text })) log.questions.add(text);
      } else if (roll < 0.35 && turn.hintsUsed < HINTS_PER_TURN) act(guesser, "turn.hint");
      else if (roll < 0.45) act(guesser, "turn.question");
      else if (roll < 0.55) act(guesser, "turn.pass");
      else if (roll < 0.65) {
        // A phone locks and comes back, or drops and reconnects.
        const connected = pick() < 0.5;
        if (game.presence(state, other, { connected, away: connected }, now, sources)) happened.add(connected ? "away" : "offline");
        checkSecrecy(state, now, log);
        now += 5_000;
        game.presence(state, other, { connected: true, away: false }, now, sources);
        checkSecrecy(state, now, log);
      } else if (roll < 0.75 && game.nextDeadline(state) !== null) {
        now = game.nextDeadline(state)!;
        if (game.tick(state, now, sources).length) happened.add("timed_out");
        checkSecrecy(state, now, log);
      } else if (roll < 0.85) act(guesser, "turn.correct.request");
      else act(guesser, "turn.skip");
    }
  }
  expect(game.isOver(state)).toBe(true);
  return { log, happened, state };
}

describe("secrecy at the edge", () => {
  it("never shows a player their own identity, and a screen no identity, in a trade-turns match", () => {
    const { log, happened } = scriptedMatch({ turnFormat: "trade", timerSeconds: 60, questions: "both", hints: true }, 11);
    expect(log.states).toBeGreaterThan(80);
    for (const move of ["turn.ask", "turn.answer", "turn.hint", "turn.pass", "turn.correct.reject", "turn.correct.confirm", "round.next", "away", "offline", "timed_out"]) {
      expect(happened, move).toContain(move);
    }
  });

  it("does the same in a keep-going match with the question counter", () => {
    const { log, happened } = scriptedMatch({ turnFormat: "keep_going", timerSeconds: 90, questions: "spoken", matchType: "rounds" }, 12);
    expect(log.states).toBeGreaterThan(80);
    for (const move of ["turn.question", "turn.hint", "turn.skip", "turn.correct.confirm", "timed_out"]) expect(happened, move).toContain(move);
  });

  it("shows each player their opponent's identity, and a finished round to both", () => {
    const { state, sources } = start({ firstPlayer: "host", turnFormat: "keep_going" });
    const ids = [assignmentOf(state, 1)!, assignmentOf(state, 4)!];
    const bob = game.snapshot(state, START, { role: "player", seat: 4 });
    expect("youId" in bob && bob.opponentIdentity?.id).toBe(ids[0]);
    solveRound(state, START, sources);
    for (const seat of state.seats) {
      const view = game.snapshot(state, START, { role: "player", seat });
      expect("youId" in view && view.roundSummary?.entries.map((e) => e.identity.id)).toEqual(ids);
    }
    const screen = JSON.stringify(game.snapshot(state, START, { role: "screen" }));
    for (const id of ids) expect(screen).not.toContain(id);
  });

  it("gives a screen only turn, timer and question count", () => {
    const { state } = start({ firstPlayer: "host", timerSeconds: 60 });
    expect(game.snapshot(state, START, { role: "screen" })).toEqual({
      role: "screen",
      version: state.room.version,
      serverNow: START,
      status: "guessing_first",
      roundIndex: 1,
      players: [
        { seat: 1, name: "Alice" },
        { seat: 4, name: "Bob" },
      ],
      turn: { seat: 1, phase: "asking", deadline: START + 60_000, pausedRemainingMs: null, questionCount: 0 },
    });
  });
});
