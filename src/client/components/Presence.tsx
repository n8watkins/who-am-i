import { presenceOf } from "../../kit/shared/presence";
import type { PlayerView } from "../../shared/protocol";
import { Banner, Pill } from "./ui";

/** "Offline" or "Away" next to a player's name; nothing while they are here. */
export function PresencePill({ player }: { player: PlayerView }) {
  const presence = presenceOf(player);
  if (presence === "here") return null;
  return (
    <span data-testid={`presence-${player.seat}`}>
      <Pill tone="amber">{presence === "away" ? "Away" : "Offline"}</Pill>
    </span>
  );
}

/** Explains why the game is waiting on the other player. Clears itself when they are back. */
export function OpponentPresenceBanner({ opponent, timerPaused }: { opponent: PlayerView; timerPaused: boolean }) {
  const presence = presenceOf(opponent);
  if (presence === "here") return null;
  const wait = timerPaused ? "The timer is paused until they are back." : "Hang tight until they are back.";
  return (
    <Banner tone="warn" role="status">
      <span data-testid="opponent-presence">
        {presence === "away"
          ? `${opponent.nickname} stepped away: their phone is locked or in another app. ${wait}`
          : `${opponent.nickname} lost connection. ${timerPaused ? "The timer is paused " : "Hang tight "}while they reconnect.`}
      </span>
    </Banner>
  );
}
