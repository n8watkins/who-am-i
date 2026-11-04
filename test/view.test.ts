import { describe, expect, it } from "vitest";
import { getIdentity } from "../src/worker/content";
import { expireTurn, setPresence, type RoomState } from "../src/worker/engine";
import { viewFor } from "../src/worker/view";
import { cmd, mustApply, setupRoom } from "./helpers";

function ownIdentity(room: RoomState, playerId: string) {
  return getIdentity(room.round!.assignments[playerId]!);
}

function expectHidden(room: RoomState, viewerId: string, now: number) {
  const identity = ownIdentity(room, viewerId);
  const json = JSON.stringify(viewFor(room, viewerId, now));
  expect(json).not.toContain(identity.id);
  expect(json).not.toContain(JSON.stringify(identity.canonicalName).slice(1, -1));
}

describe("per-player view filter", () => {
  it("shows each player only the identity their opponent is guessing", () => {
    const { room, a, b, ctx } = setupRoom();
    const va = viewFor(room, a, ctx.now);
    const vb = viewFor(room, b, ctx.now);
    expect(va.opponentIdentity?.id).toBe(room.round!.assignments[b]);
    expect(vb.opponentIdentity?.id).toBe(room.round!.assignments[a]);
    expectHidden(room, a, ctx.now);
    expectHidden(room, b, ctx.now);
  });

  it("never leaks a player's own identity in any state before the round summary", () => {
    let { room, a, b, ctx } = setupRoom({ settings: { timerSeconds: 60 } });
    const states: RoomState[] = [room];
    room = mustApply(room, b, cmd(room, "turn.question"), ctx);
    states.push(room);
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    states.push(room);
    room = setPresence(room, b, false, ctx)!;
    states.push(room);
    room = setPresence(room, b, true, ctx)!;
    states.push(room);
    room = mustApply(room, b, cmd(room, "turn.correct.reject"), ctx);
    states.push(room);
    ctx.advance(60_000);
    room = expireTurn(room, ctx)!;
    states.push(room);
    room = mustApply(room, b, cmd(room, "turn.correct.request"), ctx);
    states.push(room);
    for (const s of states) {
      expectHidden(s, a, ctx.now);
      expectHidden(s, b, ctx.now);
    }
    const roundIdentities = [ownIdentity(room, a), ownIdentity(room, b)];
    room = mustApply(room, a, cmd(room, "turn.correct.confirm"), ctx);
    expect(room.status).toBe("round_summary");
    const summary = viewFor(room, a, ctx.now).roundSummary!;
    expect(summary.entries.map((e) => e.identity.id)).toEqual(roundIdentities.map((i) => i.id));
    expect(viewFor(room, a, ctx.now).opponentIdentity).toBeNull();

    // The next round's identities are hidden again and the old summary is no longer sent.
    room = mustApply(room, a, cmd(room, "round.next"), ctx);
    expectHidden(room, a, ctx.now);
    expectHidden(room, b, ctx.now);
    expect(viewFor(room, a, ctx.now).roundSummary).toBeNull();
  });

  it("does not expose private fields", () => {
    const { room, a, ctx } = setupRoom();
    const json = JSON.stringify(viewFor(room, a, ctx.now));
    for (const forbidden of ["assignments", "usedIdentityIds", "recentCommands", "roomId", "events", "aliases"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("shows the reshuffle notice when the pack was exhausted", () => {
    const { room, a, ctx } = setupRoom();
    const reshuffled = structuredClone(room);
    reshuffled.round!.reshuffled = true;
    expect(viewFor(reshuffled, a, ctx.now).notices).toContain("pack_reshuffled");
    expect(viewFor(room, a, ctx.now).notices).not.toContain("pack_reshuffled");
  });
});
