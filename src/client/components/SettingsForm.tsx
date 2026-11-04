import type { ReactNode } from "react";
import { PACK_META, PACK_ORDER } from "../../shared/packs";
import { POINTS_TO_WIN, ROUNDS_PER_MATCH, type FirstPlayerOption, type Mode, type PlayerView, type Settings } from "../../shared/protocol";

export const MODE_LABELS: Record<Mode, { name: string; blurb: string }> = {
  twenty_questions: { name: "20 Questions", blurb: "Ask yes/no questions to figure out who you are." },
  describe_it: { name: "Describe It", blurb: "Your opponent gives clues without saying the name." },
};

export function matchLabel(settings: Settings): string {
  return settings.matchType === "points" ? `First to ${POINTS_TO_WIN} points` : `Best after ${ROUNDS_PER_MATCH} rounds`;
}

export const FIRST_PLAYER_LABELS: Record<FirstPlayerOption, string> = {
  host: "Me",
  opponent: "My opponent",
  random: "Random",
};

/** "Alice goes first", "You go first" or "Random: decided when the game starts" for the lobby. */
export function firstPlayerLabel(settings: Settings, players: PlayerView[], youId: string, hostId: string): string {
  const option = settings.firstPlayer ?? "random";
  if (option === "random") return "Random, decided when the game starts";
  const host = players.find((p) => p.playerId === hostId);
  const other = players.find((p) => p.playerId !== hostId);
  const starter = option === "host" ? host : other;
  if (!starter) return "Your opponent goes first";
  return starter.playerId === youId ? "You go first" : `${starter.nickname} goes first`;
}

export function timerLabel(settings: Settings): string {
  return settings.timerSeconds === 0 ? "No timer" : `${settings.timerSeconds} s turns`;
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2.5 text-sm font-extrabold uppercase tracking-wide text-muted">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Option({
  name,
  checked,
  onChange,
  children,
  testId,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      className={[
        "relative flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-3.5 py-2.5 transition",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
        checked ? "border-brand bg-brand-soft/60" : "border-line bg-white hover:border-brand/40",
      ].join(" ")}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-2xl opacity-0" />
      <span
        aria-hidden="true"
        className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${checked ? "border-brand bg-brand" : "border-line bg-white"}`}
      >
        {checked && <span className="size-2 rounded-full bg-white" />}
      </span>
      <span className="flex-1">{children}</span>
    </label>
  );
}

export function SettingsForm({ value, onChange }: { value: Settings; onChange: (next: Settings) => void }) {
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-7">
      <Group legend="Category">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {PACK_ORDER.map((id) => (
            <Option key={id} name="pack" checked={value.packId === id} onChange={() => set("packId", id)} testId={`pack-${id}`}>
              <span className="flex items-center gap-2 font-bold">
                <span aria-hidden="true">{PACK_META[id].emoji}</span>
                {PACK_META[id].name}
              </span>
              <span className="block text-sm text-muted">{PACK_META[id].description}</span>
            </Option>
          ))}
        </div>
      </Group>

      <Group legend="Mode">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((mode) => (
            <Option key={mode} name="mode" checked={value.mode === mode} onChange={() => set("mode", mode)}>
              <span className="font-bold">{MODE_LABELS[mode].name}</span>
              <span className="block text-sm text-muted">{MODE_LABELS[mode].blurb}</span>
            </Option>
          ))}
        </div>
      </Group>

      <Group legend="Turn timer">
        <div className="grid grid-cols-3 gap-2.5">
          {([0, 60, 90] as const).map((t) => (
            <Option key={t} name="timer" checked={value.timerSeconds === t} onChange={() => set("timerSeconds", t)}>
              <span className="font-bold">{t === 0 ? "Off" : `${t} s`}</span>
            </Option>
          ))}
        </div>
      </Group>

      <Group legend="Who goes first">
        <div className="grid grid-cols-3 gap-2.5">
          {(Object.keys(FIRST_PLAYER_LABELS) as FirstPlayerOption[]).map((option) => (
            <Option key={option} name="first" checked={(value.firstPlayer ?? "random") === option} onChange={() => set("firstPlayer", option)}>
              <span className="font-bold">{FIRST_PLAYER_LABELS[option]}</span>
            </Option>
          ))}
        </div>
        <p className="text-sm text-muted">After round 1, the first guesser alternates every round.</p>
      </Group>

      <Group legend="Match length">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Option name="match" checked={value.matchType === "points"} onChange={() => set("matchType", "points")}>
            <span className="font-bold">First to {POINTS_TO_WIN} points</span>
          </Option>
          <Option name="match" checked={value.matchType === "rounds"} onChange={() => set("matchType", "rounds")}>
            <span className="font-bold">Best after {ROUNDS_PER_MATCH} rounds</span>
          </Option>
        </div>
      </Group>
    </div>
  );
}
