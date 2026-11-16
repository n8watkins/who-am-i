// The shared result card's painter (src/client/lib/resultCard.ts), run against a recording stand-in
// for the browser's canvas: whatever the view it is handed carries, it draws no picture and no
// identity. Plain Node, like the party adapter's tests: the painter only needs the stand-ins below.
import { afterEach, describe, expect, it, vi } from "vitest";
import { paintResultCard } from "../../src/client/lib/resultCard";
import { PICTURE_HOST, type RoomView } from "../../src/shared/protocol";
import { getIdentity } from "../../src/worker/content";
import { PICTURES } from "../../src/worker/content/pictures";
import { viewFor } from "../../src/worker/view";
import { cmd, mustApply, setupRoom } from "../helpers";

/** A finished one-round match whose last round revealed two identities with pictures, as the winner sees it. */
function finishedViewWithPictures(): { view: RoomView; identityIds: string[] } {
  let { room, a, b, ctx } = setupRoom({ settings: { packId: "mixed" } });
  const [idA, idB] = Object.keys(PICTURES) as [string, string];
  room = structuredClone(room);
  room.round!.assignments[a] = idA;
  room.round!.assignments[b] = idB;
  room = mustApply(room, a, cmd(room, "turn.correct.request"), ctx);
  room = mustApply(room, b, cmd(room, "turn.correct.confirm"), ctx);
  room = mustApply(room, b, cmd(room, "turn.correct.request"), ctx);
  room = mustApply(room, a, cmd(room, "turn.correct.confirm"), ctx);
  const ended = { ...structuredClone(room), status: "match_summary" as const, match: { winnerId: a, tie: false, rounds: 1 } };
  return { view: viewFor(ended, a, ctx.now, true), identityIds: [idA, idB] };
}

interface Call {
  name: string;
  args: unknown[];
}

/** A 2D context that records every method call and accepts every property write. */
function recordingContext(calls: Call[]) {
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "measureText"
          ? (text: string) => ({ width: text.length * 20 })
          : (...args: unknown[]) => {
              calls.push({ name: String(name), args });
            },
      set: () => true,
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("result card painter", () => {
  it("never draws an image or names an identity, even from a view whose round summary carries pictures", async () => {
    const { view, identityIds } = finishedViewWithPictures();
    // The painter is handed pictures: this is what makes the check below mean something.
    expect(view.roundSummary!.entries.map((e) => e.identity.picture)).toEqual(identityIds.map((id) => PICTURES[id]));

    const calls: Call[] = [];
    const loads: string[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => recordingContext(calls),
      toBlob: (done: (blob: Blob) => void) => done(new Blob(["png"], { type: "image/png" })),
      toDataURL: () => "data:image/png;base64,",
    };
    vi.stubGlobal("document", {
      fonts: { load: async () => [] },
      createElement: (tag: string) => {
        loads.push(`element:${tag}`);
        return canvas;
      },
    });
    vi.stubGlobal("location", { host: "who-am-i.test" });
    vi.stubGlobal(
      "Image",
      class {
        set src(url: string) {
          loads.push(url);
        }
      },
    );
    vi.stubGlobal("fetch", (url: string) => {
      loads.push(String(url));
      throw new Error("the painter must not fetch anything");
    });
    vi.stubGlobal("createImageBitmap", () => {
      loads.push("createImageBitmap");
      throw new Error("the painter must not decode an image");
    });

    const { blob } = await paintResultCard(view);
    expect(blob.type).toBe("image/png");

    expect(calls.filter((c) => c.name === "drawImage")).toEqual([]);
    expect(loads).toEqual(["element:canvas"]);
    const texts = calls.filter((c) => c.name === "fillText" || c.name === "strokeText").map((c) => String(c.args[0]));
    expect(texts.length).toBeGreaterThan(0);
    const forbidden = [PICTURE_HOST, "wikimedia", "wikipedia", ...identityIds.flatMap((id) => [id, getIdentity(id).canonicalName])];
    for (const id of identityIds) {
      const picture = PICTURES[id]!;
      if (picture.author) forbidden.push(picture.author);
    }
    for (const text of texts) for (const word of forbidden) expect(text, `the card says "${text}"`).not.toContain(word);
  });
});
