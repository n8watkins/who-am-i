// Party kit: keeps a phone's screen on while a game is on screen.
// Game-agnostic: it knows nothing about rooms or rules, so any game in the collection can use it.
//
// Browsers drop a screen wake lock whenever the page is hidden (tab switch, screen lock), so the
// controller asks again each time the page becomes visible. Browsers without the Wake Lock API,
// or ones that refuse it (battery saver, an iframe policy), are a silent no-op.
import { useEffect } from "react";

export class WakeLockController {
  private sentinel: WakeLockSentinel | null = null;
  private running = false;
  private requesting = false;

  constructor(private readonly doc: Document = document, private readonly nav: Navigator = navigator) {}

  /** True while the browser holds a screen wake lock for this page. */
  get held(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.doc.addEventListener("visibilitychange", this.onVisibility);
    void this.acquire();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.doc.removeEventListener("visibilitychange", this.onVisibility);
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) sentinel.release().catch(() => undefined);
  }

  private readonly onVisibility = () => {
    if (this.doc.visibilityState === "visible") void this.acquire();
  };

  private async acquire(): Promise<void> {
    const api = this.nav.wakeLock;
    if (!api || !this.running || this.requesting || this.held || this.doc.visibilityState !== "visible") return;
    this.requesting = true;
    try {
      const sentinel = await api.request("screen");
      if (this.running) this.sentinel = sentinel;
      else sentinel.release().catch(() => undefined);
    } catch {
      // Refused or unavailable right now: the screen just dims as usual.
    } finally {
      this.requesting = false;
    }
  }
}

/** Holds a screen wake lock while `active` is true and the page is visible. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const controller = new WakeLockController();
    controller.start();
    return () => controller.stop();
  }, [active]);
}
