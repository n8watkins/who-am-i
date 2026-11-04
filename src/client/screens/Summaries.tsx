import type { RoomView } from "../../shared/protocol";
import { Scoreboard } from "../components/Scoreboard";
import { Banner, Button, Card } from "../components/ui";
import { mePlayer, opponentPlayer } from "../lib/hooks";
import type { RoomHandle } from "../lib/useRoom";
import { ResultPill } from "./Game";

export function RoundSummary({ room, view }: { room: RoomHandle; view: RoomView }) {
  const summary = view.roundSummary;
  const me = mePlayer(view);
  if (!summary) return null;
  const entries = [...summary.entries].sort((a, b) => Number(b.playerId === me.playerId) - Number(a.playerId === me.playerId));
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Round {summary.roundIndex} complete</p>
        <h1 className="text-3xl font-extrabold tracking-tight">The big reveal</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => {
          const player = view.players.find((p) => p.playerId === entry.playerId);
          const isMe = entry.playerId === me.playerId;
          return (
            <Card key={entry.playerId} className={`animate-pop ${isMe ? "border-2 border-brand/40" : ""}`}>
              <p className="text-sm font-extrabold uppercase tracking-wide text-muted">{isMe ? "You were" : `${player?.nickname ?? "Opponent"} was`}</p>
              <p className="mt-1 text-3xl font-black leading-tight" data-testid={isMe ? "reveal-self" : "reveal-opponent"}>
                {entry.identity.canonicalName}
              </p>
              <div className="mt-3">
                <ResultPill result={entry.result} />
              </div>
            </Card>
          );
        })}
      </div>
      <Scoreboard view={view} />
      <Button size="lg" block disabled={room.pending} onClick={() => room.send("round.next")}>
        {summary.matchOver ? "See final results" : "Next round"}
      </Button>
      <p className="text-center text-sm text-muted">Either player can continue.</p>
    </div>
  );
}

export function MatchSummary({ room, view }: { room: RoomHandle; view: RoomView }) {
  const match = view.matchSummary;
  const me = mePlayer(view);
  const opponent = opponentPlayer(view);
  const iWant = view.rematchVotes.includes(me.playerId);
  const opponentWants = !!opponent && view.rematchVotes.includes(opponent.playerId);
  const starter = view.players.find((p) => p.playerId === view.rematchFirstPlayerId);
  const starterText = starter
    ? `${starter.playerId === me.playerId ? "You go" : `${starter.nickname} goes`} first${match?.tie ? " (went second last match)." : " (loser starts)."}`
    : "";
  if (!match) return null;
  const winner = view.players.find((p) => p.playerId === match.winnerId);
  const headline = match.tie ? "It's a tie!" : winner?.playerId === me.playerId ? "You win!" : `${winner?.nickname ?? "Your opponent"} wins!`;
  const players = [...view.players].sort((a, b) => a.seat.localeCompare(b.seat));

  return (
    <div className="space-y-4">
      <Card className="animate-pop text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-amber-soft text-5xl" aria-hidden="true">
          {match.tie ? "\u{1F91D}" : "\u{1F3C6}"}
        </div>
        <h1 className="mt-4 text-4xl font-black tracking-tight" data-testid="match-headline">
          {headline}
        </h1>
        <p className="mt-2 text-muted">
          {match.rounds} {match.rounds === 1 ? "round" : "rounds"} played in {view.pack.name}.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Match stats</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="text-sm text-muted">
              <th scope="col" className="py-2 font-bold">Player</th>
              <th scope="col" className="py-2 text-right font-bold">Points</th>
              <th scope="col" className="py-2 text-right font-bold">Correct</th>
              <th scope="col" className="py-2 text-right font-bold">Skips</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.playerId} className="border-t border-line">
                <th scope="row" className="py-3 font-extrabold">
                  {p.nickname}
                  {p.playerId === me.playerId && <span className="font-semibold text-muted"> (you)</span>}
                  {p.playerId === match.winnerId && <span className="sr-only"> (winner)</span>}
                </th>
                <td className="py-3 text-right text-xl font-black tabular-nums">{p.score}</td>
                <td className="py-3 text-right tabular-nums">{p.correct}</td>
                <td className="py-3 text-right tabular-nums">{p.skips}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="space-y-3">
        {opponentWants && !iWant && (
          <Banner tone="success" role="status">
            {opponent?.nickname} wants a rematch.
          </Banner>
        )}
        <Button size="lg" block disabled={room.pending || iWant} onClick={() => room.send("match.rematch")}>
          {iWant ? `Waiting for ${opponent?.nickname ?? "your opponent"}...` : opponentWants ? "Accept rematch" : "Rematch"}
        </Button>
        <Button size="lg" variant="secondary" block disabled={room.pending} onClick={() => room.send("match.change_settings")}>
          Change settings
        </Button>
        <p className="text-center text-sm text-muted" data-testid="rematch-starter">
          Same room and settings, fresh shuffle. {starterText}
        </p>
      </div>
    </div>
  );
}
