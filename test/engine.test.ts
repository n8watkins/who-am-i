import { describe, expect, it } from "vitest";
import { CommandSchema, DEFAULT_SETTINGS, PACK_IDS, POINTS_TO_WIN, QUESTION_RATE_LIMIT, QuestionTextSchema, ROUNDS_PER_MATCH } from "../src/shared/protocol";
import { getIdentity, packIdentities } from "../src/worker/content";
import {
  applyCommand,
  createRoom,
  DIFFICULTY_POOLS,
  drawPair,
  expireTurn,
  identitiesClash,
  joinRoom,
  setAway,
  setPresence,
  type RoomState,
} from "../src/worker/engine";
import { viewFor } from "../src/worker/view";
import { cmd, mustApply, setupRoom, testContext } from "./helpers";

/** Plays one full round in whatever order the server chose: A gets `aResult`, B gets `bResult`. */
function playRound(
  room: RoomState,
  a: string,
  b: string,
  ctx: ReturnType<typeof testContext>,
  aResult: "correct" | "skip" = "correct",
  bResult: "correct" | "skip" = "skip",
): RoomState {
  for (let i = 0; i < 2; i++) {
    const guesser = room.turn!.playerId;
    const judge = guesser === a ? b : a;
    const result = guesser === a ? aResult : bResult;
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

  it("refuses to start without a second player, and only for the host", () => {
    const { room, a, b, ctx } = setupRoom({ start: false });
    const alone = mustApply(room, b, cmd(room, "player.leave"), ctx);
    expect(applyCommand(alone, a, cmd(alone, "match.start"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(applyCommand(room, b, cmd(room, "match.start"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    const r = mustApply(room, a, cmd(room, "match.start"), ctx);
    expect(r.status).toBe("guessing_first");
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
    expect(room.status).toBe("guessing_first");
    expect(room.turn?.playerId).toBe(a);
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    expect(room.turn?.phase).toBe("pending_confirm");
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    expect(room.status).toBe("guessing_second");
    expect(room.turn?.playerId).toBe(b);
    room = mustApply(room, b, cmd(room, "turn.skip"), ctx);
    expect(room.status).toBe("round_summary");
    expect(room.lastRoundSummary?.entries.map((e) => e.result)).toEqual(["correct", "skipped"]);
    room = mustApply(room, a, cmd(room, "round.next"), ctx);
    expect(room.status).toBe("guessing_first");
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
    expect(room.status).toBe("guessing_second");
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
    expect(expired.status).toBe("guessing_second");
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

describe("away (phone locked or another app)", () => {
  it("pauses a timed turn while a player is away and resumes when they are back", () => {
    let { room, b, ctx } = setupRoom({ settings: { timerSeconds: 60 } });
    ctx.advance(15_000);
    room = setAway(room, b, true, ctx)!;
    expect(room.players.find((p) => p.id === b)).toMatchObject({ away: true, awaySince: ctx.now });
    expect(room.turn).toMatchObject({ deadline: null, pausedRemainingMs: 45_000 });
    ctx.advance(600_000);
    expect(expireTurn(room, ctx)).toBeNull();
    room = setAway(room, b, false, ctx)!;
    expect(room.players.find((p) => p.id === b)).toMatchObject({ away: false, awaySince: null });
    expect(room.turn?.deadline).toBe(ctx.now + 45_000);
  });

  it("is shown to the other player, and is not player activity", () => {
    let { room, a, b, ctx } = setupRoom();
    const before = room.lastActivityAt;
    ctx.advance(1_000);
    room = setAway(room, b, true, ctx)!;
    expect(room.lastActivityAt).toBe(before);
    expect(viewFor(room, a, ctx.now).players.find((p) => p.playerId === b)).toMatchObject({ away: true, awaySince: ctx.now });
  });

  it("changes nothing when repeated, or for a disconnected player, and a reconnect clears it", () => {
    let { room, b, ctx } = setupRoom();
    room = setAway(room, b, true, ctx)!;
    expect(setAway(room, b, true, ctx)).toBeNull();
    room = setPresence(room, b, false, ctx)!;
    expect(setAway(room, b, false, ctx)).toBeNull();
    room = setPresence(room, b, true, ctx)!;
    expect(room.players.find((p) => p.id === b)).toMatchObject({ connected: true, away: false });
  });

  it("lets the host confirm their own guess once the opponent has been away for 30 s", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    room = setAway(room, b, true, ctx)!;
    ctx.advance(29_000);
    expect(applyCommand(room, a, cmd(room, "turn.correct.override"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    ctx.advance(1_000);
    const away = mustApply(room, a, cmd(room, "turn.correct.override"), ctx);
    expect(away.players.find((p) => p.id === a)!.score).toBe(1);
    // Coming back in time takes the override away again.
    room = setAway(room, b, false, ctx)!;
    expect(applyCommand(room, a, cmd(room, "turn.correct.override"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
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

  it("one-tap rematch: when both tap Rematch the next match starts with the same settings", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { packId: "video-games" } });
    for (let i = 0; i < POINTS_TO_WIN; i++) {
      room = playRound(room, a, b, ctx);
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(room.status).toBe("match_summary");
    const before = [...room.usedIdentityIds];
    room = mustApply(room, b, cmd(room, "match.rematch"), ctx);
    expect(room.status).toBe("match_summary");
    expect(room.rematchVotes).toEqual([b]);
    expect(applyCommand(room, b, cmd(room, "match.rematch"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    room = mustApply(room, a, cmd(room, "match.rematch"), ctx);
    expect(room.status).toBe("guessing_first");
    expect(room.roundIndex).toBe(1);
    expect(room.code).toBe("ABCDEF");
    expect(room.settings.packId).toBe("video-games");
    // A fresh draw that avoids every identity from the previous match.
    const previous = new Set(before);
    expect(previous.has(room.round!.assignments[a]!)).toBe(false);
    expect(previous.has(room.round!.assignments[b]!)).toBe(false);
    expect(room.players.map((p) => p.score)).toEqual([0, 0]);
    expect(room.rematchVotes).toEqual([]);
    expect(room.events.some((e) => e.type === "match.rematched")).toBe(true);
  });

  it("either player can go back to the lobby to change settings", () => {
    let { room, a, b, ctx } = setupRoom();
    for (let i = 0; i < POINTS_TO_WIN; i++) {
      room = playRound(room, a, b, ctx);
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    room = mustApply(room, a, cmd(room, "match.rematch"), ctx);
    room = mustApply(room, b, cmd(room, "match.change_settings"), ctx);
    expect(room.status).toBe("lobby");
    expect(room.rematchVotes).toEqual([]);
    expect(room.players.every((p) => !p.ready && p.score === 0)).toBe(true);
  });
});

describe("turn order", () => {
  it("alternates the first guesser every round", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { matchType: "rounds" } });
    const firsts: string[] = [];
    for (let i = 0; i < 4; i++) {
      firsts.push(room.turn!.playerId);
      expect(room.round!.order[0]).toBe(room.turn!.playerId);
      room = playRound(room, a, b, ctx, "skip", "skip");
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(firsts).toEqual([a, b, a, b]);
  });

  it("starts with the host, the opponent, or a random player per the lobby setting", () => {
    const host = setupRoom({ settings: { firstPlayer: "host" } });
    expect(host.room.turn!.playerId).toBe(host.a);
    const opp = setupRoom({ settings: { firstPlayer: "opponent" } });
    expect(opp.room.turn!.playerId).toBe(opp.b);
    const starters = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const r = setupRoom({ settings: { firstPlayer: "random" }, seed });
      starters.add(r.room.turn!.playerId === r.a ? "host" : "opponent");
    }
    expect(starters).toEqual(new Set(["host", "opponent"]));
  });

  it("a rematch starts with the loser of the previous match", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { firstPlayer: "opponent" } });
    // B goes first in round 1; A wins every round.
    for (let i = 0; i < POINTS_TO_WIN; i++) {
      room = playRound(room, a, b, ctx, "correct", "skip");
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(room.match?.winnerId).toBe(a);
    room = mustApply(room, a, cmd(room, "match.rematch"), ctx);
    room = mustApply(room, b, cmd(room, "match.rematch"), ctx);
    expect(room.turn!.playerId).toBe(b);

    // Now B wins: A (the loser) starts the next rematch.
    for (let i = 0; i < POINTS_TO_WIN; i++) {
      room = playRound(room, a, b, ctx, "skip", "correct");
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(room.match?.winnerId).toBe(b);
    room = mustApply(room, b, cmd(room, "match.rematch"), ctx);
    room = mustApply(room, a, cmd(room, "match.rematch"), ctx);
    expect(room.turn!.playerId).toBe(a);
  });

  it("after a tie, whoever went second in the previous match's round 1 starts the rematch", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { matchType: "rounds", firstPlayer: "host" } });
    for (let i = 0; i < ROUNDS_PER_MATCH; i++) {
      room = playRound(room, a, b, ctx, "skip", "skip");
      room = mustApply(room, a, cmd(room, "round.next"), ctx);
    }
    expect(room.match?.tie).toBe(true);
    room = mustApply(room, a, cmd(room, "match.rematch"), ctx);
    room = mustApply(room, b, cmd(room, "match.rematch"), ctx);
    expect(room.turn!.playerId).toBe(b);
  });

  it("exposes who goes first in the view", () => {
    const { room, a, b, ctx } = setupRoom({ settings: { firstPlayer: "opponent" } });
    expect(viewFor(room, a, ctx.now).firstPlayerId).toBe(b);
  });
});

describe("hints", () => {
  it("reveals the guesser's own hints one at a time, up to 3 per turn", () => {
    let { room, a, b, ctx } = setupRoom();
    const identity = getIdentity(room.round!.assignments[a]!);
    expect(applyCommand(room, b, cmd(room, "turn.hint"), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    for (let i = 0; i < 3; i++) {
      // Nothing about the next hint is in either player's view before it is requested.
      for (const viewer of [a, b]) {
        const json = JSON.stringify(viewFor(room, viewer, ctx.now));
        for (const hint of identity.hints.slice(i)) expect(json).not.toContain(hint);
      }
      room = mustApply(room, a, cmd(room, "turn.hint"), ctx);
      expect(room.turn!.log.at(-1)).toMatchObject({ kind: "hint", index: i + 1, text: identity.hints[i] });
      expect(viewFor(room, b, ctx.now).turn!.log.map((e) => e.text)).toEqual(identity.hints.slice(0, i + 1));
    }
    expect(applyCommand(room, a, cmd(room, "turn.hint"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(room.players.find((p) => p.id === a)!.hintsUsed).toBe(3);
  });

  it("never puts the identity's name or id in a hint", () => {
    let { room, a, ctx } = setupRoom();
    const identity = getIdentity(room.round!.assignments[a]!);
    for (let i = 0; i < 3; i++) room = mustApply(room, a, cmd(room, "turn.hint"), ctx);
    const json = JSON.stringify(viewFor(room, a, ctx.now));
    expect(json).not.toContain(identity.id);
    expect(json).not.toContain(identity.canonicalName);
  });

  it("is rejected when hints are off and while a guess awaits confirmation", () => {
    const off = setupRoom({ settings: { hints: false } });
    expect(applyCommand(off.room, off.a, cmd(off.room, "turn.hint"), off.ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    let { room, a, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    expect(applyCommand(room, a, cmd(room, "turn.hint"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
  });

  it("does not change scoring, and summaries count hints per player", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.hint"), ctx);
    room = mustApply(room, a, cmd(room, "turn.hint"), ctx);
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    expect(room.turn!.log).toEqual([]);
    room = mustApply(room, b, cmd(room, "turn.hint"), ctx);
    room = mustApply(room, b, cmd(room, "turn.skip"), ctx);
    const summary = viewFor(room, a, ctx.now).roundSummary!;
    expect(Object.fromEntries(summary.entries.map((e) => [e.playerId, e.hintsUsed]))).toEqual({ [a]: 2, [b]: 1 });
    expect(room.players.find((p) => p.id === a)!.score).toBe(1);
  });
});

describe("in-app questions", () => {
  it("the guesser asks, the opponent answers, both see the log, and the counter goes up", () => {
    let { room, a, b, ctx } = setupRoom();
    room = mustApply(room, a, cmd(room, "turn.ask", { text: "Am I a real person?" }), ctx);
    const question = room.turn!.log.at(-1)!;
    expect(question).toMatchObject({ kind: "question", text: "Am I a real person?", answer: null });
    expect(room.turn!.questionCount).toBe(1);
    expect(applyCommand(room, a, cmd(room, "turn.ask", { text: "Am I alive?" }), ctx)).toMatchObject({
      ok: false,
      error: "invalid_transition",
    });
    expect(applyCommand(room, a, cmd(room, "turn.answer", { questionId: question.id, answer: "yes" }), ctx)).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    room = mustApply(room, b, cmd(room, "turn.answer", { questionId: question.id, answer: "sort_of" }), ctx);
    for (const viewer of [a, b]) {
      expect(viewFor(room, viewer, ctx.now).turn!.log).toEqual([expect.objectContaining({ text: "Am I a real person?", answer: "sort_of" })]);
    }
    expect(applyCommand(room, b, cmd(room, "turn.answer", { questionId: question.id, answer: "no" }), ctx)).toMatchObject({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("only the guesser can ask, and not in a spoken-only room", () => {
    const { room, b, ctx } = setupRoom();
    expect(applyCommand(room, b, cmd(room, "turn.ask", { text: "Am I fictional?" }), ctx)).toMatchObject({ ok: false, error: "forbidden" });
    const spoken = setupRoom({ settings: { questions: "spoken" } });
    expect(applyCommand(spoken.room, spoken.a, cmd(spoken.room, "turn.ask", { text: "Am I fictional?" }), spoken.ctx)).toMatchObject({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("rate-limits question sends per player", () => {
    let { room, a, b, ctx } = setupRoom();
    for (let i = 0; i < QUESTION_RATE_LIMIT.limit; i++) {
      room = mustApply(room, a, cmd(room, "turn.ask", { text: `Question ${i}?` }), ctx);
      room = mustApply(room, b, cmd(room, "turn.answer", { questionId: room.turn!.log.at(-1)!.id, answer: "no" }), ctx);
      ctx.advance(1_000);
    }
    expect(applyCommand(room, a, cmd(room, "turn.ask", { text: "One more?" }), ctx)).toMatchObject({ ok: false, error: "rate_limited" });
    ctx.advance(QUESTION_RATE_LIMIT.windowMs);
    expect(applyCommand(room, a, cmd(room, "turn.ask", { text: "One more?" }), ctx).ok).toBe(true);
  });

  it("validates question text with Zod: trimmed, plain, at most 140 characters", () => {
    expect(QuestionTextSchema.parse("  Am I\n  famous?\u0000 ")).toBe("Am I famous?");
    expect(QuestionTextSchema.safeParse("   ").success).toBe(false);
    expect(QuestionTextSchema.safeParse("x".repeat(141)).success).toBe(false);
    expect(QuestionTextSchema.parse("<b>Am I bold?</b>")).toBe("<b>Am I bold?</b>");
    const parsed = CommandSchema.safeParse({ type: "turn.ask", commandId: "abcdefgh", expectedVersion: 1, text: "x".repeat(200) });
    expect(parsed.success).toBe(false);
  });
});

describe("Trade turns", () => {
  const trade = (seed?: number) => setupRoom({ settings: { turnFormat: "trade" }, seed });
  const ask = (room: RoomState, player: string, ctx: ReturnType<typeof testContext>, text = "Am I real?") =>
    mustApply(room, player, cmd(room, "turn.ask", { text }), ctx);
  const answer = (room: RoomState, player: string, ctx: ReturnType<typeof testContext>) => {
    const pending = room.turn!.log.find((e) => e.kind === "question" && e.answer === null)!;
    return mustApply(room, player, cmd(room, "turn.answer", { questionId: pending.id, answer: "yes" }), ctx);
  };

  it("allows one question per move, then a guess or a pass", () => {
    const { room, a, b, ctx } = trade();
    let r = ask(room, a, ctx);
    expect(applyCommand(r, a, cmd(r, "turn.pass"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(applyCommand(r, a, cmd(r, "turn.correct.request"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    r = answer(r, b, ctx);
    expect(applyCommand(r, a, cmd(r, "turn.ask", { text: "Again?" }), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(applyCommand(r, a, cmd(r, "turn.question"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    r = mustApply(r, a, cmd(r, "turn.pass"), ctx);
    expect(r.turn!.playerId).toBe(b);
    expect(r.turn!.log).toEqual([]);
  });

  it("ends the move on a wrong guess, without ending the round", () => {
    const { room, a, b, ctx } = trade();
    let r = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    r = mustApply(r, b, cmd(r, "turn.correct.reject"), ctx);
    expect(r.turn).toMatchObject({ playerId: b, phase: "asking" });
    expect(r.round!.results).toEqual({});
  });

  it("keeps each player's questions and hints across moves", () => {
    const { room, a, b, ctx } = trade();
    let r = ask(room, a, ctx, "Am I old?");
    r = answer(r, b, ctx);
    r = mustApply(r, a, cmd(r, "turn.hint"), ctx);
    r = mustApply(r, a, cmd(r, "turn.pass"), ctx);
    r = mustApply(r, b, cmd(r, "turn.pass"), ctx);
    expect(r.turn!.playerId).toBe(a);
    expect(r.turn!.questionCount).toBe(1);
    expect(r.turn!.hintsUsed).toBe(1);
    expect(r.turn!.log.map((e) => e.kind)).toEqual(["question", "hint"]);
    expect(r.turn!.moveAsked).toBe(false);
  });

  it("ends the round on the first correct guess, and the other player was beaten", () => {
    const { room, a, b, ctx } = trade();
    let r = mustApply(room, a, cmd(room, "turn.pass"), ctx);
    r = mustApply(r, b, cmd(r, "turn.correct.request"), ctx);
    r = mustApply(r, a, cmd(r, "turn.correct.confirm"), ctx);
    expect(r.status).toBe("round_summary");
    const results = Object.fromEntries(r.lastRoundSummary!.entries.map((e) => [e.playerId, e.result]));
    expect(results).toEqual({ [a]: "beaten", [b]: "correct" });
    expect(r.players.find((p) => p.id === b)!.score).toBe(1);
  });

  it("lets the other player finish alone after one gives up, and ends with no point if both do", () => {
    const { room, a, b, ctx } = trade();
    let r = mustApply(room, a, cmd(room, "turn.skip"), ctx);
    expect(r.turn!.playerId).toBe(b);
    r = mustApply(r, b, cmd(r, "turn.pass"), ctx);
    expect(r.turn!.playerId).toBe(b);
    r = mustApply(r, b, cmd(r, "turn.skip"), ctx);
    expect(r.status).toBe("round_summary");
    expect(r.lastRoundSummary!.entries.map((e) => e.result)).toEqual(["skipped", "skipped"]);
    expect(r.players.every((p) => p.score === 0)).toBe(true);
  });

  it("treats running out of time as a passed move", () => {
    const { room, a, b, ctx } = setupRoom({ settings: { turnFormat: "trade", timerSeconds: 60 } });
    ctx.now += 61_000;
    const expired = expireTurn(room, ctx)!;
    expect(expired.turn!.playerId).toBe(b);
    expect(expired.round!.results[a]).toBeUndefined();
    expect(expired.turn!.deadline).toBe(ctx.now + 60_000);
  });

  it("never applies to Clues rooms", () => {
    const { room, a, b, ctx } = setupRoom({ settings: { turnFormat: "trade", mode: "describe_it" } });
    expect(applyCommand(room, a, cmd(room, "turn.pass"), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
    const r = mustApply(room, a, cmd(room, "turn.skip"), ctx);
    expect(r.turn!.playerId).toBe(b);
    expect(r.status).toBe("guessing_second");
  });
});

describe("difficulty", () => {
  const levels = ["easy", "medium", "hard"] as const;

  it("draws only from the level's pool, in every pack, and always finds a pair", () => {
    for (const packId of PACK_IDS) {
      for (const difficulty of levels) {
        const { room } = setupRoom({ settings: { packId, difficulty }, start: false });
        for (let i = 0; i < 40; i++) {
          const { pair } = drawPair(room, Math.random);
          for (const identity of pair) expect(DIFFICULTY_POOLS[difficulty]).toContain(identity.difficulty);
        }
      }
    }
  });

  it("gets through a full 10 round match at every level in every pack", () => {
    for (const packId of PACK_IDS) {
      for (const difficulty of levels) {
        let { room, a, b, ctx } = setupRoom({ settings: { packId, difficulty, matchType: "rounds" } });
        for (let round = 1; round <= 10; round++) {
          room = playRound(room, a, b, ctx, "skip", "skip");
          room = mustApply(room, a, cmd(room, "round.next"), ctx);
        }
        expect(room.status).toBe("match_summary");
      }
    }
  });

  it("gives each player their own level as a handicap", () => {
    const { room, a, b, ctx } = setupRoom({ settings: { packId: "mixed", difficulty: "medium" }, start: false });
    let r = mustApply(room, a, cmd(room, "player.difficulty", { difficulty: "hard" }), ctx);
    r = mustApply(r, b, cmd(r, "player.difficulty", { difficulty: "easy" }), ctx);
    for (let i = 0; i < 30; i++) {
      const { pair } = drawPair(r, Math.random, [a, b]);
      expect(DIFFICULTY_POOLS.hard).toContain(pair[0].difficulty);
      expect(pair[1].difficulty).toBe("easy");
    }
    r = mustApply(r, b, cmd(r, "player.difficulty", { difficulty: null }), ctx);
    expect(viewFor(r, a, ctx.now).players.map((p) => p.difficulty)).toEqual(["hard", null]);
  });

  it("only changes between matches", () => {
    const { room, a, ctx } = setupRoom();
    expect(applyCommand(room, a, cmd(room, "player.difficulty", { difficulty: "easy" }), ctx)).toMatchObject({ ok: false, error: "invalid_transition" });
  });
});
