# Who Am I?

A fast, mobile-first, two-player party game.
Each player gets a secret identity (a famous person, a fictional character or a brand mascot).
You can see the identity your opponent is guessing, but never your own.
Take turns asking yes/no questions or giving clues until you work out who you are.

No account, no app install: one player creates a room, the other opens the invite link, and you are playing in under 30 seconds.

**Play it:** https://whoami.n8builds.dev

## How to play

1. One player taps **Create game**, picks a category, a mode, a turn timer, how questions are asked, hints on or off, who goes first and the match length, and enters a nickname.
2. The other player scans the QR code, opens the invite link, or types the 4-digit PIN or 6-character room code on their own phone, and joins.
3. The host taps **Start game**.
4. Each screen shows your opponent's character and "Your identity: Hidden".
5. On your turn, ask yes/no questions (**Ask**) or listen to your opponent describe you (**Clues**).
   With **Trade turns**, the default for Ask, each move is one question and one guess, and the first correct guess wins the round.
   With **Keep going**, your turn lasts until you get it or give up.
   Ask out loud, or send a question in the app: pick a suggested one or type your own, and your opponent answers on their phone with Yes, No, Sort of or Don't know.
   Both phones keep a log of the turn's questions and answers, and the top bar counts how many you have asked.
   Stuck? Tap **Get a hint** for up to three hints per turn, from vague to strong. Hints are free.
   When you think you know, say it out loud and tap **I Guessed It**.
6. Your opponent confirms the guess.
   A correct guess scores 1 point, a skip scores 0, and a timed-out turn counts as a skip.
7. When both players have had their turn, the round summary reveals both identities and shows how many hints each player used.
8. The match ends at **first to 5 points** or **best after 10 rounds**.
   When both players tap **Rematch**, the next match starts right away with the same settings and a fresh shuffle, and the loser goes first.
   **Change settings** returns to the lobby instead.

Who guesses first alternates every round.
The host picks who starts round 1 in the lobby: me, my opponent, or random.
A rematch avoids the identities from the previous match until the pack runs out.

The room setting **Questions** (Spoken, In the app, Both; default Both) controls which question controls appear, and **Hints** (On, Off; default On) controls the hint button.

See [ROADMAP.md](ROADMAP.md) for where the game could go next: online matchmaking, optional video chat and AI-written hints for custom packs.

Categories: Actors, Movie Characters, Historical Figures, Video Games, Brand Mascots, Anime & Cartoons, and Mixed (weighted from all of them).
Identities never repeat within a match until a pack runs out, at which point the game says "Pack exhausted, reshuffling".

## Local development

Requirements: Node.js 22 or newer.

```sh
npm install
npm run dev
```

`npm run dev` creates a `.dev.vars` file with a random local `SESSION_SECRET` (if it does not exist yet), builds the client and starts `wrangler dev` on http://localhost:8787.
`.dev.vars` is gitignored; see `.dev.vars.example`.

For hot reload of the UI, keep `wrangler dev` running and start Vite in a second terminal with `npm run dev:ui` (it proxies `/api` to Wrangler).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint (TypeScript, React hooks, and a rule that keeps client code from importing Worker modules) |
| `npm run typecheck` | `tsc` for the client, the Worker and the Node tooling |
| `npm test` | Vitest unit and integration tests, running inside the Workers runtime via `@cloudflare/vitest-plugin` |
| `npm run e2e` | Builds the client, checks the bundle for identity content, and runs Playwright against `wrangler dev` |
| `npm run deploy` | Builds, applies D1 migrations to the live database and deploys, stamping the commit into `/api/version` |
| `npm run build` | Builds the client, checks the bundle, and bundles the Worker with a Wrangler dry run |
| `E2E_BASE_URL=https://whoami.n8builds.dev npx playwright test acceptance` | Runs the acceptance scenario against a deployed Worker |
| `SCREENSHOTS=1 npx playwright test screenshots` | Regenerates `docs/screenshots` at 1280x800 and 390x844 (after `vite build`) |

