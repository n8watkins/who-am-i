// Who Am I? as the party room's game (party.ts, src/party/room-game.ts), in plain Node: every
// function of the party kit's game contract, and the secrecy rule across whole matches as the
// party room would run them (each input applied to restore(serialize(state)), every viewer's
// snapshot and every event scanned).
import { describe, expect, it } from "vitest";
// The source (party.ts's two names). "../../party" would resolve to the built party.js beside it.
import { game } from "../../src/party/room-game";
import { manifest } from "../../src/party/manifest";
// The built module a party site imports (the package's "." export): it must be the source.
import * as built from "../../party.js";
import { CARRY_MAX_BYTES, RoomSettingsSchema, type AudienceView, type RoomGameState, type RoomSnapshot, type Sources } from "../../src/party/room-game";
import { SETTING_FIELDS } from "../../src/party/manifest";
import { HINTS_PER_TURN, type RoomView } from "../../src/shared/protocol";
import { getIdentity } from "../../src/worker/content";

const START = 1_700_000_000_000;
/** The party's seats as the room hands them over: its own numbers, with gaps. */
const SEATS = [
  { seat: 2, name: "Bo", kind: "human", colour: "#f00" },
  { seat: 0, name: "Ann", kind: "human", colour: "#0f0" },
];

/** Seeded randomness (mulberry32) and counting ids, so a test plays the same match every run. */
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
const command = (state: RoomGameState, type: string, extra: object = {}) => ({
  type,
  commandId: `room-test-${++commands}`,
  expectedVersion: state.match.room.version,
  ...extra,
});

function start(settings: object = {}, opts: { seed?: number; carry?: unknown; seats?: typeof SEATS } = {}) {
  const sources = seeded(opts.seed ?? 5);
  const state = game.create({ seed: 1234, seats: opts.seats ?? SEATS, now: START, round: 1, settings, carry: opts.carry, sources });
  return { state, sources };
}

const seatOf = (id: string | null | undefined) => (id ? Number(id.replace("seat-", "")) : null);
const turnSeat = (state: RoomGameState) => seatOf(state.match.room.turn?.playerId);
const other = (state: RoomGameState, seat: number) => state.match.seats.find((s) => s !== seat)!;
const assignment = (state: RoomGameState, seat: number) => state.match.room.round?.assignments[`seat-${seat}`];
const asPlayer = (s: RoomSnapshot) => {
  expect(s.role).toBe("player");
  return s as RoomView & { role: "player"; seat: number; match: string };
};

/** One turn the quick way: right, or giving up when `skip`. */
function playTurn(state: RoomGameState, now: number, sources: Sources, skip = false, g = game) {
  const seat = turnSeat(state)!;
  if (skip) {
    expect(g.input(state, seat, command(state, "turn.skip"), now, sources)).toMatchObject({ ok: true });
    return;
  }
  expect(g.input(state, seat, command(state, "turn.correct.request"), now, sources)).toMatchObject({ ok: true });
  expect(g.input(state, other(state, seat), command(state, "turn.correct.confirm"), now, sources)).toMatchObject({ ok: true });
}

/** To the end of the match: `winner` is always right, the other always gives up. */
function playMatch(state: RoomGameState, sources: Sources, winner: number, g = game) {
  let rounds = 0;
  while (!g.isOver(state)) {
    if (state.match.room.status === "round_summary") {
      expect(g.input(state, winner, command(state, "round.next"), START, sources)).toMatchObject({ ok: true });
      rounds++;
      continue;
    }
    playTurn(state, START, sources, turnSeat(state) !== winner, g);
  }
  return rounds;
}

describe("the contract surface", () => {
  it("is a turn-based game for exactly two humans, with lifetimes for a long talking match", () => {
    expect(game.id).toBe(manifest.id);
    expect([game.minSeats, game.maxSeats, game.tickHz]).toEqual([2, 2, 0]);
    // A phone gone for a minute forfeits (the owner's rule, 2026-11-15), so the match cannot freeze.
    expect(game.reconnectGraceMs).toBe(60_000);
    expect(game.idleShutdownMs).toBe(60 * 60_000);
    expect(game.staleRoomMs).toBe(60 * 60_000);
    // Humans only: nothing for the room to hand a dropped seat to.
    expect("bot" in game).toBe(false);
    for (const name of ["create", "input", "snapshot", "isOver", "nextDeadline", "tick", "serialize", "restore", "presence", "abandon", "result", "standings", "settings", "carry"] as const) {
      expect(typeof game[name], name).toBe("function");
    }
  });

  it("is the same game in the built party.js a party site imports: the same manifest, and the same match", () => {
    expect(JSON.stringify(built.manifest)).toBe(JSON.stringify(manifest));
    const keys = (g: object) => Object.keys(g).sort();
    expect(keys(built.game)).toEqual(keys(game));
    const play = (g: typeof game) => {
      const sources = seeded(8);
      const state = g.create({ seats: SEATS, now: START, settings: { turnFormat: "keep_going" }, sources });
      playMatch(state, sources, 0, g);
      return g.serialize(state);
    };
    commands = 5_000;
    const fromSource = play(game);
    commands = 5_000;
    expect(play(built.game as typeof game)).toBe(fromSource);
  });

  it("names its room view and nothing else as public files", () => {
    expect(manifest).toMatchObject({ id: "who-am-i", path: "/who-am-i/", players: { min: 2, max: 2, solo: false }, lobby: { view: "party-view/view.js" } });
    expect(manifest.public).toEqual([{ from: "party-view", to: "party-view" }]);
  });

  it("plays in a party of up to four, two playing and the rest watching, on phones held upright", () => {
    // A larger party may vote for it: its two players stand on spots and the others are its audience.
    expect(manifest.audience).toBe(true);
    // A phone each (the room's badge), a big screen that may join, and laid out upright.
    expect(manifest.devices).toEqual({ phone: true, desktop: false, sharedScreen: true, sideways: false, upright: true });
  });
});

