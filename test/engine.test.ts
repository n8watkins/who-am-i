import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, POINTS_TO_WIN, ROUNDS_PER_MATCH } from "../src/shared/protocol";
import { getIdentity, packIdentities } from "../src/worker/content";
import {
  applyCommand,
  createRoom,
  drawPair,
  expireTurn,
  identitiesClash,
  joinRoom,
  setPresence,
  type RoomState,
} from "../src/worker/engine";
import { cmd, mustApply, setupRoom, testContext } from "./helpers";

/** Plays one full round: A gets `aResult`, B gets `bResult`. */
function playRound(
  room: RoomState,
  a: string,
  b: string,
  ctx: ReturnType<typeof testContext>,
  aResult: "correct" | "skip" = "correct",
  bResult: "correct" | "skip" = "skip",
): RoomState {
  for (const [guesser, judge, result] of [
    [a, b, aResult],
    [b, a, bResult],
  ] as const) {
    if (result === "correct") {
      room = mustApply(room, guesser, cmd(room, "turn.correct.request"), ctx);
      room = mustApply(room, judge, cmd(room, "turn.correct.confirm"), ctx);
    } else {
      room = mustApply(room, guesser, cmd(room, "turn.skip"), ctx);
    }
  }
  return room;
}

describe("lobby and seats", () => {
  it("creates a lobby with the host in seat A", () => {
    const ctx = testContext();
    const { room, playerId } = createRoom(
      { roomId: "r", code: "ABCDEF", nickname: "Host", settings: DEFAULT_SETTINGS },
      ctx,
    );
    expect(room.status).toBe("lobby");
    expect(room.hostPlayerId).toBe(playerId);
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.seat).toBe("A");
    expect(room.events.map((e) => e.type)).toEqual(["room.created", "player.joined"]);
  });

  it("enforces the two-player cap", () => {
    const { room } = setupRoom({ start: false });
    const third = joinRoom(room, "Eve", testContext());
    expect(third).toMatchObject({ ok: false, error: "room_full" });
  });

  it("refuses to start until both players are ready, and only for the host", () => {
    const { room, a, b, ctx } = setupRoom({ start: false });
    expect(applyCommand(room, a, cmd(room, "match.start"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    let r = mustApply(room, a, cmd(room, "player.ready", { ready: true }), ctx);
    r = mustApply(r, b, cmd(r, "player.ready", { ready: true }), ctx);
    expect(applyCommand(r, b, cmd(r, "match.start"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    r = mustApply(r, a, cmd(r, "match.start"), ctx);
    expect(r.status).toBe("guessing_a");
    expect(r.roundIndex).toBe(1);
  });

  it("settings changes reset readiness so both players confirm the new match", () => {
    const { room, a, b, ctx } = setupRoom({ start: false });
    let r = mustApply(room, a, cmd(room, "player.ready", { ready: true }), ctx);
    r = mustApply(r, b, cmd(r, "player.ready", { ready: true }), ctx);
    expect(applyCommand(r, b, cmd(r, "settings.update", { settings: DEFAULT_SETTINGS }), ctx)).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    r = mustApply(r, a, cmd(r, "settings.update", { settings: { ...DEFAULT_SETTINGS, packId: "actors" } }), ctx);
    expect(r.settings.packId).toBe("actors");
    expect(r.players.every((p) => !p.ready)).toBe(true);
  });

  it("rejects settings changes mid-match", () => {
    const { room, a, ctx } = setupRoom();
    expect(applyCommand(room, a, cmd(room, "settings.update", { settings: DEFAULT_SETTINGS }), ctx)).toMatchObject({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("frees the seat when a player leaves and hands host to the remaining player", () => {
    const { room, a, b, ctx } = setupRoom();
    const r = mustApply(room, a, cmd(room, "player.leave"), ctx);
    expect(r.status).toBe("lobby");
    expect(r.players.map((p) => p.id)).toEqual([b]);
    expect(r.players[0]!.seat).toBe("B");
    expect(r.hostPlayerId).toBe(b);
    expect(r.opponentLeft).toBe(true);
    const rejoin = joinRoom(r, "Carol", ctx);
    expect(rejoin.ok && rejoin.room.players.map((p) => p.seat)).toEqual(["A", "B"]);
  });
});

describe("turns and scoring", () => {
  it("runs guessing_a -> guessing_b -> round_summary -> next round", () => {
    let { room, a, b, ctx } = setupRoom();
    expect(room.status).toBe("guessing_a");
    expect(room.turn?.playerId).toBe(a);
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    expect(room.turn?.phase).toBe("pending_confirm");
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    expect(room.status).toBe("guessing_b");
    expect(room.turn?.playerId).toBe(b);
    room = mustApply(room, b, cmd(room, "turn.skip"), ctx);
    expect(room.status).toBe("round_summary");
    expect(room.lastRoundSummary?.entries.map((e) => e.result)).toEqual(["correct", "skipped"]);
    room = mustApply(room, a, cmd(room, "round.next"), ctx);
    expect(room.status).toBe("guessing_a");
    expect(room.roundIndex).toBe(2);
    expect(room.players.find((p) => p.id === a)!.score).toBe(1);
    expect(room.players.find((p) => p.id === b)!.skips).toBe(1);
  });

  it("only the active player can request or skip, only the opponent can confirm", () => {
    let { room, a, b, ctx } = setupRoom();
    expect(applyCommand(room, b, cmd(room, "turn.skip"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    expect(applyCommand(room, b, cmd(room, "turn.correct.request"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    expect(applyCommand(room, a, cmd(room, "turn.correct.confirm"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("a rejected guess returns to asking without scoring", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    room = mustApply(room, b, cmd(room, "turn.correct.reject"), ctx);
    expect(room.turn?.phase).toBe("asking");
    expect(room.players.find((p) => p.id === a)!.score).toBe(0);
  });

  it("increments the version exactly once per accepted command", () => {
    let { room, a, ctx } = setupRoom();
    const before = room.version;
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    expect(room.version).toBe(before + 1);
  });

  it("counts questions only in 20 Questions mode", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, b, cmd(room, "turn.question"), ctx);
    room = mustApply(room, a, cmd(room, "turn.question"), ctx);
    expect(room.turn?.questionCount).toBe(2);
    const describe = setupRoom({ settings: { mode: "describe_it" } });
    expect(
      applyCommand(describe.room, describe.a, cmd(describe.room, "turn.question"), describe.ctx),
    ).toMatchObject({ ok: false, error: "invalid_transition" });
  });
});

describe("idempotency and version checks", () => {
  it("a duplicate confirm (same command id) scores exactly once", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    const confirm = cmd(room, "turn.correct.confirm");
    const first = applyCommand(room, b, confirm, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyCommand(first.room, b, confirm, ctx);
    expect(second).toMatchObject({ ok: true, duplicate: true });
    if (!second.ok) return;
    expect(second.room).toBe(first.room);
    expect(second.room.players.find((p) => p.id === a)!.score).toBe(1);
  });

  it("a second confirm click with a new id but the old version is rejected", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    const staleVersion = room.version;
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    const again = applyCommand(room, b, { type: "turn.correct.confirm", commandId: "fresh-id-123", expectedVersion: staleVersion }, ctx);
    expect(again).toMatchObject({ ok: false, error: "version_conflict" });
    expect(room.players.find((p) => p.id === a)!.score).toBe(1);
  });

  it("duplicate skip clicks skip once", () => {
    let { room, a, ctx } = setupRoom();
    const skip = cmd(room, "turn.skip");
    room = mustApply(room, a, skip, ctx);
    const dup = applyCommand(room, a, skip, ctx);
    expect(dup).toMatchObject({ ok: true, duplicate: true });
    expect(room.players.find((p) => p.id === a)!.skips).toBe(1);
    expect(room.status).toBe("guessing_b");
  });

  it("when both clients race, the first valid transition wins", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    const confirm = cmd(room, "turn.correct.confirm");
    const skip = cmd(room, "turn.skip");
    room = mustApply(room, b, confirm, ctx);
    expect(applyCommand(room, a, skip, ctx)).toMatchObject({ ok: false, error: "version_conflict" });
    expect(room.players.find((p) => p.id === a)!.score).toBe(1);
  });

  it("rejects commands from non-players", () => {
    const { room, ctx } = setupRoom();
    expect(applyCommand(room, "intruder", cmd(room, "turn.skip"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("timer", () => {
  const timed = () => setupRoom({ settings: { timerSeconds: 60 } });

  it("starts a deadline when the turn begins with both players connected", () => {
    const { room, ctx } = timed();
    expect(room.turn?.deadline).toBe(ctx.now + 60_000);
  });

  it("times out a turn exactly once", () => {
    const { room, a, ctx } = timed();
    ctx.advance(59_999);
    expect(expireTurn(room, ctx)).toBeNull();
    ctx.advance(1);
    const expired = expireTurn(room, ctx)!;
    expect(expired.status).toBe("guessing_b");
    expect(expired.players.find((p) => p.id === a)!.skips).toBe(1);
    expect(expired.events.filter((e) => e.type === "turn.timed_out")).toHaveLength(1);
    // The next turn has a fresh deadline, so a second check does nothing.
    expect(expireTurn(expired, ctx)).toBeNull();
    expect(expired.version).toBe(room.version + 1);
  });

  it("a timeout makes a stale command fail instead of double-ending the turn", () => {
    const { room, a, ctx } = timed();
    const skip = cmd(room, "turn.skip");
    ctx.advance(60_000);
    const expired = expireTurn(room, ctx)!;
    expect(applyCommand(expired, a, skip, ctx)).toMatchObject({ ok: false, error: "version_conflict" });
  });

  it("pauses while a guess awaits confirmation and resumes on rejection", () => {
    let { room, a, b, ctx } = timed();
    ctx.advance(20_000);
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    expect(room.turn?.deadline).toBeNull();
    expect(room.turn?.pausedRemainingMs).toBe(40_000);
    ctx.advance(100_000);
    expect(expireTurn(room, ctx)).toBeNull();
    room = mustApply(room, b, cmd(room, "turn.correct.reject"), ctx);
    expect(room.turn?.deadline).toBe(ctx.now + 40_000);
  });

  it("pauses while a player is disconnected", () => {
    let { room, b, ctx } = timed();
    ctx.advance(10_000);
    room = setPresence(room, b, false, ctx)!;
    expect(room.turn?.deadline).toBeNull();
    expect(room.turn?.pausedRemainingMs).toBe(50_000);
    ctx.advance(300_000);
    room = setPresence(room, b, true, ctx)!;
    expect(room.turn?.deadline).toBe(ctx.now + 50_000);
  });

  it("has no deadline when the timer is off", () => {
    const { room, ctx } = setupRoom();
    expect(room.turn?.deadline).toBeNull();
    ctx.advance(10_000_000);
    expect(expireTurn(room, ctx)).toBeNull();
  });
});

describe("host override", () => {
  it("lets the host score their own guess after the opponent is gone for 30 s", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    room = setPresence(room, b, false, ctx)!;
    ctx.advance(29_000);
    expect(applyCommand(room, a, cmd(room, "turn.correct.override"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    ctx.advance(1_000);
    room = mustApply(room, a, cmd(room, "turn.correct.override"), ctx);
    expect(room.players.find((p) => p.id === a)!.score).toBe(1);
  });

  it("is not available to the non-host or while the opponent is connected", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    ctx.advance(60_000);
    expect(applyCommand(room, a, cmd(room, "turn.correct.override"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    room = mustApply(room, b, cmd(room, "turn.correct.request"), ctx);
    room = setPresence(room, a, false, ctx)!;
    ctx.advance(60_000);
    expect(applyCommand(room, b, cmd(room, "turn.correct.override"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("identity draws", () => {
  it("assigns two distinct identities from the chosen pack", () => {
    const { room, a, b } = setupRoom({ settings: { packId: "actors" } });
    const ids = [room.round!.assignments[a]!, room.round!.assignments[b]!];
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(getIdentity(id).categoryId).toBe("actors");
  });

  it("never repeats an identity within a match until the pack is exhausted, then reshuffles", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { packId: "actors", matchType: "rounds" } });
    const packSize = packIdentities("actors").length;
    const seen = new Set<string>();
    let rounds = 0;
    // Play past exhaustion by resetting the round counter so the match does not end.
    while (true) {
      const pair = [room.round!.assignments[a]!, room.round!.assignments[b]!];
      if (room.round!.reshuffled) break;
      for (const id of pair) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      room = playRound(room, a, b, ctx, "skip", "skip");
      room.roundIndex = 0;
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
      rounds++;
      expect(rounds).toBeLessThan(packSize);
    }
    expect(seen.size).toBeGreaterThanOrEqual(packSize - 2);
    expect(room.usedIdentityIds).toHaveLength(2);
  });

  it("draws in the Mixed pack come from several source packs", () => {
    const categories = new Set<string>();
    const { room } = setupRoom();
    const r = structuredClone(room);
    for (let i = 0; i < 200; i++) {
      const { pair } = drawPair(r, Math.random);
      for (const identity of pair) categories.add(identity.categoryId);
    }
    expect(categories.size).toBe(6);
  });

  it("never draws two clashing identities together", () => {
    const { room } = setupRoom();
    for (let i = 0; i < 500; i++) {
      const { pair } = drawPair(room, Math.random);
      expect(identitiesClash(pair[0], pair[1])).toBe(false);
    }
  });
});

describe("match end and rematch", () => {
  it(`ends a points match when someone reaches ${POINTS_TO_WIN} at the end of a round`, () => {
    let { room, a, b, ctx } = setupRoom();
    for (let i = 0; i < POINTS_TO_WIN; i++) {
      room = playRound(room, a, b, ctx, "correct", "skip");
      if (i < POINTS_TO_WIN - 1) {
        expect(room.lastRoundSummary?.matchOver).toBe(false);
        room = mustApply(room, b, cmd(room, "round.next"), ctx);
      }
    }
    expect(room.status).toBe("round_summary");
    expect(room.lastRoundSummary?.matchOver).toBe(true);
    room = mustApply(room, b, cmd(room, "round.next"), ctx);
    expect(room.status).toBe("match_summary");
    expect(room.match).toEqual({ winnerId: a, tie: false, rounds: POINTS_TO_WIN });
  });

  it(`ends a rounds match after ${ROUNDS_PER_MATCH} rounds and reports ties`, () => {
    let { room, a, b, ctx } = setupRoom({ settings: { matchType: "rounds" } });
    for (let i = 0; i < ROUNDS_PER_MATCH; i++) {
      room = playRound(room, a, b, ctx, "skip", "skip");
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(room.status).toBe("match_summary");
    expect(room.match).toEqual({ winnerId: null, tie: true, rounds: ROUNDS_PER_MATCH });
  });

  it("rematch keeps the room and settings, and resets scores and assignments", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { packId: "video-games" } });
    for (let i = 0; i < POINTS_TO_WIN; i++) {
      room = playRound(room, a, b, ctx);
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(room.status).toBe("match_summary");
    room = mustApply(room, b, cmd(room, "match.rematch"), ctx);
    expect(room.status).toBe("lobby");
    expect(room.code).toBe("ABCDEF");
    expect(room.settings.packId).toBe("video-games");
    expect(room.usedIdentityIds).toEqual([]);
    expect(room.players.map((p) => p.score)).toEqual([0, 0]);
    room = mustApply(room, a, cmd(room, "player.ready", { ready: true }), ctx);
    room = mustApply(room, b, cmd(room, "player.ready", { ready: true }), ctx);
    room = mustApply(room, a, cmd(room, "match.start"), ctx);
    expect(room.roundIndex).toBe(1);
    expect(room.events.some((e) => e.type === "match.rematched")).toBe(true);
  });
});
