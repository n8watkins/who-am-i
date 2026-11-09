// Party kit: Auto / Light / Dark, as a small segmented control for a footer or menu.
import { useTheme, type ThemePreference } from "./theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex min-h-11 items-center rounded-full border border-line bg-card p-1" data-testid="theme-switch">
      {OPTIONS.map((option) => {
        const checked = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => setTheme(option.value)}
            className={`min-h-9 rounded-full px-3 text-xs font-extrabold transition ${checked ? "bg-brand text-white" : "text-muted hover:text-ink"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
