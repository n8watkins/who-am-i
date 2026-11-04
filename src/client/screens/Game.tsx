import { HOST_OVERRIDE_AFTER_MS, QUESTION_LIMIT, type RoomView, type TurnResult } from "../../shared/protocol";
import { Scoreboard } from "../components/Scoreboard";
import { MODE_LABELS } from "../components/SettingsForm";
import { Banner, Button, Card, Pill } from "../components/ui";
import { mePlayer, opponentPlayer, useNow } from "../lib/hooks";
import type { RoomHandle } from "../lib/useRoom";

export const RESULT_LABELS: Record<TurnResult, { text: string; tone: "mint" | "neutral" | "amber" }> = {
  correct: { text: "Guessed it", tone: "mint" },
  skipped: { text: "Skipped", tone: "neutral" },
  timed_out: { text: "Time ran out", tone: "amber" },
};

export function Game({ room, view }: { room: RoomHandle; view: RoomView }) {
  const me = mePlayer(view);
  const opponent = opponentPlayer(view)!;
  const turn = view.turn;
  const myTurn = turn?.playerId === me.playerId;
  const pendingConfirm = turn?.phase === "pending_confirm";
  const twentyQ = view.settings.mode === "twenty_questions";
  const isHost = view.hostPlayerId === me.playerId;
  const now = useNow(500, !opponent.connected || view.settings.timerSeconds > 0);
  const opponentGoneFor = !opponent.connected && opponent.disconnectedAt ? now + room.serverOffset - opponent.disconnectedAt : 0;
  const canOverride = myTurn && pendingConfirm && isHost && !opponent.connected && opponentGoneFor >= HOST_OVERRIDE_AFTER_MS;
  const identityName = view.opponentIdentity?.canonicalName ?? "";

  const turnHeadline = myTurn ? "Your turn to guess" : `${opponent.nickname} is guessing`;
  const myResult = view.turnResults[me.playerId];
  const opponentResult = view.turnResults[opponent.playerId];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Round {view.roundIndex}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="brand">{view.pack.name}</Pill>
          <Pill>{MODE_LABELS[view.settings.mode].name}</Pill>
          {turn && view.settings.timerSeconds > 0 && <TurnTimer view={view} now={now} offset={room.serverOffset} />}
        </div>
      </div>

      <p className="sr-only" aria-live="polite" role="status">
        Round {view.roundIndex}. {turnHeadline}.{pendingConfirm ? (myTurn ? " Waiting for confirmation." : ` ${opponent.nickname} thinks they got it.`) : ""}
      </p>

      {view.firstPlayerId && (
        <p className="text-sm font-bold text-muted" data-testid="round-starter">
          {view.firstPlayerId === me.playerId ? "You go first this round." : `${opponent.nickname} goes first this round.`}
        </p>
      )}

      {view.notices.includes("pack_reshuffled") && (
        <Banner tone="info" role="status">
          Pack exhausted, reshuffling. Earlier identities can come up again.
        </Banner>
      )}
      {!opponent.connected && (
        <Banner tone="warn" role="status">
          {opponent.nickname} lost connection. {view.settings.timerSeconds > 0 ? "The timer is paused " : "Hang tight "}
          while they reconnect.
        </Banner>
      )}

      <Scoreboard view={view} compact />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="relative overflow-hidden border-2 border-brand/30">
          <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Opponent's character</p>
          <p className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl" data-testid="opponent-identity">
            {identityName}
          </p>
          <p className="mt-3 text-sm text-muted">
            {opponent.nickname} is trying to guess this.{" "}
            {opponentResult ? <ResultPill result={opponentResult} /> : !myTurn ? "It's their turn now." : "Their turn is next."}
          </p>
        </Card>
        <Card className="flex items-center gap-4 border-2 border-dashed border-line bg-paper">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand text-4xl font-black text-white" aria-hidden="true">
            ?
          </span>
          <div>
            <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Your identity</p>
            <p className="text-2xl font-black" data-testid="own-identity">
              Hidden
            </p>
            <p className="text-sm text-muted">{myResult ? <ResultPill result={myResult} /> : "Revealed at the end of the round."}</p>
          </div>
        </Card>
      </div>

      <Card className={myTurn ? "border-2 border-brand" : ""}>
        <div className="flex items-center gap-2.5">
          <span className={`size-3 rounded-full ${myTurn ? "bg-brand" : "bg-coral"}`} aria-hidden="true" />
          <h2 className="text-xl font-extrabold" data-testid="turn-headline">
            {turnHeadline}
          </h2>
        </div>

        {turn && !pendingConfirm && (
          <p className="mt-2 text-muted">
            {myTurn
              ? twentyQ
                ? `Ask ${opponent.nickname} yes/no questions about who you are. Say your guess out loud, then tap I Guessed It.`
                : `${opponent.nickname} is describing you. Say your guess out loud, then tap I Guessed It.`
              : twentyQ
                ? `Answer ${opponent.nickname}'s yes/no questions about ${identityName}.`
                : `Give ${opponent.nickname} clues about ${identityName} without saying the name.`}
          </p>
        )}

        {turn && twentyQ && !pendingConfirm && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-2.5">
            <span className="font-bold">
              Questions:{" "}
              <span className="tabular-nums" data-testid="question-count">
                {turn.questionCount}
              </span>
              <span className="whitespace-nowrap text-muted"> / {QUESTION_LIMIT}</span>
              {turn.questionCount >= QUESTION_LIMIT && <span className="ml-2 text-coral">Limit reached</span>}
            </span>
            <Button variant="secondary" disabled={room.pending} onClick={() => room.send("turn.question")} aria-label="Count one more question">
              +1
            </Button>
          </div>
        )}

        <div className="mt-5">
          {myTurn && !pendingConfirm && (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" size="lg" disabled={room.pending} onClick={() => room.send("turn.skip")}>
                Skip
              </Button>
              <Button size="lg" disabled={room.pending} onClick={() => room.send("turn.correct.request")}>
                I Guessed It
              </Button>
            </div>
          )}

          {myTurn && pendingConfirm && (
            <div className="space-y-3">
              <Banner tone="info" role="status">
                Waiting for {opponent.nickname} to confirm your guess...
              </Banner>
              {canOverride && (
                <Button block disabled={room.pending} onClick={() => room.send("turn.correct.override")}>
                  Confirm without {opponent.nickname} (host)
                </Button>
              )}
              <Button variant="secondary" block disabled={room.pending} onClick={() => room.send("turn.skip")}>
                Skip instead
              </Button>
            </div>
          )}

          {!myTurn && pendingConfirm && (
            <div className="space-y-3">
              <p className="text-lg font-bold">
                {opponent.nickname} thinks they got it. Did they say <span className="text-brand">{identityName}</span>?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" size="lg" disabled={room.pending} onClick={() => room.send("turn.correct.reject")}>
                  Not quite
                </Button>
                <Button variant="success" size="lg" disabled={room.pending} onClick={() => room.send("turn.correct.confirm")}>
                  Yes, correct
                </Button>
              </div>
            </div>
          )}

          {!myTurn && !pendingConfirm && (
            <p className="rounded-2xl bg-paper px-4 py-3 text-sm font-semibold text-muted">
              When {opponent.nickname} guesses, you will be asked to confirm it here.
            </p>
          )}
        </div>
      </Card>

      <details className="group rounded-3xl border border-line bg-card px-5 py-1 shadow-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-bold">
          Rules reminder
          <span aria-hidden="true" className="transition group-open:rotate-180">
            {"▾"}
          </span>
        </summary>
        <ul className="list-disc space-y-1.5 pb-4 pl-5 text-sm text-muted">
          <li>{MODE_LABELS[view.settings.mode].blurb}</li>
          <li>A correct guess, confirmed by your opponent, scores 1 point. A skip scores 0.</li>
          <li>The round ends when both players have guessed or skipped. Then both identities are revealed.</li>
          {view.settings.timerSeconds > 0 && <li>Each turn lasts {view.settings.timerSeconds} seconds. When time runs out, the turn ends.</li>}
        </ul>
      </details>
    </div>
  );
}

