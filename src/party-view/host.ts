// What the room view's frame is given by the module the party room mounts (public/view.js), on
// its own <iframe> element: the room's context, in plain data and functions.
import type { AudienceView, PlayerSnapshot, RoomScreenView } from "../party/snapshots";

export type Snapshot = PlayerSnapshot | RoomScreenView | AudienceView;

/** The room's view of the party: each seat's name and colour. */
export interface PartyRoomView {
  members?: ({ name: string; colour: string } | null)[];
}

/** What the room's answer to an input with an id is when it is not ok (the kit's PartyError). */
export interface PartyAnswerError extends Error {
  code?: string;
}

export interface PartyHost {
  room: PartyRoomView;
  /** `{role: "player", seat}`, `{role: "audience", seat}` for a member watching, or `{role: "screen", seat: -1}` for the big screen. */
  you: { role: string; seat: number };
  /** The room has stopped asking this phone for sideways: the page may lay itself out upright. False on the big screen. */
  upright?: boolean;
  /** The latest snapshot the room gave: the start, or a later one for a page that started again. */
  snapshot: Snapshot;
  inset: { top: number; right: number };
  /** The room's clock, in ms. */
  now(): number;
  /** One input for the game, as this phone's seat. With an id, a promise for the room's answer. */
  send(data: unknown, opts: { id: string | number }): Promise<unknown>;
  /** A new input id, unique for this seat for the whole game, also across reloads. */
  inputId(): string | number;
  on(type: "snapshot", handler: (s: Snapshot, now?: number, full?: boolean) => void): () => void;
  on(type: "events", handler: (list: unknown[]) => void): () => void;
  ready(): void;
}

/** What the frame's element carries: the host, once a page attaches to it. */
interface FrameHost extends PartyHost {
  /** Drops what an earlier page in this frame registered (a reload) and returns the host. */
  attach?(): PartyHost;
}

/**
 * The host, when this page is shown by a party room; null when it was opened on its own. Call it
 * once per page: it attaches this page, so a page that reloads in the frame starts from the
 * latest snapshot and the page before it hears nothing more.
 */
export function partyHost(): PartyHost | null {
  try {
    const frame = window.frameElement as (Element & { partyHost?: FrameHost | null }) | null;
    const host = frame?.partyHost ?? null;
    return host?.attach ? host.attach() : host;
  } catch {
    return null;
  }
}
