// Phone helpers for E2E tests: a fake Screen Wake Lock API and a controllable page visibility,
// so tests can lock and unlock a "phone" the way a real one hides and shows the page.
import type { BrowserContext, Page } from "@playwright/test";

export interface WakeLockStats {
  requests: number;
  releases: number;
  held: number;
}

declare global {
  interface Window {
    __wakeLock: WakeLockStats;
    __setVisibility: (state: "visible" | "hidden") => void;
  }
}

/**
 * Installs a fake `navigator.wakeLock` (or removes it with `supported: false`, or makes every
 * request fail with `refuse: true`) and makes `document.visibilityState` controllable. Hiding the
 * page releases held locks, as browsers do.
 */
export async function installPhoneMocks(context: BrowserContext, opts: { supported?: boolean; refuse?: boolean } = {}): Promise<void> {
  await context.addInitScript(
    ({ supported, refuse }) => {
      let visibility: "visible" | "hidden" = "visible";
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => visibility });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => visibility !== "visible" });
      const stats = { requests: 0, releases: 0, held: 0 };
      window.__wakeLock = stats;
      const sentinels = new Set<EventTarget & { released: boolean; release: () => Promise<void> }>();
      class FakeSentinel extends EventTarget {
        released = false;
        readonly type = "screen";
        onrelease: ((e: Event) => void) | null = null;
        async release() {
          if (this.released) return;
          this.released = true;
          sentinels.delete(this);
          stats.releases++;
          stats.held--;
          const event = new Event("release");
          this.dispatchEvent(event);
          this.onrelease?.(event);
        }
      }
      if (supported) {
        Object.defineProperty(Navigator.prototype, "wakeLock", {
          configurable: true,
          get: () => ({
            request: async () => {
              stats.requests++;
              if (refuse || visibility !== "visible") throw new DOMException("Refused", "NotAllowedError");
              const sentinel = new FakeSentinel();
              sentinels.add(sentinel);
              stats.held++;
              return sentinel;
            },
          }),
        });
      } else {
        delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock;
      }
      window.__setVisibility = (state) => {
        visibility = state;
        if (state === "hidden") for (const s of [...sentinels]) void s.release();
        document.dispatchEvent(new Event("visibilitychange"));
      };
    },
    { supported: opts.supported ?? true, refuse: opts.refuse ?? false },
  );
}

export function wakeLockStats(page: Page): Promise<WakeLockStats> {
  return page.evaluate(() => ({ ...window.__wakeLock }));
}

/** Hides or shows the page, like locking and unlocking the phone. */
export async function setVisibility(page: Page, state: "visible" | "hidden"): Promise<void> {
  await page.evaluate((s) => window.__setVisibility(s), state);
}
