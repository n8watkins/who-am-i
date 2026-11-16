import { describe, expect, it } from "vitest";
import { PICTURE_HOST } from "../src/shared/protocol";
import { ALL_PACK_IDENTITIES, getIdentity } from "../src/worker/content";
import { PICTURES, picturesOn } from "../src/worker/content/pictures";
import { expireTurn, setPresence, type RoomState } from "../src/worker/engine";
import { resultCardText } from "../src/worker/result-card";
import { previewOf, viewFor } from "../src/worker/view";
import { cmd, mustApply, pictureNeedles, setupRoom } from "./helpers";

function ownIdentity(room: RoomState, playerId: string) {
  return getIdentity(room.round!.assignments[playerId]!);
}

function expectHidden(room: RoomState, viewerId: string, now: number) {
  const identity = ownIdentity(room, viewerId);
  const json = JSON.stringify(viewFor(room, viewerId, now, true));
  expect(json).not.toContain(identity.id);
  expect(json).not.toContain(JSON.stringify(identity.canonicalName).slice(1, -1));
}

describe("per-player view filter", () => {
  it("shows each player only the identity their opponent is guessing", () => {
    const { room, a, b, ctx } = setupRoom();
    const va = viewFor(room, a, ctx.now, true);
    const vb = viewFor(room, b, ctx.now, true);
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
    const summary = viewFor(room, a, ctx.now, true).roundSummary!;
    expect(summary.entries.map((e) => e.identity.id)).toEqual(roundIdentities.map((i) => i.id));
    expect(viewFor(room, a, ctx.now, true).opponentIdentity).toBeNull();

    // The next round's identities are hidden again and the old summary is no longer sent.
    room = mustApply(room, a, cmd(room, "round.next"), ctx);
    expectHidden(room, a, ctx.now);
    expectHidden(room, b, ctx.now);
    expect(viewFor(room, a, ctx.now, true).roundSummary).toBeNull();
  });

  it("does not expose private fields", () => {
    const { room, a, ctx } = setupRoom();
    const json = JSON.stringify(viewFor(room, a, ctx.now, true));
    for (const forbidden of ["assignments", "usedIdentityIds", "recentCommands", "roomId", "events", "aliases"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("shows the reshuffle notice when the pack was exhausted", () => {
    const { room, a, ctx } = setupRoom();
    const reshuffled = structuredClone(room);
    reshuffled.round!.reshuffled = true;
    expect(viewFor(reshuffled, a, ctx.now, true).notices).toContain("pack_reshuffled");
    expect(viewFor(room, a, ctx.now, true).notices).not.toContain("pack_reshuffled");
  });
});

describe("identity pictures in views", () => {
  /** A started room where both players hold an identity that has a picture. */
  function roomWithPictures() {
    const { room, a, b, ctx } = setupRoom({ settings: { packId: "mixed" } });
    const [idA, idB] = Object.keys(PICTURES);
    expect(idA && idB, "at least two identities have pictures").toBeTruthy();
    const pictured = structuredClone(room);
    pictured.round!.assignments[a] = idA!;
    pictured.round!.assignments[b] = idB!;
    return { room: pictured, a, b, ctx, pictureA: PICTURES[idA!]!, pictureB: PICTURES[idB!]! };
  }

  /** A player's own picture: no part of it (the whole object, its address, its file page) may be in their view. */
  function expectOwnPictureHidden(room: RoomState, viewerId: string, now: number) {
    const own = ownIdentity(room, viewerId).picture!;
    const json = JSON.stringify(viewFor(room, viewerId, now, true));
    for (const needle of pictureNeedles(own)) expect(json).not.toContain(needle);
  }

  it("sends a player only their opponent's picture, beside the opponent's name", () => {
    const { room, a, b, ctx, pictureA, pictureB } = roomWithPictures();
    expect(viewFor(room, a, ctx.now, true).opponentIdentity?.picture).toEqual(pictureB);
    expect(viewFor(room, b, ctx.now, true).opponentIdentity?.picture).toEqual(pictureA);
    expectOwnPictureHidden(room, a, ctx.now);
    expectOwnPictureHidden(room, b, ctx.now);
  });

  it("finds a leaked picture by any of its needles, so the leak checks above can fail", () => {
    const { room, a, b, ctx } = roomWithPictures();
    // Bob's view carries Alice's identity as his opponent's: every needle of her picture is in it.
    const json = JSON.stringify(viewFor(room, b, ctx.now, true));
    for (const needle of pictureNeedles(ownIdentity(room, a).picture!)) expect(json).toContain(needle);
  });

  it("never sends a player their own picture in any state before the round summary, then shows both", () => {
    let { room, a, b, ctx, pictureA, pictureB } = roomWithPictures();
    const states: RoomState[] = [room];
    room = mustApply(room, b, cmd(room, "turn.question"), ctx);
    states.push(room);
    room = mustApply(room, a, cmd(room, "turn.hint"), ctx);
    states.push(room);
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    states.push(room);
    room = setPresence(room, b, false, ctx)!;
    states.push(room);
    room = setPresence(room, b, true, ctx)!;
    states.push(room);
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    states.push(room);
    room = mustApply(room, b, cmd(room, "turn.correct.request"), ctx);
    states.push(room);
    for (const s of states) {
      expectOwnPictureHidden(s, a, ctx.now);
      expectOwnPictureHidden(s, b, ctx.now);
    }
    room = mustApply(room, a, cmd(room, "turn.correct.confirm"), ctx);
    expect(room.status).toBe("round_summary");
    for (const viewer of [a, b]) {
      const view = viewFor(room, viewer, ctx.now, true);
      const byPlayer = Object.fromEntries(view.roundSummary!.entries.map((e) => [e.playerId, e.identity.picture]));
      expect(byPlayer).toEqual({ [a]: pictureA, [b]: pictureB });
      expect(view.opponentIdentity).toBeNull();
    }
    // The next round's pictures are hidden again, like its names.
    room = mustApply(room, a, cmd(room, "round.next"), ctx);
    const next = JSON.stringify(viewFor(room, a, ctx.now, true));
    for (const needle of pictureNeedles(pictureA)) expect(next).not.toContain(needle);
  });

  it("keeps pictures out of the lobby, the join preview, the match summary and the share card's words", () => {
    const { room, a, ctx } = roomWithPictures();
    const preview = JSON.stringify(previewOf(room));
    expect(preview).not.toContain("picture");
    expect(preview).not.toContain(PICTURE_HOST);
    const lobby = setupRoom({ start: false });
    expect(JSON.stringify(viewFor(lobby.room, lobby.a, lobby.ctx.now, true))).not.toContain(PICTURE_HOST);
    const ended = structuredClone(room);
    ended.status = "match_summary";
    ended.match = { winnerId: a, tie: false, rounds: 3 };
    expect(JSON.stringify(viewFor(ended, a, ctx.now, true))).not.toContain(PICTURE_HOST);
    expect(JSON.stringify(resultCardText(ended))).not.toContain(PICTURE_HOST);
  });

  it("reads PICTURES: off (any case, any spaces) turns pictures off, anything else or unset leaves them on", () => {
    for (const off of ["off", "OFF", " off ", "Off"]) expect(picturesOn(off)).toBe(false);
    for (const on of [undefined, "", "on", "yes", "offline"]) expect(picturesOn(on)).toBe(true);
  });

  it("sends no picture anywhere in a view built with pictures off, the round summary included", () => {
    let { room, a, b, ctx } = roomWithPictures();
    for (const viewer of [a, b]) {
      const view = viewFor(room, viewer, ctx.now, false);
      expect(view.opponentIdentity).not.toBeNull();
      expect(view.opponentIdentity?.picture).toBeNull();
      expect(JSON.stringify(view)).not.toContain(PICTURE_HOST);
    }
    room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
    room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
    room = mustApply(room, b, cmd(room, "turn.correct.request"), ctx);
    room = mustApply(room, a, cmd(room, "turn.correct.confirm"), ctx);
    expect(room.status).toBe("round_summary");
    const summary = viewFor(room, a, ctx.now, false);
    expect(summary.roundSummary!.entries.map((e) => e.identity.picture)).toEqual([null, null]);
    expect(JSON.stringify(summary)).not.toContain(PICTURE_HOST);
    expect(viewFor(room, a, ctx.now, true).roundSummary!.entries.every((e) => e.identity.picture)).toBe(true);
  });

  it("sends a text-only identity with no picture", () => {
    const textOnly = ALL_PACK_IDENTITIES.find((i) => !i.picture);
    expect(textOnly, "at least one identity is text-only").toBeTruthy();
    const { room, a, b, ctx } = setupRoom({ settings: { packId: "mixed" } });
    const plain = structuredClone(room);
    plain.round!.assignments[b] = textOnly!.id;
    expect(viewFor(plain, a, ctx.now, true).opponentIdentity).toMatchObject({ id: textOnly!.id, picture: null });
  });
});
