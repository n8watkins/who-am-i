// Who Am I? as a view a party room mounts over itself and takes away again (the party kit's
// GAME-CONTRACT.md, "In the browser"). The manifest names this module (`lobby.view`).
//
//   const view = mount(container, { room, you, upright, snapshot, send, inputId, now, inset });
//   view.snapshot(s, now, full);  // this device's own view of the match: after every change
//   view.events(list);            // what an input, a deadline or an ending said
//   view.unmount();               // the match is over: everything is freed
//
// The match is drawn by the game's own React screens on a page beside this module (index.html,
// built from src/party-view by `npm run build:party`) in a frame of the same origin. That
// keeps the game's styles, fonts and listeners in the frame's document, out of the room's page,
// and makes unmount() complete: removing the frame frees them all. The frame finds what the room
// gave on its own element (`frame.partyHost`): plain data and functions, no messages. A page in
// the frame calls `attach()` on it first; a page that reloads attaches again, starts from the
// latest snapshot, and the handlers of the page before it are dropped.
//
// The game is laid out for a phone held upright (the manifest's `devices.upright`), and the room
// stops asking its players and its audience for sideways while it is on (`upright`). On a phone
// held upright the stage is the whole width; on one held sideways the room letterboxes it to an
// upright shape in the middle. On a phone or a laptop the page is a column at most 480 CSS pixels
// wide, centred, starting below the room's door button only where it reaches that corner. The big
// screen (`you.role === "screen"`) gets the whole width.
//
// Plain JavaScript with no build: it is served as it is.

/** The frame's page, beside this module wherever a host serves it. */
const PAGE = new URL("./index.html", import.meta.url);
/** The widest a phone's column gets. */
const COLUMN_MAX = 480;

/**
 * @param {HTMLElement} container  an empty box laid over the room's page
 * @param {object} ctx  what the room gives a game's view: room, you, upright, snapshot, send, inputId, now, inset
 */
export function mount(container, { room, you, upright = false, snapshot, send, inputId, now, inset = {} }) {
  const doc = container.ownerDocument;
  const handlers = { events: new Set(), snapshot: new Set() };
  const screen = you?.role === "screen";
  const column = screen ? Infinity : COLUMN_MAX;
  const door = { top: inset.top ?? 0, right: inset.right ?? 0 };
  /** The latest snapshot the room gave, for a page that starts (or starts again) in the frame. */
  let latest = snapshot;
  let backlog = [];
  let ready = false;
  let gone = false;

  const emit = (type, ...args) => {
    if (gone) return;
    if (type === "snapshot") latest = args[0];
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
  Object.assign(frame.style, { border: "0", display: "block", width: "100%", maxWidth: screen ? "none" : `${COLUMN_MAX}px`, height: "100%", background: "#fff8ef" });

  /**
   * The room's door button sits in the top right corner of the room's page. Where the column
   * reaches under it, the column starts below it; where it does not (a wide stage, or the
   * upright stage the room letterboxes in the middle of a sideways phone), it starts at the top.
   */
  const fit = () => {
    if (gone) return;
    const width = container.clientWidth;
    const rect = typeof container.getBoundingClientRect === "function" ? container.getBoundingClientRect() : { left: 0, top: 0 };
    const page = doc.documentElement?.clientWidth || rect.left + width;
    const columnRight = rect.left + (width + Math.min(width, column)) / 2;
    const underDoor = rect.top < door.top && columnRight > page - door.right;
    box.style.paddingTop = underDoor ? `${door.top}px` : "0";
  };
  // The stage's own size, and the page's (the letterbox moves with it).
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  resize?.observe(container);
  if (doc.documentElement && resize) resize.observe(doc.documentElement);
  fit();

  const host = {
    room,
    you,
    upright,
    /** The latest snapshot: the start, or what the room said since. */
    get snapshot() {
      return latest;
    },
    inset: { ...door },
    now,
    /** One input with an id: a promise for the room's answer (ack, or the game's error). */
    send: (data, opts) => (gone ? Promise.reject(Object.assign(new Error("The match is over."), { code: "gone" })) : send(data, opts)),
    inputId,
    /**
     * A page in the frame calls this first, once: the handlers of a page before it (a reload) are
     * dropped, and the room's words are held until this page is ready. Returns the host.
     */
    attach() {
      handlers.events.clear();
      handlers.snapshot.clear();
      backlog = [];
      ready = false;
      return host;
    },
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
  frame.partyHost = host;
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
