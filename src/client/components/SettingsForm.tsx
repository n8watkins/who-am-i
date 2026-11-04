import type { ReactNode } from "react";
import { PACK_META, PACK_ORDER } from "../../shared/packs";
import { PackArt } from "./PackArt";
import { POINTS_TO_WIN, ROUNDS_PER_MATCH, type FirstPlayerOption, type Mode, type QuestionMode, type PlayerView, type Settings } from "../../shared/protocol";

export const MODE_LABELS: Record<Mode, { name: string; blurb: string }> = {
  twenty_questions: { name: "Ask", blurb: "You ask yes/no questions." },
  describe_it: { name: "Clues", blurb: "Your opponent describes you." },
};

export function matchLabel(settings: Settings): string {
  return settings.matchType === "points" ? `First to ${POINTS_TO_WIN} points` : `Best after ${ROUNDS_PER_MATCH} rounds`;
}

/** The room's settings as one line, for the lobby and join screens. */
export function settingsSummary(settings: Settings): string {
  const match = settings.matchType === "points" ? `First to ${POINTS_TO_WIN}` : `Best of ${ROUNDS_PER_MATCH}`;
  const timer = settings.timerSeconds === 0 ? "No timer" : `${settings.timerSeconds} s`;
  return [MODE_LABELS[settings.mode].name, match, timer, settings.hints === false ? "No hints" : "Hints on"].join(" · ");
}

/** The options behind More options, as one line. */
export function optionsSummary(settings: Settings): string {
  const match = settings.matchType === "points" ? `First to ${POINTS_TO_WIN}` : `Best of ${ROUNDS_PER_MATCH}`;
  const first = { host: "You start", opponent: "They start", random: "Random start" }[settings.firstPlayer ?? "random"];
  const timer = settings.timerSeconds === 0 ? "No timer" : `${settings.timerSeconds} s turns`;
  return [match, timer, settings.hints === false ? "No hints" : "Hints on", first].join(" · ");
}

export const QUESTION_MODE_LABELS: Record<QuestionMode, string> = { spoken: "Spoken", app: "In the app", both: "Both" };

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
        "relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 transition sm:gap-3 sm:px-3.5",
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

type SettingsProps = { value: Settings; onChange: (next: Settings) => void };

/** The category tiles: art and name, with Mixed as the wide first choice. */
export function PackPicker({ value, onChange }: SettingsProps) {
  return (
    <fieldset>
      <legend className="sr-only text-sm font-extrabold uppercase tracking-wide text-muted md:not-sr-only md:mb-2.5">Category</legend>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-2.5">
        {PACK_ORDER.map((id) => {
          const checked = value.packId === id;
          return (
            <label
              key={id}
              data-testid={`pack-${id}`}
              title={PACK_META[id].description}
              className={[
                "relative flex min-h-12 cursor-pointer items-center gap-2.5 rounded-2xl border-2 p-1.5 transition md:flex-col md:items-stretch md:p-2.5",
                id === "mixed" ? "col-span-2" : "",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                checked ? "border-brand bg-brand-soft/60" : "border-line bg-white hover:border-brand/40",
              ].join(" ")}
            >
              <input type="radio" name="pack" checked={checked} onChange={() => onChange({ ...value, packId: id })} aria-label={PACK_META[id].name} className="absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none opacity-0" />
              <PackArt pack={id} className="size-9 p-1 md:h-24 md:w-full md:p-2" />
              <span className="min-w-0 text-sm font-extrabold leading-tight">{PACK_META[id].name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Ask or Clues: how the guesser gets their information. */
export function StylePicker({ value, onChange }: SettingsProps) {
  return (
    <Group legend="How you play">
      <div className="grid grid-cols-2 gap-2.5">
        {(Object.keys(MODE_LABELS) as Mode[]).map((mode) => (
          <Option key={mode} name="mode" checked={value.mode === mode} onChange={() => onChange({ ...value, mode })}>
            <span className="font-bold">{MODE_LABELS[mode].name}</span>
          </Option>
        ))}
      </div>
      <p className="text-sm text-muted">{MODE_LABELS[value.mode].blurb}</p>
    </Group>
  );
}

/** Everything that has a good default. */
export function MoreOptions({ value, onChange }: SettingsProps) {
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-5">
      <Group legend="Turn timer">
        <div className="grid grid-cols-3 gap-2.5">
          {([0, 60, 90] as const).map((t) => (
            <Option key={t} name="timer" checked={value.timerSeconds === t} onChange={() => set("timerSeconds", t)}>
              <span className="whitespace-nowrap font-bold">{t === 0 ? "Off" : `${t} s`}</span>
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
      </Group>
      {value.mode === "twenty_questions" && (
        <Group legend="Questions">
          <div className="grid grid-cols-3 gap-2.5">
            {(Object.keys(QUESTION_MODE_LABELS) as QuestionMode[]).map((mode) => (
              <Option key={mode} name="questions" checked={(value.questions ?? "both") === mode} onChange={() => set("questions", mode)}>
                <span className="font-bold">{QUESTION_MODE_LABELS[mode]}</span>
              </Option>
            ))}
          </div>
        </Group>
      )}
      <Group legend="Hints">
        <div className="grid grid-cols-2 gap-2.5">
          <Option name="hints" checked={value.hints !== false} onChange={() => set("hints", true)}>
            <span className="font-bold">On</span>
          </Option>
          <Option name="hints" checked={value.hints === false} onChange={() => set("hints", false)}>
            <span className="font-bold">Off</span>
          </Option>
        </div>
      </Group>
      <Group legend="Match length">
        <div className="grid grid-cols-2 gap-2.5">
          <Option name="match" checked={value.matchType === "points"} onChange={() => set("matchType", "points")}>
            <span className="font-bold">First to {POINTS_TO_WIN}</span>
          </Option>
          <Option name="match" checked={value.matchType === "rounds"} onChange={() => set("matchType", "rounds")}>
            <span className="font-bold">Best of {ROUNDS_PER_MATCH}</span>
          </Option>
        </div>
      </Group>
    </div>
  );
}

export function SettingsForm(props: SettingsProps) {
  return (
    <div className="space-y-5">
      <PackPicker {...props} />
      <StylePicker {...props} />
      <MoreOptions {...props} />
    </div>
  );
}
