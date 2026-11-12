# Moving Who Am I? onto the shared party kit

Written 2026-11-12 against `main` at `24a5fec` (v0.3.0, live at https://whoami.n8builds.dev) and the party kit in `n8watkins/n8-party-games` at `0a4af80`.
This is a plan, not a migration: no game code has moved.
The move is not clean, because the kit is built for real-time games with bots and Who Am I? is a turn-based, two-human game whose core rule is secrecy.
It needs kit changes first, and those belong in `n8-party-games`, where the shared lobby is being built in parallel.

## The goal

- Who Am I? becomes a game repository like `n8watkins/cork-and-bell`: clone, `npm install`, `npm run dev`, play.
- It takes the kit as a pinned git dependency (`"n8-party-games": "github:n8watkins/n8-party-games#<tag>"`, `.npmrc` already has `allow-git=root`).
- It exports `game` and `manifest` from its package's `.` export (`party.js`), per `party-kit/GAME-CONTRACT.md`, so the party site can list and host it.

## Where Who Am I? stands

- Public repository, MIT license (Nathan Watkins, 2026), default branch `main`, no open work besides a Dependabot PR.
- Live on a Workers custom domain, `whoami.n8builds.dev`, Worker `who-am-i-game`, serving commit `24a5fec`.
- Stack: TypeScript, React 19, Vite, Tailwind, Zod, one Worker with three Durable Object classes (`RoomDurableObject`, `RateLimiterDurableObject`, `PinDirectoryDurableObject`) and a D1 database (`who-am-i`).
- D1 holds `identity_plays` (difficulty measurements, no player data), `share_cards` (shared result images, 90-day expiry) and GitHub sign-in accounts.
- Secrets by name: `SESSION_SECRET` (signs room sessions; local runs make their own), `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (sign-in, not set up yet, so sign-in stays hidden).
- Tests: lint, typecheck, 137 Vitest tests in the Workers runtime, and a Playwright suite that records every HTTP body and WebSocket frame to prove a player never receives their own identity.

## Why the kit does not fit yet

| Who Am I? needs | The kit today |
| --- | --- |
| Each player gets a different view: the opponent's identity, never their own (`viewFor` in `src/worker/view.ts`). | Every socket gets the same `game.snapshot(state)` and the same events. A shared screen sees everything. |
| A match of 10 to 30 minutes of talking, with the room asleep between taps and an alarm only for the turn timer. | A round runs a `setInterval` at `tickHz` (default 30) for its whole length, and the room stays awake and is billed the whole time. Clients ping every 2 seconds during a round. |
| A match survives the object being evicted or a deploy: every command is saved before it is acknowledged. | A round in progress lives in memory only. |
| Two humans, always. Nobody can stand in: a bot cannot see your identity and answer your questions. | Empty seats are filled with bots at the start, and a dropped player is replaced by a bot at once. |
| A dropped or locked phone keeps its seat; the turn timer pauses; after 30 seconds the host may confirm their own guess. | The seat is held for 30 seconds, then the bot keeps it for good. |
| "Away": the socket is open but the page is hidden (phone locked). | `away` means "a bot is standing in"; no hidden-page signal. |
| A room lives an hour without activity, so two locked phones do not lose the game. | An empty room closes after 1 minute, a quiet one after 10. |
| Commands are validated, answered (ok or a clear error), idempotent by command id, and checked against the state version (409 with the right state). | `in {d}` is fire and forget: no reply, no error, no retry safety. |
| The host picks settings in the lobby (category, mode, timer, questions, hints, difficulty, who starts, match length), and "Change settings" returns there after a match. | `create({seed, seats, now, round})` takes no settings, and there is no way back to the lobby after a round. |
| A rematch avoids the last match's identities and lets the loser start. | Each round's `create` starts from nothing. |
| Identities are drawn with `crypto.getRandomValues`. | The room's `seed` is sent to every client in the room view. If identities were drawn from it, anyone could work out their own from the public repository's content. |
| Host tools: remove a player, New PIN, the PIN kept alive while the host's lobby is open. | Add or remove a bot; the PIN is fixed for 15 minutes. |
| Its own HTTP routes: `/api/packs`, shared result cards (`/api/share`, `/s/:id`), `/api/version`, `/api/me`, `/api/auth/*`, and a D1 write at each round's end. | A host serves only `/api/party/*` and the game's static files; the contract has no routes, bindings or secrets for a game. |
| Its own React lobby with category art, settings and invite (QR, link, PIN, code). | `mountLobby` "is the only join flow; games do not build their own". |
| A seat survives closing the tab (session in `localStorage`). | The token is in `sessionStorage`. |

## Kit change requests

These are for `n8watkins/n8-party-games` (party kit), after the lobby work on `feat/lobby` lands.
KR-1 to KR-8 block running Who Am I? on the kit at all.
KR-9 and KR-10 block the party site hosting it.
KR-11 is optional.

1. **KR-1 Per-seat views.** Let a game shape what each socket receives: `game.snapshot(state, now, viewer)` with `viewer` = `{role: "player", seat}` or `{role: "screen"}`, used for `hello`, `start`, `snap` and `end`, and events filtered the same way (for example `tick` and `input` events carrying an optional `to: seat`).
   Let a game refuse shared screens (`game.screens: false`).
   Add an option to keep the room seed out of the room view (`game.privateSeed: true`), or stop sending it.
2. **KR-2 Turn-based rounds with no tick loop.** With `tickHz: 0`, the room runs no interval: it applies each input at once, broadcasts what changed and goes back to sleep.
   A `game.nextDeadline(state)` puts the turn timer on the alarm, and the alarm calls `game.tick(state, now)`.
   In this mode the client pings only for liveness (or uses the runtime's auto-response, as Who Am I? does with `setWebSocketAutoResponse`), and the room budget counts only real wake time.
   Without this, one Who Am I? match keeps a room awake for its whole length and spends the shared 10% room budget fast.
3. **KR-3 Saved rounds.** A turn-based round is saved after every input and restored on wake (`game.serialize` and `game.restore`, or plain JSON state), so a match survives eviction and deploys.
4. **KR-4 Humans only.** `game.bots: false`: no bots fill seats, start needs `minSeats` connected humans, and a dropped player keeps the seat (no stand-in) for a game-chosen grace (`game.reconnectGraceMs`, Infinity for "while the room lives").
   The game hears about it through `game.presence(state, seat, {connected, away}, now)`, so it can pause the timer and allow the host override.
5. **KR-5 Away presence.** Accept `away` and `back` from the client (Who Am I?'s `src/kit/shared/presence.ts` and `src/kit/client/visibility.ts` can move into the kit as they are), show it on the seat, and pass it to the game.
   Rename the seat's current `away` (a bot is standing in) to something like `standIn`, so the two do not clash.
6. **KR-6 Room lifetimes per game.** `game.idleShutdownMs` and `game.staleRoomMs`, defaulting to today's 1 and 10 minutes.
   Who Am I? needs about an hour.
7. **KR-7 Answered inputs.** `game.input` may return `{ok: false, error, message}`; the room answers the sender (`ack {id}` or `error {id, error, message}`), drops a repeated input id instead of applying it again, and `PartyClient.sendInput` returns a promise.
   Who Am I?'s double-tap safety (a guess is confirmed and scored once) depends on this.
8. **KR-8 Room settings and the way back to the lobby.** The host sets game settings in the lobby (`settings {v}`, checked by `game.settings(v)`), the joiner's preview shows them, and `create` receives them.
   After a round the host may send the room back to the lobby (`toLobby`).
   `create` also receives what the last round left behind (`game.carry(state)`), so a rematch can avoid repeats and let the loser start.
   Host tools: remove a player (the token stops working and the old PIN refuses them), New PIN, and a PIN that stays alive while the host's lobby is open.
9. **KR-9 Game routes, data and secrets in the contract.** An optional `api(request, env, ctx)` export for `/api/<id>/*` (or `/<path>api/*`), `manifest.bindings` (a D1 database and its migrations folder), `manifest.secrets` (names only), and an optional `onRoundEnd(result, env)` hook for side effects such as `identity_plays`.
   Without it the party site cannot serve packs, shared result cards, sign-in or the difficulty data.
10. **KR-10 A game's own lobby.** Allow a game to draw its own waiting room on `PartyClient` (the contract's "only join flow" rule today), or give `mountLobby` a settings slot and a look Who Am I? can match.
   Agree a join link the game can keep: the kit uses `<path>?join=<PIN>`, Who Am I? uses `/r/<code>` and `/join`.
   Let the client keep its session in `localStorage` (`new PartyClient({storage: "local"})`).
11. **KR-11 Phone comforts (optional).** Who Am I?'s `src/kit` was written for the collection and is free of Who Am I? code: screen wake lock, sound and haptics, light and dark themes, `/api/version`, the footer and shared result cards on D1.
   They could move into the kit for every game.

The contract also needs a ruling on language: Who Am I? is TypeScript with Zod on the server.
Wrangler's esbuild and Vitest can take `.ts` from a dependency, so `party.js` could re-export TypeScript, or the game could commit a built `party.js`; the contract today says "plain JavaScript".

## What Who Am I? would gain, lose or change

- Gains: no `SESSION_SECRET` (kit tokens need no signing key), the kit's origin check and Turnstile option, the room budget, and one room implementation to maintain instead of two.
- Loses or changes: the HTTP command API becomes socket inputs (KR-7 keeps the safety); signed sessions become kit tokens, so open rooms end at the switch; room links move from `/r/<code>` to the kit's join link; the 6-character code alphabet and rate limits become the kit's; the site moves from `/` to `/who-am-i/` (the root redirects, as Cork & Bell's does).
- Must keep: the secrecy rules and the E2E capture that proves them (extended to `/api/party/*` and the kit's frames), `check-bundle.mjs`, the D1 data and every `/s/<id>` link already shared.
- Risk to watch: the room budget answers `battles_full` once the shared allowance is spent, which would stop new Who Am I? rooms on its own site too.
  Who Am I? has no solo mode to fall back on, so the owner should decide whether its own site runs with a budget.

## Steps, once the kit has KR-1 to KR-8

All of this happens on a branch (`feat/party-kit`, worktree `~/worktrees/who-am-i-feat-party-kit`) and changes nothing live.

1. Pin the kit tag in `devDependencies`, as Cork & Bell does, and keep `.npmrc`.
2. Write the game adapter (`src/party/game.ts`): `create` builds a `RoomState` from the seats and settings with the existing `createRoom` and `joinRoom`; `input` maps the seat to the player and calls `applyCommand`; `snapshot(state, now, viewer)` is `viewFor`; `nextDeadline` and `tick` call `nextDeadline` and `expireTurn`; `presence` calls `setPresence` and `setAway`; `isOver` and `result` come from the match summary.
   The engine (`src/worker/engine.ts`) and its 769-line test stay as they are.
3. Write `party.js` with `game` and the manifest:
   `id: "who-am-i"`, `name: "Who Am I?"`, `path: "/who-am-i/"`, `players: {min: 2, max: 2, solo: false}`, `devices: {phone: true, desktop: true, sharedScreen: false, sideways: false}`, no `scores`, and `public` naming the built client.
4. Rewrite `src/worker/index.ts` around `handlePartyApi` and `createPartyRoom(game)`, with Who Am I?'s own routes (KR-9) beside it, and move `wrangler.jsonc` to the kit's bindings with a `local` environment, keeping the `DB` binding.
5. Point the client at `/party-kit/client/party-client.js` (a Vite external), set Vite's `base` to `/who-am-i/`, and swap `src/client/lib/api.ts` and `useRoom.ts` for a small wrapper around `PartyClient`.
6. Port the tests: engine, view, content and share-card tests stay; `test/worker.test.ts` and `test/pin-directory.test.ts` move to the kit's API or are dropped where the kit's own tests cover them; the E2E suite keeps every scenario and the secrecy capture, on the new paths.
7. Add a README section on running it alone, check the MIT license and the `files` list, run the full suite and a two-phone playtest, and open a PR.
8. Try it on the party site locally (add it to `games.js` on a scratch branch); with one room class per site today, that needs the lobby's multi-game rooms first.

## Going live (owner only, later)

- The live Worker keeps its name and custom domain.
- The deploy adds the kit's classes and retires the three old ones in a Durable Object migration; rooms open at that moment end, so it should go out at a quiet time.
- D1 is untouched, and `/s/<id>` and `/api/share/*` keep answering.
- Rolling back means redeploying the previous commit with a migration that brings the old classes back (empty), so test the rollback on a preview Worker first.

## A cheaper first step

The party site could list Who Am I? as a link to `https://whoami.n8builds.dev` before any of this, if the contract gains `manifest.href` for games hosted elsewhere.
Who Am I? would then ship a `party.js` with only a manifest, and nothing live would change.

## Decisions for the owner

1. Build KR-1 to KR-8 into the kit (turn-based support for every future game), or keep Who Am I? on its own room code and list it as a link.
2. Whether Who Am I?'s own site runs under the shared room budget.
3. Whether the kit's plain lobby replaces Who Am I?'s React lobby, or games may keep their own (KR-10).
4. Whether a game may ship TypeScript through `party.js`.
5. Whether Who Am I?'s phone comforts move into the kit (KR-11).
