# Who Am I? and the shared party kit

Written 2026-11-12 against `main` at `24a5fec` (v0.3.0, live at https://whoami.n8builds.dev) and the party kit in `n8watkins/n8-party-games` at `0a4af80`, when it assumed the kit's own room would host the game.
Brought up to date on 2026-11-15 against the party room's turn-based stack in `n8-party-games` (#23 to #29, top branch `feat/party-room-away` at `907721a`), with a look at #30 (settings and a rematch carry), which is open beside it.

There are two moves, and they are now separate:

1. **Into the party room** (partygames.n8builds.dev): Who Am I? as one of the games a party votes for, played inside the party room.
   Built on branch `feat/party-room-game` (step W7).
   It needs nothing from this site's rooms and changes nothing here; it waits only on the party room's stack merging.
2. **This site onto the kit** (whoami.n8builds.dev running on `createPartyRoom` instead of its own rooms).
   Still a plan, and still blocked: the kit's own room does not run turn-based games, and the kit has no routes or data for a game.

## Where Who Am I? stands

- Public repository, MIT license (Nathan Watkins, 2026), default branch `main`.
- Live on a Workers custom domain, `whoami.n8builds.dev`, Worker `who-am-i-game`.
- Stack: TypeScript, React 19, Vite, Tailwind, Zod, one Worker with three Durable Object classes (`RoomDurableObject`, `RateLimiterDurableObject`, `PinDirectoryDurableObject`) and a D1 database (`who-am-i`).
- D1 holds `share_cards` (shared result images, 90-day expiry), which every `/s/<id>` link depends on.
  It also still holds the unused `users` and `identity_plays` tables; dropping them is an owner decision.
- One secret by name: `SESSION_SECRET` (signs room sessions; local runs make their own).
- No accounts and nothing written to D1 during play (PR #45).

## The layers

| Layer | File | Who uses it |
| --- | --- | --- |
| Rules engine | `src/worker/engine.ts` | Unchanged. Pure state machine. |
| Per-player views | `src/worker/view.ts` | Unchanged. The secrecy boundary. |
| Adapter, `rules` | `src/party/game.ts` | This site's room (`src/worker/room.ts`) reaches the engine only through it. |
| Adapter, `game` | `src/party/game.ts` | The kit's shape by seat number: settings, carry, viewer, presence. Kept for the kit's own room. |
| Party room game | `src/party/room-game.ts` | The party room. Built on the adapter's `game`. |
| Manifest | `src/party/manifest.ts` | Any host: id, path, players, devices, room view, settings fields, public files. |
| Package export | `party.ts`, built to `party.js` | A party site's `games.js`. |
| Room view | `src/party-view/`, built to `party-view/` | The party room's page mounts `party-view/view.js`. |

## Into the party room

### The game as built

| Contract member | What it does |
| --- | --- |
| `id`, `minSeats: 2`, `maxSeats: 2`, `tickHz: 0` | A turn-based game for exactly two humans; no `bot`. |
| `create({seed, seats, now, round, settings?, carry?})` | Starts the match at once with the party's two seats (cleaned to the game's nickname rule). `seed` is never read: the identities come from `crypto.getRandomValues` inside the game. `settings` default to first to 3; `carry` from the same two seats makes it a rematch. |
| `input(state, seat, data, now)` | The engine's own commands (with `commandId` and `expectedVersion`). `{ok: true, duplicate}` or `{ok: false, error, message}`. A turn whose deadline has passed ends first. Lobby, settings and rematch commands are refused. |
| `snapshot(state, now, viewer)` | A player in the match gets their own view, as on this site, plus `role`, `seat` and `match`. Everyone else (the screen, a watching member, anything unknown) gets whose turn, the timer and the question count. `{role: "audience"}` gets that and both identities. |
| `nextDeadline`, `tick` | The turn timer on the room's alarm; `tick` ends the turn as timed out and the next one sets its own deadline. Events: `{k: "timed_out", seat}`. |
| `presence(state, seat, {connected, away}, now)` | Pauses and resumes the timer, and counts towards the host override. Returns whether anything changed. |
| `abandon(state, seat, now)` | The player who stayed wins: `standings` with only them, `result` with `abandonedBy`, event `{k: "abandoned", seat}`. |
| `isOver`, `result`, `standings` | Over at the match summary. The result names no identity. A tie shares first place. |
| `settings(value)` | The clean choices with their defaults, or `{ok: false, error: "bad_settings", message}`. |
| `carry(state)` | The last match's identities (oldest dropped to stay under the room's 4 KB) and who lost. Server-only. |
| `serialize`, `restore` | The whole state as one string; `restore` refuses anything else. `input` is proved on `restore(serialize(state))`. |
| `reconnectGraceMs: Infinity`, `idleShutdownMs` and `staleRoomMs` an hour | A locked or dropped phone keeps its seat while the room lives; two quiet phones do not lose the match. |

