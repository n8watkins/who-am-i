import { useEffect, useState } from "react";
import type { PlayerView, RoomView } from "../../shared/protocol";

/** Re-renders every `intervalMs` and returns the current time. */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

export function mePlayer(view: RoomView): PlayerView {
  return view.players.find((p) => p.playerId === view.youId)!;
}

export function opponentPlayer(view: RoomView): PlayerView | undefined {
  return view.players.find((p) => p.playerId !== view.youId);
}
