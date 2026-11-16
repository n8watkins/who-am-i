// The room view's page: a match of Who Am I? inside a party room, drawn with the game's own
// screens. A player's phone gets the match as on the game's own site (the other player's
// identity, the questions and answers, the guesser's controls, the log and the timer). The big
// screen and a watching phone get their own views (Watch.tsx), from what their snapshot holds.
import { useEffect } from "react";
import { Banner, Card } from "../client/components/ui";
import { mePlayer, opponentPlayer } from "../client/lib/hooks";
import type { RoomHandle } from "../client/lib/useRoom";
import { Game } from "../client/screens/Game";
import { RoundSummary } from "../client/screens/Summaries";
import { useWakeLock } from "../kit/client/wake-lock";
import type { PlayerSnapshot } from "../party/snapshots";
import { isBigScreen, type PartyHost } from "./host";
import type { Notice } from "./notices";
import { outcomeOf } from "./outcome";
import { useParty } from "./useParty";
import { BigScreen, MATCH_LABELS, WatchPhone } from "./Watch";

/** How long a notice that is not sticky stays up while the page is shown. */
const NOTICE_MS = 8_000;

export function PartyApp({ host }: { host: PartyHost }) {
  const { snap, handle, notice, clearNotice } = useParty(host);
  // The room shows this page only while a match is on: a phone set down mid-round, and the big
  // screen, must not dim and lock (the frame is allowed the wake lock: view.js).
  useWakeLock(true);
  useNoticeTimeout(notice, clearNotice);
  // A notice about a round is put away once another round is on.
  const shown = notice && notice.roundIndex === snap.roundIndex ? notice : null;

  if (snap.role !== "player" && isBigScreen(host.you)) return <BigScreen view={snap} offset={handle.serverOffset} notice={shown?.text ?? null} />;
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
      {snap.role === "player" ? (
        <>
          {shown && (
            <div className="mb-3" data-testid="party-notice">
              <Banner tone="info" role="status" onDismiss={clearNotice}>
                {shown.text}
              </Banner>
            </div>
          )}
          <PlayerView view={snap} handle={handle} />
        </>
      ) : (
        <WatchPhone view={snap} offset={handle.serverOffset} notice={shown?.text ?? null} />
      )}
    </main>
  );
}

/** A notice that is not sticky goes after NOTICE_MS of the page being shown (not while it is hidden). */
function useNoticeTimeout(notice: Notice | null, clear: () => void) {
  useEffect(() => {
    if (!notice || notice.sticky) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") timer = setTimeout(clear, NOTICE_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [notice, clear]);
}

function PlayerView({ view, handle }: { view: PlayerSnapshot; handle: RoomHandle }) {
  if (view.status === "guessing_first" || view.status === "guessing_second") return <Game room={handle} view={view} eitherMayOverride />;
  if (view.status === "round_summary") {
    return (
      <div className="space-y-4">
        {view.roundSummary?.matchOver && <MatchDecided view={view} />}
        <RoundSummary room={handle} view={view} />
      </div>
    );
  }
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

/** The last round's summary says the match is over: who won it, by name, before the reveal. */
function MatchDecided({ view }: { view: PlayerSnapshot }) {
  const { winner, line } = outcomeOf(view.players.map((p) => ({ key: p.playerId, score: p.score })));
  const name = view.players.find((p) => p.playerId === winner)?.nickname;
  const title = winner === null ? "It's a tie!" : winner === view.youId ? "You win the match!" : `${name ?? "Your opponent"} wins the match!`;
  return (
    <Card className="animate-pop border-2 border-brand/40 text-center">
      <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Match over</p>
      <p className="mt-1 text-3xl font-black tracking-tight" data-testid="match-decided">
        {title}
      </p>
      <p className="mt-1 font-bold text-muted">{line}</p>
    </Card>
  );
}
