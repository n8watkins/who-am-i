import type { RoomView } from "../../shared/protocol";

export function Scoreboard({ view, compact = false }: { view: RoomView; compact?: boolean }) {
  const players = [...view.players].sort((a, b) => a.seat.localeCompare(b.seat));
  return (
    <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Scores">
      {players.map((p) => {
        const you = p.playerId === view.youId;
        const active = view.turn?.playerId === p.playerId;
        return (
          <div
            key={p.playerId}
            data-testid={`score-${p.seat}`}
            className={[
              "flex items-center justify-between gap-2 rounded-2xl border-2 px-3.5",
              compact ? "py-2" : "py-3",
              active ? "border-brand bg-brand-soft/60" : "border-line bg-white",
            ].join(" ")}
          >
            <div className="min-w-0">
              <div className="truncate font-extrabold">{p.nickname}</div>
              <div className="text-xs font-bold text-muted">
                {active ? <span className="text-brand">{you ? "You, guessing" : "Guessing now"}</span> : you ? "You" : "Opponent"}
              </div>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black tabular-nums" aria-label={`${p.nickname} has ${p.score} ${p.score === 1 ? "point" : "points"}`}>
                {p.score}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
