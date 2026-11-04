import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { getIdentity } from "../src/worker/content";

/**
 * Records everything a player's browser receives, in arrival order: every HTTP response body,
 * every WebSocket frame, plus snapshots of the rendered HTML and localStorage.
 */
export class Capture {
  private seq = 0;
  private pending: Promise<void>[] = [];
  readonly items: { seq: number; kind: "http" | "ws" | "html" | "storage"; source: string; text: string }[] = [];

  constructor(readonly page: Page) {
    page.on("response", (response) => {
      const seq = this.seq++;
      this.pending.push(
        response
          .body()
          .then((body) => {
            this.items.push({ seq, kind: "http", source: response.url(), text: body.toString("utf8") });
          })
          .catch(() => undefined),
      );
    });
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const text = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
        this.items.push({ seq: this.seq++, kind: "ws", source: ws.url(), text });
      });
    });
  }

  /** The next sequence number; items recorded later have a higher number. */
  mark(): number {
    return this.seq;
  }

  async snapshot(label: string): Promise<void> {
    const html = await this.page.content();
    this.items.push({ seq: this.seq++, kind: "html", source: label, text: html });
    const storage = await this.page.evaluate(() => JSON.stringify({ ...localStorage }));
    this.items.push({ seq: this.seq++, kind: "storage", source: label, text: storage });
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** Items received in [from, to). */
  between(from: number, to: number) {
    return this.items.filter((i) => i.seq >= from && i.seq < to);
  }

  /** First item carrying the summary of `roundIndex`, i.e. the moment that round is revealed. */
  revealOf(roundIndex: number, after = 0) {
    return this.items
      .filter((i) => i.seq >= after && i.text.includes(`"roundSummary":{"roundIndex":${roundIndex},`))
      .sort((a, b) => a.seq - b.seq)[0];
  }
}

interface ViewLike {
  youId: string;
  roundSummary: { roundIndex: number; entries: { playerId: string; identity: { id: string; canonicalName: string } }[] } | null;
}

/** Reads the viewer's own identity for a round from the reveal message. */
export function ownIdentityFromReveal(text: string): { id: string; canonicalName: string } {
  const parsed = JSON.parse(text) as { view: ViewLike };
  const entry = parsed.view.roundSummary!.entries.find((e) => e.playerId === parsed.view.youId)!;
  return entry.identity;
}

/**
 * Asserts the player's own identity for `roundIndex` never reached their browser before the
 * round summary revealed it (searching from `windowStart`, e.g. the start of the match).
 * Returns how many items were checked.
 */
export async function assertNoLeakBeforeReveal(capture: Capture, roundIndex: number, windowStart: number): Promise<number> {
  // The reveal frame can land a moment after the DOM shows the summary on the other page.
  await expect
    .poll(async () => {
      await capture.settle();
      return !!capture.revealOf(roundIndex, windowStart);
    })
    .toBe(true);
  const reveal = capture.revealOf(roundIndex, windowStart);
  expect(reveal, `round ${roundIndex} reveal was captured`).toBeTruthy();
  const own = ownIdentityFromReveal(reveal!.text);
  const before = capture.between(windowStart, reveal!.seq);
  expect(before.length).toBeGreaterThan(0);
  for (const item of before) {
    const context = `${item.kind} ${item.source} (seq ${item.seq})`;
    expect(item.text.includes(own.id), `own identity id ${own.id} leaked in ${context}`).toBe(false);
    expect(item.text.includes(own.canonicalName), `own identity "${own.canonicalName}" leaked in ${context}`).toBe(false);
    const escaped = JSON.stringify(own.canonicalName).slice(1, -1);
    expect(item.text.includes(escaped), `own identity (escaped) leaked in ${context}`).toBe(false);
  }
  return before.length;
}

export async function newPlayer(browser: Browser, opts: { mobile?: boolean } = {}): Promise<{ context: BrowserContext; page: Page; capture: Capture }> {
  const context = await browser.newContext(
    opts.mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  const page = await context.newPage();
  const capture = new Capture(page);
  return { context, page, capture };
}

export async function createGame(
  page: Page,
  opts: { nickname: string; pack?: string; timer?: "Off" | "60 s" | "90 s"; rounds?: boolean; first?: "Me" | "My opponent" | "Random" },
) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
  await page.getByLabel("Your nickname").fill(opts.nickname);
  if (opts.pack) await page.getByTestId(`pack-${opts.pack}`).click();
  if (opts.timer) await page.getByRole("radio", { name: opts.timer, exact: true }).check();
  if (opts.rounds) await page.getByRole("radio", { name: /Best after/ }).check();
  // Tests default to the host going first so turn order is deterministic.
  await page.getByRole("radio", { name: opts.first ?? "Me", exact: true }).check();
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("room-code")).toBeVisible();
  const code = (await page.getByTestId("room-code").textContent())!.trim();
  const link = (await page.getByTestId("invite-link").textContent())!.trim();
  return { code, link };
}

export async function joinGame(page: Page, link: string, nickname: string) {
  await page.goto(link);
  await page.getByLabel("Your nickname").fill(nickname);
  await page.getByRole("button", { name: "Join game" }).click();
  await expect(page.getByTestId("room-code")).toBeVisible();
}

export async function readyAndStart(host: Page, guest: Page) {
  await host.getByRole("button", { name: "I'm ready" }).click();
  await guest.getByRole("button", { name: "I'm ready" }).click();
  const start = host.getByRole("button", { name: "Start game" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(host.getByTestId("opponent-identity")).not.toBeEmpty();
  await expect(guest.getByTestId("opponent-identity")).not.toBeEmpty();
}

export async function scoreOf(page: Page, seat: "A" | "B"): Promise<string> {
  return (await page.getByTestId(`score-${seat}`).locator(".text-3xl").textContent())!.trim();
}

/** Both players' identities for a round, read from the viewer's reveal message. */
function revealedPair(capture: Capture, roundIndex: number, windowStart: number) {
  const reveal = capture.revealOf(roundIndex, windowStart)!;
  const parsed = JSON.parse(reveal.text) as { view: ViewLike };
  const own = parsed.view.roundSummary!.entries.find((e) => e.playerId === parsed.view.youId)!.identity;
  const other = parsed.view.roundSummary!.entries.find((e) => e.playerId !== parsed.view.youId)!.identity;
  return { reveal, own: getIdentity(own.id), other: getIdentity(other.id) };
}

/**
 * Asserts each of the player's own hints for `roundIndex` reached their browser only after they
 * requested it (`requestMarks[k]` is the capture mark taken right before requesting hint k+1),
 * and unrequested hints never arrived before the reveal. Hint texts that also belong to the
 * opponent's identity are skipped, because the player legitimately sees the opponent's hints.
 */
export async function assertHintsOnlyAfterRequest(capture: Capture, roundIndex: number, windowStart: number, requestMarks: number[]): Promise<number> {
  await capture.settle();
  const { reveal, own, other } = revealedPair(capture, roundIndex, windowStart);
  let checked = 0;
  own.hints.forEach((hint, k) => {
    if (other.hints.includes(hint)) return;
    const until = requestMarks[k] ?? reveal.seq;
    for (const item of capture.between(windowStart, until)) {
      checked++;
      expect(item.text.includes(hint), `hint ${k + 1} "${hint}" arrived before it was requested (${item.kind} ${item.source})`).toBe(false);
      expect(item.text.includes(JSON.stringify(hint).slice(1, -1)), `hint ${k + 1} arrived early (escaped)`).toBe(false);
    }
  });
  return checked;
}
