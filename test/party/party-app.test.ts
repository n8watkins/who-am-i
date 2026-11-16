// The room view's page (src/party-view/PartyApp.tsx) rendered to markup in plain Node, from
// snapshots the room game really gives: what each viewer's page shows. Only the first render is
// checked (no effects run, nothing is clicked); nothing of it was seen in a browser.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The page's build defines the version; plain Node does not.
const wakeLock = vi.hoisted(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = "test";
  return { calls: [] as boolean[] };
});
vi.mock("../../src/kit/client/wake-lock", () => ({ useWakeLock: (active: boolean) => void wakeLock.calls.push(active) }));

import { Game } from "../../src/client/screens/Game";
import type { RoomHandle } from "../../src/client/lib/useRoom";
import { game, type RoomGameState, type Sources } from "../../src/party/room-game";
import type { PartyHost, Snapshot } from "../../src/party-view/host";
import { confirmedWithoutYouNotice, timedOutNotice } from "../../src/party-view/notices";
import { PartyApp } from "../../src/party-view/PartyApp";
import type { RoomView } from "../../src/shared/protocol";
import { getIdentity } from "../../src/worker/content";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const SEATS = [
  { seat: 0, name: "Ann" },
  { seat: 2, name: "Bo" },
];

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
const command = (state: RoomGameState, type: string, extra: object = {}) => ({ type, commandId: `party-app-${++commands}`, expectedVersion: state.match.room.version, ...extra });
const turnSeat = (state: RoomGameState) => Number(state.match.room.turn!.playerId.replace("seat-", ""));

/** A match whose first guesser is `seat`, started at `now`. */
function matchFor(seat: number, now: number) {
  for (let seed = 1; ; seed++) {
    const sources = seeded(seed);
    const state = game.create({ seats: SEATS, now, settings: { turnFormat: "keep_going" }, sources });
    if (turnSeat(state) === seat) return { state, sources };
  }
}

function hostFor(snapshot: Snapshot, now: number, you?: { role: string; seat: number }): PartyHost {
  return {
    room: {},
    you: you ?? (snapshot.role === "player" ? { role: "player", seat: snapshot.seat } : { role: snapshot.role, seat: -1 }),
    snapshot,
    inset: { top: 56, right: 56 },
    now: () => now,
    send: () => Promise.resolve(),
    inputId: () => "x.1",
    on: () => () => {},
    ready: () => {},
  };
}

const render = (snapshot: Snapshot, now: number, you?: { role: string; seat: number }) => renderToStaticMarkup(createElement(PartyApp, { host: hostFor(snapshot, now, you) }));

/** Plays turns until the round's summary is up: `winner` is always right, the other gives up. */
function toSummary(state: RoomGameState, sources: Sources, now: number, winner: number) {
  while (state.match.room.status !== "round_summary") {
    const seat = turnSeat(state);
    if (seat === winner) {
      game.input(state, seat, command(state, "turn.correct.request"), now, sources);
      game.input(state, SEATS.find((s) => s.seat !== seat)!.seat, command(state, "turn.correct.confirm"), now, sources);
    } else game.input(state, seat, command(state, "turn.skip"), now, sources);
  }
}

/** An identity's texts (its id, name and long aliases), escaped as markup holds them. */
const identityTexts = (id: string) => {
  const identity = getIdentity(id);
  return [identity.id, identity.canonicalName, ...identity.aliases.filter((a) => a.length >= 4)].map(escapeHtml);
};