## Tests

- **Unit tests** (`test/engine.test.ts`, `test/view.test.ts`, `test/content.test.ts`) cover the state machine transitions, turn order (alternation, the lobby setting, loser-first rematches and the tie rule), one-tap rematch, idempotency (duplicate confirm and skip clicks score once), version checks, the two-player cap, distinct and non-repeating draws, reshuffling, timer timeouts and pauses, the host override, hints, in-app questions and their rate limit, the per-player view filter, and the hint content rules.
- **Worker and Durable Object tests** (`test/worker.test.ts`) exercise the real HTTP API, signed sessions, WebSockets, rate limiting and alarms in `workerd`.
- **End-to-end tests** (`e2e/`) drive two separate browser contexts through the full acceptance scenario: create an Actors game, join by invite link, start, ask an in-app question, request hints, guess, confirm, skip, reveal, five rounds with alternating first guessers to a winner, then a one-tap rematch started by the loser.
  While doing so they record every HTTP response body and WebSocket frame each browser receives, plus the page HTML and localStorage, and assert that a player's own identity (name and id) never appears before the round summary, and that each hint arrives only after it was requested.
  Phone tests run at 390x844 with a fake Screen Wake Lock API and a controllable page visibility (`e2e/phone.ts`), so they can lock and unlock a "phone" the way a real one hides and shows the page.
  Other E2E tests cover joining by PIN in under 10 seconds with the same secrecy capture, the QR code, copy confirmations, New PIN, removing a player, in-app questions on both phones (including typed HTML shown as plain text), the Questions setting, the lobby turn-order picker, every main desktop screen fitting 1280x800 with no accessibility violations, refresh and reconnect restoring the right seat, a third browser being turned away, unknown room codes, a timed turn running out, and the socket handshake (no token in any address or header the browser sends, old header-form pages closed, out-of-date pages reloading only once).

## Secrecy model

Keeping your own identity secret is the core of the game, so it is enforced on the server, not the client.

- Identity content lives only in `src/worker/content` and is never imported by the client.
  ESLint forbids client imports from the Worker, and `scripts/check-bundle.mjs` fails the build if any identity name or id appears in the built client.
- The room's assignment map (player to identity) is private state in the Durable Object.
- Every payload sent to a browser is built by `viewFor(room, playerId)` in `src/worker/view.ts`.
  It contains the public room state plus only the identity your opponent is guessing.
  Your own identity is included only in the summary of a round that has already ended.
  An identity's picture is part of that identity in the view, so the same rule covers it: tests check that your own picture's address is in no HTTP response or socket frame you receive before the summary, and that your browser never loads it before then.
- Each WebSocket records its player in its attachment once its hello is accepted, and every broadcast is rendered separately per socket; a socket that has not said who it is gets nothing.
- Command responses and errors carry the same filtered view.
- Clients send commands, never identities or scores; the server ignores anything else.
- Hints are stored with each identity on the server.
  The server adds a hint to the turn log only when the guesser asks for it, one at a time, so unrequested hints never leave the Durable Object.
  A content test guarantees no hint contains any identity's name or alias, so neither your own hints nor your opponent's can spell out who you are.
- In-app questions are plain text (Zod-validated, at most 140 characters, rendered as text, never HTML) and rate limited per player.

### Sessions

Players are anonymous.
On create or join the Worker issues a token signed with HMAC-SHA256 (`SESSION_SECRET`), scoped to the room id, room code and player id.
The browser stores it in localStorage per room, so a refresh restores the same seat; it never contains identity data.
HTTP calls send it as `Authorization: Bearer`, a header Workers Logs redacts.

The token never goes in an address or in a WebSocket header, because Workers Logs keeps request addresses and headers.
The room socket handshake (`whoami.v2`) works like this:

