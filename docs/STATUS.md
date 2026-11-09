# Who Am I? status

Last updated 2026-11-04.
Paused by the owner on 2026-11-04.
Read this first when work resumes, then `docs/V2_PLAN.md` sections 2a and 2b, which override older plan text.
The owner's master list mirrors a short summary of this file: `~/projects/ops/MAINTENANCE.md`, section 4.
When this file changes in a way that matters there, update that summary too.

## Current state

Live at https://whoami.n8builds.dev, and the old workers.dev address still works.

Shipped:

- Invite with a 4-digit PIN and QR code, New PIN, and removing a player from the lobby.
- The desktop-first redesign: landing, new game, lobby, game and reveal, with original category art and initials tiles.
- Ask and Clues, with no 20 question limit and no Ready step.
- Trade turns as the default, with Keep going as a setting, plus Give up and Pass.
- Easy, Medium and Hard, and each player's own difficulty as a handicap.
- GitHub sign-in, which stays hidden until the owner's setup below is done.
- Difficulty tracking: every finished round writes to the `identity_plays` table in D1, with no player data.

## Parked branches and PRs

None: no PRs are open and no work is waiting on a branch.
Other agent sessions left worktrees at `~/projects/who-am-i-domain` and `~/n8builds/worktrees/whoami-og`, and their work is merged.

## Owner steps

Sign-in cannot go live until these are done.

1. Create a GitHub OAuth app at https://github.com/settings/developers.
   - Application name: `Who Am I?`
   - Homepage URL: `https://whoami.n8builds.dev`
   - Authorization callback URL: `https://whoami.n8builds.dev/api/auth/github/callback`
2. Give the agent the Client ID, which is public.
3. Generate a client secret and set it yourself with `npx wrangler secret put GITHUB_CLIENT_SECRET`.
   Never paste the secret into a chat.

Later, and blocking nothing yet:

- A Gemini API key, needed only for AI-written content or AI answers.
- Google sign-in setup, so friends without GitHub can sign in.
- Payments and a legal review, before anything costs money.
- Branch protection on `main`, which is optional but stops a failing PR from being merged.
- Rerun `set-cloudflare-deploy-token`, which adds the `CLOUDFLARE_API_TOKEN` repo secret here (`~/projects/ops/MAINTENANCE.md`, section 7).

## Open work, in order

1. **Finish sign-in** once the owner's steps are done.
   - Add `GITHUB_CLIENT_ID` to `wrangler.jsonc` vars and test a real sign-in on the live site.
   - GitHub allows one callback URL, so redirect the workers.dev address to `whoami.n8builds.dev`, or sign-in will fail there.
   - Add Google soon after.
2. **Lobby avatars** (owner priority).
   Small original characters players can move around the waiting room, bumping and jumping on each other.
   This is a sweeping visual change, so show a desktop preview first, then mobile, and get approval.
3. **Timeline** (first new game).
   Played live by taking turns placing events in order, or as a challenge where you pick a period and send it to a friend.
4. **Measured difficulty**: turn the `identity_plays` data into each identity's level once it has enough plays.
5. **Catalog**: grow to about 1,000 identities (400 easy, 400 medium, 200 hard, starting with hard), and stop repeats per account.
6. **Finish the friend game**: Pass and play, the big-screen view, dark mode, and the build-version handshake.
7. **Friends and rivalry**: friend list, Slow Duel with friends answering, points, forfeits, per-game ratings and Auto difficulty.
8. **More games**: Know Your Friend and Voice Clues, then rooms for 3 or more, then Bluff Facts and Sketch Relay.
9. **Signature and revenue**: skins, live voice and the party pass.
10. **Only if usage justifies it**: Solo, Daily, and matchmaking with strangers.

## Links

- Live site: https://whoami.n8builds.dev (the old workers.dev address still works)
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
- A Sentry DSN is reserved for this app in `~/projects/ops/MAINTENANCE.md`, section 4, for when its code lands.
- Other agent sessions have also worked on this repo, so check for open PRs and for worktrees before resuming.
- `npm audit` reports moderate issues in dev tooling, blocked upstream by `eslint`, and the `minimatch` alert was dismissed for that reason.

## Keys

Checked 2026-11-09 against the secret names on the Worker and in GitHub Actions (names only, no values).
New values go into the owner's pass-env store and are sent with `pass-env pipe <entry> -- <command>`; never commit or paste a value.

- [ ] `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (missing): create the GitHub OAuth app (Owner steps above), then set both on the Worker.
- [ ] `CLOUDFLARE_API_TOKEN` Actions secret (missing): Deploy runs pass without deploying. Rerun `set-cloudflare-deploy-token`.
- [ ] `GEMINI_API_KEY` (later): for AI mode, when that work resumes.
- [x] `SESSION_SECRET`: set on the Worker.
