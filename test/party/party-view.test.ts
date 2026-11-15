// The module a party room mounts (party-view/view.js, from src/party-view/public/view.js), with
// a stand-in for the few DOM calls it makes: it puts one frame inside the container and nothing
// anywhere else, hands the frame the room's context, holds what the room says until the page is
// listening, and leaves nothing behind when it is unmounted. The page in the frame (React) is not
// run here; nothing of it was checked in a browser.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain JavaScript with no types: it is served as it is.
import { mount } from "../../party-view/view.js";

interface FakeEl {
  tag: string;
  style: Record<string, string>;
  attrs: Record<string, string>;
  children: FakeEl[];
  parent: FakeEl | null;
  src?: string;
  title?: string;
  partyHost?: Record<string, (...args: unknown[]) => unknown> | null;
  clientWidth: number;
}

function fakeDocument() {
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
  const doc = { createElement: el };
  const container = Object.assign(el("div"), { ownerDocument: doc, clientWidth: 844 });
  return { container };
}

function context(sent: unknown[] = []) {
  return {
    room: { members: [{ name: "Ann", colour: "#f00" }] },
    you: { role: "player", seat: 0 },
    snapshot: { role: "player", version: 3 },
    send: (data: unknown, opts: unknown) => {
      sent.push([data, opts]);
      return Promise.resolve({ ok: true });
    },
    inputId: () => "abc.1",
    now: () => 123,
    inset: { top: 56, right: 56 },
  };
}

describe("the room view's module", () => {
  it("shows the game's page in one frame inside the container, as an upright column", () => {
    const { container } = fakeDocument();
    const view = mount(container, context());
    expect(view.full).toBe(true);
    expect(container.children).toHaveLength(1);
    const box = container.children[0]!;
    const frame = box.children[0]!;
    expect(frame.tag).toBe("iframe");
    expect(frame.src).toMatch(/\/party-view\/index\.html$/);
    expect(frame.style.maxWidth).toBe("480px");
    // A sideways phone: the column is clear of the door, so it starts at the top.
    expect(box.style.paddingTop).toBe("0");
    view.unmount();
  });

  it("starts the column below the door when it reaches the corner (an upright phone)", () => {
    const { container } = fakeDocument();
    container.clientWidth = 390;
    const view = mount(container, context());
    expect(container.children[0]!.style.paddingTop).toBe("56px");
    view.unmount();
  });

  it("hands the page the room's context, and holds what the room says until the page is listening", () => {
    const { container } = fakeDocument();
    const sent: unknown[] = [];
    const view = mount(container, context(sent));
    const host = container.children[0]!.children[0]!.partyHost!;
    expect(host.you).toEqual({ role: "player", seat: 0 });
    expect((host.now as () => number)()).toBe(123);
    expect((host.inputId as () => string)()).toBe("abc.1");
    view.snapshot({ version: 4 }, 1, false);
    view.events([{ k: "timed_out", seat: 0 }]);
    const got: unknown[] = [];
    host.on!("snapshot", (s: unknown) => got.push(["snapshot", s]));
    host.on!("events", (list: unknown) => got.push(["events", list]));
    expect(got).toEqual([]);
    host.ready!();
    expect(got).toEqual([
      ["snapshot", { version: 4 }],
      ["events", [{ k: "timed_out", seat: 0 }]],
    ]);
    view.snapshot({ version: 5 });
    expect(got.at(-1)).toEqual(["snapshot", { version: 5 }]);
    void host.send!({ type: "turn.hint" }, { id: "abc.1" });
    expect(sent).toEqual([[{ type: "turn.hint" }, { id: "abc.1" }]]);
    view.unmount();
  });

  it("leaves nothing behind: the frame is gone, the page's handle is cut, and a late tap is refused", async () => {
    const { container } = fakeDocument();
    const view = mount(container, context());
    const frame = container.children[0]!.children[0]!;
    const host = frame.partyHost!;
    const got: unknown[] = [];
    host.on!("snapshot", (s: unknown) => got.push(s));
    host.ready!();
    view.unmount();
    expect(container.children).toEqual([]);
    expect(frame.partyHost).toBeNull();
    view.snapshot({ version: 9 });
    expect(got).toEqual([]);
    await expect(host.send!({}, { id: 1 })).rejects.toMatchObject({ code: "gone" });
    view.unmount();
  });
});
