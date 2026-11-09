// Keeps the client's copy of the room in sync with the Durable Object: an initial HTTP fetch,
// then a WebSocket that pushes this player's filtered view on every change, with reconnects.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WS_PROTOCOL,
  WS_TOKEN_PREFIX,
  type Command,
  type CommandType,
  type RoomView,
  type ServerMessage,
} from "../../shared/protocol";
import { visibilitySignal, watchVisibility } from "../../kit/client/visibility";
import { PRESENCE_AWAY } from "../../kit/shared/presence";
import type { CreatedCard } from "../../kit/shared/share-cards";
import { api, ApiRequestError, newCommandId, type StoredSession } from "./api";

export type Connection = "connecting" | "open" | "reconnecting";
export type FatalReason = "expired" | "unauthorized" | "left" | "removed";

type CommandExtra<T extends CommandType> = Omit<Extract<Command, { type: T }>, "type" | "commandId" | "expectedVersion">;

const PING_INTERVAL_MS = 25_000;

/** Commands whose meaning does not depend on the exact state the player saw (the server re-validates them). */
const ABSOLUTE_COMMANDS = new Set<CommandType>(["player.ready", "settings.update", "match.start", "match.change_settings", "player.leave", "player.remove", "player.difficulty"]);
/** How many times a command is resent after unrelated version conflicts before giving up. */
const MAX_CONFLICT_RETRIES = 3;

/** The parts of the state a turn command depends on. Presence or counter changes do not alter it. */
function gamePosition(view: RoomView): string {
  return JSON.stringify([view.status, view.roundIndex, view.turn?.playerId, view.turn?.phase, view.turnResults]);
}

/**
 * After a version conflict, retry once if the conflict came from an unrelated change (for example
 * the opponent reconnecting) or the command is absolute. A guess that was already confirmed or a
 * turn that already ended changes the game position, so it is never retried.
 */
function shouldRetry(type: CommandType, seen: RoomView, latest: RoomView | undefined): boolean {
  if (!latest) return false;
  return ABSOLUTE_COMMANDS.has(type) || gamePosition(seen) === gamePosition(latest);
}

export interface RoomHandle {
  view: RoomView | null;
  connection: Connection;
  fatal: FatalReason | null;
  error: string | null;
  clearError: () => void;
  pending: boolean;
  /** Milliseconds to add to Date.now() to get the server clock. */
  serverOffset: number;
  send: <T extends CommandType>(type: T, ...extra: keyof CommandExtra<T> extends never ? [] : [CommandExtra<T>]) => Promise<boolean>;
  renewPin: () => Promise<void>;
  /** Uploads a painted result card for this match, private until shared. */
  shareResult: (png: Blob) => Promise<CreatedCard>;
}