describe("settings", () => {
  it("fills in the defaults: the game's own, first to 3, and no settings at all is the defaults", () => {
    const defaults = game.settings(undefined);
    expect(defaults).toEqual({
      packId: "mixed",
      mode: "twenty_questions",
      turnFormat: "trade",
      questions: "both",
      timerSeconds: 0,
      hints: true,
      difficulty: "medium",
      match: "first_to_3",
    });
    expect(game.settings({})).toEqual(defaults);
    expect(game.settings({ timerSeconds: 90, match: "rounds_10" })).toMatchObject({ timerSeconds: 90, match: "rounds_10", mode: "twenty_questions" });
    // Anything the room passes that is not a field is dropped.
    expect(game.settings({ firstPlayer: "host", extra: 1 })).toEqual(defaults);
  });

  it("refuses a value that is not one of the choices, with a sentence", () => {
    for (const bad of [{ timerSeconds: 45 }, { packId: "nope" }, { match: "first_to_9" }, { hints: "yes" }, "first_to_3", 7]) {
      const refused = game.settings(bad);
      expect(refused, JSON.stringify(bad)).toMatchObject({ ok: false, error: "bad_settings" });
      expect((refused as { message: string }).message.length).toBeGreaterThan(5);
    }
    expect(() => game.create({ seats: SEATS, now: START, settings: { mode: "charades" } })).toThrow();
  });

  it("keeps the manifest's fields and the check in step: every option is accepted, every default is the check's", () => {
    const defaults = game.settings({}) as Record<string, unknown>;
    expect(SETTING_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(RoomSettingsSchema.shape).sort());
    for (const field of SETTING_FIELDS) {
      expect(field.default, field.key).toEqual(defaults[field.key]);
      expect(field.options.length).toBeLessThanOrEqual(24);
      for (const option of field.options) expect(game.settings({ [field.key]: option.value }), `${field.key}=${option.value}`).toMatchObject({ [field.key]: option.value });
    }
    expect(SETTING_FIELDS.length).toBeLessThanOrEqual(16);
  });

  it("passes the choices to the match: a points match ends at 3, and best of 10 is the engine's rounds", () => {
    expect(start().state).toMatchObject({ pointsToWin: 3, match: { room: { settings: { matchType: "points", firstPlayer: "random" } } } });
    expect(start({ match: "first_to_5" }).state.pointsToWin).toBeNull();
    expect(start({ match: "rounds_10", timerSeconds: 60, packId: "actors" }).state.match.room.settings).toMatchObject({ matchType: "rounds", timerSeconds: 60, packId: "actors" });
  });
});