`manifest` adds `lobby: {view: "party-view/view.js"}`, `settings` (the fields below) and `public: [{from: "party-view", to: "party-view"}]`.

The settings fields are the game's own choices with two changes: the match length is one field (`first_to_3`, the default, `first_to_5` and `rounds_10`), and who guesses first is not offered, because the party's host need not be playing; the first match starts with a random guesser and a rematch with the loser.
First to 3 is the adapter's, not the engine's: at the end of the round that reaches 3, the round's summary says the match is over, as the engine does at 5.

### What each device sees

| Who | Viewer the room passes | Sees |
| --- | --- | --- |
| A player's phone | `{role: "player", seat}` | The other player's identity, the questions and answers, the guesser's controls, hints, the log, the timer. Their own identity only in a finished round's summary. |
| The big screen | `{role: "screen"}` | Whose turn, the timer, the question count, "Checking a guess". |
| A member who is not playing | `{role: "screen", seat}` | The same as the screen. |
| An audience phone | `{role: "audience"}` (not sent by the room yet) | The screen's view and both identities. |

### The language decision

The plan recommended letting the contract accept TypeScript.
Checked on a scratch copy of the party site (not pushed) with Who Am I? as a pinned git dependency in its `games.js`:

- Vitest compiled the TypeScript export from `node_modules` and ran the party site's whole suite.
- esbuild, as wrangler uses it, bundled it.
- The party site's own build, `scripts/build-public.mjs`, which wrangler runs before every `dev` and `deploy`, imports `games.js` in plain Node, and Node refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). There is no flag for it.

