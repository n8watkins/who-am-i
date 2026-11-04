import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ANSWER_LABELS,
  ANSWERS,
  HINTS_PER_TURN,
  HOST_OVERRIDE_AFTER_MS,
  QUESTION_LIMIT,
  QUESTION_MAX_LENGTH,
  QuestionTextSchema,
  type RoomView,
  type TurnLogEntry,
  type TurnResult,
} from "../../shared/protocol";
import { pickSuggestions } from "../../shared/questions";
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
  const hintsOn = view.settings.hints !== false;
  const questionMode = view.settings.questions ?? "both";
  const appOn = questionMode !== "spoken";
  const spokenOn = questionMode !== "app";
  const pendingQuestion = turn?.log.find((e) => e.kind === "question" && e.answer === null);

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
                ? `Ask ${opponent.nickname} yes/no questions about who you are${appOn && spokenOn ? ", out loud or in the app" : appOn ? " in the app" : ""}. Say your guess out loud, then tap I Guessed It.`
                : `${opponent.nickname} is describing you. Say your guess out loud, then tap I Guessed It.`
              : twentyQ
                ? `Answer ${opponent.nickname}'s yes/no questions about ${identityName}${appOn && !spokenOn ? " when they appear here" : ""}.`
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
            {spokenOn && (
              <Button variant="secondary" disabled={room.pending} onClick={() => room.send("turn.question")} aria-label="Count one more question">
                +1
              </Button>
            )}
          </div>
        )}

        {myTurn && !pendingConfirm && appOn && turn && (
          <AskPanel key={turn.log.length} room={room} waitingFor={pendingQuestion ? opponent.nickname : null} />
        )}

        {!myTurn && !pendingConfirm && !pendingQuestion && (
          <p className="mt-4 rounded-2xl bg-paper px-4 py-3 text-sm font-semibold text-muted">
            When {opponent.nickname} guesses, you will be asked to confirm it here.
          </p>
        )}

        {/* The turn's primary actions: a sticky bottom bar on phones, inline on larger screens. */}
        {turn && (myTurn || pendingConfirm || pendingQuestion) && (
          <ActionBar>
            {!myTurn && pendingQuestion && pendingQuestion.kind === "question" && !pendingConfirm && (
              <AnswerPanel room={room} asker={opponent.nickname} questionId={pendingQuestion.id} text={pendingQuestion.text} />
            )}

            {myTurn && !pendingConfirm && (
              <div className="space-y-2.5">
                {hintsOn && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-muted">
                      {turn.hintsUsed >= HINTS_PER_TURN ? "No hints left this turn" : `${HINTS_PER_TURN - turn.hintsUsed} of ${HINTS_PER_TURN} hints left`}
                    </span>
                    <Button variant="secondary" disabled={room.pending || turn.hintsUsed >= HINTS_PER_TURN} onClick={() => room.send("turn.hint")}>
                      Get a hint
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="secondary" size="lg" disabled={room.pending} onClick={() => room.send("turn.skip")}>
                    Skip
                  </Button>
                  <Button size="lg" disabled={room.pending} onClick={() => room.send("turn.correct.request")} className="whitespace-nowrap">
                    I Guessed It
                  </Button>
                </div>
              </div>
            )}

            {myTurn && pendingConfirm && (
              <div className="space-y-2.5">
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
              <div className="space-y-2.5">
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
          </ActionBar>
        )}
      </Card>

      {turn && turn.log.length > 0 && <TurnLog entries={turn.log} guesserName={myTurn ? "You" : opponent.nickname} />}

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

/**
 * Holds the turn's primary actions. Below the `sm` breakpoint it is fixed to the bottom of the
 * screen (above the iOS home indicator), and the page reserves its height so it never covers
 * the log. On larger screens it renders inline. No animation, so reduced motion is respected.
 */
function ActionBar({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--action-bar-h", `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--action-bar-h");
    };
  }, []);
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Turn actions"
      data-testid="action-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(29,26,46,0.10)] backdrop-blur sm:static sm:z-auto sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none"
    >
      <div className="mx-auto max-w-lg sm:max-w-none">{children}</div>
    </div>
  );
}