describe("create", () => {
  it("starts at once with the party's two seats, both here, in seat order, and names cleaned as the game's own", () => {
    const { state } = start({}, { seats: [SEATS[0]!, { ...SEATS[1]!, name: "  Ann\u0000  " }] });
    expect(state.match.seats).toEqual([0, 2]);
    expect(state.match.room.status).toBe("guessing_first");
    expect(state.match.room.players.map((p) => [p.nickname, p.connected])).toEqual([
      ["Ann", true],
      ["Bo", true],
    ]);
    const nameless = start({}, { seats: [SEATS[0]!, { ...SEATS[1]!, name: "" }] }).state;
    expect(nameless.match.room.players[0]!.nickname).toBe("Player");
  });

  it("takes exactly two seats", () => {
    expect(() => game.create({ seats: [SEATS[0]!], now: START })).toThrow("exactly two seats");
    expect(() => game.create({ seats: [...SEATS, { seat: 5, name: "Cy", kind: "human", colour: "#00f" }], now: START })).toThrow("exactly two seats");
  });

  it("never reads the room's seed: the same seed gives different identities, from the game's own randomness", () => {
    const draws = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const state = game.create({ seed: 42, seats: SEATS, now: START, round: 1 });
      draws.add(`${assignment(state, 0)}|${assignment(state, 2)}`);
    }
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("input", () => {
  it("answers ok, or refuses with an error and a sentence and changes nothing", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    const guesser = turnSeat(state)!;
    const before = game.serialize(state);
    for (const [seat, data, error] of [
      [7, command(state, "turn.hint"), "forbidden"],
      [guesser, { type: "turn.hint" }, "bad_request"],
      [other(state, guesser), command(state, "turn.skip"), "forbidden"],
      [guesser, { ...command(state, "turn.hint"), expectedVersion: 0 }, "version_conflict"],
      [guesser, command(state, "match.rematch"), "forbidden"],
      [guesser, command(state, "settings.update", { settings: {} }), "bad_request"],
    ] as const) {
      const answer = game.input(state, seat, data, START, sources);
      expect(answer, error).toMatchObject({ ok: false, error });
      expect((answer as { message: string }).message.length).toBeGreaterThan(5);
    }
    expect(game.serialize(state)).toBe(before);
    expect(game.input(state, guesser, command(state, "turn.hint"), START, sources)).toEqual({ ok: true, duplicate: false });
  });

  it("applies a double tap once: the same command twice scores once", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    const guesser = turnSeat(state)!;
    expect(game.input(state, guesser, command(state, "turn.correct.request"), START, sources)).toMatchObject({ ok: true });
    const confirm = command(state, "turn.correct.confirm");
    expect(game.input(state, other(state, guesser), confirm, START, sources)).toEqual({ ok: true, duplicate: false });
    expect(game.input(state, other(state, guesser), confirm, START, sources)).toEqual({ ok: true, duplicate: true });
    expect(state.match.room.players.find((p) => p.id === `seat-${guesser}`)!.score).toBe(1);
  });
});

describe("snapshot", () => {
  it("shows a player the opponent's identity and never their own; everyone else gets the screen's view", () => {
    const { state } = start({ timerSeconds: 60 });
    const ann = asPlayer(game.snapshot(state, START, { role: "player", seat: 0 }));
    const bo = asPlayer(game.snapshot(state, START, { role: "player", seat: 2 }));
    expect(ann.opponentIdentity?.id).toBe(assignment(state, 2));
    expect(bo.opponentIdentity?.id).toBe(assignment(state, 0));
    expect(JSON.stringify(ann)).not.toContain(assignment(state, 0)!);
    expect(JSON.stringify(bo)).not.toContain(assignment(state, 2)!);
    expect([ann.seat, ann.match, ann.youId]).toEqual([0, "first_to_3", "seat-0"]);

    const screen = game.snapshot(state, START, { role: "screen" });
    expect(screen).toEqual({
      role: "screen",
      version: state.match.room.version,
      serverNow: START,
      status: "guessing_first",
      roundIndex: 1,
      match: "first_to_3",
      players: [
        { seat: 0, name: "Ann" },
        { seat: 2, name: "Bo" },
      ],
      turn: { seat: turnSeat(state), phase: "asking", deadline: START + 60_000, pausedRemainingMs: null, questionCount: 0 },
    });
    // A member who is watching, a seat that is not in the match, and anything unknown: the screen's view.
    for (const viewer of [{ role: "screen", seat: 1 }, { role: "player", seat: 1 }, { role: "player", seat: "0" }, { role: "judge" }, {}, null, undefined]) {
      expect(game.snapshot(state, START, viewer), JSON.stringify(viewer)).toEqual(screen);
    }
  });

  it("has an audience view: both identities, never sent to anyone else", () => {
    const { state } = start();
    // Nobody but the audience gets it: not a player, the screen, a member watching as a screen, or anyone unknown.
    for (const viewer of [{ role: "player", seat: 0 }, { role: "player", seat: 2 }, { role: "screen" }, { role: "screen", seat: 1 }, { role: "judge", seat: 1 }, {}, null, undefined]) {
      const text = JSON.stringify(game.snapshot(state, START, viewer));
      expect(text, JSON.stringify(viewer)).not.toMatch(/"(role":"audience|identities|reveal|scores)"/);
      const seat = viewer?.role === "player" && "seat" in viewer ? viewer.seat : null;
      const own = seat !== null && seat !== undefined ? [assignment(state, seat)!] : [assignment(state, 0)!, assignment(state, 2)!];
      for (const id of own) expect(text, JSON.stringify(viewer)).not.toContain(id);
    }
    const audience = game.snapshot(state, START, { role: "audience" });
    expect(audience).toMatchObject({ role: "audience", match: "first_to_3", scores: [{ seat: 0, score: 0 }, { seat: 2, score: 0 }] });
    expect((audience as { identities: { seat: number; identity: { id: string } }[] }).identities.map((i) => [i.seat, i.identity.id])).toEqual([
      [0, assignment(state, 0)],
      [2, assignment(state, 2)],
    ]);
    // A watching member's own seat, and no hint or question goes with it.
    const watching = game.snapshot(state, START, { role: "audience", seat: 1 });
    expect(watching).toEqual(audience);
    expect(JSON.stringify(watching)).not.toMatch(/"(log|hints|youId)"/);
  });

  it("shows the audience the round's reveal and the scores between rounds; the screen still sees neither", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    const drawn = { 0: assignment(state, 0)!, 2: assignment(state, 2)! };
    while (state.match.room.status !== "round_summary") playTurn(state, START, sources, turnSeat(state) !== 0);
    const audience = game.snapshot(state, START, { role: "audience", seat: 1 }) as AudienceView;
    expect(audience.scores).toEqual([
      { seat: 0, score: 1 },
      { seat: 2, score: 0 },
    ]);
    expect(audience.reveal).toMatchObject({ roundIndex: 1, matchOver: false });
    expect(audience.reveal!.entries.map((e) => [e.seat, e.identity.id, e.result])).toEqual([
      [0, drawn[0], "correct"],
      [2, drawn[2], "skipped"],
    ]);
    const screen = JSON.stringify(game.snapshot(state, START, { role: "screen" }));
    for (const id of Object.values(drawn)) expect(screen).not.toContain(id);
    // Once the next round is on, the reveal is put away and the new identities shown.
    game.input(state, 0, command(state, "round.next"), START, sources);
    const next = game.snapshot(state, START, { role: "audience", seat: 1 }) as AudienceView;
    expect(next.reveal).toBeNull();
    expect(next.identities).toHaveLength(2);
  });

  it("never gives a seat that is playing the audience's view: it is that player's own, without their identity", () => {
    const { state } = start();
    for (const seat of [0, 2]) {
      const s = game.snapshot(state, START, { role: "audience", seat });
      expect(s, `seat ${seat}`).toEqual(game.snapshot(state, START, { role: "player", seat }));
      expect(JSON.stringify(s)).not.toContain(assignment(state, seat)!);
    }
  });
});

