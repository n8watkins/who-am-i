import { useState } from "react";
import { canNativeShare, useShareCard } from "../../kit/client/share";
import type { RoomView } from "../../shared/protocol";
import { Portrait } from "../components/PackArt";
import { OpponentPresenceBanner } from "../components/Presence";
import { Scoreboard } from "../components/Scoreboard";
import { Banner, Button, Card, Dialog } from "../components/ui";
import { paintResultCard, resultHeadline } from "../lib/resultCard";
import { mePlayer, opponentPlayer } from "../lib/hooks";
import type { RoomHandle } from "../lib/useRoom";
import { ResultPill } from "./Game";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function RoundSummary({ room, view }: { room: RoomHandle; view: RoomView }) {
  const summary = view.roundSummary;
  const me = mePlayer(view);
  if (!summary) return null;
  const entries = [...summary.entries].sort((a, b) => Number(b.playerId === me.playerId) - Number(a.playerId === me.playerId));
  const opponent = opponentPlayer(view);
  return (
    <div className="space-y-4">
      {opponent && <OpponentPresenceBanner opponent={opponent} timerPaused={false} />}
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
              <div className="flex items-center gap-4">
                <Portrait name={entry.identity.canonicalName} categoryId={entry.identity.categoryId} className="size-16 text-xl" />
                <div className="min-w-0">
                  <p className="text-sm font-extrabold uppercase tracking-wide text-muted">{isMe ? "You were" : `${player?.nickname ?? "Opponent"} was`}</p>
                  <p className="mt-1 text-3xl font-black leading-tight" data-testid={isMe ? "reveal-self" : "reveal-opponent"}>
                    {entry.identity.canonicalName}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ResultPill result={entry.result} />
                <span className="text-sm font-semibold text-muted" data-testid={isMe ? "hints-self" : "hints-opponent"}>
                  {entry.hintsUsed === 0 ? "No hints" : entry.hintsUsed === 1 ? "1 hint used" : `${entry.hintsUsed} hints used`}
                </span>
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
    <div className="mx-auto max-w-lg space-y-4">
      <Card className="animate-pop text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-soft text-3xl" aria-hidden="true">
          {match.tie ? "\u{1F91D}" : "\u{1F3C6}"}
        </div>
        <h1 className="mt-3 text-4xl font-black tracking-tight" data-testid="match-headline">
          {headline}
        </h1>
        <p className="mt-2 text-muted">
          {match.rounds} {match.rounds === 1 ? "round" : "rounds"} played in {view.pack.name}.
        </p>
        <ShareResult room={room} view={view} />
      </Card>

      <Card>
        <h2 className="sr-only">Match stats</h2>
        <ul className="divide-y divide-line">
          {players.map((p) => (
            <li key={p.playerId} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 truncate font-extrabold">
                {p.nickname}
                {p.playerId === me.playerId && <span className="font-semibold text-muted"> (you)</span>}
                {p.playerId === match.winnerId && <span className="sr-only"> (winner)</span>}
              </span>
              <span className="shrink-0 text-sm font-semibold text-muted">
                <span className="mr-2 text-xl font-black tabular-nums text-ink">{p.score}</span>
                gave up {p.skips}, {plural(p.hintsUsed, "hint")}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-3">
        {opponent && <OpponentPresenceBanner opponent={opponent} timerPaused={false} />}
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

/** "Share result": paints the card, keeps it private until a tap on Share or Copy link. */
function ShareResult({ room, view }: { room: RoomHandle; view: RoomView }) {
  const [open, setOpen] = useState(false);
  const handle = useShareCard({
    paint: () => paintResultCard(view),
    upload: room.shareResult,
    title: "Who Am I?",
    text: `${resultHeadline(view)} Our Who Am I? result:`,
  });
  const native = canNativeShare();
  const ready = handle.status === "ready";
  const message =
    handle.outcome === "copied"
      ? "Link copied. Anyone with the link can see this card."
      : handle.outcome === "shared"
        ? "Shared. Anyone with the link can see this card."
        : handle.outcome === "failed"
          ? "Could not share the link. Try again."
          : handle.isPublic
            ? "Anyone with the link can see this card."
            : "Only you can see this card until you share it.";

  return (
    <>
      <Button
        variant="secondary"
        className="mt-4"
        onClick={() => {
          setOpen(true);
          handle.prepare();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        Share result
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Share your result">
        <div className="space-y-4">
          <div className="grid aspect-[1200/630] w-full place-items-center overflow-hidden rounded-2xl border border-line bg-paper">
            {handle.previewUrl ? (
              <img src={handle.previewUrl} alt={`Result card: ${resultHeadline(view)}`} className="size-full object-cover" data-testid="share-preview" />
            ) : handle.status === "error" ? null : (
              <span className="text-sm font-semibold text-muted">Making your card...</span>
            )}
          </div>
          {handle.status === "error" ? (
            <Banner tone="error" role="alert">
              Could not make the card. Check your connection and try again.
            </Banner>
          ) : (
            <p className="text-sm font-semibold text-muted" role="status" data-testid="share-status">
              {ready ? message : "Getting your card ready..."}
            </p>
          )}
          {handle.status === "error" ? (
            <Button block onClick={handle.prepare}>
              Try again
            </Button>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row-reverse">
              {native && (
                <Button block disabled={!ready} onClick={() => handle.share("share")}>
                  Share
                </Button>
              )}
              <Button variant={native ? "secondary" : "primary"} block disabled={!ready} onClick={() => handle.share("copy")}>
                Copy link
              </Button>
            </div>
          )}
          {handle.isPublic && (
            <Button variant="ghost" block onClick={() => void handle.stop()}>
              Stop sharing
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
