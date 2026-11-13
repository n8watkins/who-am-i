# Who Am I? status

Last updated 2026-11-12.
Paused by the owner on 2026-11-04.
Read this first when work resumes, then `docs/V2_PLAN.md` sections 2a and 2b, which override older plan text.
The owner's master list mirrors a short summary of this file: `~/projects/ops/MAINTENANCE.md`, section 4.
When this file changes in a way that matters there, update that summary too.

## Current state

Live at https://whoami.n8builds.dev; the old workers.dev address is off.

Shipped:

- Invite with a 4-digit PIN and QR code, New PIN, and removing a player from the lobby.
- The desktop-first redesign: landing, new game, lobby, game and reveal, with original category art and initials tiles.
- Ask and Clues, with no 20 question limit and no Ready step.
- Trade turns as the default, with Keep going as a setting, plus Give up and Pass.
- Easy, Medium and Hard, and each player's own difficulty as a handicap.
- v0.2.0 (2026-11-09), phone comforts: screen wake lock, an "away" state when a phone locks (pauses the timer, counts for the host override), sound and haptic cues with a remembered mute, a shareable result card (`/s/:id`, private until shared, revocable, 90-day expiry), and `/api/version` with a "What's new" footer link.
- v0.3.0 (2026-11-09): dark mode following the phone, with an Auto / Light / Dark switch in the footer (owner approved), and two layout fixes (whole opponent name in the phone top bar next to a timer, a roomier I Guessed It on desktop).
- The party kit in `src/kit`: game-agnostic pieces for the planned game collection (wake lock, presence, feedback, share cards, version, theme). Lint keeps it free of Who Am I? code.

## Parked branches and PRs

None: no PRs are open and no work is waiting on a branch.
Other agent sessions left worktrees at `~/projects/who-am-i-domain` and `~/n8builds/worktrees/whoami-og`, and their work is merged.

## Owner steps

Blocking nothing yet:

- A Gemini API key, needed only for AI-written content or AI answers.
- Payments and a legal review, before anything costs money.
- Branch protection on `main`, which is optional but stops a failing PR from being merged.
- Rerun `set-cloudflare-deploy-token`, which adds the `CLOUDFLARE_API_TOKEN` repo secret here (`~/projects/ops/MAINTENANCE.md`, section 7).

## Open work, in order

1. **Lobby avatars** (owner priority).
   Small original characters players can move around the waiting room, bumping and jumping on each other.
   This is a sweeping visual change, so show a desktop preview first, then mobile, and get approval.
2. **Timeline** (first new game).
   Played live by taking turns placing events in order, or as a challenge where you pick a period and send it to a friend.
3. **Catalog**: grow to about 1,000 identities (400 easy, 400 medium, 200 hard, starting with hard).
4. **Finish the friend game**: Pass and play, the big-screen view, and the client half of the build-version handshake (compare the bundle's version with `/api/version` and offer a reload).
5. **Friends and rivalry**: friend list, Slow Duel with friends answering, points, forfeits, per-game ratings and Auto difficulty.
6. **More games**: Know Your Friend and Voice Clues, then rooms for 3 or more, then Bluff Facts and Sketch Relay.
7. **Signature and revenue**: skins, live voice and the party pass.
8. **Only if usage justifies it**: Solo, Daily, and matchmaking with strangers.

## Links

- Live site: https://whoami.n8builds.dev (the old workers.dev address is off)
- Repo: https://github.com/n8watkins/who-am-i
- Plan of record: `docs/V2_PLAN.md`
- Reasoning and game ideas: https://claude.ai/artifact/FD3rWDr5kRWZMKPDLrx7jb
- Master maintenance list: `~/projects/ops/MAINTENANCE.md`
- Owner's list across repos: `~/OWNER-TODO.md`

## Good to know

- Deploys are manual: run `npm run deploy` after merging (it builds, applies D1 migrations and stamps the commit into `/api/version`).
  Wait for the live site to serve the new build before running live checks, and save their full output.
- Local E2E runs can sit for about 2 minutes per test server before starting, because this machine is slow to refuse closed ports.
  That delay does not happen in CI.
- PIN lookups are limited to 10 per 10 minutes per address, so repeating the join tests against the live site ends in "Too many tries".
  That is the limit working, not a bug.
- GitHub sign-in and the difficulty tracking were removed on 2026-11-12, before either was switched on.
  The D1 database still holds their `users` and `identity_plays` tables (migration `0001`), which nothing reads or writes now.
  Dropping them would be a destructive migration, so it waits for the owner; `share_cards` stays, because every shared `/s/<id>` link depends on it.
- A Sentry DSN is reserved for this app in `~/projects/ops/MAINTENANCE.md`, section 4, for when its code lands.
- Other agent sessions have also worked on this repo, so check for open PRs and for worktrees before resuming.
- `npm audit` reports moderate issues in dev tooling, blocked upstream by `eslint`, and the `minimatch` alert was dismissed for that reason.

## Keys

Checked 2026-11-09 against the secret names on the Worker and in GitHub Actions (names only, no values).
New values go into the owner's pass-env store and are sent with `pass-env pipe <entry> -- <command>`; never commit or paste a value.

- [ ] `CLOUDFLARE_API_TOKEN` Actions secret (missing): Deploy runs pass without deploying. Rerun `set-cloudflare-deploy-token`.
- [ ] `GEMINI_API_KEY` (later): for AI mode, when that work resumes.
- [x] `SESSION_SECRET`: set on the Worker.