describe("the turn timer", () => {
  it("is the room's alarm through nextDeadline, and tick ends the turn and sets the next deadline", () => {
    const { state, sources } = start({ timerSeconds: 60, turnFormat: "keep_going" });
    const first = turnSeat(state)!;
    expect(game.nextDeadline(state)).toBe(START + 60_000);
    expect(game.tick(state, START + 59_999, sources)).toEqual([]);
    expect(game.tick(state, START + 60_000, sources)).toEqual([{ k: "timed_out", seat: first }]);
    expect(turnSeat(state)).toBe(other(state, first));
    // The room requires a tick to move the deadline on.
    expect(game.nextDeadline(state)).toBe(START + 120_000);
  });

  it("has no deadline without a timer", () => {
    expect(game.nextDeadline(start().state)).toBeNull();
  });

  it("pauses while a phone is gone or hidden, and runs on from where it stopped", () => {
    const { state, sources } = start({ timerSeconds: 60 });
    const waiting = other(state, turnSeat(state)!);
    expect(game.presence(state, waiting, { connected: true, away: false }, START + 10_000, sources)).toBe(false);
    expect(game.presence(state, waiting, { connected: true, away: true }, START + 10_000, sources)).toBe(true);
    expect(game.nextDeadline(state)).toBeNull();
    expect(game.snapshot(state, START + 10_000, { role: "screen" })).toMatchObject({ turn: { deadline: null, pausedRemainingMs: 50_000 } });
    expect(game.presence(state, waiting, { connected: false, away: false }, START + 20_000, sources)).toBe(true);
    expect(game.nextDeadline(state)).toBeNull();
    expect(game.presence(state, waiting, { connected: true, away: false }, START + 40_000, sources)).toBe(true);
    expect(game.nextDeadline(state)).toBe(START + 90_000);
    expect(game.presence(state, 9, { connected: false, away: false }, START, sources)).toBe(false);
  });

  it("lets either guesser confirm their own guess once the other phone has been gone 30 seconds", () => {
    for (const guesser of [0, 2]) {
      let found: ReturnType<typeof start> | null = null;
      for (let seed = 1; !found; seed++) {
        const tried = start({}, { seed });
        if (turnSeat(tried.state) === guesser) found = tried;
      }
      const { state, sources } = found;
      const answerer = other(state, guesser);
      // Not before a guess, and not while the other phone is here.
      expect(game.input(state, guesser, command(state, "turn.correct.override"), START, sources)).toMatchObject({ ok: false });
      expect(game.input(state, guesser, command(state, "turn.correct.request"), START, sources)).toMatchObject({ ok: true });
      expect(game.input(state, guesser, command(state, "turn.correct.override"), START + 60_000, sources)).toMatchObject({ ok: false, error: "forbidden" });
      expect(game.presence(state, answerer, { connected: true, away: true }, START, sources)).toBe(true);
      expect(game.input(state, guesser, command(state, "turn.correct.override"), START + 29_999, sources), `seat ${guesser}`).toMatchObject({ ok: false, error: "forbidden" });
      // The one who is not guessing may not use it.
      expect(game.input(state, answerer, command(state, "turn.correct.override"), START + 30_000, sources)).toMatchObject({ ok: false, error: "forbidden" });
      expect(game.input(state, guesser, command(state, "turn.correct.override"), START + 30_000, sources), `seat ${guesser}`).toMatchObject({ ok: true });
      expect(state.match.room.players.find((p) => p.id === `seat-${guesser}`)!.score).toBe(1);
      // Nothing else changes hands: the match's host is still the lower seat.
      expect(state.match.room.hostPlayerId).toBe("seat-0");
    }
  });
});

describe("the end of a match", () => {
  it("ends a first-to-3 match at the round that reaches 3: places, and a result that names no identity", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    const used = new Set<string>();
    while (!game.isOver(state)) {
      for (const seat of state.match.seats) {
        const id = assignment(state, seat);
        if (id) used.add(id);
      }
      if (state.match.room.status === "round_summary") {
        game.input(state, 0, command(state, "round.next"), START, sources);
        continue;
      }
      playTurn(state, START, sources, turnSeat(state) !== 2);
    }
    // Rows best first, with each seat's score: the room's end card shows the score beside the place.
    expect(game.result(state)).toEqual([
      { seat: 2, score: 3 },
      { seat: 0, score: 0 },
    ]);
    expect(game.standings(state)).toEqual([
      { seat: 2, place: 1 },
      { seat: 0, place: 2 },
    ]);
    const text = JSON.stringify([game.result(state), game.standings(state)]);
    for (const id of used) expect(text).not.toContain(id);
  });

  it("shows the round that reaches 3 as the last one, and is over only after a player taps on", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    for (let round = 0; round < 3; round++) {
      while (state.match.room.status !== "round_summary") playTurn(state, START, sources, turnSeat(state) !== 0);
      if (round < 2) game.input(state, 2, command(state, "round.next"), START, sources);
    }
    expect(game.isOver(state)).toBe(false);
    expect(asPlayer(game.snapshot(state, START, { role: "player", seat: 0 })).roundSummary?.matchOver).toBe(true);
    expect(game.input(state, 2, command(state, "round.next"), START, sources)).toMatchObject({ ok: true });
    expect(game.isOver(state)).toBe(true);
  });

  it("is decided at the round that reaches 3: whoever leaves on that summary, the real winner is first", () => {
    for (const leaver of [0, 2]) {
      const { state, sources } = start({ turnFormat: "keep_going" });
      for (let round = 0; round < 3; round++) {
        while (state.match.room.status !== "round_summary") playTurn(state, START, sources, turnSeat(state) !== 0);
        if (round < 2) game.input(state, 2, command(state, "round.next"), START, sources);
      }
      expect(state.match.room.lastRoundSummary?.matchOver).toBe(true);
      const ended = game.abandon(state, leaver, START);
      expect(ended.standings, `seat ${leaver} left`).toEqual([
        { seat: 0, place: 1 },
        { seat: 2, place: 2 },
      ]);
      expect(ended.result, `seat ${leaver} left`).toEqual([
        { seat: 0, score: 3 },
        { seat: 2, score: 0 },
      ]);
      expect(ended.events).toEqual([]);
    }
  });

  it("keeps the engine's own lengths: first to 5, and the best after 10 rounds with a shared first place on a tie", () => {
    const five = start({ match: "first_to_5", turnFormat: "keep_going" });
    expect(playMatch(five.state, five.sources, 0)).toBe(5);
    const ten = start({ match: "rounds_10", turnFormat: "keep_going" });
    while (!game.isOver(ten.state)) {
      if (ten.state.match.room.status === "round_summary") game.input(ten.state, 0, command(ten.state, "round.next"), START, ten.sources);
      else playTurn(ten.state, START, ten.sources, true);
    }
    expect(game.result(ten.state)).toEqual([
      { seat: 0, score: 0 },
      { seat: 2, score: 0 },
    ]);
    expect(ten.state.match.room.roundIndex).toBe(10);
    expect(game.standings(ten.state)).toEqual([
      { seat: 0, place: 1 },
      { seat: 2, place: 1 },
    ]);
  });
});

