// A player must never be able to read their own name on their phone before the reveal, not even
// inside the name, picture or hints of the opponent they are looking at. Some names give another
// away: "Link from The Legend of Zelda" says "Zelda" to the player who is Princess Zelda, and a
// picture's address can carry a name too (Katniss Everdeen's was a file named after Jennifer
// Lawrence). This runs against the forced-deal Worker (./worker.ts), which deals the first pair
// the rules allow from a cut-down deck, so it plays exactly the round a real room would deal
// when the dice land that way, and reads each phone the way a curious player could: the page
// text, every picture and link address on it, and every message the server sent.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { normalizeName } from "../../src/worker/engine";
import { getIdentity } from "../../src/worker/content";
import { createGame, joinGame, newPlayer, ownIdentityFromReveal, startMatch, type Capture } from "../support";

type Player = { name: string; page: Page; capture: Capture };

/** Words too common to give a name away on their own. */
const COMMON = new Set(["the", "of", "a", "an", "and", "from", "in", "on", "to"]);

/** The words of a name and its aliases that would give it away, normalised. */
function telling(id: string): string[] {
  const identity = getIdentity(id);
  const words = [identity.canonicalName, ...identity.aliases].flatMap((n) => normalizeName(n).split(" "));
  return [...new Set(words)].filter((w) => w.length > 1 && !COMMON.has(w));
}

/** What a phone shows: its visible text, and every picture and link address on the page. */
async function phone(page: Page) {
  return page.evaluate(() => ({
    text: document.body.innerText,
    addresses: [
      ...Array.from(document.images).flatMap((img) => [img.src, img.alt]),
      ...Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href),
    ],
  }));
}

/** Everything the server told this phone about the round in play: the opponent's card and the turn log. */
function roundPayloads(capture: Capture, from: number, to: number): { source: string; text: string }[] {
  const out: { source: string; text: string }[] = [];
  for (const item of capture.between(from, to)) {
    if (item.kind !== "ws" && !(item.kind === "http" && item.source.includes("/api/"))) continue;
    try {
      const view = (JSON.parse(item.text) as { view?: { opponentIdentity?: unknown; turn?: unknown } }).view;
      if (view) out.push({ source: `${item.kind} ${item.source} #${item.seq}`, text: JSON.stringify({ opponentIdentity: view.opponentIdentity, turn: view.turn }) });
    } catch {
      // Not JSON: nothing about the round.
    }
  }
  return out;
}

const decoded = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** The telling words of `ownId` that `text` carries as whole words. */
function found(ownId: string, text: string, ignore: Set<string> = new Set()): string[] {
  const words = ` ${normalizeName(decoded(text))} `;
  return telling(ownId).filter((w) => !ignore.has(w) && words.includes(` ${w} `));
}

for (const { pack, label } of [
  { pack: "video-games", label: "Video Games (Link, Princess Zelda next in line)" },
  { pack: "mixed", label: "Mixed (Jennifer Lawrence, Katniss Everdeen next in line)" },
]) {
  test(`neither phone can read its own name before the reveal: ${label}`, async ({ browser }, testInfo) => {
    const hostP = await newPlayer(browser);
    const guestP = await newPlayer(browser, { mobile: true });
    const host: Player = { name: "Alice", ...hostP };
    const guest: Player = { name: "Bob", ...guestP };
    const { link } = await createGame(host.page, { nickname: host.name, pack });
    await joinGame(guest.page, link, guest.name);

    // What each phone shows before anything is dealt: the game's own words ("Copy link"), not a leak.
    const chrome = new Map<Player, Set<string>>();
    for (const p of [host, guest]) {
      const shown = await phone(p.page);
      chrome.set(p, new Set(normalizeName([shown.text, ...shown.addresses].map(decoded).join(" ")).split(" ")));
    }
    const starts = new Map<Player, number>([
      [host, host.capture.mark()],
      [guest, guest.capture.mark()],
    ]);
    await startMatch(host.page, guest.page);
    const shownInRound = new Map<Player, Awaited<ReturnType<typeof phone>>>();
    for (const p of [host, guest]) shownInRound.set(p, await phone(p.page));
    const shots = testInfo.outputPath();
    mkdirSync(shots, { recursive: true });
    await host.page.screenshot({ path: path.join(shots, `${pack}-host-in-round.png`), fullPage: true });
    await guest.page.screenshot({ path: path.join(shots, `${pack}-guest-in-round.png`), fullPage: true });

    // Both give up, and the reveal says who each player was.
    await host.page.getByRole("button", { name: "Give up" }).click();
    await expect(guest.page.getByRole("button", { name: "Give up" })).toBeVisible();
    await guest.page.getByRole("button", { name: "Give up" }).click();
    await expect(host.page.getByRole("heading", { name: "The big reveal" })).toBeVisible();
    await expect(guest.page.getByRole("heading", { name: "The big reveal" })).toBeVisible();

    const findings: { player: string; own: string; where: string; words: string[]; excerpt: string }[] = [];
    const dealt: Record<string, string> = {};
    for (const p of [host, guest]) {
      await expect.poll(async () => (await p.capture.settle(), !!p.capture.revealOf(1, starts.get(p)!))).toBe(true);
      const reveal = p.capture.revealOf(1, starts.get(p)!)!;
      const own = ownIdentityFromReveal(reveal.text);
      dealt[p.name] = own.canonicalName;
      const shown = shownInRound.get(p)!;
      const record = (where: string, text: string, ignore?: Set<string>) => {
        const words = found(own.id, text, ignore);
        if (words.length) findings.push({ player: p.name, own: own.canonicalName, where, words, excerpt: decoded(text).slice(0, 300) });
      };
      record("page text", shown.text, chrome.get(p));
      for (const address of shown.addresses) record("picture or link address on the page", address, chrome.get(p));
      for (const payload of roundPayloads(p.capture, starts.get(p)!, reveal.seq)) record(`server message (${payload.source})`, payload.text);
    }

    const evidence = { pack, dealt, findings };
    writeFileSync(path.join(shots, `${pack}-evidence.json`), JSON.stringify(evidence, null, 2));
    if (process.env.REPRO_DIR) {
      mkdirSync(process.env.REPRO_DIR, { recursive: true });
      writeFileSync(path.join(process.env.REPRO_DIR, `${pack}-evidence.json`), JSON.stringify(evidence, null, 2));
      await host.page.screenshot({ path: path.join(process.env.REPRO_DIR, `${pack}-host-reveal.png`) });
      for (const name of [`${pack}-host-in-round.png`, `${pack}-guest-in-round.png`]) {
        copyFileSync(path.join(shots, name), path.join(process.env.REPRO_DIR, name));
      }
    }
    await testInfo.attach("evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    expect(findings, `a phone could read its own name before the reveal: ${JSON.stringify(evidence, null, 2)}`).toEqual([]);
  });
}
