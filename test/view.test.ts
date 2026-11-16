import { describe, expect, it } from "vitest";
import { PICTURE_HOST } from "../src/shared/protocol";
import { ALL_PACK_IDENTITIES, getIdentity } from "../src/worker/content";
import { configurePictures, PICTURES, picturesEnabled } from "../src/worker/content/pictures";
import { expireTurn, setPresence, type RoomState } from "../src/worker/engine";
import { resultCardText } from "../src/worker/result-card";
import { previewOf, viewFor } from "../src/worker/view";
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

  /** A player's own picture: neither its address nor its file page may be in their view. */
  function expectOwnPictureHidden(room: RoomState, viewerId: string, now: number) {
    const own = ownIdentity(room, viewerId).picture!;
    const json = JSON.stringify(viewFor(room, viewerId, now));
    expect(json).not.toContain(own.imageUrl);
    expect(json).not.toContain(own.filePage);
  }

  it("sends a player only their opponent's picture, beside the opponent's name", () => {
    const { room, a, b, ctx, pictureA, pictureB } = roomWithPictures();
    expect(viewFor(room, a, ctx.now).opponentIdentity?.picture).toEqual(pictureB);
    expect(viewFor(room, b, ctx.now).opponentIdentity?.picture).toEqual(pictureA);
    expectOwnPictureHidden(room, a, ctx.now);
    expectOwnPictureHidden(room, b, ctx.now);
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
      const view = viewFor(room, viewer, ctx.now);
      const byPlayer = Object.fromEntries(view.roundSummary!.entries.map((e) => [e.playerId, e.identity.picture]));
      expect(byPlayer).toEqual({ [a]: pictureA, [b]: pictureB });
      expect(view.opponentIdentity).toBeNull();
    }
    // The next round's pictures are hidden again, like its names.
    room = mustApply(room, a, cmd(room, "round.next"), ctx);
    expect(JSON.stringify(viewFor(room, a, ctx.now))).not.toContain(pictureA.imageUrl);
  });

  it("keeps pictures out of the lobby, the join preview, the match summary and the share card's words", () => {
    const { room, a, ctx } = roomWithPictures();
    const preview = JSON.stringify(previewOf(room));
    expect(preview).not.toContain("picture");
    expect(preview).not.toContain(PICTURE_HOST);
    const lobby = setupRoom({ start: false });
    expect(JSON.stringify(viewFor(lobby.room, lobby.a, lobby.ctx.now))).not.toContain(PICTURE_HOST);
    const ended = structuredClone(room);
    ended.status = "match_summary";
    ended.match = { winnerId: a, tie: false, rounds: 3 };
    expect(JSON.stringify(viewFor(ended, a, ctx.now))).not.toContain(PICTURE_HOST);
    expect(JSON.stringify(resultCardText(ended))).not.toContain(PICTURE_HOST);
  });

  it("turns every picture off with PICTURES=off, and back on when it is unset", () => {
    const { room, a, ctx } = roomWithPictures();
    try {
      for (const off of ["off", "OFF", " off "]) {
        configurePictures(off);
        expect(picturesEnabled()).toBe(false);
        const view = viewFor(room, a, ctx.now);
        expect(view.opponentIdentity?.picture).toBeNull();
        expect(JSON.stringify(view)).not.toContain(PICTURE_HOST);
      }
      configurePictures("on");
      expect(viewFor(room, a, ctx.now).opponentIdentity?.picture).not.toBeNull();
      configurePictures("off");
      configurePictures(undefined);
      expect(viewFor(room, a, ctx.now).opponentIdentity?.picture).not.toBeNull();
    } finally {
      configurePictures(undefined);
    }
  });

  it("sends a text-only identity with no picture", () => {
    const textOnly = ALL_PACK_IDENTITIES.find((i) => !i.picture);
    expect(textOnly, "at least one identity is text-only").toBeTruthy();
    const { room, a, b, ctx } = setupRoom({ settings: { packId: "mixed" } });
    const plain = structuredClone(room);
    plain.round!.assignments[b] = textOnly!.id;
    expect(viewFor(plain, a, ctx.now).opponentIdentity).toMatchObject({ id: textOnly!.id, picture: null });
  });
});