describe("abandon", () => {
  it("ends the match for the player who stayed: first place for them, none for the one who left", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    playTurn(state, START, sources);
    const ended = game.abandon(state, 2, START);
    expect(ended.standings).toEqual([{ seat: 0, place: 1 }]);
    // The one who stayed first, whatever the scores; the one who left after them.
    expect(ended.result).toEqual([
      { seat: 0, score: expect.any(Number) },
      { seat: 2, score: expect.any(Number) },
    ]);
    expect(ended.events).toEqual([{ k: "abandoned", seat: 2 }]);
    expect(JSON.stringify(ended)).not.toContain(assignment(state, 0)!);
    expect(JSON.stringify(ended)).not.toContain(assignment(state, 2)!);
    expect(game.abandon(state, 5, START)).toEqual({ standings: [], result: null, events: [] });
  });

  it("gives the one who stayed the win when the other phone's grace runs out", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    playTurn(state, START, sources);
    expect(game.presence(state, 2, { connected: false, away: false }, START, sources)).toBe(true);
    const ended = game.abandon(state, 2, START + game.reconnectGraceMs);
    expect(ended.standings).toEqual([{ seat: 0, place: 1 }]);
    expect(ended.events).toEqual([{ k: "abandoned", seat: 2 }]);
  });

  it("gives the one who stayed the win when the other forfeits, even with their own page hidden all the while", () => {
    // Seat 2's phone drops; seat 0 switches to another app 5 seconds later and is still away when seat 2's minute runs out.
    const { state, sources } = start({ turnFormat: "keep_going" });
    playTurn(state, START, sources);
    game.presence(state, 2, { connected: false, away: false }, START, sources);
    game.presence(state, 0, { connected: true, away: true }, START + 5_000, sources);
    const ended = game.abandon(state, 2, START + game.reconnectGraceMs);
    expect(ended.standings).toEqual([{ seat: 0, place: 1 }]);
    expect(ended.result![0]!.seat).toBe(0);

    // A ghost: seat 2's page went away and its socket fell silent, so the room was never told it
    // dropped before it gave up on it. Still a forfeit, and the hidden stayer still wins.
    const ghost = start({ turnFormat: "keep_going" });
    game.presence(ghost.state, 2, { connected: true, away: true }, START, ghost.sources);
    game.presence(ghost.state, 0, { connected: true, away: true }, START + 1_000, ghost.sources);
    expect(game.abandon(ghost.state, 2, START + game.reconnectGraceMs).standings).toEqual([{ seat: 0, place: 1 }]);
  });

  it("gives nobody the win when a phone forfeits while the other phone has been dropped 30 seconds too", () => {
    const { state, sources } = start({ turnFormat: "keep_going" });
    game.presence(state, 2, { connected: false, away: false }, START, sources);
    game.presence(state, 0, { connected: false, away: false }, START + 20_000, sources);
    expect(game.abandon(state, 2, START + game.reconnectGraceMs).standings).toEqual([]);
    // Dropped only a moment ago: the one who stayed still wins.
    const late = start({ turnFormat: "keep_going" });
    game.presence(late.state, 2, { connected: false, away: false }, START, late.sources);
    game.presence(late.state, 0, { connected: false, away: false }, START + 50_000, late.sources);
    expect(game.abandon(late.state, 2, START + game.reconnectGraceMs).standings).toEqual([{ seat: 0, place: 1 }]);
  });

  it("gives nobody the win when a player leaves while the other has been gone for a while", () => {
    for (const report of [
      { connected: false, away: false },
      { connected: true, away: true },
    ]) {
      const { state, sources } = start({ turnFormat: "keep_going" });
      playTurn(state, START, sources);
      // Seat 0's phone is gone; seat 2 waits a minute and gives up on the match.
      expect(game.presence(state, 0, report, START, sources)).toBe(true);
      const ended = game.abandon(state, 2, START + 60_000);
      expect(ended.standings, JSON.stringify(report)).toEqual([]);
      expect(ended.events).toEqual([{ k: "abandoned", seat: 2 }]);
      expect(ended.result).not.toBeNull();
    }
    // A phone locked a moment ago is still the player's: the one who stayed wins as before.
    const { state, sources } = start({ turnFormat: "keep_going" });
    game.presence(state, 0, { connected: true, away: true }, START, sources);
    expect(game.abandon(state, 2, START + 10_000).standings).toEqual([{ seat: 0, place: 1 }]);
  });
});