describe("the room view's page", () => {
  it("keeps every screen awake while the match is shown: a phone set down mid-round, and the big screen", () => {
    const now = Date.now();
    const { state } = matchFor(0, now);
    for (const viewer of [{ role: "player", seat: 0 }, { role: "audience", seat: 1 }, { role: "screen" }]) {
      wakeLock.calls.length = 0;
      render(game.snapshot(state, now, viewer), now);
      expect(wakeLock.calls, JSON.stringify(viewer)).toContain(true);
      expect(wakeLock.calls).not.toContain(false);
    }
  });

  it("lays a phone out as a column and the big screen across its width", () => {
    const now = Date.now();
    const { state } = matchFor(0, now);
    const phone = render(game.snapshot(state, now, { role: "player", seat: 0 }), now);
    expect(phone).toContain("max-w-lg");
    expect(phone).not.toContain("data-screen");
    const screen = render(game.snapshot(state, now, { role: "screen" }), now);
    expect(screen).not.toContain("max-w-lg");
    expect(screen).toContain('data-screen="big"');
  });

  it("shows a watching phone both identities in a round, and the reveal and the scores after it", () => {
    const now = Date.now();
    const { state, sources } = matchFor(0, now);
    const names = state.match.seats.map((seat) => getIdentity(state.match.room.round!.assignments[`seat-${seat}`]!).canonicalName);
    const during = render(game.snapshot(state, now, { role: "audience", seat: 1 }), now);
    for (const name of names) expect(during).toContain(escapeHtml(name));
    // Ann guesses hers; Bo gives up.
    game.input(state, 0, command(state, "turn.correct.request"), now, sources);
    game.input(state, 2, command(state, "turn.correct.confirm"), now, sources);
    game.input(state, 2, command(state, "turn.skip"), now, sources);
    expect(state.match.room.status).toBe("round_summary");
    const after = render(game.snapshot(state, now, { role: "audience", seat: 1 }), now);
    for (const name of names) expect(after).toContain(escapeHtml(name));
    expect(after).toContain("Guessed it");
    expect(after).toContain("Gave up");
    expect(after).toMatch(/Ann[^]*1[^]*Bo[^]*0/);
    // The big screen, in the round: no identity.
    const { state: live } = matchFor(0, now);
    const liveNames = live.match.seats.map((seat) => escapeHtml(getIdentity(live.match.room.round!.assignments[`seat-${seat}`]!).canonicalName));
    const screen = render(game.snapshot(live, now, { role: "screen" }), now);
    for (const name of liveNames) expect(screen).not.toContain(name);
  });

  it("offers either guesser the button to confirm their own guess once the other phone has been gone 30 seconds", () => {
    const now = Date.now();
    for (const guesser of [0, 2]) {
      const { state, sources } = matchFor(guesser, now - 60_000);
      const answerer = SEATS.find((s) => s.seat !== guesser)!.seat;
      expect(game.input(state, guesser, command(state, "turn.correct.request"), now - 60_000, sources)).toMatchObject({ ok: true });
      const here = render(game.snapshot(state, now, { role: "player", seat: guesser }), now);
      expect(here).toContain("Waiting for");
      expect(here).not.toContain("Confirm without");
      game.presence(state, answerer, { connected: true, away: true }, now - 31_000, sources);
      const gone = render(game.snapshot(state, now, { role: "player", seat: guesser }), now);
      expect(gone, `seat ${guesser}`).toContain("Confirm without");
      expect(gone).not.toContain("(host)");
    }
  });

  it("fills the big screen with both names and scores, whose turn, the questions and the timer, and no identity in a round", () => {
    const now = Date.now();
    const { state } = matchFor(2, now);
    state.match.room.turn!.deadline = now + 42_000;
    state.match.room.turn!.questionCount = 3;
    const screen = render(game.snapshot(state, now, { role: "screen" }), now);
    expect(screen).toContain('data-screen="big"');
    expect(screen).toMatch(/data-testid="watch-turn"[^>]*>Bo’s turn to guess/);
    expect(screen).toMatch(/data-testid="watch-questions"[^]*>3<[^]*questions asked/);
    expect(screen).toContain("0:42");
    expect(screen).toMatch(/data-testid="watch-scores"[^]*Ann[^]*Answering[^]*0[^]*Bo[^]*Guessing[^]*0/);
    expect(screen).toContain("Round 1 · First to 3");
    for (const seat of [0, 2]) for (const text of identityTexts(state.match.room.round!.assignments[`seat-${seat}`]!)) expect(screen).not.toContain(text);
  });

  it("shows the big screen the round's reveal and the scores between rounds, and who won once the match is decided", () => {
    const now = Date.now();
    const { state, sources } = matchFor(0, now);
    const drawn = [0, 2].map((seat) => getIdentity(state.match.room.round!.assignments[`seat-${seat}`]!).canonicalName);
    toSummary(state, sources, now, 0);
    const between = render(game.snapshot(state, now, { role: "screen" }), now);
    expect(between).toContain("Round 1 complete");
    for (const name of drawn) expect(between).toContain(escapeHtml(name));
    expect(between).toContain("Guessed it");
    expect(between).toContain("Gave up");
    expect(between).not.toContain("wins the match");
    // On to the round that reaches 3.
    while (!state.match.room.lastRoundSummary?.matchOver) {
      game.input(state, 0, command(state, "round.next"), now, sources);
      toSummary(state, sources, now, 0);
    }
    for (const viewer of [{ role: "screen" }, { role: "audience", seat: 1 }]) {
      const html = render(game.snapshot(state, now, viewer), now);
      expect(html, JSON.stringify(viewer)).toMatch(/data-testid="watch-headline"[^>]*>Ann wins the match!/);
      expect(html).toContain("3 to 0");
    }
  });

  it("tells both players who won on the last round's summary, by name", () => {
    const now = Date.now();
    const { state, sources } = matchFor(0, now);
    toSummary(state, sources, now, 0);
    expect(render(game.snapshot(state, now, { role: "player", seat: 0 }), now)).not.toContain("match-decided");
    while (!state.match.room.lastRoundSummary?.matchOver) {
      game.input(state, 0, command(state, "round.next"), now, sources);
      toSummary(state, sources, now, 0);
    }
    expect(render(game.snapshot(state, now, { role: "player", seat: 0 }), now)).toMatch(/data-testid="match-decided"[^>]*>You win the match!/);
    const bo = render(game.snapshot(state, now, { role: "player", seat: 2 }), now);
    expect(bo).toMatch(/data-testid="match-decided"[^>]*>Ann wins the match!/);
    expect(bo).toContain("3 to 0");
  });

  it("makes both identities the main thing on an audience phone, each under whose it is", () => {
    const now = Date.now();
    const { state } = matchFor(2, now);
    const html = render(game.snapshot(state, now, { role: "audience", seat: 1 }), now);
    const [ann, bo] = [0, 2].map((seat) => escapeHtml(getIdentity(state.match.room.round!.assignments[`seat-${seat}`]!).canonicalName));
    expect(html).toMatch(new RegExp(`data-testid="watch-identities"[^]*Ann <span[^>]*>is</span>[^]*${ann}[^]*Bo <span[^>]*>is</span>[^]*Guessing now[^]*${bo}`));
    expect(html).toContain("text-3xl");
  });

  it("lays out a member who joined mid-match (a screen with a seat) as a phone, with no identity", () => {
    const now = Date.now();
    const { state } = matchFor(2, now);
    const html = render(game.snapshot(state, now, { role: "screen", seat: 3 }), now, { role: "screen", seat: 3 });
    expect(html).toContain("max-w-lg");
    expect(html).not.toContain("data-screen");
    expect(html).toContain("Bo’s turn to guess");
    for (const seat of [0, 2]) for (const text of identityTexts(state.match.room.round!.assignments[`seat-${seat}`]!)) expect(html).not.toContain(text);
  });

  it("leaves the game's own site as it was: only its host gets the button there", () => {
    const now = Date.now();
    const { state, sources } = matchFor(2, now - 60_000);
    game.input(state, 2, command(state, "turn.correct.request"), now - 60_000, sources);
    game.presence(state, 0, { connected: false, away: false }, now - 31_000, sources);
    const view = game.snapshot(state, now, { role: "player", seat: 2 }) as RoomView;
    const room = { view, serverOffset: 0, pending: false, send: () => Promise.resolve(true) } as unknown as RoomHandle;
    expect(renderToStaticMarkup(createElement(Game, { room, view }))).not.toContain("Confirm without");
  });
});

