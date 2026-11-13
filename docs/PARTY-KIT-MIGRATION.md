# Moving Who Am I? onto the shared party kit

Written 2026-11-12 against `main` at `24a5fec` (v0.3.0, live at https://whoami.n8builds.dev) and the party kit in `n8watkins/n8-party-games` at `0a4af80`.
Updated the same day after two steps on the Who Am I? side, checked against the kit at `088d609` (the party room, first playable version):

- GitHub sign-in and the difficulty recording are gone (PR #45), so the game has no accounts and writes nothing to D1 during play.
- The rules sit behind one adapter, `src/party/game.ts`, in the shape the kit will need (step 2 below, done).
  The game's own room already calls the engine only through it.

This is still a plan for the rest: nothing has moved onto the kit.
The move is not clean, because the kit is built for real-time games with bots and Who Am I? is a turn-based, two-human game whose core rule is secrecy.
It needs kit changes first, and those belong in `n8-party-games`, where the shared lobby is being built in parallel.

## The goal

- Who Am I? stays playable on its own site, and can also be attached to the party room as one of its games.
- It becomes a game repository like `n8watkins/cork-and-bell`: clone, `npm install`, `npm run dev`, play.
- It takes the kit as a pinned git dependency (`"n8-party-games": "github:n8watkins/n8-party-games#<tag>"`, `.npmrc` already has `allow-git=root`).
- It exports `game` and `manifest` from its package's `.` export, per `party-kit/GAME-CONTRACT.md`, so the party site can list and host it.

## Where Who Am I? stands

- Public repository, MIT license (Nathan Watkins, 2026), default branch `main`.
- Live on a Workers custom domain, `whoami.n8builds.dev`, Worker `who-am-i-game`.
- Stack: TypeScript, React 19, Vite, Tailwind, Zod, one Worker with three Durable Object classes (`RoomDurableObject`, `RateLimiterDurableObject`, `PinDirectoryDurableObject`) and a D1 database (`who-am-i`).
- D1 holds `share_cards` (shared result images, 90-day expiry), which every `/s/<id>` link depends on.
  It also still holds the unused `users` and `identity_plays` tables; dropping them is an owner decision.
- One secret by name: `SESSION_SECRET` (signs room sessions; local runs make their own).
- Tests: lint, typecheck, Vitest in the Workers runtime and, for the adapter, in plain Node, and a Playwright suite that records every HTTP body and WebSocket frame to prove a player never receives their own identity.

## The adapter

`src/party/game.ts` is a thin wrapper over the engine (`src/worker/engine.ts`) and the per-player views (`src/worker/view.ts`), which it does not change.
It imports nothing from Cloudflare or from the room: lint enforces that, it typechecks under plain Node types, and `test/party/game.test.ts` runs in a plain Node Vitest project.
It has two layers:

- `rules` addresses players by id and returns new states.
  `RoomDurableObject` reaches the engine only through it, so the live site and the existing Worker and E2E suites exercise it.
- `game` addresses players by the party room's seat numbers and keeps its state in a holder the room may mutate, as the kit's games do.

| `game` member | What it does |
| --- | --- |
| `id`, `minSeats: 2`, `maxSeats: 2` | As the contract asks. |
| `tickHz: 0`, `bots: false`, `reconnectGraceMs: Infinity`, `idleShutdownMs` and `staleRoomMs` (an hour), `privateSeed: true`, `screens: true` | What the game asks of the room (KR-1, KR-2, KR-4, KR-6). The kit reads none of these yet. |
| `settings(value)` | Checks the host's settings, defaults when missing (KR-8). |
| `create({ seats, settings, now, carry })` | Starts a match at once with exactly two seats, both connected. The lower seat is the match's host (the one who may confirm their own guess when the other phone has been gone 30 seconds). With a carry from the same two seats it is a rematch: the loser guesses first and the last match's identities stay out of the draw. Identities come from `crypto.getRandomValues`, never from the room's seed. |
| `input(state, seat, command, now)` | `{ok: true, duplicate}` or `{ok: false, error, message}` (KR-7). Commands are the existing Zod-checked ones with `commandId` and `expectedVersion`; lobby, settings, seat and rematch commands are refused, because the room owns those. A turn whose deadline has passed ends first. |
| `snapshot(state, now, viewer)` | `viewer` is `{role: "player", seat}` or `{role: "screen"}` (KR-1). A player gets the existing filtered view; a screen, or a seat not in the game, gets turn, timer and question count only, never an identity, hint or question. |
| `nextDeadline(state)`, `tick(state, now)` | The turn deadline for the room's alarm, and the timeout at it (KR-2). `tick` returns `[{k: "timed_out", seat}]` or nothing. |
| `presence(state, seat, {connected, away}, now)` | Pauses the timer and counts towards the host override (KR-4, KR-5). Returns whether anything changed. |
| `isOver`, `result`, `standings` | Over at the match summary. Places for the night score: the winner first, both first after a tie. The result names no identity. |
| `carry(state)` | What a rematch between the same two seats starts from (KR-8). Server-only: it lists identity ids. |
| `serialize`, `restore` | Plain JSON, saved after every input (KR-3). |

`manifest` is `{id: "who-am-i", name: "Who Am I?", blurb, path: "/who-am-i/", players: {min: 2, max: 2, solo: false}, devices: {phone: true, desktop: true, sharedScreen: true, sideways: false}, public: []}`.
`sharedScreen: true` means a big screen may join; the adapter makes sure it only ever sees turn, timer and question count.
`public` stays empty until the client is packaged for the party site (steps 5 and 7).

## Where the kit and the adapter disagree

Checked against `party-kit/GAME-CONTRACT.md` and `lobby/server/lobby-core.js` at `088d609`.
Each line is something the kit has to add or change; the adapter does not work around any of them.

1. **`create`.** The party room calls `create({seed, seats, now, round})`; the adapter needs `settings` and `carry` as well (KR-8) and ignores `seed`.
   `seats` already has the right shape (`{seat, name, kind, colour}`).
2. **`input`.** The room ignores what `input` returns and answers nobody; the adapter returns ok or an error for the sender (KR-7).
   The room also drops input from a seat whose socket is closed, which is fine.
3. **`snapshot`.** The room sends one `game.snapshot(state, now)` to every socket, and `start` carries it too; the adapter needs the viewer, and must be called once per socket (KR-1).
   The room view still carries the room's `seed` to every client (`seed: this.seed` in the room view); it must stay out of it, or a game that drew from it would leak (KR-1).
4. **Ticks.** In a game the room ticks at `tickHz` and is billed for all of it; `tickHz: 0` has no meaning yet.
   The room needs to sleep between inputs and wake at `game.nextDeadline(state)` (KR-2).
5. **Bots and drops.** The room hands a dropped seat to `game.bot` and has no presence hook; the adapter has no bot and needs `presence` with `connected` and `away` (KR-4, KR-5).
6. **Saving.** "A game in progress is not saved": a restart sends everyone back to the lobby, which would end a 10 to 30 minute match (KR-3).
7. **Settings and carry.** The vote starts the game with no settings step and nothing carried from the last round (KR-8, and the phone section below).
8. **Lifetimes.** The party room closes a quiet room after its stale limit and any room after 4 hours; a match with two locked phones needs about an hour of quiet (KR-6).
9. **Exactly two players.** The party room starts a game with every member present, and the game's box lights only when the party has 2 to `players.max`.
   A party of three or more could never pick Who Am I?.
   **New, KR-12:** let a game for fewer players than the party be started with chosen seats (the two who want to play, or two picked by the room), while the others watch as screens.
10. **Ending early.** "A game runs to its end", but a player can leave the party.
    With no bots, a two-player match whose other player has left cannot end.
    **New, KR-13:** the room ends a game whose seats fall below `minSeats` (or calls an optional `game.abandon(state, seat, now)`), with no standings or with the game's.
11. **Holding the phone upright.** `devices.sideways` is `"preferred"`, `"required"` or `false`, and the party room itself is held sideways ("Turn your phone sideways to see the whole room").
    There is no way to say a game wants the phone upright, so the room cannot ask for the turn on the way in and back on the way out.
    **New, KR-14:** `devices.upright: true` (or `orientation: "portrait"`), which the room uses for both prompts (see the phone section below).
12. **The game's view on the room's page.** The contract proposes `mount(container, {room, you, snapshot})` named in the manifest (`lobby.view`), but it is not built (KR-10).
    `you` is already `{role, seat}`, which matches the adapter's viewer.
13. **Routes and data.** The party site still cannot serve a game's own routes: Who Am I? needs `/api/packs`, `/api/share/*`, `/s/<id>`, `/api/version` and its D1 database for shared cards (KR-9).

## Why the kit does not fit yet

| Who Am I? needs | The kit today |
| --- | --- |
| Each player gets a different view: the opponent's identity, never their own. | Every socket gets the same `game.snapshot(state)` and the same events. A shared screen sees everything. |
| A match of 10 to 30 minutes of talking, with the room asleep between taps and an alarm only for the turn timer. | A round runs a `setInterval` at `tickHz` (default 30) for its whole length, and the room stays awake and is billed the whole time. Clients ping every 2 seconds during a round. |
| A match survives the object being evicted or a deploy: every command is saved before it is acknowledged. | A round in progress lives in memory only. |
| Two humans, always. Nobody can stand in: a bot cannot see your identity and answer your questions. | Empty seats are filled with bots at the start, and a dropped player is replaced by a bot at once. |
| A dropped or locked phone keeps its seat; the turn timer pauses; after 30 seconds the host may confirm their own guess. | The seat is held for 30 seconds, then the bot keeps it for good. |
| "Away": the socket is open but the page is hidden (phone locked). | `away` means "a bot is standing in"; no hidden-page signal. |
| A room lives an hour without activity, so two locked phones do not lose the game. | An empty room closes after 1 minute, a quiet one after 10. |
| Commands are validated, answered (ok or a clear error), idempotent by command id, and checked against the state version (409 with the right state). | `in {d}` is fire and forget: no reply, no error, no retry safety. |
| The host picks settings (category, mode, timer, questions, hints, difficulty, who starts, match length), and "Change settings" returns there after a match. | `create({seed, seats, now, round})` takes no settings, and there is no way back to the lobby after a round. |
| A rematch avoids the last match's identities and lets the loser start. | Each round's `create` starts from nothing. |
| Identities are drawn with `crypto.getRandomValues`. | The room's `seed` is sent to every client in the room view. If identities were drawn from it, anyone could work out their own from the public repository's content. |
| Host tools: remove a player, New PIN, the PIN kept alive while the host's lobby is open. | Add or remove a bot; the PIN is fixed for 15 minutes. |
| Its own HTTP routes: `/api/packs`, shared result cards (`/api/share`, `/s/:id`) and `/api/version`. | A host serves only `/api/party/*` and the game's static files; the contract has no routes, bindings or secrets for a game. |
| Its own React lobby with category art, settings and invite (QR, link, PIN, code). | `mountLobby` "is the only join flow; games do not build their own". |
| A seat survives closing the tab (session in `localStorage`). | The token is in `sessionStorage`. |

## Kit change requests

These are for `n8watkins/n8-party-games` (party kit).
KR-1 to KR-8 block running Who Am I? on the kit at all.
KR-9 and KR-10 block the party site hosting it.
KR-12 to KR-14 block attaching it to the party room.
KR-11 is optional.

1. **KR-1 Per-seat views.** Let a game shape what each socket receives: `game.snapshot(state, now, viewer)` with `viewer` = `{role: "player", seat}` or `{role: "screen"}`, used for `hello`, `start`, `snap` and `end`, and events filtered the same way (for example `tick` and `input` events carrying an optional `to: seat`).
   A screen, and a member who joined after the game started, is sent the screen view.
   Add an option to keep the room seed out of the room view (`game.privateSeed: true`), or stop sending it; the party room's view sends it today.
2. **KR-2 Turn-based rounds with no tick loop.** With `tickHz: 0`, the room runs no interval: it applies each input at once, sends fresh snapshots and goes back to sleep.
   A `game.nextDeadline(state)` puts the turn timer on the alarm, and the alarm calls `game.tick(state, now)`.
   In this mode the client pings only for liveness (or uses the runtime's auto-response, as Who Am I? does with `setWebSocketAutoResponse`), and the room budget counts only real wake time.
   Without this, one Who Am I? match keeps a room awake for its whole length and spends the shared room budget fast.
3. **KR-3 Saved rounds.** A turn-based round is saved after every input and restored on wake (`game.serialize` and `game.restore`, or plain JSON state), so a match survives eviction and deploys.
4. **KR-4 Humans only.** `game.bots: false`: no bots fill seats, start needs `minSeats` connected humans, and a dropped player keeps the seat (no stand-in) for a game-chosen grace (`game.reconnectGraceMs`, Infinity for "while the room lives").
   The game hears about it through `game.presence(state, seat, {connected, away}, now)`, so it can pause the timer and allow the host override.
5. **KR-5 Away presence.** Accept `away` and `back` from the client (Who Am I?'s `src/kit/shared/presence.ts` and `src/kit/client/visibility.ts` can move into the kit as they are), show it on the seat, and pass it to the game.
   Rename the seat's current `away` (a bot is standing in) to something like `standIn`, so the two do not clash.
6. **KR-6 Room lifetimes per game.** `game.idleShutdownMs` and `game.staleRoomMs`, defaulting to today's values.
   Who Am I? needs about an hour.
7. **KR-7 Answered inputs.** `game.input` may return `{ok: false, error, message}`; the room answers the sender (`ack {id}` or `error {id, error, message}`), drops a repeated input id instead of applying it again, and `PartyClient.sendInput` returns a promise.
   After every input, answered either way, the room sends fresh snapshots: an input can end a timed-out turn before it is refused.
   Who Am I?'s double-tap safety (a guess is confirmed and scored once) depends on this.
8. **KR-8 Settings, carry and the way back to the lobby.** The host sets a game's settings in a short step after the vote (checked by `game.settings(v)`), and `create` receives them.
   `create` also receives what the last match between the same seats left behind (`game.carry(state)`), so a rematch can avoid repeats and let the loser start.
   On a game's own site: the joiner's preview shows the settings, the host may send the room back to the lobby after a round (`toLobby`), and the host tools stay (remove a player, New PIN, a PIN that stays alive while the host's lobby is open).
9. **KR-9 Game routes and data in the contract.** An optional `api(request, env, ctx)` export for `/api/<id>/*` (or `/<path>api/*`), and `manifest.bindings` (a D1 database and its migrations folder).
   Without it the party site cannot serve packs, shared result cards or `/s/<id>` links.
   With sign-in and the difficulty recording gone, Who Am I? needs no secrets and no round-end hook from the kit.
10. **KR-10 A game's own lobby and view.** Build the proposed `mount(container, {room, you, snapshot})` view hook with the module named in the manifest, or allow a game to draw its own waiting room on `PartyClient` (the contract's "only join flow" rule today).
    Agree a join link the game can keep: the kit uses `<path>?join=<PIN>`, Who Am I? uses `/r/<code>` and `/join`.
    Let the client keep its session in `localStorage` (`new PartyClient({storage: "local"})`).
11. **KR-11 Phone comforts (optional).** Who Am I?'s `src/kit` was written for the collection and is free of Who Am I? code: screen wake lock, sound and haptics, light and dark themes, `/api/version`, the footer and shared result cards on D1.
    They could move into the kit for every game.
12. **KR-12 Games for fewer players than the party.** Let the room start a two-player game with two chosen seats while the rest of the party watches as screens, instead of with every member present.
13. **KR-13 Ending a game early.** When a game's seats fall below `minSeats` for good (a player left the party), the room ends it, optionally through `game.abandon(state, seat, now)`, and everyone goes back to the lobby.
14. **KR-14 Upright games.** `devices.upright: true` (or `orientation: "portrait"`), so the room can ask for the phone to turn upright when such a game starts and sideways again when it ends.

## The language question

The contract says a game's server code is "plain JavaScript" with no kit import, and the package's `.` export is `party.js`.
Who Am I? is TypeScript, with Zod checking every command and setting; the adapter imports the engine, the views, the content and `src/shared/protocol.ts`, all TypeScript.

Recommendation: let the contract accept TypeScript source for a game's server code, exported as `party.ts`, and keep every other rule (no kit import, nothing served but `public`).
Wrangler's esbuild, Vite and Vitest all compile TypeScript from a dependency with no setup, so the party site needs no build step for it, and the rule that matters, one copy of the kit in a site's bundle, is unchanged.
The other way, committing a built `party.js` next to the source, keeps the contract as it is but adds a build output that can drift from the source, and the contract bans a `prepare` script that could rebuild it on install.
If the owner wants the contract to stay JavaScript, choose the committed build, with a CI check that it matches the source.

## On the phone during a match in the party room

The party room is held sideways; a match of Who Am I? is played upright.

- **Choosing it.** When Who Am I? wins the vote, the room does not start it straight away.
  The two players' phones show a short settings step, with the host's choices (category, mode, timer, questions, hints, difficulty, who starts, points or rounds) and a Start button; everyone else's phone shows "Choosing settings" (KR-8, KR-12).
- **Going in.** Starting the match asks both players to turn their phone upright, with a picture of a phone turning, and the match screen appears once the phone is upright (KR-14).
  A phone that stays sideways still works, with the same screen letterboxed in the middle.
- **During the match.** Each phone shows the other player's identity (name and category), the answer buttons (Yes, No, Sort of, Don't know) when a question is waiting, and the guesser's own controls (ask, hint, I guessed it, pass, give up) on their turn.
  A phone never shows its own player's identity; the wake lock keeps the screen on, and a locked phone shows as "stepped away" on the other one and pauses the timer.
- **The big screen.** The room's screen shows only whose turn it is, the timer and the question count, and "Checking a guess" while a guess waits for confirmation.
  It never shows an identity, a hint or a typed question, so it can sit in front of both players.
  Everyone else in the party watches the same: their phones get the screen view.
- **Coming out.** At the match summary the phones show the result and both identities, and the room asks for the phone to turn sideways again before everyone is back in the room, with the points on the Tonight board.

## What Who Am I? would gain, lose or change

- Gains: no `SESSION_SECRET` (kit tokens need no signing key), the kit's origin check and Turnstile option, the room budget, and one room implementation to maintain instead of two.
- Loses or changes: the HTTP command API becomes socket inputs (KR-7 keeps the safety); signed sessions become kit tokens, so open rooms end at the switch; room links move from `/r/<code>` to the kit's join link; the 6-character code alphabet and rate limits become the kit's; the site moves from `/` to `/who-am-i/` (the root redirects, as Cork & Bell's does).
- Must keep: the secrecy rules and the E2E capture that proves them (extended to `/api/party/*` and the kit's frames), `check-bundle.mjs`, the adapter's secrecy tests, the D1 data and every `/s/<id>` link already shared.
- Risk to watch: the room budget answers `battles_full` once the shared allowance is spent, which would stop new Who Am I? rooms on its own site too.
  Who Am I? has no solo mode to fall back on, so the owner should decide whether its own site runs with a budget.

## Steps, once the kit has KR-1 to KR-8

All of this happens on a branch (`feat/party-kit`, worktree `~/worktrees/who-am-i-feat-party-kit`) and changes nothing live.

1. Pin the kit tag in `devDependencies`, as Cork & Bell does, and keep `.npmrc`.
2. ~~Write the game adapter (`src/party/game.ts`).~~ Done: see "The adapter" above.
   The engine (`src/worker/engine.ts`) and its tests stay as they are.
3. Export `game` and `manifest` from the package's `.` export (`party.ts` or a built `party.js`, per the language question).
4. Rewrite `src/worker/index.ts` around `handlePartyApi` and `createPartyRoom(game)`, with Who Am I?'s own routes (KR-9) beside it, and move `wrangler.jsonc` to the kit's bindings with a `local` environment, keeping the `DB` binding.
5. Point the client at `/party-kit/client/party-client.js` (a Vite external), set Vite's `base` to `/who-am-i/`, and swap `src/client/lib/api.ts` and `useRoom.ts` for a small wrapper around `PartyClient`.
6. Port the tests: engine, view, content, adapter and share-card tests stay; `test/worker.test.ts` and `test/pin-directory.test.ts` move to the kit's API or are dropped where the kit's own tests cover them; the E2E suite keeps every scenario and the secrecy capture, on the new paths.
7. Add a README section on running it alone, check the MIT license and the `files` list, run the full suite and a two-phone playtest, and open a PR.
8. Try it on the party site locally (add it to the games list on a scratch branch), with KR-12 to KR-14 in place.

## Going live (owner only, later)

- The live Worker keeps its name and custom domain.
- The deploy adds the kit's classes and retires the three old ones in a Durable Object migration; rooms open at that moment end, so it should go out at a quiet time.
- D1 is untouched, and `/s/<id>` and `/api/share/*` keep answering.
- Rolling back means redeploying the previous commit with a migration that brings the old classes back (empty), so test the rollback on a preview Worker first.

## A cheaper first step

The party site could list Who Am I? as a link to `https://whoami.n8builds.dev` before any of this, if the contract gains `manifest.href` for games hosted elsewhere.
Who Am I? would then ship only its manifest, and nothing live would change.

## Decisions for the owner

1. Build KR-1 to KR-8 and KR-12 to KR-14 into the kit (turn-based, two-player support in the party room for every future game), or keep Who Am I? on its own room code and list it as a link.
2. Whether Who Am I?'s own site runs under the shared room budget.
3. Whether the kit's plain lobby replaces Who Am I?'s React lobby on its own site, or games may keep their own (KR-10).
4. Whether a game may ship TypeScript through its package export (recommended above).
5. Whether Who Am I?'s phone comforts move into the kit (KR-11).
6. Whether to drop the unused `users` and `identity_plays` tables from the live D1 database.