describe("carry", () => {
  it("starts a rematch between the same seats with the loser guessing and none of the last match's identities", () => {
    const first = start({ turnFormat: "keep_going", packId: "brand-mascots" });
    expect(game.carry(first.state)).toBeNull();
    playMatch(first.state, first.sources, 2);
    const carry = game.carry(first.state)!;
    expect(carry).toMatchObject({ seats: [0, 2], winnerSeat: 2, tie: false });
    // A carry is what the room keeps and passes back: plain JSON.
    const kept = JSON.parse(JSON.stringify(carry));
    for (let seed = 20; seed < 26; seed++) {
      const { state } = start({ turnFormat: "keep_going", packId: "brand-mascots" }, { seed, carry: kept });
      expect(turnSeat(state)).toBe(0);
      for (const seat of state.match.seats) expect(carry.usedIdentityIds).not.toContain(assignment(state, seat));
      expect(state.match.room.players.every((p) => p.score === 0)).toBe(true);
    }
  });

  it("is ignored from other seats or when it is not one of this game's", () => {
    const first = start({ turnFormat: "keep_going" });
    playMatch(first.state, first.sources, 2);
    const carry = game.carry(first.state)!;
    expect(start({}, { carry: { ...carry, seats: [0, 5] } }).state.match.room.usedIdentityIds).toHaveLength(2);
    for (const junk of [null, "x", { seats: [0, 2] }, { ...carry, usedIdentityIds: [7] }, { ...carry, firstSeat: "0" }]) {
      expect(() => start({}, { carry: junk })).not.toThrow();
    }
  });

  it("stays under the room's 4 KB, dropping the oldest identities of a long match", () => {
    const { state, sources } = start({ match: "first_to_5", turnFormat: "keep_going" });
    // A long match: nobody scores for a while.
    for (let i = 0; i < 40 && !game.isOver(state); i++) {
      if (state.match.room.status === "round_summary") game.input(state, 0, command(state, "round.next"), START, sources);
      else playTurn(state, START, sources, true);
    }
    playMatch(state, sources, 0);
    const all = state.match.room.usedIdentityIds;
    const carry = game.carry(state)!;
    expect(JSON.stringify(carry).length).toBeLessThanOrEqual(CARRY_MAX_BYTES);
    expect(carry.usedIdentityIds.length).toBeGreaterThan(10);
    expect(all.slice(-carry.usedIdentityIds.length)).toEqual(carry.usedIdentityIds);
  });
});

