// The party room as the game's own screens expect a room to be (src/client/lib/useRoom.ts's
// RoomHandle): the latest view, `send` for a command, `pending` while one is out, and the
// server's clock. Commands go to the room as answered inputs with ids, so the room never applies
// one twice (a double tap, or a resend after a reconnect); the engine's own `commandId` is the
// same id, and its `expectedVersion` turns a tap made against an old view into a refusal.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandType, RoomView } from "../shared/protocol";
import type { RoomHandle } from "../client/lib/useRoom";
import type { PartyAnswerError, PartyHost, Snapshot } from "./host";
import { confirmedWithoutYouNotice, timedOutNotice, type Notice } from "./notices";

/** How many times a command is sent again after a version conflict that did not change the game's position. */
const MAX_CONFLICT_RETRIES = 3;

/** The parts of the state a turn command depends on (as on the game's own site). Presence or a counter do not change it. */
function gamePosition(view: RoomView): string {
  return JSON.stringify([view.status, view.roundIndex, view.turn?.playerId, view.turn?.phase, view.turnResults]);
}

/** The engine's command id for an input id: 8 to 64 characters, and one input id gives one command id. */
export function commandIdOf(id: string | number): string {
  const text = String(id);
  return text.length + 12 <= 64 ? `party-input-${text}` : text.slice(0, 64);
}

const MESSAGES: Record<string, string> = {
  timeout: "The room did not answer. Check your connection and try again.",
  disconnected: "The connection dropped. Try again once it is back.",
  not_connected: "Not connected to the room yet.",
  gone: "The match is over.",
  game_error: "The game could not take that. Try again.",
};

export function useParty(host: PartyHost) {
  const [snap, setSnap] = useState<Snapshot>(host.snapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Snapshot>(host.snapshot);
  /** Milliseconds to add to Date.now() for the room's clock, taken again with every snapshot. */
  const [serverOffset, setServerOffset] = useState(() => host.now() - Date.now());

  /** A line above the game for what its own screens do not say (notices.ts). */
  const [notice, setNotice] = useState<Notice | null>(null);
  /** This page sent the confirmation of the guess now waiting, so its being right is no news. */
  const confirmedHere = useRef(false);

  useEffect(() => {
    // Both listen before ready(), so what the room said meanwhile reaches them too.
    const offSnap = host.on("snapshot", (s) => {
      setServerOffset(host.now() - Date.now());
      // Never step back to an older view (two snapshots can cross on a reconnect).
      const prev = latest.current;
      if (s.version < prev.version) return;
      latest.current = s;
      setSnap(s);
      if (prev.role === "player" && s.role === "player") {
        const away = confirmedWithoutYouNotice(prev, s, confirmedHere.current);
        if (away) setNotice(away);
        if (s.turn?.phase !== "pending_confirm" || s.turn.playerId !== prev.turn?.playerId) confirmedHere.current = false;
      }
    });
    const offEvents = host.on("events", (list) => {
      const timedOut = Array.isArray(list) ? timedOutNotice(list, host.you, latest.current) : null;
      if (timedOut) setNotice(timedOut);
    });
    host.ready();
    return () => {
      offSnap();
      offEvents();
    };
  }, [host]);

  const send = useCallback(
    async (type: CommandType, extra: object = {}): Promise<boolean> => {
      if (type === "turn.correct.confirm") confirmedHere.current = true;
      setPending(true);
      setError(null);
      try {
        for (let attempt = 0; ; attempt++) {
          const seen = latest.current;
          const id = host.inputId();
          const data = { type, commandId: commandIdOf(id), expectedVersion: seen.version, ...extra };
          try {
            await host.send(data, { id });
            return true;
          } catch (err) {
            const e = err as PartyAnswerError;
            // The room sends the fresh view before its answer: retry only when the game is where it was.
            const now = latest.current;
            if (
              e.code === "version_conflict" &&
              attempt < MAX_CONFLICT_RETRIES &&
              seen.role === "player" &&
              now.role === "player" &&
              now.version > seen.version &&
              gamePosition(seen) === gamePosition(now)
            ) {
              continue;
            }
            if (e.code !== "version_conflict") setError(MESSAGES[e.code ?? ""] ?? e.message ?? "Something went wrong. Please try again.");
            return false;
          }
        }
      } finally {
        setPending(false);
      }
    },
    [host],
  );

  const handle: RoomHandle = {
    view: snap.role === "player" ? snap : null,
    connection: "open",
    fatal: null,
    error,
    clearError: () => setError(null),
    pending,
    serverOffset,
    send: send as RoomHandle["send"],
    renewPin: async () => {},
    shareResult: () => Promise.reject(new Error("Result cards are shared from the game's own site.")),
  };
  const clearNotice = useCallback(() => setNotice(null), []);
  return { snap, handle, notice, clearNotice };
}
