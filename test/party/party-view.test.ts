// The module a party room mounts (party-view/view.js, from src/party-view/public/view.js), with
// a stand-in for the few DOM calls it makes: it puts one frame inside the container and nothing
// anywhere else, hands the frame the room's context, holds what the room says until the page is
// listening, and leaves nothing behind when it is unmounted. The page in the frame (React) is not
// run here; nothing of it was checked in a browser.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain JavaScript with no types: it is served as it is.
import { mount } from "../../party-view/view.js";

type Host = Record<string, unknown> & {
  on(type: string, handler: (...args: unknown[]) => void): () => void;
  ready(): void;
  attach(): Host;
  send(data: unknown, opts: unknown): Promise<unknown>;
};

interface FakeEl {
  tag: string;
  style: Record<string, string>;
  attrs: Record<string, string>;
  children: FakeEl[];
  parent: FakeEl | null;
  src?: string;
  title?: string;
  partyHost?: Host | null;
  clientWidth: number;
}

/**
 * The room's page: `viewport` CSS pixels wide, and the box the room lays over it (the stage) at
 * `left`, `width` wide. On a phone held sideways in an upright game the room letterboxes the stage
 * to an upright shape in the middle; otherwise it is the whole width.
 */
function fakeDocument({ viewport = 844, left = 0, width }: { viewport?: number; left?: number; width?: number } = {}) {
  width ??= viewport;
  const el = (tag: string): FakeEl & { append(c: FakeEl): void; remove(): void; setAttribute(k: string, v: string): void; ownerDocument?: unknown } => {
    const node = {
      tag,
      style: {} as Record<string, string>,
      attrs: {} as Record<string, string>,
      children: [] as FakeEl[],
      parent: null as FakeEl | null,
      clientWidth: 0,
      append(child: FakeEl) {
        child.parent = node;
        node.children.push(child);
      },
      remove() {
        if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
        node.parent = null;
      },
      setAttribute(k: string, v: string) {
        node.attrs[k] = v;
      },
    };
    return node;
  };
  const doc = { createElement: el, documentElement: { clientWidth: viewport } };
  const container = Object.assign(el("div"), {
    ownerDocument: doc,
    clientWidth: width,
    getBoundingClientRect: () => ({ left, right: left + width, top: 0, width }),
  });
  return { container };
}

function context(sent: unknown[] = [], extra: object = {}) {
  return {
    room: { members: [{ name: "Ann", colour: "#f00" }] },
    you: { role: "player", seat: 0 },
    upright: true,
    snapshot: { role: "player", version: 3 },
    send: (data: unknown, opts: unknown) => {
      sent.push([data, opts]);
      return Promise.resolve({ ok: true });
    },
    inputId: () => "abc.1",
    now: () => 123,
    inset: { top: 56, right: 56 },
    ...extra,
  };
}

const parts = (container: FakeEl) => {
  const box = container.children[0]!;
  return { box, frame: box.children[0]!, host: box.children[0]!.partyHost! };
};