describe("serialize and restore", () => {
  it("round-trip a match in progress completely: the restored game plays on exactly as the original", () => {
    const { state, sources } = start({ timerSeconds: 90, turnFormat: "keep_going" });
    const guesser = turnSeat(state)!;
    game.input(state, guesser, command(state, "turn.hint"), START, sources);
    game.input(state, guesser, command(state, "turn.ask", { text: "Am I real?" }), START, sources);
    game.presence(state, other(state, guesser), { connected: true, away: true }, START + 1_000, sources);

    const text = game.serialize(state);
    expect(typeof text).toBe("string");
    const restored = game.restore(text);
    expect(restored).toEqual(state);
    expect(game.serialize(restored)).toBe(text);
    for (const viewer of [{ role: "player", seat: 0 }, { role: "player", seat: 2 }, { role: "screen" }]) {
      expect(game.snapshot(restored, START + 2_000, viewer)).toEqual(game.snapshot(state, START + 2_000, viewer));
    }
    expect(game.nextDeadline(restored)).toBe(game.nextDeadline(state));

    // The same moves on both, with the same randomness from here on, end in the same place.
    const a = { state, sources: seeded(77) };
    const b = { state: restored, sources: seeded(77) };
    for (const side of [a, b]) {
      game.presence(side.state, other(side.state, guesser), { connected: true, away: false }, START + 3_000, side.sources);
      commands = 1_000;
      playMatch(side.state, side.sources, guesser);
    }
    expect(game.serialize(b.state)).toBe(game.serialize(a.state));
  });

  it("refuses anything that is not a saved party game", () => {
    const { state } = start();
    const saved = JSON.parse(game.serialize(state));
    expect(() => game.restore("not json")).toThrow();
    expect(() => game.restore("{}")).toThrow("Not a saved");
    expect(() => game.restore(JSON.stringify({ ...saved, shape: "turns/1" }))).toThrow("Not a saved");
    expect(() => game.restore(JSON.stringify({ ...saved, state: { ...saved.state, settings: { match: "first_to_9" } } }))).toThrow("Not a saved");
    expect(() => game.restore(JSON.stringify({ ...saved, state: { ...saved.state, pointsToWin: "3" } }))).toThrow("Not a saved");
    expect(() => game.restore(JSON.stringify({ ...saved, state: { ...saved.state, match: { room: {}, seats: [0] } } }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Secrecy across whole matches, as the party room runs them.

const escaped = (text: string) => JSON.stringify(text).slice(1, -1);

/** What the room sends: each viewer's snapshot after every change, and every event. */
const VIEWERS = {
  ann: { role: "player", seat: 0 },
  bo: { role: "player", seat: 2 },
  screen: { role: "screen" },
  watcher: { role: "screen", seat: 1 },
  audience: { role: "audience", seat: 3 },
} as const;
type Who = keyof typeof VIEWERS;

interface Scan {
  frames: number;
  /** Every identity assigned to a seat, and whether its round is over (then the player may see it). */
  owned: Map<string, { seat: number; round: number; revealed: boolean }>;
  questions: Set<string>;
}

/** Keeps the record of who was given which identity, and which rounds are over. */
function track(state: RoomGameState, scan: Scan) {
  const room = state.match.room;
  if (room.round) {
    for (const seat of state.match.seats) {
      const id = assignment(state, seat)!;
      if (!scan.owned.has(id)) scan.owned.set(id, { seat, round: room.round.index, revealed: false });
    }
  }
  const summary = room.lastRoundSummary;
  if (summary && (room.status === "round_summary" || room.status === "match_summary")) {
    for (const entry of summary.entries) {
      const owned = scan.owned.get(entry.identityId);
      if (owned && owned.round === summary.roundIndex) owned.revealed = true;
    }
  }
}

/** Every text that gives an identity away: its id, name and aliases, and its hints. */
function secretsOf(id: string) {
  const identity = getIdentity(id);
  return { names: [identity.id, identity.canonicalName, ...identity.aliases.filter((a) => a.length >= 4)].map(escaped), hints: identity.hints.map(escaped) };
}

/** Scans one frame sent to `who`. */
function scanFrame(state: RoomGameState, who: Who, frame: string, scan: Scan) {
  scan.frames++;
  const viewer = VIEWERS[who];
  if (viewer.role === "player") {
    const seat = viewer.seat;
    const opponentId = assignment(state, other(state, seat));
    const opponent = opponentId ? getIdentity(opponentId) : null;
    const allowed = opponent ? [opponent.canonicalName, ...opponent.aliases, ...opponent.hints].map(escaped) : [];
    const hintsUsed = state.match.room.round?.hintsUsed?.[`seat-${seat}`] ?? 0;
    for (const [id, owned] of scan.owned) {
      if (owned.seat !== seat || owned.revealed) continue;
      const current = owned.round === state.match.room.round?.index;
      const { names, hints } = secretsOf(id);
      for (const text of names) {
        // A short alias that is part of the opponent's own name or hints is not a leak.
        if (allowed.some((a) => a.includes(text))) continue;
        expect(frame, `${who} was sent their own identity (${text})`).not.toContain(text);
      }
      hints.forEach((hint, i) => {
        if ((current && i < hintsUsed) || allowed.some((a) => a.includes(hint))) return;
        expect(frame, `${who} was sent a hint for themselves they did not ask for (${hint})`).not.toContain(hint);
      });
    }
    return;
  }
  if (viewer.role === "audience") {
    // A member watching as the audience: both identities while a round is on (in its snapshot),
    // but no hint, no question, no log and nothing of a player's own view.
    const round = state.match.room.round;
    const current = round ? state.match.seats.map((s) => getIdentity(assignment(state, s)!)) : [];
    const shown = current.flatMap((i) => [i.canonicalName, i.id, ...i.aliases]).map(escaped);
    if (frame.startsWith('{"t":"snap"')) for (const identity of current) expect(frame, `${who} was not sent ${identity.id}`).toContain(escaped(identity.canonicalName));
    for (const id of scan.owned.keys()) {
      for (const hint of secretsOf(id).hints) {
        if (!shown.some((s) => s.includes(hint))) expect(frame, `${who} was sent a hint (${hint})`).not.toContain(hint);
      }
    }
    for (const question of scan.questions) expect(frame, `${who} was sent a question`).not.toContain(escaped(question));
    expect(frame).not.toMatch(/"(log|hints|opponentIdentity|roundSummary|assignments|usedIdentityIds|youId)"/);
    return;
  }
  // The screen and a member watching as a screen: no identity at all, no hint, no question, no log.
  for (const id of scan.owned.keys()) {
    const { names, hints } = secretsOf(id);
    for (const text of [...names, ...hints]) expect(frame, `${who} was sent ${text}`).not.toContain(text);
  }
  for (const question of scan.questions) expect(frame, `${who} was sent a question`).not.toContain(escaped(question));
  expect(frame).not.toMatch(/"(log|opponentIdentity|roundSummary|identity|identities|assignments|usedIdentityIds|youId)"/);
}

/** Every viewer's snapshot now, and the events, as the room would send them (no event of this game has `only`). */
function send(state: RoomGameState, now: number, events: unknown[], scan: Scan) {
  track(state, scan);
  for (const who of Object.keys(VIEWERS) as Who[]) {
    scanFrame(state, who, JSON.stringify({ t: "snap", s: game.snapshot(state, now, VIEWERS[who]), now }), scan);
    if (events.length) scanFrame(state, who, JSON.stringify({ t: "ev", ev: events, now }), scan);
  }
}

/**
 * Plays a whole match the way the party room runs it: every input goes to a copy made with
 * restore(serialize(state)), kept unless the game refused it and nothing changed; the alarm calls
 * tick at the deadline; presence changes go to presence; and after each, every viewer is sent
 * its snapshot and the events. Returns what happened, to check the script covered everything.
 */
function roomMatch(settings: object, seed: number, opts: { abandonAt?: number } = {}) {
  const sources = seeded(seed);
  let state = game.create({ seed: 99, seats: SEATS, now: START, round: 1, settings, sources });
  const pick = seeded(seed + 500).random;
  const scan: Scan = { frames: 0, owned: new Map(), questions: new Set() };
  const happened = new Set<string>();
  let now = START;
  let moves = 0;
  send(state, now, [], scan);

  const act = (seat: number, type: string, extra: object = {}) => {
    const draft = game.restore(game.serialize(state));
    const answer = game.input(draft, seat, command(state, type, extra), now, sources);
    const changed = game.serialize(draft) !== game.serialize(state);
    if (answer.ok || changed) state = draft;
    if (answer.ok) happened.add(type);
    // The sender always gets a fresh snapshot; everyone does when something changed.
    if (answer.ok || changed) send(state, now, [], scan);
    else scanFrame(state, seat === 0 ? "ann" : "bo", JSON.stringify({ t: "snap", s: game.snapshot(state, now, { role: "player", seat }), now }), scan);
    return answer.ok;
  };

  for (let step = 0; step < 3_000 && !game.isOver(state); step++) {
    now += 1_000;
    if (opts.abandonAt === step) {
      const ended = game.abandon(state, 2, now);
      send(state, now, ended.events, scan);
      for (const who of Object.keys(VIEWERS) as Who[]) scanFrame(state, who, JSON.stringify({ t: "end", result: ended.result }), scan);
      happened.add("abandon");
      return { scan, happened, state, ended };
    }
    const room = state.match.room;
    if (room.status === "round_summary") {
      moves = 0;
      act(state.match.seats[step % 2]!, "round.next");
      continue;
    }
    const guesser = turnSeat(state)!;
    const answerer = other(state, guesser);
    const turn = room.turn!;
    const pending = turn.log.find((e) => e.kind === "question" && e.answer === null);
    moves++;
    if (turn.phase === "pending_confirm") {
      act(answerer, pick() < 0.4 ? "turn.correct.reject" : "turn.correct.confirm");
    } else if (pending) {
      act(answerer, "turn.answer", { questionId: pending.id, answer: ["yes", "no", "sort_of", "dont_know"][Math.floor(pick() * 4)] });
    } else if (moves > 12) {
      act(guesser, pick() < 0.8 ? "turn.correct.request" : "turn.skip");
    } else {
      const roll = pick();
      if (roll < 0.2) {
        const text = `Is it question ${step}?`;
        if (act(guesser, "turn.ask", { text })) scan.questions.add(text);
      } else if (roll < 0.35 && turn.hintsUsed < HINTS_PER_TURN) act(guesser, "turn.hint");
      else if (roll < 0.45) act(guesser, "turn.question");
      else if (roll < 0.55) act(guesser, "turn.pass");
      else if (roll < 0.65) {
        // A phone locks or drops, and comes back.
        const connected = pick() < 0.5;
        if (game.presence(state, answerer, { connected, away: connected }, now, sources)) {
          happened.add(connected ? "away" : "dropped");
          send(state, now, [], scan);
        }
        now += 5_000;
        if (game.presence(state, answerer, { connected: true, away: false }, now, sources)) send(state, now, [], scan);
      } else if (roll < 0.75 && game.nextDeadline(state) !== null) {
        // Nobody moves: the room's alarm rings at the deadline.
        now = game.nextDeadline(state)!;
        const events = game.tick(state, now, sources);
        if (events.length) happened.add("timed_out");
        send(state, now, events, scan);
      } else if (roll < 0.85) act(guesser, "turn.correct.request");
      else act(guesser, "turn.skip");
    }
  }
  expect(game.isOver(state)).toBe(true);
  // The end goes to everyone.
  for (const who of Object.keys(VIEWERS) as Who[]) scanFrame(state, who, JSON.stringify({ t: "end", result: game.result(state), standings: game.standings(state) }), scan);
  return { scan, happened, state, ended: null };
}

describe("secrecy across whole matches in the party room", () => {
  it("trade turns, typed and spoken questions, hints and a timer: no viewer is ever sent what they must not see", () => {
    const { scan, happened, state } = roomMatch({ turnFormat: "trade", timerSeconds: 60, questions: "both", hints: true, match: "first_to_5" }, 31);
    expect(scan.frames).toBeGreaterThan(400);
    expect(scan.owned.size).toBeGreaterThanOrEqual(6);
    expect([...scan.owned.values()].every((o) => o.revealed)).toBe(true);
    for (const move of ["turn.ask", "turn.answer", "turn.hint", "turn.pass", "turn.correct.reject", "turn.correct.confirm", "round.next", "away", "dropped", "timed_out"]) {
      expect(happened, move).toContain(move);
    }
    expect(game.isOver(state)).toBe(true);
  });

  it("keep going, spoken questions and best of 10, with the question counter and give-ups", () => {
    const { scan, happened } = roomMatch({ turnFormat: "keep_going", timerSeconds: 90, questions: "spoken", match: "rounds_10" }, 32);
    expect(scan.owned.size).toBe(20);
    for (const move of ["turn.question", "turn.hint", "turn.skip", "turn.correct.confirm", "timed_out"]) expect(happened, move).toContain(move);
  });

  it("clues mode, first to 3 (the room's default)", () => {
    const { scan, happened } = roomMatch({ mode: "describe_it" }, 33);
    expect(scan.frames).toBeGreaterThan(50);
    expect(happened).toContain("turn.correct.confirm");
  });

  it("a match a player leaves in the middle: the last snapshots, the events and the result keep the secret too", () => {
    const { scan, ended, state } = roomMatch({ turnFormat: "trade", questions: "app" }, 34, { abandonAt: 25 });
    expect(ended?.events).toEqual([{ k: "abandoned", seat: 2 }]);
    expect(ended?.result?.[0]?.seat).toBe(0);
    expect(state.match.room.round).not.toBeNull();
    expect([...scan.owned.values()].some((o) => !o.revealed)).toBe(true);
  });
});
