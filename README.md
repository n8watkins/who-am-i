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
| `npm run build` | Builds the client, checks the bundle, and bundles the Worker with a Wrangler dry run |
| `E2E_BASE_URL=https://whoami.n8builds.dev npx playwright test acceptance` | Runs the acceptance scenario against a deployed Worker |
| `SCREENSHOTS=1 npx playwright test screenshots` | Regenerates `docs/screenshots` at 1280x800 and 390x844 (after `vite build`) |

## Tests

- **Unit tests** (`test/engine.test.ts`, `test/view.test.ts`, `test/content.test.ts`) cover the state machine transitions, turn order (alternation, the lobby setting, loser-first rematches and the tie rule), one-tap rematch, idempotency (duplicate confirm and skip clicks score once), version checks, the two-player cap, distinct and non-repeating draws, reshuffling, timer timeouts and pauses, the host override, hints, in-app questions and their rate limit, the per-player view filter, and the hint content rules.
- **Worker and Durable Object tests** (`test/worker.test.ts`) exercise the real HTTP API, signed sessions, WebSockets, rate limiting and alarms in `workerd`.
- **End-to-end tests** (`e2e/`) drive two separate browser contexts through the full acceptance scenario: create an Actors game, join by invite link, start, ask an in-app question, request hints, guess, confirm, skip, reveal, five rounds with alternating first guessers to a winner, then a one-tap rematch started by the loser.
  While doing so they record every HTTP response body and WebSocket frame each browser receives, plus the page HTML and localStorage, and assert that a player's own identity (name and id) never appears before the round summary, and that each hint arrives only after it was requested.
  Other E2E tests cover joining by PIN in under 10 seconds with the same secrecy capture, the QR code, copy confirmations, New PIN, removing a player, in-app questions on both phones (including typed HTML shown as plain text), the Questions setting, the lobby turn-order picker, every main desktop screen fitting 1280x800 with no accessibility violations, refresh and reconnect restoring the right seat, a third browser being turned away, unknown room codes, and a timed turn running out.

## Secrecy model

Keeping your own identity secret is the core of the game, so it is enforced on the server, not the client.

- Identity content lives only in `src/worker/content` and is never imported by the client.
  ESLint forbids client imports from the Worker, and `scripts/check-bundle.mjs` fails the build if any identity name or id appears in the built client.
- The room's assignment map (player to identity) is private state in the Durable Object.
- Every payload sent to a browser is built by `viewFor(room, playerId)` in `src/worker/view.ts`.
  It contains the public room state plus only the identity your opponent is guessing.
  Your own identity is included only in the summary of a round that has already ended.
- Each WebSocket is tagged with its player, and every broadcast is rendered separately per socket.
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
The WebSocket carries the token as a subprotocol, because browsers cannot set headers on WebSockets.

### Abuse resistance

- Room codes are 6 characters from a 31-character unambiguous alphabet (about 887 million codes), generated with rejection sampling from `crypto.getRandomValues`.
- Join attempts, room lookups and room creation are rate limited per client IP (a whole IPv6 /64 counts as one client) by a small Durable Object.
- Accounts are optional and use GitHub sign-in, which stays hidden until `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set.
  The session is an HttpOnly signed cookie, only public profile data is read, and the GitHub access token is never stored.
- Each finished round records how each identity went (solved, questions, hints, level) in D1 with no player or room data, so difficulty can be measured instead of guessed.
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
- **State machine:** `lobby -> assigning -> guessing_first -> guessing_second -> round_summary -> assigning ... -> match_summary`, and `match_summary -> assigning` when both players tap Rematch.
- **Turn order:** the first guesser alternates every round.
  Round 1 follows the host's lobby choice (me, my opponent, or random); a rematch starts with the loser of the previous match, or after a tie with whoever went second in its round 1.
- **Commands** are validated with Zod, carry a client-generated command id (retries are answered, never re-applied) and the state version the client saw (stale versions get `409` with the canonical state).
  If both players act at once, the first valid transition wins.
- **Timer:** a single Durable Object alarm handles the turn deadline and room expiry.
  The clock pauses while a guess awaits confirmation or a player is disconnected, and each turn has a unique id so a timeout ends it exactly once.
- **Disconnects:** the opponent sees a banner and the timer pauses; if the confirming player is gone for 30 seconds, the host may confirm their own guess.
  Leaving frees the seat and returns the room to the lobby.
- **No external database:** room state lives in Durable Object storage and is deleted when the room expires.

```
src/
  shared/    protocol types, Zod schemas, pack metadata (safe for the client)
  worker/    Worker entry, Room and RateLimiter Durable Objects, engine, view filter, sessions, content packs
  client/    React screens (landing, setup, join, lobby, game, round summary, match summary)
test/        Vitest tests (Workers runtime)
e2e/         Playwright tests
```

## Content

Each pack is a typed data file in `src/worker/content` using the `Identity` shape (`id`, `canonicalName`, `aliases`, `categoryId`, `tags`, `difficulty`, `active`, optional `imageUrl`) plus exactly three curated `hints`, vague to strong.
Ids are `<pack>.<slug>` and must stay stable once published.
Names only, no images.
A unit test rejects duplicate ids, names that overlap across packs, and hints that are missing, too long, or contain any identity's name or alias.

## License

MIT, see [LICENSE](LICENSE).