describe("what the room view tells a person above the game", () => {
  it("tells the guesser their time ran out, and everyone else whose did", () => {
    const now = Date.now();
    for (const turnFormat of ["trade", "keep_going"] as const) {
      const sources = seeded(7);
      const state = game.create({ seats: SEATS, now, settings: { turnFormat, timerSeconds: 60 }, sources });
      const guesser = turnSeat(state);
      const other = SEATS.find((s) => s.seat !== guesser)!;
      const before = game.snapshot(state, now, { role: "player", seat: guesser }) as Snapshot;
      const events = game.tick(state, game.nextDeadline(state)!, sources);
      expect(events).toEqual([{ k: "timed_out", seat: guesser }]);
      const mine = timedOutNotice(events, { role: "player", seat: guesser }, before);
      expect(mine?.text).toBe(turnFormat === "trade" ? `Your time ran out, so it is ${other.name}'s move.` : "Your time ran out on this one.");
      expect(mine?.sticky).toBe(false);
      const guesserName = SEATS.find((s) => s.seat === guesser)!.name;
      for (const viewer of [{ role: "player", seat: other.seat }, { role: "screen", seat: -1 }, { role: "audience", seat: 1 }]) {
        const snap = game.snapshot(state, now, viewer) as Snapshot;
        expect(timedOutNotice(events, viewer, snap)?.text, JSON.stringify(viewer)).toBe(`${guesserName}'s time ran out.`);
      }
    }
    expect(timedOutNotice([{ k: "abandoned", seat: 0 }], { role: "player", seat: 0 }, game.snapshot(matchFor(0, now).state, now, { role: "player", seat: 0 }) as Snapshot)).toBeNull();
  });

  it("tells a player back from a hidden page that the other confirmed their own guess without them", () => {
    const now = Date.now();
    const { state, sources } = matchFor(2, now - 60_000);
    game.input(state, 2, command(state, "turn.correct.request"), now - 60_000, sources);
    game.presence(state, 0, { connected: true, away: true }, now - 40_000, sources);
    const prev = game.snapshot(state, now, { role: "player", seat: 0 }) as RoomView;
    expect(game.input(state, 2, command(state, "turn.correct.override"), now, sources)).toMatchObject({ ok: true });
    const next = game.snapshot(state, now, { role: "player", seat: 0 }) as RoomView;
    const notice = confirmedWithoutYouNotice(prev, next, false);
    expect(notice).toEqual({ text: "While you were away, Bo confirmed their own guess.", sticky: true, roundIndex: 1 });
    // Not when this page confirmed it, and not for the guesser.
    expect(confirmedWithoutYouNotice(prev, next, true)).toBeNull();
    const bo = game.snapshot(state, now, { role: "player", seat: 2 }) as RoomView;
    expect(confirmedWithoutYouNotice(bo, bo, false)).toBeNull();
    // It names no identity.
    for (const seat of [0, 2]) for (const text of identityTexts(state.match.room.round!.assignments[`seat-${seat}`]!)) expect(notice!.text).not.toContain(text);
  });
});