1. The page opens `GET /api/rooms/:code/ws` with the subprotocol `whoami.v2`, which carries no secret.
2. The room accepts the socket as nobody's: its attachment says `playerId: null`, so it survives the room sleeping.
   The room sends it nothing and acts on nothing from it.
3. The page's first message is `{"type":"hello","token":"..."}`.
   With a valid token for a seat in this room the socket becomes that player's, and from then on behaves as before: presence, the player's own view, away and back, `sync`.
4. Anything else as the first message closes the socket with 4004 (the page is out of date; it reloads once, and shows a Reload screen if that did not help).
   A wrong token closes it with 4003, or 4002 for a removed player; the page then checks its session over HTTP as after any drop.
5. Sockets that have not said who they are ("silent") are capped per room and per client, where a client is an IPv4 address or an IPv6 /48 (`socketClientKey`, because one customer can be handed a whole /48; used for this cap only).
   A client holds at most 4 silent sockets in a room, and its fifth pushes out its own oldest (4005), never anyone else's.
   4, not fewer, because a mobile carrier can put both players of a room in one /48, and both phones with two tabs each may reconnect at the same moment.
   A room holds at most 64 silent sockets in all; at that point the oldest socket of the client holding the most goes, which, when every client holds one, is simply the oldest silent socket.
   A socket whose hello is being checked is never pushed out, and a newcomer is refused (429) only when all 64 are mid-check.
   Silent sockets older than 10 seconds are closed (4005) when the next socket arrives, and they never count as activity, so they cannot keep a room alive.
   What is left: a real phone's socket is the newest silent one during the round trip before its hello, so pushing it out takes 63 newer opens from 63 other clients inside that round trip.
   For a 200 ms round trip that is about 315 opens a second, sustained for as long as the attacker wants the phone kept out; at 30 opens a minute per address (item 6) it needs about 630 IPv4 addresses or IPv6 /64s, spread over at least 63 IPv4 addresses or IPv6 /48s.
   Even then the phone only retries with backoff, and a seated player is never affected.
   Someone inside the same carrier /48 as a player shares that player's 4 slots, so 4 opens in that round trip can push out the player's socket; the page then reconnects.
6. Socket requests are limited to 30 a minute per client before the room is touched, which also keeps the route from answering room-code guesses faster than the lookup limit.
   This limit counts an IPv6 /64, like every other limit, not the /48: it is one allowance across all rooms that refuses outright, so a /48 key would let one busy phone shut out every other phone in its carrier /48.
7. After a fatal close (room closed, left, removed, out of date), or a fatal answer over HTTP (which also closes an open socket), the page opens no more sockets, even when the tab comes back into view.
   Reconnects back off from 0.5 s to 8 s and start over only once the room has sent the socket a view (`SocketLife` in `src/client/lib/roomSocket.ts`).

Create and join require the header `X-WhoAmI-Client: 2`, which current pages send.
Without it they answer 426 with "This page is out of date. Reload it and try again.", which pages from before v2 show where create and join errors appear.
That keeps an old page (which keeps its old code across in-app navigation) from taking a seat and then putting the new token in a socket header.

Pages built before v2 still open sockets offering `whoami.v1` plus `token.<token>`.
The Worker never honours that token: it opens the socket and closes it at once with 4000 (room closed).
On those pages, 4000, 4001 and 4002 are the only codes that stop the reconnect loop, and 4000 is the least false of them: 4001 deletes the stored seat at once, and 4002 says the host removed you.
The old page shows "This room has closed"; a reload loads the new page, which finds the stored seat and carries on.
This cannot be made fully quiet for pages already open: their code reopens a socket every time the tab comes back into view, even on that screen, and each time sends its token in the header again (each is closed with 4000 again, outside the socket limit, so it never turns into a fast retry loop), until the page is reloaded or closed.

### Abuse resistance

