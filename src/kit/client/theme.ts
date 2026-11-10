// Party kit: light and dark themes. "system" (the default) follows the phone's setting live;
// "light" and "dark" are remembered per device. The resolved theme is written to
// <html data-theme="light|dark">, which the CSS tokens key off. public/theme-init.js applies the
// same choice before first paint, so there is no flash of the wrong theme.
import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "kit:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();
let preference: ThemePreference = readPreference();

function readPreference(): ThemePreference {
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) : null;
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

export function resolvedTheme(pref: ThemePreference = preference): "light" | "dark" {
  return pref === "system" ? (systemDark() ? "dark" : "light") : pref;
}

function apply(): void {
  const theme = resolvedTheme();
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode: the choice lasts for this page.
  }
  apply();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The saved preference, and a setter. Mounting it keeps "system" in step with the phone. */
export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const current = useSyncExternalStore(subscribe, () => preference, () => "system" as const);
  useEffect(() => {
    apply();
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(DARK_QUERY);
    const onChange = () => {
      if (preference === "system") apply();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return [current, setThemePreference];
}