Accepting TypeScript would mean running the party site's scripts under a TypeScript loader, a new dependency in another repository for one game.
So the package ships a committed, built `party.js` (Vite library mode, not minified, zod left as an import), and `npm run check:party`, which CI runs, rebuilds it and fails when the committed file differs.
With the built `party.js`, the scratch party site built its public files, bundled its Worker in a wrangler dry run, and passed its suite apart from three tests that expect Who Am I? to be an outside game (the wall's list of boxes, and "opens in 3" becoming "starts in 3").

### Change requests: what the party room now meets

| Request | Status in the party room (`907721a`) | By what name |
| --- | --- | --- |
| KR-1 Per-seat views | Met | `game.snapshot(state, now, viewer)` for every message with game state; events with `only`; the room's seed is never sent, and each game gets its own seed from the secure source. `privateSeed` is not needed. |
| KR-2 No tick loop | Met | `tickHz: 0`; `nextDeadline(state)` is the alarm and calls `tick` once; pages keep to the keep-alive (`turns: true`). |
| KR-3 Saved rounds | Met | `serialize` and `restore`, saved after every input and restored on wake; `input` sees `restore(serialize(state))`. |
| KR-4 Humans only | Met | A turn-based game is humans only (`bot` is never called); `reconnectGraceMs`, `Infinity` for "while the room lives"; `presence(state, seat, {connected, away}, now)`. The adapter's `bots: false` is not read. |
| KR-5 Away | Met | `away` and `back` on the socket, `away: true` on the member, and the room's page says it when hidden during a turn-based game. |
| KR-6 Lifetimes | Met | `idleShutdownMs` and `staleRoomMs`. |
| KR-7 Answered inputs | Met | `{ok: false, error, message}` from `input`; `in {d, id}`, answered `ack {id}` or `error {id, error, message}`; `id_reused`; `inputId()` in the view; `send(data, {id})` returns a promise. |
| KR-8 Settings and carry | Not on `907721a`; open in #30 | #30 adds `game.settings(value)` (returns the clean object), `manifest.settings` fields, a settings step after the vote, and `game.carry(state)` passed back as `create({carry})` for the same seats. The room game is written to that shape. "Back to the lobby" mid-game is not built. |
| KR-9 Routes and data | Not needed there | In the party room the packs ship in the package and there are no shared result cards; still needed to move this site onto the kit. |
| KR-10 A game's view | Met | `mount(container, {room, you, snapshot, send, inputId, now, inset, params})`, named by `manifest.lobby.view`. A game's own lobby on `PartyClient` and `localStorage` sessions are only for moving this site. |
| KR-11 Phone comforts | Not in the kit | The room view has no wake lock of its own yet; the frame allows one. |
| KR-12 Fewer players than the party | Not met | The game is started with every member present, so a party of three or more cannot pick Who Am I?. |
| KR-13 Ending early | Met | `abandon(state, seat, now)` returning `{standings, result, events}`, a note and `last.early`. |
| KR-14 Upright games | Not met | `devices.sideways` has no "upright". The view is letterboxed (below). |

### Where the contract did not fit, and what was done instead

1. **TypeScript.** The contract says plain JavaScript; the party site's build cannot load TypeScript from a package. A committed `party.js` with a check against its source (above).
2. **No `prepare` script.** The contract forbids one; release-kit adds `prepare` to every repository it manages (`git config core.hooksPath .githooks`), and its own README says why the kit has none.
   npm 12 on the party site holds it back with a warning ("install scripts blocked"), and the install works.
   It is left as it is; whether this repository drops it is an owner decision, since release-kit would add it back.
3. **Settings shape.** The adapter's `settings` returns `{ok: true, settings}`; #30 takes the returned object as the settings themselves.
   The room game returns the clean object, and declares `manifest.settings`, which #30 requires of a game with `settings`.
   On `907721a` neither is read, so every match is the defaults.
4. **First to 3.** Not an engine setting; done in the room game at the end of a round, the way the engine ends a match at 5.
5. **Who starts.** The game's own "host" and "opponent" choices have no meaning when the party's host may not be playing; not offered.
6. **The match's end.** The room unmounts the view and shows its own card right after the last snapshot, so the game's own match summary (rematch, share card) is never seen.
   The last round's reveal is: the match ends only when a player taps on from it.
7. **The rematch.** Only through the room's carry (#30). Without it, every match is a first match.
8. **A carry's size.** The room keeps at most 4 KB; a long match's identities can pass that, so the oldest are dropped.
9. **A party of three.** KR-12: the box stays dark. Who Am I? cannot be played by two of three.
10. **`create` that throws.** The room calls `create` without a guard; the box lights only for exactly two, so it should not happen, but what a room does with a throw there is not defined.
11. **The host override.** The engine's host is the lower seat, chosen by the adapter; the party room has no match host.
12. **A watcher's `you`.** A member who is not playing is `{role: "player", seat}` in `you` and a screen in the snapshot; the view goes by the snapshot's `role`.
13. **The audience.** The room has no audience role yet; the game has the view ready.
14. **Upright.** The game is designed for a phone held upright; the room is held sideways and cannot ask for the turn (KR-14).
15. **Wake lock and the other phone comforts** (KR-11) are this site's, not the kit's; the room view does not hold the screen on.
16. **The party site's tests** assume Who Am I? is an outside game: hosting it changes three of them.
17. **npm.** `npm install github:n8watkins/who-am-i#<commit>` over an existing git dependency was refused (`EALLOWGIT`, "non-root"); setting the commit in `package.json` and running `npm install` worked.

### The room view

The module the room mounts, `party-view/view.js`, is plain JavaScript (`src/party-view/public/view.js`, copied as it is).
It puts one frame in the container with the room view's page (`party-view/index.html`, built from `src/party-view/`), and hands the frame the room's context on its element, as Cork & Bell does.
The page draws the game's own screens, `Game` and `RoundSummary` from `src/client/screens`, over a small stand-in for this site's `RoomHandle` (`src/party-view/useParty.ts`): every command goes to the room as an answered input whose id is also the engine's `commandId`, a version conflict that did not change the game's position is sent again, as on this site, and buttons wait while a command is out.
The screen and a watcher get a plain card with whose turn, the timer and the question count.
Everything the view makes lives in the frame's document, so unmounting removes it all.
The frame is an upright column at most 480 CSS pixels wide, centred and letterboxed on a sideways phone, starting below the room's door button when it reaches that corner.

**What the upright switch should do for it** (KR-14, a later step in the party room): when a game that says it is upright starts, ask the phones to turn upright and give the view the whole upright screen, keep the door button in the corner it names in `inset`, and ask for sideways again at `end`.
The view needs no change for it: on an upright phone the column already takes the whole width.
The look is plain on purpose; the owner judges it in a preview.

### Secrecy in the party room

- `test/party/room-game.test.ts` drives the game through whole matches the way the room runs them: each input on `restore(serialize(state))`, kept unless refused with nothing changed, the alarm at the deadline, presence changes, and a player leaving.
  After every change it scans every snapshot and event sent to both players, the screen and a watcher: a player is never sent the identity they are guessing (its id, name or a long alias) or a hint for it they did not ask for before their round is over; the screen and a watcher are never sent an identity, a hint, a typed question or a log.
- `test/party-room/harness.test.ts` runs the built `party.js` in the party room's real room class with the fake runtime its own tests use, fetched at a pinned commit (`scripts/party-room-checkout.mjs`): a whole match with ids, a double tap, a refusal, the room rebuilt in the middle, the turn timer on the alarm with a page hidden and a phone dropped, and a player leaving.
  Every frame each socket is sent is checked as it is sent.
- `scripts/check-bundle.mjs` scans `party-view/` for every identity name and id, as it does this site's bundle.

Nothing of this was checked in a browser or on a phone.

### Steps left for the party room

1. Merge the party room's stack (#23 to #29), and #30 for settings and the rematch.
2. Merge `feat/party-room-game` here.
3. In `n8-party-games`: add `"who-am-i": "github:n8watkins/who-am-i#<commit>"` to `devDependencies`, import it in `games.js`, take it out of `OUTSIDE` in `lobby/wall.js`, and update the three wall tests.
4. Play it on two phones and a screen in the party room, and judge the room view's look in a preview.
5. Later: KR-12 (two of a larger party), KR-14 (upright), and an audience role.

## This site onto the kit

Unchanged from the first plan, with what the party room work settled:

- The kit's own room (`createPartyRoom`) still ticks every game on a timer and keeps a round in memory only ("do not give it a game with `tickHz: 0`").
  The turn-based logic is plain in `party-kit/src/core/turns.js`, `presence.js` and `answers.js`, so the kit's room can take it from the party room.
- KR-9 (a game's routes and its D1 data) is still needed for packs, shared result cards and `/s/<id>` links.
- KR-10's other half: this site's own React lobby and settings, or the kit's plain lobby; a join link the game can keep; sessions in `localStorage`.

### What this site would gain, lose or change

- Gains: no `SESSION_SECRET`, the kit's origin check and Turnstile option, the room budget, and one room implementation instead of two.
- Loses or changes: the HTTP command API becomes socket inputs (answered inputs keep the safety); signed sessions become kit tokens, so open rooms end at the switch; room links move from `/r/<code>` to the kit's join link; the site moves from `/` to `/who-am-i/`.
- Must keep: the secrecy rules and the E2E capture that proves them, `check-bundle.mjs`, the adapter's secrecy tests, the D1 data and every `/s/<id>` link already shared.
- Risk: the room budget answers `battles_full` once the shared allowance is spent, which would stop new rooms on this site too, and Who Am I? has no solo mode to fall back on.

### Going live (owner only, later)

- The live Worker keeps its name and custom domain.
- The deploy adds the kit's classes and retires the three old ones in a Durable Object migration; rooms open at that moment end, so it should go out at a quiet time.
- D1 is untouched, and `/s/<id>` and `/api/share/*` keep answering.
- Rolling back means redeploying the previous commit with a migration that brings the old classes back (empty), so test the rollback on a preview Worker first.

## Decisions for the owner

1. Whether this repository drops release-kit's `prepare` script, as the party kit's contract asks (the party site's install works with it, with a warning).
2. Whether the contract should say that a game ships built JavaScript (as here) or the party site's scripts should load TypeScript.
3. Whether a player who leaves should hand the win to the one who stayed (as built) or end the match with no points.
4. The room view's look, from a preview on a phone.
5. Whether this site moves onto the kit at all once KR-9 exists, and whether it runs under the shared room budget.
6. Whether to drop the unused `users` and `identity_plays` tables from the live D1 database.
