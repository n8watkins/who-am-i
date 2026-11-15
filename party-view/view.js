// Who Am I? as a view a party room mounts over itself and takes away again (the party kit's
// GAME-CONTRACT.md, "In the browser"). The manifest names this module (`lobby.view`).
//
//   const view = mount(container, { room, you, snapshot, send, inputId, now, inset });
//   view.snapshot(s, now, full);  // this device's own view of the match: after every change
//   view.events(list);            // what an input, a deadline or an ending said
//   view.unmount();               // the match is over: everything is freed
//
// The match is drawn by the game's own React screens on a page beside this module (index.html,
// built from src/party-view by `npm run build:party`) in a frame of the same origin. That
// keeps the game's styles, fonts and listeners in the frame's document, out of the room's page,
// and makes unmount() complete: removing the frame frees them all. The frame finds what the room
// gave on its own element (`frame.partyHost`): plain data and functions, no messages.
//
// The game is designed for a phone held upright and the room is held sideways, so the frame is
// an upright column, centred, at most 480 CSS pixels wide: letterboxed on a sideways phone, the
// whole width on an upright one, clear of the room's door button either way.
//
// Plain JavaScript with no build: it is served as it is.

/** The frame's page, beside this module wherever a host serves it. */
const PAGE = new URL("./index.html", import.meta.url);
/** The widest the upright column gets. */
const COLUMN_MAX = 480;

/**
 * @param {HTMLElement} container  an empty box laid over the room's page
 * @param {object} ctx  what the room gives a game's view: room, you, snapshot, send, inputId, now, inset
 */
export function mount(container, { room, you, snapshot, send, inputId, now, inset = {} }) {
  const doc = container.ownerDocument;
  const handlers = { events: new Set(), snapshot: new Set() };
  let backlog = [];
  let ready = false;
  let gone = false;

  const emit = (type, ...args) => {
    if (gone) return;
    if (!ready) return void backlog.push([type, args]);
    for (const handler of handlers[type]) handler(...args);
  };

  // Every style is set through the style object, never a style attribute: the host's
  // Content-Security-Policy forbids those.
  const box = doc.createElement("div");
  Object.assign(box.style, { position: "absolute", inset: "0", display: "flex", justifyContent: "center", alignItems: "stretch", background: "#16141f", boxSizing: "border-box" });
  const frame = doc.createElement("iframe");
  frame.title = "Who Am I?";
  frame.setAttribute("allow", "screen-wake-lock");
  Object.assign(frame.style, { border: "0", display: "block", width: "100%", maxWidth: `${COLUMN_MAX}px`, height: "100%", background: "#fff8ef" });

  /** The room's door button sits in the top right corner: when the column reaches it, the column starts below it. */
  const fit = () => {
    if (gone) return;
    const side = (container.clientWidth - Math.min(container.clientWidth, COLUMN_MAX)) / 2;
    box.style.paddingTop = side >= (inset.right ?? 0) ? "0" : `${inset.top ?? 0}px`;
  };
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  resize?.observe(container);
  fit();

  frame.partyHost = {
    room,
    you,
    snapshot,
    inset: { top: inset.top ?? 0, right: inset.right ?? 0 },
    now,
    /** One input with an id: a promise for the room's answer (ack, or the game's error). */
    send: (data, opts) => (gone ? Promise.reject(Object.assign(new Error("The match is over."), { code: "gone" })) : send(data, opts)),
    inputId,
    on(type, handler) {
      handlers[type]?.add(handler);
      return () => handlers[type]?.delete(handler);
    },
    /** The page calls this once it is listening: everything the room said meanwhile follows, in order. */
    ready() {
      ready = true;
      for (const [type, args] of backlog.splice(0)) for (const handler of handlers[type]) handler(...args);
    },
  };
  frame.src = PAGE.href;
  box.append(frame);
  container.append(box);

  return {
    /** The view covers the whole container: the room puts its own bars away while it is up. */
    full: true,
    frame,
    events: (list) => emit("events", list),
    snapshot: (s, at, full = false) => emit("snapshot", s, at, full),
    unmount() {
      if (gone) return;
      gone = true;
      backlog = [];
      resize?.disconnect();
      handlers.events.clear();
      handlers.snapshot.clear();
      frame.partyHost = null;
      box.remove();
    },
  };
}
