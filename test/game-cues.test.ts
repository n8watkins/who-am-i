import { describe, expect, it } from "vitest";
import { cuesFor } from "../src/client/lib/gameCues";
import type { RoomState } from "../src/worker/engine";
import { viewFor } from "../src/worker/view";
import { cmd, mustApply, setupRoom } from "./helpers";

/** The cues each player hears when the room goes from `before` to `after`. */
function heard(before: RoomState, after: RoomState, players: string[], now: number) {
  return players.map((p) => cuesFor(viewFor(before, p, now), viewFor(after, p, now)));
}

describe("sound and haptic cues", () => {
  it("calls the guesser when their turn starts, and nobody else", () => {
    const { room: lobby, a, b, ctx } = setupRoom({ start: false });
    let room = mustApply(lobby, a, cmd(lobby, "player.ready", { ready: true }), ctx);
    room = mustApply(room, b, cmd(room, "player.ready", { ready: true }), ctx);
    const started = mustApply(room, a, cmd(room, "match.start"), ctx);
    expect(heard(room, started, [a, b], ctx.now)).toEqual([["attention"], []]);
  });

  it("calls the answerer for a typed question and the judge for a guess, then celebrates a correct one", () => {
    const { room, a, b, ctx } = setupRoom();
    const asked = mustApply(room, a, cmd(room, "turn.ask", { text: "Am I real?" }), ctx);
    expect(heard(room, asked, [a, b], ctx.now)).toEqual([[], ["attention"]]);
    const questionId = asked.turn!.log[0]!.id;
    const answered = mustApply(asked, b, cmd(asked, "turn.answer", { questionId, answer: "yes" }), ctx);
    expect(heard(asked, answered, [a, b], ctx.now)).toEqual([[], []]);
    const guessed = mustApply(answered, a, cmd(answered, "turn.correct.request"), ctx);
    expect(heard(answered, guessed, [a, b], ctx.now)).toEqual([[], ["attention"]]);
    const confirmed = mustApply(guessed, b, cmd(guessed, "turn.correct.confirm"), ctx);
    // Bob's own turn starts at the same moment; the success sound wins.
    expect(heard(guessed, confirmed, [a, b], ctx.now)).toEqual([["success"], ["success"]]);
  });

  it("plays nothing for changes that need nobody, like presence", () => {
    const { room, a, b, ctx } = setupRoom();
    const counted = mustApply(room, b, cmd(room, "turn.question"), ctx);
    expect(heard(room, counted, [a, b], ctx.now)).toEqual([[], []]);
  });

  it("hands the call back and forth with each Trade turns move", () => {
    const { room, a, b, ctx } = setupRoom({ settings: { turnFormat: "trade" } });
    const passed = mustApply(room, a, cmd(room, "turn.pass"), ctx);
    expect(heard(room, passed, [a, b], ctx.now)).toEqual([[], ["attention"]]);
    const back = mustApply(passed, b, cmd(passed, "turn.pass"), ctx);
    expect(heard(passed, back, [a, b], ctx.now)).toEqual([["attention"], []]);
  });

  it("ends the match with victory, defeat or a draw", () => {
    let { room, a, b, ctx } = setupRoom();
    for (;;) {
      const guesser = room.turn!.playerId;
      if (guesser === a) {
        room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
        room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
      } else {
        room = mustApply(room, b, cmd(room, "turn.skip"), ctx);
      }
      if (room.status === "round_summary") {
        const before = room;
        room = mustApply(room, a, cmd(room, "round.next"), ctx);
        if (room.status === "match_summary") {
          expect(heard(before, room, [a, b], ctx.now)).toEqual([["victory"], ["defeat"]]);
          return;
        }
      }
    }
  });
});
