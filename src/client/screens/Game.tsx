import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ANSWER_LABELS,
  ANSWERS,
  HINTS_PER_TURN,
  HOST_OVERRIDE_AFTER_MS,
  QUESTION_MAX_LENGTH,
  QuestionTextSchema,
  type RoomView,
  type TurnLogEntry,
  type TurnResult,
} from "../../shared/protocol";
import { pickSuggestions } from "../../shared/questions";
import { absentSince, presenceOf } from "../../kit/shared/presence";
import { Portrait } from "../components/PackArt";
import { OpponentPresenceBanner } from "../components/Presence";
import { MODE_LABELS } from "../components/SettingsForm";
import { Banner, Button, Card, Pill } from "../components/ui";
import { mePlayer, opponentPlayer, useNow } from "../lib/hooks";
import type { RoomHandle } from "../lib/useRoom";

export const RESULT_LABELS: Record<TurnResult, { text: string; tone: "mint" | "neutral" | "amber" }> = {
  correct: { text: "Guessed it", tone: "mint" },
  skipped: { text: "Gave up", tone: "neutral" },
  timed_out: { text: "Time ran out", tone: "amber" },
  beaten: { text: "Beaten to it", tone: "neutral" },
};

export function Game({ room, view }: { room: RoomHandle; view: RoomView }) {
  const me = mePlayer(view);
  const opponent = opponentPlayer(view)!;
  const turn = view.turn;
  const myTurn = turn?.playerId === me.playerId;
  const pendingConfirm = turn?.phase === "pending_confirm";
  const twentyQ = view.settings.mode === "twenty_questions";
  const trade = twentyQ && view.settings.turnFormat === "trade";
  const moveAsked = trade && !!turn?.moveAsked;
  const isHost = view.hostPlayerId === me.playerId;
  const opponentAbsentSince = absentSince(opponent);
  const now = useNow(500, opponentAbsentSince !== null || view.settings.timerSeconds > 0);
  const opponentGoneFor = opponentAbsentSince !== null ? now + room.serverOffset - opponentAbsentSince : 0;
  const canOverride = myTurn && pendingConfirm && isHost && opponentAbsentSince !== null && opponentGoneFor >= HOST_OVERRIDE_AFTER_MS;
  const identityName = view.opponentIdentity?.canonicalName ?? "";
  const hintsOn = view.settings.hints !== false;
  const questionMode = view.settings.questions ?? "both";
  const appOn = twentyQ && questionMode !== "spoken";
  const spokenOn = twentyQ && questionMode !== "app";
  const pendingQuestion = turn?.log.find((e) => e.kind === "question" && e.answer === null);

  const turnHeadline = myTurn ? "Your turn to guess" : `${opponent.nickname} is guessing`;
  const myResult = view.turnResults[me.playerId];
  const opponentResult = view.turnResults[opponent.playerId];
  const instruction = myTurn
    ? trade
      ? `Ask ${opponent.nickname} one yes/no question${appOn && spokenOn ? ", out loud or here" : appOn ? " here" : " out loud"}, then guess or pass.`
      : twentyQ
        ? `Ask ${opponent.nickname} yes/no questions about who you are${appOn && spokenOn ? ", out loud or here" : appOn ? " here" : " out loud"}.`
      : `${opponent.nickname} is describing you. Say your guess out loud.`
    : twentyQ
      ? `Answer ${opponent.nickname}'s yes/no questions.`
      : `Give ${opponent.nickname} clues without saying the name.`;

  return (
    <div className="space-y-3 md:grid md:grid-cols-[minmax(0,1fr)_22rem] md:items-start md:gap-x-5 md:space-y-0">
      <h1 className="sr-only">Round {view.roundIndex}</h1>
      <p className="sr-only" aria-live="polite" role="status">
        Round {view.roundIndex}. {turnHeadline}.{pendingConfirm ? (myTurn ? " Waiting for confirmation." : ` ${opponent.nickname} thinks they got it.`) : ""}
      </p>
      {view.firstPlayerId && (
        <p className="sr-only" data-testid="round-starter">
          {view.firstPlayerId === me.playerId ? "You go first this round." : `${opponent.nickname} goes first this round.`}
        </p>
      )}

      <TopBar view={view} now={now} offset={room.serverOffset} />

      {(view.notices.includes("pack_reshuffled") || presenceOf(opponent) !== "here") && (
        <div className="space-y-2 md:col-span-2 md:mt-3">
          {view.notices.includes("pack_reshuffled") && (
            <Banner tone="info" role="status">
              Pack exhausted, reshuffling. Earlier identities can come up again.
            </Banner>
          )}
          <OpponentPresenceBanner opponent={opponent} timerPaused={view.settings.timerSeconds > 0} />
        </div>
      )}

      <aside className="space-y-3 md:col-start-2 md:mt-3">
        <h2 className="sr-only" data-testid="turn-headline">
          {turnHeadline}
        </h2>
        {myTurn ? (
          <details className="group rounded-2xl border-2 border-brand/25 bg-card px-4 py-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3">
              {view.opponentIdentity && <Portrait name={identityName} categoryId={view.opponentIdentity.categoryId} className="size-9 text-sm" />}
              <span className="min-w-0 flex-1 text-sm font-bold text-muted">
                {opponent.nickname} is <span className="text-base font-black text-ink" data-testid="opponent-identity">{identityName}</span>
                {opponentResult ? " " : ", up next"}
                {opponentResult && <ResultPill result={opponentResult} />}
              </span>
              <span aria-hidden="true" className="text-muted transition group-open:rotate-180">{"▾"}</span>
            </summary>
            <RulesList view={view} />
            {trade && !myResult && (
              <div className="pb-2">
                <Button variant="ghost" className="-ml-5" disabled={room.pending} onClick={() => room.send("turn.skip")}>
                  Give up this round
                </Button>
              </div>
            )}
          </details>
        ) : (
          <Card className="flex items-center gap-4 border-2 border-brand/30 py-4">
            {view.opponentIdentity && <Portrait name={identityName} categoryId={view.opponentIdentity.categoryId} className="size-16 text-xl" />}
            <div className="min-w-0">
              <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Answer as</p>
              <p className="text-3xl font-black leading-tight" data-testid="opponent-identity">
                {identityName}
              </p>
              {myResult && (
                <p className="mt-1.5 text-sm font-bold text-muted">
                  Your turn: <ResultPill result={myResult} />
                </p>
              )}
            </div>
          </Card>
        )}

        {turn && (
          <ActionBar>
            {!myTurn && !pendingConfirm && pendingQuestion?.kind === "question" && (
              <AnswerPanel room={room} asker={opponent.nickname} questionId={pendingQuestion.id} text={pendingQuestion.text} />
            )}

            {!myTurn && !pendingConfirm && !pendingQuestion && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-muted">
                  {trade ? `It's ${opponent.nickname}'s move.` : `${turnHeadline}. They will tap I Guessed It when they have it.`}
                </p>
                {spokenOn && !moveAsked && (
                  <Button variant="secondary" className="shrink-0" disabled={room.pending} onClick={() => room.send("turn.question")} aria-label="+1, count one more question">
                    +1
                  </Button>
                )}
              </div>
            )}

            {myTurn && !pendingConfirm && (
              <div className="space-y-2.5">
                {moveAsked && !pendingQuestion ? (
                  <p className="font-bold" data-testid="move-prompt">
                    Make your guess, or pass to {opponent.nickname}.
                  </p>
                ) : appOn ? (
                  <AskPanel key={turn.log.length} room={room} waitingFor={pendingQuestion ? opponent.nickname : null} />
                ) : (
                  spokenOn && (
                    <Button variant="secondary" block size="lg" disabled={room.pending} onClick={() => room.send("turn.question")} aria-label="+1 question, count one more question">
                      +1 question
                    </Button>
                  )
                )}
                <div className="flex items-center gap-2">
                  {hintsOn && (
                    <Button
                      variant="secondary"
                      disabled={room.pending || turn.hintsUsed >= HINTS_PER_TURN}
                      onClick={() => room.send("turn.hint")}
                      aria-label={`Get a hint, ${HINTS_PER_TURN - turn.hintsUsed} of ${HINTS_PER_TURN} left`}
                      className="px-3.5 whitespace-nowrap"
                    >
                      Hint <span className="tabular-nums text-muted">{HINTS_PER_TURN - turn.hintsUsed}</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="whitespace-nowrap px-3.5"
                    disabled={room.pending || (trade && !!pendingQuestion)}
                    onClick={() => room.send(trade ? "turn.pass" : "turn.skip")}
                  >
                    {trade ? "Pass" : "Give up"}
                  </Button>
                  <Button size="lg" className="min-w-0 flex-1 whitespace-nowrap px-3" disabled={room.pending || (trade && !!pendingQuestion)} onClick={() => room.send("turn.correct.request")}>
                    I Guessed It
                  </Button>
                </div>
              </div>
            )}

            {myTurn && pendingConfirm && (
              <div className="space-y-2.5">
                <p className="font-bold" role="status">
                  Waiting for {opponent.nickname} to confirm your guess...
                </p>
                {canOverride && (
                  <Button block disabled={room.pending} onClick={() => room.send("turn.correct.override")}>
                    Confirm without {opponent.nickname} (host)
                  </Button>
                )}
                {!trade && (
                  <Button variant="secondary" block disabled={room.pending} onClick={() => room.send("turn.skip")}>
                    Give up instead
                  </Button>
                )}
              </div>
            )}

            {!myTurn && pendingConfirm && (
              <div className="space-y-2.5">
                <p className="text-lg font-bold">
                  {opponent.nickname} thinks they got it. Did they say <span className="text-brand-ink">{identityName}</span>?
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
      </aside>

      {turn && (
        <div className="md:col-start-1 md:row-start-2 md:mt-3">
          <TurnLog entries={turn.log} guesserName={myTurn ? "You" : opponent.nickname} mine={myTurn} empty={instruction} />
        </div>
      )}
    </div>
  );
}

/** Round, score, question count and timer in one line. */
function TopBar({ view, now, offset }: { view: RoomView; now: number; offset: number }) {
  const me = mePlayer(view);
  const opponent = opponentPlayer(view)!;
  const turn = view.turn;
  const points = (seat: string, score: number, name: string) => (
    <span className="text-lg font-black tabular-nums" data-testid={`points-${seat}`} aria-label={`${name} has ${score} ${score === 1 ? "point" : "points"}`}>
      {score}
    </span>
  );
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-card px-3.5 text-sm font-bold shadow-sm md:col-span-2" role="group" aria-label="Round and scores">
      <span className="font-black text-brand-ink" aria-hidden="true">R{view.roundIndex}</span>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        <span className="shrink-0">You</span>
        {points(me.seat, me.score, "You")}
        <span className="text-muted" aria-hidden="true">:</span>
        {points(opponent.seat, opponent.score, opponent.nickname)}
        <span className="truncate">{opponent.nickname}</span>
      </span>
      {turn && view.settings.mode === "twenty_questions" && (
        <span className="whitespace-nowrap tabular-nums text-muted">
          <span className="text-ink" data-testid="question-count">{turn.questionCount}</span> asked
        </span>
      )}
      {turn && view.settings.timerSeconds > 0 && <TurnTimer view={view} now={now} offset={offset} />}
    </div>
  );
}

function RulesList({ view }: { view: RoomView }) {
  return (
    <ul className="list-disc space-y-1.5 pb-3 pl-5 text-sm text-muted">
      <li>{MODE_LABELS[view.settings.mode].blurb}</li>
      <li>A correct guess, confirmed by your opponent, scores 1 point.</li>
      {view.settings.mode === "twenty_questions" && view.settings.turnFormat === "trade" ? (
        <li>Each move is one question and one guess. The first correct guess wins the round, and a wrong guess ends your move.</li>
      ) : (
        <li>The round ends when both players have guessed or given up. Then both identities are revealed.</li>
      )}
      {view.settings.timerSeconds > 0 && <li>Each turn lasts {view.settings.timerSeconds} seconds. When time runs out, the turn ends.</li>}
    </ul>
  );
}

/**
 * Holds the turn's primary actions. Below the `md` breakpoint it is fixed to the bottom of the
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(29,26,46,0.10)] backdrop-blur md:static md:z-auto md:rounded-3xl md:border md:bg-card md:p-5 md:shadow-sm md:backdrop-blur-none"
    >
      <div className="mx-auto max-w-lg md:max-w-none">{children}</div>
    </div>
  );
}

function TurnLog({ entries, guesserName, mine, empty }: { entries: TurnLogEntry[]; guesserName: string; mine: boolean; empty: string }) {
  const end = useRef<HTMLDivElement>(null);
  const count = entries.length;
  useEffect(() => {
    if (count > 0) end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  if (count === 0) return <p className="rounded-2xl bg-card/60 px-4 py-6 text-center font-semibold text-muted">{empty}</p>;
  const forWhom = guesserName === "You" ? "you" : guesserName;
  return (
    <>
      <ol className="space-y-2" aria-live="polite" data-testid="turn-log">
        {entries.map((entry) =>
          entry.kind === "hint" ? (
            <li key={entry.id} className="animate-pop rounded-2xl bg-amber-soft/70 px-3.5 py-2 text-center text-sm font-semibold" data-testid="log-hint">
              <span className="font-black text-amber" aria-hidden="true">Hint {entry.index}: </span>
              <span className="sr-only">Hint {entry.index} for {forWhom}: </span>
              {entry.text}
            </li>
          ) : (
            <li key={entry.id} className={`animate-pop flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`} data-testid="log-question">
              <span className={`max-w-[85%] break-words rounded-2xl px-3.5 py-2 font-semibold ${mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md border border-line bg-card"}`}>
                <span className="sr-only">{guesserName === "You" ? "You asked" : `${guesserName} asked`}: </span>
                {entry.text}
              </span>
              <span className={mine ? "self-start" : "self-end"}>
                {entry.answer ? (
                  <Pill tone={entry.answer === "yes" ? "mint" : entry.answer === "no" ? "coral" : "amber"}>
                    <span className="sr-only">Answer: </span>
                    {ANSWER_LABELS[entry.answer]}
                  </Pill>
                ) : (
                  <Pill>Waiting</Pill>
                )}
              </span>
            </li>
          ),
        )}
      </ol>
      <div ref={end} className="scroll-mb-[calc(var(--action-bar-h,0px)+1rem)]" />
    </>
  );
}

function AskPanel({ room, waitingFor }: { room: RoomHandle; waitingFor: string | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const suggestions = useMemo(() => pickSuggestions(), []);
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
      <p className="rounded-2xl bg-brand-soft/60 px-4 py-3 font-semibold text-brand-ink" role="status">
        Waiting for {waitingFor} to answer...
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 md:[&>button:nth-child(n+5)]:hidden" role="group" aria-label="Suggested questions">
        {suggestions.map((q) => (
          <button
            key={q}
            type="button"
            disabled={room.pending}
            onClick={() => send(q)}
            className="min-h-11 shrink-0 whitespace-nowrap rounded-full border-2 border-brand/25 bg-brand-soft/50 px-3 text-sm font-bold text-brand-ink hover:border-brand disabled:opacity-50"
          >
            {q}
          </button>
        ))}
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
          className="min-h-11 min-w-0 flex-1 rounded-2xl border-2 border-line bg-field px-3.5 font-semibold focus:border-brand focus:outline-none"
        />
        <Button type="submit" disabled={room.pending || text.trim().length === 0}>
          Send
        </Button>
      </form>
      {error && (
        <p id="ask-help" className="text-xs font-semibold text-coral">
          {error}
        </p>
      )}
    </div>
  );
}

function AnswerPanel({ room, asker, questionId, text }: { room: RoomHandle; asker: string; questionId: string; text: string }) {
  return (
    <div className="space-y-2.5" data-testid="answer-panel">
      <p className="text-sm font-extrabold uppercase tracking-wide text-brand-ink">{asker} asks</p>
      <p className="break-words text-xl font-black" data-testid="pending-question">
        {text}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
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
      <span aria-hidden="true">{result === "correct" ? "✓" : result === "timed_out" ? "⏱" : "↷"}</span>
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
        low ? "border-coral bg-coral-soft text-coral-ink" : "border-line bg-field text-ink"
      }`}
    >
      <span aria-hidden="true">{paused ? "⏸" : "⏱"}</span>
      {paused ? `${label} paused` : label}
    </span>
  );
}