- Room codes are 6 characters from a 31-character unambiguous alphabet (about 887 million codes), generated with rejection sampling from `crypto.getRandomValues`.
- Join attempts, room lookups, room sockets and room creation are rate limited per client IP (a whole IPv6 /64 counts as one client, since carriers give each phone its own /64 from a shared /48) by a small Durable Object.
- PINs are short-lived aliases for an open lobby, held in one `PinDirectoryDurableObject`.
  They are chosen at random, last 15 minutes unless the host's lobby stays open, end when the room fills or the game starts, wait out a 10-minute cooldown before reuse, and lookups are limited to 10 per 10 minutes and 30 per hour.
  Unknown and expired PINs get the same response, and a lookup returns only the room preview, never a player id or token.
- Rooms hold at most two players and close after an hour without activity.

## Architecture

```
Browser (React SPA)  --HTTP-->  Worker (src/worker/index.ts)  --RPC/fetch-->  RoomDurableObject (one per room code)
        ^                                                                             |
        +----------------------- WebSocket (per-player filtered views) ---------------+
```

- **One Worker** serves the Vite-built React SPA as static assets and the JSON API under `/api`.
- **One Durable Object per room** (`src/worker/room.ts`) is the authoritative game server.
  It loads the room from Durable Object storage, applies commands through a pure state machine (`src/worker/engine.ts`), persists before acknowledging, and pushes a filtered view to every connected socket using the WebSocket Hibernation API.
- **One edge for the rules:** the room reaches the engine and the views only through `src/party/game.ts`, which also offers them in the shape the shared party kit will host (`docs/PARTY-KIT-MIGRATION.md`).
  It imports nothing from Cloudflare, so its tests run in plain Node.
- **State machine:** `lobby -> assigning -> guessing_first -> guessing_second -> round_summary -> assigning ... -> match_summary`, and `match_summary -> assigning` when both players tap Rematch.
- **Turn order:** the first guesser alternates every round.
  Round 1 follows the host's lobby choice (me, my opponent, or random); a rematch starts with the loser of the previous match, or after a tie with whoever went second in its round 1.
- **Commands** are validated with Zod, carry a client-generated command id (retries are answered, never re-applied) and the state version the client saw (stale versions get `409` with the canonical state).
  If both players act at once, the first valid transition wins.
- **Timer:** a single Durable Object alarm handles the turn deadline and room expiry.
  The clock pauses while a guess awaits confirmation or a player is disconnected, and each turn has a unique id so a timeout ends it exactly once.
- **Disconnects and away:** the opponent sees a banner and the timer pauses; if the confirming player is gone for 30 seconds, the host may confirm their own guess.
  A player whose phone locks or who switches apps keeps their socket but sends `away` (and `back` on return, `src/kit/client/visibility.ts`), so the other phone says "Bob stepped away" instead of stalling silently, and the same pause and host-override rules apply.
  A player with two tabs is away only while every tab is hidden.
  Leaving frees the seat and returns the room to the lobby.
- **Screen wake lock:** while a player is in a room, `src/kit/client/wake-lock.ts` keeps the phone's screen on, takes the lock again whenever the page becomes visible, and does nothing where the API is missing or refused.
- **Sound and haptics:** `src/kit/client/feedback.ts` plays short synthesized cues (no sound files) with a matching vibration, and `src/client/lib/gameCues.ts` maps game moments to them: your turn, a question to answer or a guess to confirm, a correct guess, and winning, losing or a tie.
  Nothing plays before the first tap on the page, the speaker button in the header mutes sound and vibration and each device remembers it, and "reduce motion" turns vibration off.
- **Shareable result card:** at the end of a match, **Share result** paints a 1200x630 card in the browser (`src/client/lib/resultCard.ts`: names, scores, category and rounds, never an identity) and uploads it private (`POST /api/rooms/:code/share`).
  Tapping **Share** (Web Share API) or **Copy link** makes it public in the same tap; cancelling the share sheet makes it private again, and **Stop sharing** takes it down.
  The public page `/s/:id` carries the card in its link-preview tags, and the title and description are written by the server from the finished match (`src/worker/result-card.ts`).
  The party kit stores cards in D1 (`share_cards`, owner key hashed, 90-day expiry) and accepts only a 1200x630 PNG under 400 KB (`src/kit/worker/share-cards.ts`).