function TurnLog({ entries, guesserName }: { entries: TurnLogEntry[]; guesserName: string }) {
  const forWhom = guesserName === "You" ? "you" : guesserName;
  return (
    <Card>
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted">This turn</h2>
      <ol className="mt-3 space-y-2" aria-live="polite" data-testid="turn-log">
        {entries.map((entry) =>
          entry.kind === "hint" ? (
            <li key={entry.id} className="animate-pop flex gap-3 rounded-2xl bg-amber-soft/70 px-4 py-2.5" data-testid="log-hint">
              <span className="h-fit shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-black text-amber" aria-hidden="true">
                Hint {entry.index}
              </span>
              <span className="font-semibold">
                <span className="sr-only">Hint {entry.index} for {forWhom}: </span>
                {entry.text}
              </span>
            </li>
          ) : (
            <li key={entry.id} className="animate-pop flex items-start justify-between gap-3 rounded-2xl bg-paper px-4 py-2.5" data-testid="log-question">
              <span className="min-w-0 break-words font-semibold">
                <span className="sr-only">{guesserName === "You" ? "You asked" : `${guesserName} asked`}: </span>
                {entry.text}
              </span>
              {entry.answer ? (
                <Pill tone={entry.answer === "yes" ? "mint" : entry.answer === "no" ? "coral" : "amber"}>
                  <span className="sr-only">Answer: </span>
                  {ANSWER_LABELS[entry.answer]}
                </Pill>
              ) : (
                <Pill>Waiting</Pill>
              )}
            </li>
          ),
        )}
      </ol>
    </Card>
  );
}

const VISIBLE_SUGGESTIONS = 4;

function AskPanel({ room, waitingFor }: { room: RoomHandle; waitingFor: string | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const suggestions = useMemo(() => pickSuggestions(), []);
  const visible = showAll ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTIONS);
  const send = async (question: string) => {
    const parsed = QuestionTextSchema.safeParse(question);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Type a question");
      return;
    }
    setError(null);
    if (await room.send("turn.ask", { text: parsed.data })) setText("");
  };
  if (waitingFor) {
    return (
      <p className="mt-4 rounded-2xl bg-brand-soft/60 px-4 py-3 font-semibold text-brand-dark" role="status">
        Waiting for {waitingFor} to answer...
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-2.5">
      <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Ask in the app</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
        {visible.map((q) => (
          <button
            key={q}
            type="button"
            disabled={room.pending}
            onClick={() => send(q)}
            className="min-h-11 rounded-full border-2 border-brand/25 bg-brand-soft/50 px-3 text-sm font-bold text-brand-dark hover:border-brand disabled:opacity-50"
          >
            {q}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="min-h-11 rounded-full px-3 text-sm font-bold text-brand underline-offset-2 hover:underline"
        >
          {showAll ? "Fewer" : "More"}
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Type your own yes/no question
        </label>
        <input
          id="ask-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={QUESTION_MAX_LENGTH}
          placeholder="Type a question"
          autoComplete="off"
          enterKeyHint="send"
          aria-invalid={error ? true : undefined}
          aria-describedby="ask-help"
          className="min-h-11 min-w-0 flex-1 rounded-2xl border-2 border-line bg-white px-3.5 font-semibold focus:border-brand focus:outline-none"
        />
        <Button type="submit" disabled={room.pending || text.trim().length === 0}>
          Send
        </Button>
      </form>
      {(error || text.length > 0) && (
        <p id="ask-help" className={`text-xs ${error ? "font-semibold text-coral" : "text-muted"}`}>
          {error ?? `${text.length}/${QUESTION_MAX_LENGTH}`}
        </p>
      )}
    </div>
  );
}

function AnswerPanel({ room, asker, questionId, text }: { room: RoomHandle; asker: string; questionId: string; text: string }) {
  return (
    <div className="space-y-2.5" data-testid="answer-panel">
      <p className="text-sm font-extrabold uppercase tracking-wide text-brand-dark">{asker} asks</p>
      <p className="break-words text-xl font-black" data-testid="pending-question">
        {text}
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {ANSWERS.map((answer) => (
          <Button
            key={answer}
            variant={answer === "yes" ? "success" : "secondary"}
            disabled={room.pending}
            onClick={() => room.send("turn.answer", { questionId, answer })}
          >
            {ANSWER_LABELS[answer]}
          </Button>
        ))}
      </div>
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