describe("the room view's module", () => {
  it("shows the game's page in one frame inside the container, as an upright column", () => {
    const { container } = fakeDocument();
    const view = mount(container, context());
    expect(view.full).toBe(true);
    expect(container.children).toHaveLength(1);
    const { box, frame } = parts(container);
    expect(frame.tag).toBe("iframe");
    expect(frame.src).toMatch(/\/party-view\/index\.html$/);
    expect(frame.style.maxWidth).toBe("480px");
    // A wide stage: the column in the middle is clear of the door, so it starts at the top.
    expect(box.style.paddingTop).toBe("0");
    view.unmount();
  });

  it("starts the column below the door when it reaches the corner (an upright phone)", () => {
    const { container } = fakeDocument({ viewport: 390 });
    const view = mount(container, context());
    expect(parts(container).box.style.paddingTop).toBe("56px");
    view.unmount();
  });

  it("does not leave room for the door on a sideways phone, where the room letterboxes the stage in the middle", () => {
    // 844 by 390, held sideways: the stage is an upright 292 pixels in the middle, far from the door.
    const { container } = fakeDocument({ viewport: 844, left: 276, width: 292 });
    const view = mount(container, context());
    expect(parts(container).box.style.paddingTop).toBe("0");
    view.unmount();
  });

  it("draws the column at its least width, scaled down, on a stage narrower than that (a phone held sideways)", () => {
    // 640 by 360, held sideways: the room's upright box is 270 pixels wide.
    const { container } = fakeDocument({ viewport: 640, left: 185, width: 270 });
    const view = mount(container, context());
    const { box, frame } = parts(container);
    expect(frame.style.width).toBe("360px");
    expect(frame.style.transform).toBe("scale(0.75)");
    expect(frame.style.transformOrigin).toBe("0 0");
    expect(frame.style.height).toBe(`${100 / 0.75}%`);
    expect(box.style.justifyContent).toBe("flex-start");
    expect(box.style.overflow).toBe("hidden");
    view.unmount();
    // An upright phone is wide enough: the column fills the stage as it is.
    const upright = fakeDocument({ viewport: 390 });
    const v2 = mount(upright.container, context());
    expect(parts(upright.container).frame.style).toMatchObject({ width: "100%", height: "100%", transform: "" });
    expect(parts(upright.container).box.style.justifyContent).toBe("center");
    v2.unmount();
  });

  it("gives the big screen the whole width, not a phone's column, and tells the page who it is", () => {
    const { container } = fakeDocument({ viewport: 1920 });
    const view = mount(container, context([], { you: { role: "screen", seat: -1 }, upright: false }));
    const { frame, host } = parts(container);
    expect(frame.style.maxWidth).toBe("none");
    expect(host.you).toEqual({ role: "screen", seat: -1 });
    expect(host.upright).toBe(false);
    view.unmount();
  });

  it("gives a member who joined mid-match (a screen with a seat of its own) a phone's column, scaled into a narrow stage", () => {
    // A phone held sideways: the room letterboxes the upright stage, 270 pixels, in the middle.
    const { container } = fakeDocument({ viewport: 640, left: 185, width: 270 });
    const view = mount(container, context([], { you: { role: "screen", seat: 3 }, upright: true }));
    const { frame } = parts(container);
    expect(frame.style.maxWidth).toBe("480px");
    expect(frame.style).toMatchObject({ width: "360px", transform: "scale(0.75)" });
    view.unmount();
  });

  it("hands the page the room's context, and holds what the room says until the page is listening", () => {
    const { container } = fakeDocument();
    const sent: unknown[] = [];
    const view = mount(container, context(sent));
    const host = parts(container).host.attach();
    expect(host.you).toEqual({ role: "player", seat: 0 });
    expect(host.upright).toBe(true);
    expect((host.now as () => number)()).toBe(123);
    expect((host.inputId as () => string)()).toBe("abc.1");
    view.snapshot({ version: 4 }, 1, false);
    view.events([{ k: "timed_out", seat: 0 }]);
    const got: unknown[] = [];
    host.on("snapshot", (s: unknown) => got.push(["snapshot", s]));
    host.on("events", (list: unknown) => got.push(["events", list]));
    expect(got).toEqual([]);
    host.ready();
    expect(got).toEqual([
      ["snapshot", { version: 4 }],
      ["events", [{ k: "timed_out", seat: 0 }]],
    ]);
    view.snapshot({ version: 5 });
    expect(got.at(-1)).toEqual(["snapshot", { version: 5 }]);
    void host.send({ type: "turn.hint" }, { id: "abc.1" });
    expect(sent).toEqual([[{ type: "turn.hint" }, { id: "abc.1" }]]);
    view.unmount();
  });

  it("holds a bounded backlog for a page that is slow to listen: the latest snapshot, and the latest events", () => {
    const { container } = fakeDocument();
    const view = mount(container, context());
    const host = parts(container).host.attach();
    for (let i = 1; i <= 500; i++) {
      view.snapshot({ role: "player", version: i });
      view.events([{ k: "timed_out", seat: 0, n: i }]);
    }
    const got: [string, unknown][] = [];
    host.on("snapshot", (s: unknown) => got.push(["snapshot", s]));
    host.on("events", (list: unknown) => got.push(["events", list]));
    host.ready();
    const snaps = got.filter(([t]) => t === "snapshot");
    const events = got.filter(([t]) => t === "events");
    expect(snaps).toEqual([["snapshot", { role: "player", version: 500 }]]);
    expect(events).toHaveLength(64);
    expect(events.at(0)).toEqual(["events", [{ k: "timed_out", seat: 0, n: 437 }]]);
    expect(events.at(-1)).toEqual(["events", [{ k: "timed_out", seat: 0, n: 500 }]]);
    expect(host.snapshot).toEqual({ role: "player", version: 500 });
    view.unmount();
  });

  it("starts a page reloaded in the frame from the latest snapshot, and drops the old page's handlers", () => {
    const { container } = fakeDocument();
    const view = mount(container, context());
    const first = parts(container).host.attach();
    expect(first.snapshot).toEqual({ role: "player", version: 3 });
    const old: unknown[] = [];
    first.on("snapshot", (s: unknown) => old.push(s));
    first.ready();
    view.snapshot({ role: "player", version: 7 });
    expect(old).toEqual([{ role: "player", version: 7 }]);

    // The frame's page reloads: the new page attaches and starts from what the room said last.
    const second = parts(container).host.attach();
    expect(second.snapshot).toEqual({ role: "player", version: 7 });
    view.snapshot({ role: "player", version: 8 });
    const got: unknown[] = [];
    second.on("snapshot", (s: unknown) => got.push(s));
    second.ready();
    expect(got).toEqual([{ role: "player", version: 8 }]);
    // The old page's handler is gone: it heard nothing after the reload.
    expect(old).toEqual([{ role: "player", version: 7 }]);
    view.unmount();
  });

  it("leaves nothing behind: the frame is gone, the page's handle is cut, and a late tap is refused", async () => {
    const { container } = fakeDocument();
    const view = mount(container, context());
    const { frame } = parts(container);
    const host = frame.partyHost!.attach();
    const got: unknown[] = [];
    host.on("snapshot", (s: unknown) => got.push(s));
    host.ready();
    view.unmount();
    expect(container.children).toEqual([]);
    expect(frame.partyHost).toBeNull();
    view.snapshot({ version: 9 });
    expect(got).toEqual([]);
    await expect(host.send({}, { id: 1 })).rejects.toMatchObject({ code: "gone" });
    view.unmount();
  });
});
