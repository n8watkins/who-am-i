// The views of a match for everyone who is not playing it: the big screen (a TV across the room)
// and a watching phone (the audience, or a member who joined after the match began). They show
// only what their snapshot holds: whose turn, the timer, the question count and the scores; the
// round's reveal once the round is over; and, on an audience phone, both identities while a round
// is on. The big screen's snapshot holds no identity while a round is on, so it cannot show one.
import { Portrait } from "../client/components/PackArt";
import { Card, Pill } from "../client/components/ui";
import { useNow } from "../client/lib/hooks";
import { RESULT_LABELS, ResultPill } from "../client/screens/Game";
import type { MatchLength } from "../party/manifest";
import type { AudienceView, RoomScreenView, RoundReveal } from "../party/snapshots";
import type { PublicIdentity, TurnResult } from "../shared/protocol";
import { outcomeOf } from "./outcome";

export type WatchSnapshot = RoomScreenView | AudienceView;

export const MATCH_LABELS: Record<MatchLength, string> = { first_to_3: "First to 3", first_to_5: "First to 5", rounds_10: "Best of 10 rounds" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function nameFor(view: WatchSnapshot) {
  return (seat: number) => view.players.find((p) => p.seat === seat)?.name || "A player";
}

/** The turn's clock as the screen shows it: seconds left and whether it is paused, or null without a timer. */
function useClock(view: WatchSnapshot, offset: number): { seconds: number; paused: boolean } | null {
  const turn = view.turn;
  const timed = turn !== null && (turn.deadline !== null || turn.pausedRemainingMs !== null);
  const now = useNow(500, timed);
  if (!turn || !timed) return null;
  const remaining = turn.deadline !== null ? Math.max(0, turn.deadline - (now + offset)) : (turn.pausedRemainingMs ?? 0);
  return { seconds: Math.ceil(remaining / 1000), paused: turn.deadline === null };
}

const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The headline once a round is over: who won the match, or which round ended. */
function revealHeadline(view: WatchSnapshot, reveal: RoundReveal, name: (seat: number) => string): { kicker: string; title: string; line: string } {
  if (!reveal.matchOver) return { kicker: `Round ${reveal.roundIndex} complete`, title: "The big reveal", line: "" };
  const { winner, line } = outcomeOf(view.scores.map((s) => ({ key: s.seat, score: s.score })));
  return { kicker: "Match over", title: winner === null ? "It's a tie!" : `${name(winner)} wins the match!`, line };
}

const scoreOf = (view: WatchSnapshot, seat: number) => view.scores.find((s) => s.seat === seat)?.score ?? 0;

// ---------------------------------------------------------------------------
// The big screen: a TV read from a sofa. Every size is in rem, and the page's root size grows with
// the screen (styles.css), so the layout is the same at 1280 and 1920 pixels wide.

export function BigScreen({ view, offset, notice }: { view: WatchSnapshot; offset: number; notice: string | null }) {
  const name = nameFor(view);
  return (
    <main data-screen="big" className="flex h-dvh flex-col gap-[1.25rem] overflow-hidden px-[2.5rem] pt-[1.25rem] pb-[1.75rem]">
      <header className="flex items-baseline justify-between gap-[1rem]">
        <span className="text-[1.5rem] font-black tracking-tight">Who Am I?</span>
        <span className="text-[1.25rem] font-extrabold text-muted" data-testid="screen-round">
          Round {view.reveal?.roundIndex ?? view.roundIndex} · {MATCH_LABELS[view.match] ?? ""}
        </span>
      </header>
      {view.reveal ? <ScreenReveal view={view} reveal={view.reveal} name={name} /> : <ScreenTurn view={view} offset={offset} name={name} notice={notice} />}
    </main>
  );
}

function ScreenTurn({ view, offset, name, notice }: { view: WatchSnapshot; offset: number; name: (seat: number) => string; notice: string | null }) {
  const turn = view.turn;
  const clock = useClock(view, offset);
  const low = clock !== null && !clock.paused && clock.seconds <= 10;
  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[1.5rem] text-center">
        {turn ? (
          <>
            <h1 className="text-[4.25rem] leading-none font-black tracking-tight" data-testid="watch-turn">
              {name(turn.seat)}&rsquo;s turn to guess
            </h1>
            <div className="flex items-stretch justify-center gap-[1.25rem]">
              <div className="min-w-[11rem] rounded-[1.5rem] border-2 border-line bg-card px-[1.75rem] py-[1rem]" data-testid="watch-questions">
                <p className="font-mono text-[3.5rem] leading-none font-black tabular-nums">{turn.questionCount}</p>
                <p className="mt-[0.5rem] text-[1.125rem] font-extrabold text-muted">{turn.questionCount === 1 ? "question asked" : "questions asked"}</p>
              </div>
              {clock && (
                <div
                  role="timer"
                  aria-label={clock.paused ? `Timer paused at ${clock.seconds} seconds` : `${clock.seconds} seconds left`}
                  className={`min-w-[11rem] rounded-[1.5rem] border-2 px-[1.75rem] py-[1rem] ${low ? "border-coral bg-coral-soft text-coral-ink" : "border-line bg-card"}`}
                  data-testid="watch-timer"
                >
                  <p className="font-mono text-[3.5rem] leading-none font-black tabular-nums">{clockText(clock.seconds)}</p>
                  <p className={`mt-[0.5rem] text-[1.125rem] font-extrabold ${low ? "" : "text-muted"}`}>{clock.paused ? "paused" : "left"}</p>
                </div>
              )}
            </div>
            <p className="min-h-[2rem] text-[1.5rem] font-extrabold text-brand-ink" aria-live="polite">
              {notice ?? (turn.phase === "pending_confirm" ? `${name(turn.seat)} has a guess. Is it right?` : "")}
            </p>
          </>
        ) : (
          <h1 className="text-[3.5rem] font-black">Drawing identities...</h1>
        )}
      </section>
      <ScreenScores view={view} name={name} guessing={turn?.seat ?? null} />
    </>
  );
}