export function ResultPill({ result }: { result: TurnResult }) {
  const r = RESULT_LABELS[result];
  return (
    <Pill tone={r.tone}>
      <span aria-hidden="true">{result === "correct" ? "✓" : result === "skipped" ? "↷" : "⏱"}</span>
      {r.text}
    </Pill>
  );
}

function TurnTimer({ view, now, offset }: { view: RoomView; now: number; offset: number }) {
  const turn = view.turn!;
  const paused = turn.deadline === null;
  const remainingMs = paused ? (turn.pausedRemainingMs ?? 0) : Math.max(0, turn.deadline! - (now + offset));
  const seconds = Math.ceil(remainingMs / 1000);
  const low = !paused && seconds <= 10;
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span
      role="timer"
      aria-label={paused ? `Timer paused at ${seconds} seconds` : `${seconds} seconds left`}
      data-testid="turn-timer"
      className={`inline-flex min-w-20 items-center justify-center gap-1.5 rounded-full border-2 px-3 py-1 font-mono text-sm font-black tabular-nums ${
        low ? "border-coral bg-coral-soft text-[#9b2c12]" : "border-line bg-white text-ink"
      }`}
    >
      <span aria-hidden="true">{paused ? "⏸" : "⏱"}</span>
      {paused ? `${label} paused` : label}
    </span>
  );
}
