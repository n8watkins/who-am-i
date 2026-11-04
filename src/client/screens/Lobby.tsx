import { useState } from "react";
import type { RoomView, Settings } from "../../shared/protocol";
import { firstPlayerLabel, MODE_LABELS, QUESTION_MODE_LABELS, matchLabel, SettingsForm, timerLabel } from "../components/SettingsForm";
import { Invite } from "../components/Invite";
import { Banner, Button, Card, Pill } from "../components/ui";
import { mePlayer, opponentPlayer } from "../lib/hooks";
import type { RoomHandle } from "../lib/useRoom";

export function Lobby({ room, view }: { room: RoomHandle; view: RoomView }) {
  const me = mePlayer(view);
  const opponent = opponentPlayer(view);
  const isHost = view.hostPlayerId === view.youId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Settings>(view.settings);
  const bothReady = view.players.length === 2 && view.players.every((p) => p.ready);

  const startHint = !opponent
    ? "Waiting for a second player to join."
    : !bothReady
      ? `Waiting for ${[me, opponent].filter((p) => !p.ready).map((p) => (p === me ? "you" : p.nickname)).join(" and ")} to be ready.`
      : isHost
        ? "Everyone is ready."
        : `Waiting for ${opponent.nickname} to start the game.`;

  return (
    <div className="space-y-4">
      {view.notices.includes("opponent_left") && (
        <Banner tone="info" role="status">
          Your opponent left. Share the PIN or code to invite someone new.
        </Banner>
      )}

      <Card>
        <h1 className="sr-only">Lobby</h1>
        <Invite code={view.code} pin={view.pin} seatFree={!opponent} isHost={isHost} busy={room.pending} onNewPin={() => void room.renewPin()} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Players</h2>
        <ul className="space-y-2.5">
          {(["A", "B"] as const).map((seat) => {
            const p = view.players.find((x) => x.seat === seat);
            return (
              <li
                key={seat}
                data-testid={`slot-${seat}`}
                className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 py-2.5 ${p ? "border-line bg-white" : "border-dashed border-line bg-paper"}`}
              >
                {p ? (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-black text-brand" aria-hidden="true">
                      {p.nickname.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-extrabold">
                        {p.nickname}
                        {p.playerId === view.youId && <span className="font-semibold text-muted"> (you)</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {p.isHost && <Pill tone="brand">Host</Pill>}
                        {!p.connected && <Pill tone="amber">Offline</Pill>}
                        {p.ready ? (
                          <Pill tone="mint">
                            <span aria-hidden="true">{"✓"}</span> Ready
                          </Pill>
                        ) : (
                          <Pill>
                            <span aria-hidden="true">{"…"}</span> Not ready
                          </Pill>
                        )}
                      </div>
                    </div>
                    {isHost && p.playerId !== view.youId && (
                      <Button variant="ghost" disabled={room.pending} onClick={() => room.send("player.remove", { playerId: p.playerId })} aria-label={`Remove ${p.nickname}`}>
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
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted">Game settings</h2>
          {isHost && !editing && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(view.settings);
                setEditing(true);
              }}
            >
              Change
            </Button>
          )}
        </div>
        {editing ? (
          <div className="mt-4 space-y-5">
            <SettingsForm value={draft} onChange={setDraft} />
            <p className="text-sm text-muted">Saving new settings asks both players to ready up again.</p>
            <div className="flex gap-3">
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
                Save settings
              </Button>
            </div>
          </div>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <SettingItem label="Category" value={view.pack.name} />
            <SettingItem label="Mode" value={MODE_LABELS[view.settings.mode].name} />
            <SettingItem label="Timer" value={timerLabel(view.settings)} />
            <SettingItem label="Match" value={matchLabel(view.settings)} />
            <SettingItem label="Questions" value={QUESTION_MODE_LABELS[view.settings.questions ?? "both"]} />
            <SettingItem label="Hints" value={view.settings.hints === false ? "Off" : "On, up to 3 per turn"} />
            <div className="col-span-2 rounded-2xl bg-brand-soft/60 px-4 py-3" data-testid="first-player">
              <dt className="font-bold text-muted">First guess</dt>
              <dd className="text-base font-extrabold text-brand-dark">{firstPlayerLabel(view.settings, view.players, view.youId, view.hostPlayerId)}</dd>
            </div>
          </dl>
        )}
      </Card>

      <div className="space-y-3 pt-1">
        <Button
          size="lg"
          block
          variant={me.ready ? "secondary" : "success"}
          disabled={room.pending}
          onClick={() => room.send("player.ready", { ready: !me.ready })}
          aria-pressed={me.ready}
        >
          {me.ready ? "Not ready yet" : "I'm ready"}
        </Button>
        {isHost && (
          <Button size="lg" block disabled={!bothReady || room.pending} onClick={() => room.send("match.start")}>
            Start game
          </Button>
        )}
        <p className="text-center text-sm font-semibold text-muted" role="status">
          {startHint}
        </p>
      </div>
    </div>
  );
}

function SettingItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-muted">{label}</dt>
      <dd className="text-base font-extrabold">{value}</dd>
    </div>
  );
}
