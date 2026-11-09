import { useState } from "react";
import { DIFFICULTIES, type Difficulty, type RoomView, type Settings } from "../../shared/protocol";
import { Invite } from "../components/Invite";
import { PresencePill } from "../components/Presence";
import { DIFFICULTY_LABELS, firstPlayerLabel, SettingsForm, settingsSummary } from "../components/SettingsForm";
import { Banner, Button, Card, Dialog, Pill } from "../components/ui";
import { mePlayer, opponentPlayer } from "../lib/hooks";
import type { RoomHandle } from "../lib/useRoom";

export function Lobby({ room, view }: { room: RoomHandle; view: RoomView }) {
  const me = mePlayer(view);
  const opponent = opponentPlayer(view);
  const isHost = view.hostPlayerId === view.youId;
  const host = view.players.find((p) => p.isHost);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Settings>(view.settings);
  const canStart = isHost && !!opponent && view.players.every((p) => p.connected);

  return (
    <div className={opponent ? "mx-auto max-w-lg" : "grid gap-4 md:grid-cols-2 md:items-start md:gap-6"}>
      <h1 className="sr-only">Lobby</h1>
      {view.notices.includes("opponent_left") && (
        <div className="mb-4 md:col-span-2 md:mb-0">
          <Banner tone="info" role="status">
            Your opponent left. Share the PIN or code to invite someone new.
          </Banner>
        </div>
      )}

      {!opponent && (
        <Card>
          <Invite code={view.code} pin={view.pin} seatFree isHost={isHost} busy={room.pending} onNewPin={() => void room.renewPin()} />
        </Card>
      )}

      <div className="space-y-4">
      <Card>
        <ul className="divide-y divide-line">
          {(["A", "B"] as const).map((seat) => {
            const p = view.players.find((x) => x.seat === seat);
            return (
              <li key={seat} data-testid={`slot-${seat}`} className="flex min-h-14 items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                {p ? (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-black text-brand" aria-hidden="true">
                      {p.nickname.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-extrabold">
                      {p.nickname}
                      {p.playerId === view.youId && <span className="font-semibold text-muted"> (you)</span>}
                    </span>
                    {p.isHost && <Pill tone="brand">Host</Pill>}
                    <PresencePill player={p} />
                    {isHost && p.playerId !== view.youId && (
                      <Button variant="ghost" className="-mr-3" disabled={room.pending} onClick={() => room.send("player.remove", { playerId: p.playerId })} aria-label={`Remove ${p.nickname}`}>
                        Remove
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="font-semibold text-muted">Waiting for a player to join...</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <p className="font-bold" data-testid="settings-summary">
              {view.pack.name} · {settingsSummary(view.settings)}
            </p>
            <p className="mt-0.5 font-semibold text-muted" data-testid="first-player">
              {firstPlayerLabel(view.settings, view.players, view.youId, view.hostPlayerId)}
            </p>
          </div>
          {isHost && (
            <Button
              variant="ghost"
              className="-mr-3 shrink-0"
              onClick={() => {
                setDraft(view.settings);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm font-bold">
          Your difficulty
          <select
            value={me.difficulty ?? ""}
            disabled={room.pending}
            onChange={(e) => room.send("player.difficulty", { difficulty: (e.target.value || null) as Difficulty | null })}
            className="min-h-11 rounded-xl border-2 border-line bg-white px-2.5 font-bold"
          >
            <option value="">Same as room ({DIFFICULTY_LABELS[view.settings.difficulty]})</option>
            {DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {DIFFICULTY_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
      </Card>

      {opponent && (
        <p className="text-center text-sm font-semibold text-muted">
          Room <span className="font-mono font-extrabold tracking-wider text-ink" data-testid="room-code">{view.code}</span>
        </p>
      )}

      <div className="pt-1">
        {isHost ? (
          <Button size="lg" block disabled={!canStart || room.pending} onClick={() => room.send("match.start")}>
            {!opponent ? "Waiting for a player" : canStart ? "Start game" : `Waiting for ${opponent.nickname} to reconnect`}
          </Button>
        ) : (
          <p className="text-center font-bold text-muted" role="status">
            Waiting for {host?.nickname ?? "the host"} to start
          </p>
        )}
      </div>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Game settings">
        <SettingsForm value={draft} onChange={setDraft} />
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex gap-3 border-t border-line bg-card p-4">
          <Button variant="secondary" onClick={() => setEditing(false)} block>
            Cancel
          </Button>
          <Button
            block
            disabled={room.pending}
            onClick={async () => {
              if (await room.send("settings.update", { settings: draft })) setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