- **Dark mode:** follows the phone's setting by default; the footer's Auto / Light / Dark switch overrides it per device (`src/kit/client/theme.ts`, key `kit:theme`).
  `public/theme-init.js` applies the theme before first paint, and the colors are CSS tokens in `src/client/styles.css` (`brand` is a fill behind white text, `brand-ink` is brand-colored text on a surface). The QR code stays dark on white in both themes so every scanner reads it.
- **Version:** `GET /api/version` answers `{ ok, name, version, commit }` (`src/kit/worker/version.ts`), and the footer's "What's new · vX.Y.Z" links to [CHANGELOG.md](CHANGELOG.md).
- **No external database:** room state lives in Durable Object storage and is deleted when the room expires.

```
src/
  kit/       the party kit: game-agnostic phone comforts (wake lock, away presence, sound and haptics, result cards, version, light and dark themes) shared by every game in the collection
  party/     the game adapter: the rules by player id for the room, and by seat for the party kit
  shared/    protocol types, Zod schemas, pack metadata (safe for the client)
  worker/    Worker entry, Room and RateLimiter Durable Objects, engine, view filter, sessions, content packs
  client/    React screens (landing, setup, join, lobby, game, round summary, match summary)
test/        Vitest tests (Workers runtime)
e2e/         Playwright tests
```

## Content

Each pack is a typed data file in `src/worker/content` using the `Identity` shape (`id`, `canonicalName`, `aliases`, `categoryId`, `tags`, `difficulty`, `active`, optional `picture`) plus exactly three curated `hints`, vague to strong.
Ids are `<pack>.<slug>` and must stay stable once published.
A unit test rejects duplicate ids, names that overlap across packs, and hints that are missing, too long, or contain any identity's name or alias.

### Pictures

Most identities have a picture, listed one per line in `src/worker/content/pictures.json` (read by `pictures.ts`): a thumbnail address on `upload.wikimedia.org`, the file's page, the author, the licence and whether it is free.
No picture is copied into this repo or the site; the phone loads the thumbnail straight from Wikimedia with no referrer, and the page's `img-src` allows that one host.
Real people have a free photo or portrait from Wikimedia Commons, chosen by hand.
Film, TV, game and cartoon characters and brand mascots have the lead image of their own English Wikipedia article (`free: false` when it is a non-free image); those images belong to their owners and are used by the owner's decision, knowing a rights holder may ask for one to be taken down.
Identities without an article of their own, or without a suitable image, stay text-only.
The footer's **Pictures** note says where pictures come from and links to a new GitHub issue for reporting one.

- **Pull one picture:** delete its line in `pictures.json` and deploy; that identity goes back to the text card.
- **Turn all pictures off:** in the Cloudflare dashboard, open the `who-am-i-game` Worker, Settings, Variables and secrets, and add the text variable `PICTURES` with the value `off`.
  It takes effect on save, with no code change, and `keep_vars` in `wrangler.jsonc` keeps it across later deploys.
  Delete the variable to turn pictures back on.
- A picture travels only inside the identity it shows (`publicIdentity` in `src/worker/view.ts`), so it reaches a phone exactly when that identity's name does: your opponent's during a round, both in the round summary, and never your own before then.
- Pictures never appear on share cards, link previews, the landing page or the screenshots in `docs/screenshots` (the screenshot run makes every picture fail to load).
- E2E tests answer picture requests with a stand-in image and never reach Wikimedia; `E2E_PICTURES=live` lets them through when you want to look at the real pictures.

## License

MIT, see [LICENSE](LICENSE).
