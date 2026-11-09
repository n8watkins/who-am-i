// Plays the party kit's cues for Who Am I? moments (see gameCues.ts). The first view after
// loading or reconnecting never plays anything.
import { useEffect, useRef } from "react";
import { playCue } from "../../kit/client/feedback";
import type { RoomView } from "../../shared/protocol";
import { cuesFor } from "./gameCues";

export function useGameCues(view: RoomView | null): void {
  const previous = useRef<RoomView | null>(null);
  useEffect(() => {
    if (!view) return;
    const prev = previous.current;
    previous.current = view;
    if (!prev || prev.version >= view.version) return;
    for (const cue of cuesFor(prev, view)) playCue(cue);
  }, [view]);
}
