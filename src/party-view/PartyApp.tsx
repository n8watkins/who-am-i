// The room view's page: a match of Who Am I? inside a party room, drawn with the game's own
// screens. A player's phone gets the match as on the game's own site (the other player's
// identity, the questions and answers, the guesser's controls, the log and the timer); the big
// screen and a watching phone get whose turn it is, the timer and the question count, and nothing
// else, because that is all their snapshot holds.
import { Banner, Card, Pill } from "../client/components/ui";
import { mePlayer, opponentPlayer, useNow } from "../client/lib/hooks";
import { Game } from "../client/screens/Game";
import { RoundSummary } from "../client/screens/Summaries";
import { useWakeLock } from "../kit/client/wake-lock";
import type { MatchLength } from "../party/manifest";
import type { AudienceView, PlayerSnapshot, RoomScreenView } from "../party/snapshots";
import type { PartyHost } from "./host";
import { useParty } from "./useParty";

const MATCH_LABELS: Record<MatchLength, string> = { first_to_3: "First to 3", first_to_5: "First to 5", rounds_10: "Best of 10 rounds" };

export function PartyApp({ host }: { host: PartyHost }) {
  const { snap, handle } = useParty(host);
  // The room shows this page only while a match is on: a phone set down mid-round, and the big
  // screen, must not dim and lock (the frame is allowed the wake lock: view.js).
  useWakeLock(true);
  return (
    <main className="mx-auto w-full max-w-lg px-4 pt-3 pb-[calc(1.5rem+var(--action-bar-h,0px))]">
      <header className="mb-3 flex min-h-9 items-center justify-between gap-3 text-sm font-extrabold">
        <span className="tracking-tight">Who Am I?</span>
        <span className="text-muted">{MATCH_LABELS[snap.match] ?? ""}</span>
      </header>
      {handle.error && (
        <div className="mb-3">
          <Banner tone="error" role="alert" onDismiss={handle.clearError}>
            {handle.error}
          </Banner>
        </div>
      )}
      {snap.role === "player" ? <PlayerView view={snap} handle={handle} /> : <WatchView view={snap} offset={handle.serverOffset} />}
    </main>
  );
}

function PlayerView({ view, handle }: { view: PlayerSnapshot; handle: ReturnType<typeof useParty>["handle"] }) {
  if (view.status === "guessing_first" || view.status === "guessing_second") return <Game room={handle} view={view} eitherMayOverride />;
  if (view.status === "round_summary") return <RoundSummary room={handle} view={view} />;
  if (view.status === "match_summary") {
    const me = mePlayer(view);
    const opponent = opponentPlayer(view);
    const won = view.matchSummary?.winnerId === me.playerId;
    return (
      <Card>
        <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Match over</p>
        <p className="mt-1 text-3xl font-black">{view.matchSummary?.tie ? "A tie" : won ? "You won" : `${opponent?.nickname ?? "Your opponent"} won`}</p>
      </Card>
    );
  }
  return <p className="py-12 text-center font-semibold text-muted">Drawing identities...</p>;
}

/** The big screen, and a phone whose seat is not in the match: no identity, no hint, no question. */
function WatchView({ view, offset }: { view: RoomScreenView | AudienceView; offset: number }) {
  const turn = view.turn;
  const timed = turn !== null && (turn.deadline !== null || turn.pausedRemainingMs !== null);
  const now = useNow(500, timed);
  const name = (seat: number) => view.players.find((p) => p.seat === seat)?.name ?? "A player";
  const remaining = turn ? (turn.deadline !== null ? Math.max(0, turn.deadline - (now + offset)) : turn.pausedRemainingMs) : null;
  const seconds = remaining === null ? null : Math.ceil(remaining / 1000);
  return (
    <Card className="space-y-4 text-center">
      <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Round {view.roundIndex}</p>
      {turn ? (
        <>
          <p className="text-3xl font-black leading-tight" data-testid="watch-turn">
            {name(turn.seat)} is guessing
          </p>
          {turn.phase === "pending_confirm" && <Pill tone="brand">Checking a guess</Pill>}
          <div className="flex items-center justify-center gap-3 text-lg font-bold">
            <span data-testid="watch-questions">
              <span className="font-black tabular-nums">{turn.questionCount}</span> {turn.questionCount === 1 ? "question" : "questions"}
            </span>
            {seconds !== null && (
              <span role="timer" className="rounded-full border-2 border-line bg-field px-3 py-1 font-mono text-base font-black tabular-nums" data-testid="watch-timer">
                {turn.deadline === null ? "paused " : ""}
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-2xl font-black">Between rounds</p>
      )}
      {view.role === "audience" && view.identities.length > 0 && (
        <ul className="space-y-1 text-sm font-bold text-muted">
          {view.identities.map((i) => (
            <li key={i.seat}>
              {name(i.seat)} is {i.identity.canonicalName}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
