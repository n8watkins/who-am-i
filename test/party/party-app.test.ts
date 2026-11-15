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
import { PartyApp } from "../../src/party-view/PartyApp";
import type { RoomView } from "../../src/shared/protocol";

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

function hostFor(snapshot: Snapshot, now: number): PartyHost {
  return {
    room: {},
    you: snapshot.role === "player" ? { role: "player", seat: snapshot.seat } : { role: snapshot.role, seat: -1 },
    snapshot,
    inset: { top: 56, right: 56 },
    now: () => now,
    send: () => Promise.resolve(),
    inputId: () => "x.1",
    on: () => () => {},
    ready: () => {},
  };
}

const render = (snapshot: Snapshot, now: number) => renderToStaticMarkup(createElement(PartyApp, { host: hostFor(snapshot, now) }));

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