/** Both players across the foot of the screen: name, score, and who is guessing. */
function ScreenScores({ view, name, guessing }: { view: WatchSnapshot; name: (seat: number) => string; guessing: number | null }) {
  return (
    <ul className="grid grid-cols-2 gap-[1.25rem]" aria-label="Scores" data-testid="watch-scores">
      {view.players.map((p) => {
        const on = p.seat === guessing;
        return (
          <li
            key={p.seat}
            className={`flex items-center justify-between gap-[1rem] rounded-[1.75rem] border-[0.1875rem] px-[1.75rem] py-[1rem] ${on ? "border-brand bg-brand-soft" : "border-line bg-card"}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[2.25rem] leading-tight font-black">{name(p.seat)}</span>
              <span className={`block text-[1.125rem] font-extrabold ${on ? "text-brand-ink" : "text-muted"}`}>{guessing === null ? " " : on ? "Guessing" : "Answering"}</span>
            </span>
            <span className="font-mono text-[4rem] leading-none font-black tabular-nums" aria-label={plural(scoreOf(view, p.seat), "point")}>
              {scoreOf(view, p.seat)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const RESULT_TONES: Record<TurnResult, string> = {
  correct: "bg-mint-soft text-mint-ink border-mint/30",
  skipped: "bg-paper text-muted border-line",
  timed_out: "bg-amber-soft text-amber border-amber/30",
  beaten: "bg-paper text-muted border-line",
};

function ScreenReveal({ view, reveal, name }: { view: WatchSnapshot; reveal: RoundReveal; name: (seat: number) => string }) {
  const head = revealHeadline(view, reveal, name);
  return (
    <>
      <section className="text-center">
        <p className="text-[1.25rem] font-extrabold tracking-wide text-muted uppercase">{head.kicker}</p>
        <h1 className="mt-[0.25rem] text-[3.25rem] leading-none font-black tracking-tight" data-testid="watch-headline">
          {head.title}
        </h1>
        {head.line && <p className="mt-[0.5rem] text-[1.5rem] font-extrabold text-muted">{head.line}</p>}
      </section>
      <ul className="grid min-h-0 flex-1 grid-cols-2 gap-[1.25rem]" data-testid="watch-reveal">
        {reveal.entries.map((e) => (
          <li key={e.seat} className="flex min-h-0 flex-col justify-between gap-[0.75rem] rounded-[1.75rem] border-[0.1875rem] border-line bg-card px-[1.75rem] py-[1.25rem]">
            <div className="flex items-baseline justify-between gap-[1rem]">
              <span className="truncate text-[1.5rem] font-black">{name(e.seat)} was</span>
              <span className="font-mono text-[3rem] leading-none font-black tabular-nums" aria-label={plural(scoreOf(view, e.seat), "point")}>
                {scoreOf(view, e.seat)}
              </span>
            </div>
            <div className="flex min-h-0 items-center gap-[1.25rem]">
              <Portrait name={e.identity.canonicalName} categoryId={e.identity.categoryId} className="size-[5.5rem] rounded-[1.25rem] text-[2rem]" />
              <p className="min-w-0 text-[2.5rem] leading-[1.05] font-black tracking-tight [overflow-wrap:anywhere]">{e.identity.canonicalName}</p>
            </div>
            <span className={`self-start rounded-full border-2 px-[1rem] py-[0.25rem] text-[1.25rem] font-extrabold ${RESULT_TONES[e.result]}`}>{RESULT_LABELS[e.result].text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// A watching phone: the audience (both identities, which is the whole point of watching), or a
// member who joined after the match began (the screen's view, laid out for a phone).

export function WatchPhone({ view, offset, notice }: { view: WatchSnapshot; offset: number; notice: string | null }) {
  const name = nameFor(view);
  const turn = view.turn;
  const clock = useClock(view, offset);
  if (view.reveal) return <PhoneReveal view={view} reveal={view.reveal} name={name} />;
  const identities = view.role === "audience" ? view.identities : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold tracking-wide text-muted uppercase">Round {view.roundIndex}</p>
        {turn && (
          <span className="flex items-center gap-2 text-sm font-bold">
            <span data-testid="watch-questions">{plural(turn.questionCount, "question")}</span>
            {clock && (
              <span role="timer" className="rounded-full border-2 border-line bg-field px-2.5 py-0.5 font-mono font-black tabular-nums" data-testid="watch-timer">
                {clock.paused ? "paused " : ""}
                {clockText(clock.seconds)}
              </span>
            )}
          </span>
        )}
      </div>
      {turn ? (
        <h1 className="text-2xl leading-tight font-black" data-testid="watch-turn">
          {name(turn.seat)}&rsquo;s turn to guess
        </h1>
      ) : (
        <h1 className="text-2xl font-black">Drawing identities...</h1>
      )}
      {(notice || turn?.phase === "pending_confirm") && (
        <p className="text-sm font-bold text-brand-ink" aria-live="polite">
          {notice ?? `${name(turn!.seat)} has a guess. Is it right?`}
        </p>
      )}
      {identities.length > 0 ? (
        <ul className="space-y-3" data-testid="watch-identities">
          {identities.map((i) => (
            <IdentityCard key={i.seat} who={name(i.seat)} identity={i.identity} guessing={turn?.seat === i.seat} score={scoreOf(view, i.seat)} />
          ))}
        </ul>
      ) : (
        <PhoneScores view={view} name={name} guessing={turn?.seat ?? null} />
      )}
    </div>
  );
}

/** One player's secret, large: whose it is above it, and whether they are guessing it now. */
function IdentityCard({ who, identity, guessing, score }: { who: string; identity: PublicIdentity; guessing: boolean; score: number }) {
  return (
    <li className={`rounded-3xl border-2 bg-card p-4 ${guessing ? "border-brand" : "border-line"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-base font-extrabold">
          {who} <span className="font-semibold text-muted">is</span>
        </p>
        <span className="flex shrink-0 items-center gap-2">
          {guessing && <Pill tone="brand">Guessing now</Pill>}
          <span className="font-mono text-lg font-black tabular-nums" aria-label={plural(score, "point")}>
            {score}
          </span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Portrait name={identity.canonicalName} categoryId={identity.categoryId} className="size-16 text-xl" />
        <p className="min-w-0 text-3xl leading-tight font-black [overflow-wrap:anywhere]">{identity.canonicalName}</p>
      </div>
    </li>
  );
}

function PhoneScores({ view, name, guessing }: { view: WatchSnapshot; name: (seat: number) => string; guessing: number | null }) {
  return (
    <ul className="grid grid-cols-2 gap-3" aria-label="Scores" data-testid="watch-scores">
      {view.players.map((p) => (
        <li key={p.seat} className={`rounded-2xl border-2 bg-card px-4 py-3 ${p.seat === guessing ? "border-brand" : "border-line"}`}>
          <span className="block truncate font-extrabold">{name(p.seat)}</span>
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-muted">{guessing === null ? "" : p.seat === guessing ? "Guessing" : "Answering"}</span>
            <span className="font-mono text-3xl font-black tabular-nums">{scoreOf(view, p.seat)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PhoneReveal({ view, reveal, name }: { view: WatchSnapshot; reveal: RoundReveal; name: (seat: number) => string }) {
  const head = revealHeadline(view, reveal, name);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-extrabold tracking-wide text-muted uppercase">{head.kicker}</p>
        <h1 className="text-3xl font-extrabold tracking-tight" data-testid="watch-headline">
          {head.title}
        </h1>
        {head.line && <p className="font-bold text-muted">{head.line}</p>}
      </div>
      <ul className="space-y-3" data-testid="watch-reveal">
        {reveal.entries.map((e) => (
          <li key={e.seat}>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-extrabold tracking-wide text-muted uppercase">{name(e.seat)} was</p>
                <span className="font-mono text-lg font-black tabular-nums" aria-label={plural(scoreOf(view, e.seat), "point")}>
                  {scoreOf(view, e.seat)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Portrait name={e.identity.canonicalName} categoryId={e.identity.categoryId} className="size-14 text-lg" />
                <p className="min-w-0 text-2xl leading-tight font-black [overflow-wrap:anywhere]">{e.identity.canonicalName}</p>
              </div>
              <div className="mt-3">
                <ResultPill result={e.result} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {!reveal.matchOver && <p className="text-center text-sm text-muted">The next round starts when a player taps Next round.</p>}
    </div>
  );
}
