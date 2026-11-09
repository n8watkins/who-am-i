// The words on a shared Who Am I? result: the link preview's title and description. Built on the
// server from the finished match, so a shared card can never say anything the match did not.
// It names no identity: those stay between the two players.
import { packInfo } from "./content";
import type { RoomState } from "./engine";

export function resultCardText(room: RoomState): { title: string; description: string } | null {
  if (room.status !== "match_summary" || !room.match) return null;
  const players = [...room.players].sort((a, b) => a.seat.localeCompare(b.seat));
  if (players.length !== 2) return null;
  const { winnerId, tie, rounds } = room.match;
  const winner = players.find((p) => p.id === winnerId);
  const loser = players.find((p) => p.id !== winnerId);
  const title =
    tie || !winner || !loser
      ? `${players[0]!.nickname} and ${players[1]!.nickname} tied ${players[0]!.score}-${players[1]!.score} at Who Am I?`
      : `${winner.nickname} beat ${loser.nickname} ${winner.score}-${loser.score} at Who Am I?`;
  const description = `${packInfo(room.settings.packId).name}, ${rounds} ${rounds === 1 ? "round" : "rounds"}. A two-player guessing game: you each get a secret identity, and only your friend can see yours.`;
  return { title, description };
}
