// Per-player filtered views. This is the secrecy boundary (FR-04): everything a client
// receives about a room is built here, and a player's own identity is only included in
// the summary of a round that has already been completed.
import type { Notice, PublicIdentity, RoomPreview, RoomView } from "../shared/protocol";
import { getIdentity, packInfo } from "./content";
import { isGuessing, opponentOf, playerById, rematchFirstPlayer, type RoomState } from "./engine";

function publicIdentity(identityId: string): PublicIdentity {
  const identity = getIdentity(identityId);
  return { id: identity.id, canonicalName: identity.canonicalName, categoryId: identity.categoryId };
}

export function viewFor(room: RoomState, viewerId: string, now: number): RoomView {
  if (!playerById(room, viewerId)) throw new Error("viewFor called for a player not in the room");
  const opponent = opponentOf(room, viewerId);

  // Only the identity the opponent must guess. room.round.assignments[viewerId] is never read here.
  const opponentIdentityId =
    isGuessing(room.status) && room.round && opponent ? room.round.assignments[opponent.id] : undefined;

  const showSummary = room.status === "round_summary" || room.status === "match_summary";
  const notices: Notice[] = [];
  if (isGuessing(room.status) && room.round?.reshuffled) notices.push("pack_reshuffled");
  if (room.status === "lobby" && room.opponentLeft) notices.push("opponent_left");

  return {
    code: room.code,
    pin: room.pin?.value ?? null,
    version: room.version,
    serverNow: now,
    status: room.status,
    settings: room.settings,
    pack: packInfo(room.settings.packId),
    youId: viewerId,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map((p) => ({
      playerId: p.id,
      seat: p.seat,
      nickname: p.nickname,
      ready: p.ready,
      connected: p.connected,
      disconnectedAt: p.disconnectedAt,
      away: p.connected && (p.away ?? false),
      awaySince: p.connected && p.away ? (p.awaySince ?? null) : null,
      isHost: p.id === room.hostPlayerId,
      score: p.score,
      correct: p.correct,
      skips: p.skips,
      hintsUsed: p.hintsUsed ?? 0,
      difficulty: p.difficulty ?? null,
    })),
    roundIndex: room.roundIndex,
    firstPlayerId: room.round?.order[0] ?? null,
    turn: room.turn
      ? {
          playerId: room.turn.playerId,
          phase: room.turn.phase,
          deadline: room.turn.deadline,
          pausedRemainingMs: room.turn.pausedRemainingMs,
          questionCount: room.turn.questionCount,
          hintsUsed: room.turn.hintsUsed ?? 0,
          log: (room.turn.log ?? []).map((entry) => ({ ...entry })),
          moveAsked: room.turn.moveAsked ?? false,
        }
      : null,
    turnResults: room.round ? { ...room.round.results } : {},
    opponentIdentity: opponentIdentityId ? publicIdentity(opponentIdentityId) : null,
    roundSummary:
      showSummary && room.lastRoundSummary
        ? {
            roundIndex: room.lastRoundSummary.roundIndex,
            matchOver: room.lastRoundSummary.matchOver,
            entries: room.lastRoundSummary.entries.map((e) => ({
              playerId: e.playerId,
              result: e.result,
              hintsUsed: e.hintsUsed ?? 0,
              identity: publicIdentity(e.identityId),
            })),
          }
        : null,
    matchSummary: room.status === "match_summary" && room.match ? { ...room.match } : null,
    rematchVotes: room.status === "match_summary" ? [...(room.rematchVotes ?? [])] : [],
    rematchFirstPlayerId: room.status === "match_summary" && room.players.length === 2 ? rematchFirstPlayer(room) : null,
    notices,
  };
}

/** Public room info for the join screen. Contains no identities and no player ids. */
export function previewOf(room: RoomState): RoomPreview {
  const host = playerById(room, room.hostPlayerId);
  return {
    code: room.code,
    status: room.status,
    settings: room.settings,
    pack: packInfo(room.settings.packId),
    hostNickname: host?.nickname ?? null,
    playerCount: room.players.length,
    full: room.players.length >= 2 || room.status !== "lobby",
  };
}