export function useRoom(code: string, session: StoredSession): RoomHandle {
  const [view, setView] = useState<RoomView | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [fatal, setFatal] = useState<FatalReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const viewRef = useRef<RoomView | null>(null);

  const accept = useCallback((next: RoomView) => {
    const current = viewRef.current;
    if (current && next.version < current.version) return;
    viewRef.current = next;
    setServerOffset(next.serverNow - Date.now());
    setView(next);
  }, []);

  const handleFailure = useCallback(
    (err: unknown): void => {
      if (!(err instanceof ApiRequestError)) {
        setError("Something went wrong. Please try again.");
        return;
      }
      if (err.body.view) accept(err.body.view);
      if (err.body.error === "removed") setFatal("removed");
      else if (err.status === 401 || err.status === 404) setFatal(err.status === 404 ? "expired" : "unauthorized");
      else if (err.body.error === "version_conflict") setError("The game moved on. You are seeing the latest state.");
      else setError(err.body.message);
    },
    [accept],
  );

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const verifySession = async (): Promise<boolean> => {
      try {
        accept(await api.state(code, session.token));
        return true;
      } catch (err) {
        if (err instanceof ApiRequestError && err.body.error === "removed") {
          setFatal("removed");
          return false;
        }
        if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) {
          setFatal(err.status === 404 ? "expired" : "unauthorized");
          return false;
        }
        return true; // Network trouble: keep retrying.
      }
    };

    const connect = () => {
      if (stopped) return;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${encodeURIComponent(code)}/ws`, [
        WS_PROTOCOL,
        `${WS_TOKEN_PREFIX}${session.token}`,
      ]);
      socket = ws;
      ws.onopen = () => {
        retry = 0;
        setConnection("open");
        // Every new socket starts as "here"; a hidden page says so at once.
        if (visibilitySignal() === PRESENCE_AWAY) ws.send(PRESENCE_AWAY);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_INTERVAL_MS);
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === "state") accept(message.view);
        } catch {
          // Ignore malformed frames.
        }
      };
      ws.onclose = (event) => {
        clearInterval(pingTimer);
        if (stopped || socket !== ws) return;
        if (event.code === 4000) return setFatal("expired");
        if (event.code === 4001) return setFatal("left");
        if (event.code === 4002) return setFatal("removed");
        setConnection("reconnecting");
        const delay = Math.min(500 * 2 ** retry, 8_000);
        retry += 1;
        retryTimer = setTimeout(async () => {
          if (await verifySession()) connect();
        }, delay);
      };
    };

    void verifySession().then((ok) => ok && connect());

    const onVisible = () => {
      if (document.visibilityState === "visible" && socket?.readyState === WebSocket.CLOSED) {
        clearTimeout(retryTimer);
        retry = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    // Tell the room when this phone locks or switches apps, and when it comes back.
    const stopWatching = watchVisibility((signal) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(signal);
    });

    return () => {
      stopped = true;
      stopWatching();
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close(1000, "unmount");
    };
  }, [code, session.token, accept]);

  const send = useCallback(
    async (type: CommandType, extra: object = {}): Promise<boolean> => {
      const current = viewRef.current;
      if (!current) return false;
      const command = { type, commandId: newCommandId(), expectedVersion: current.version, ...extra } as Command;
      // Resend with the latest version while conflicts keep coming from unrelated changes.
      const retryAfterConflicts = async (conflict: ApiRequestError) => {
        let latest = conflict;
        for (let attempt = 1; ; attempt++) {
          try {
            return await api.command(code, session.token, { ...command, expectedVersion: latest.body.view!.version });
          } catch (err) {
            const again = err instanceof ApiRequestError && err.body.error === "version_conflict" && shouldRetry(type, current, err.body.view);
            if (!again || attempt >= MAX_CONFLICT_RETRIES) throw err;
            latest = err;
          }
        }
      };
      setPending(true);
      try {
        let response;
        try {
          response = await api.command(code, session.token, command);
        } catch (err) {
          if (!(err instanceof ApiRequestError)) throw err;
          if (err.status === 0) {
            // A dropped request is retried once with the same command id; the server never applies it twice.
            response = await api.command(code, session.token, command);
          } else if (err.body.error === "version_conflict" && shouldRetry(type, current, err.body.view)) {
            response = await retryAfterConflicts(err);
          } else {
            throw err;
          }
        }
        accept(response.view);
        return true;
      } catch (err) {
        handleFailure(err);
        return false;
      } finally {
        setPending(false);
      }
    },
    [code, session.token, accept, handleFailure],
  ) as RoomHandle["send"];

  const renewPin = useCallback(async () => {
    setPending(true);
    try {
      accept(await api.renewPin(code, session.token));
    } catch (err) {
      handleFailure(err);
    } finally {
      setPending(false);
    }
  }, [code, session.token, accept, handleFailure]);

  const clearError = useCallback(() => setError(null), []);
  const shareResult = useCallback((png: Blob) => api.shareResult(code, session.token, png), [code, session.token]);

  return { view, connection, fatal, error, clearError, pending, serverOffset, send, renewPin, shareResult };
}
