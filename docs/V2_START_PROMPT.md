# Who Am I? v2 starting prompt

Paste the block below into a new Claude Code session opened in `~/projects/who-am-i`.

```
Read docs/V2_PLAN.md end to end, then README.md, ROADMAP.md, AGENTS.md and RELEASING.md, and skim src/, test/ and e2e/ so you know the v1 code.
Build milestone M1 (Invite, QR and 4-digit PIN) exactly as the plan describes, then continue with M2, M3 and so on in order.
Ask me before starting M4 if the GEMINI_API_KEY secret is not set yet; you can build M4 against the fake answerer while you wait, but the live eval and the deploy need the key.

How to work:
- One branch and one PR per step (a milestone may be several PRs).
  Squash-merge your own PR once CI is green; never push to main.
- Conventional Commits for every commit and PR title (feat, fix, docs, test, refactor, ...); user-facing feat and fix subjects read as patch notes.
  No Co-Authored-By trailer.
- Never use the em dash character anywhere.
  In Markdown, one sentence per line.
- Never edit CHANGELOG.md or auto-generated files; releases go through npm run release.
- Keep docs/V2_PLAN.md current: if a decision changes while building, update the plan in the same PR and say why.
- Lint, typecheck, unit, Workers and E2E tests must pass locally before you push; fix any flaky or failing test you see, even if you did not cause it.
- Every milestone extends the secrecy checks: each new mode, view or endpoint gets the E2E capture assertion that no player receives their own identity early (rules S1 to S12 in the plan).

Machine and process limits:
- Run browsers headless and muted (Playwright launch arg --mute-audio).
- At most 4 heavy jobs at once (builds, test suites, dev servers, browsers).
- Stop every dev server and background process you start; wait on jobs by their completion notification or exit code, not by polling with pgrep or pkill on a pattern from your own command line.

Secrets:
- Never print, echo, log or commit a secret (GEMINI_API_KEY, SESSION_SECRET, DAILY_SECRET).
  Generate DAILY_SECRET by piping openssl rand straight into npx wrangler secret put.
- The owner creates the new Gemini API key (the old keys are invalid) and sets it with npx wrangler secret put GEMINI_API_KEY; never ask for the key in chat.

After each merge:
- Deploy with npx wrangler deploy.
- Wait until the live site serves the new build (the asset names in its HTML match dist/client/assets), because the first seconds after a deploy can still serve the old client and fail the checks for no real reason.
- Save the full output of the check to a file, then rerun the live acceptance and secrecy check: E2E_BASE_URL=https://who-am-i-game.nathancwatkins23.workers.dev npx playwright test acceptance (plus the new mode specs once they exist).
- Report the PR link, the deploy result and the check result in a few lines.

UI changes:
- For taste-driven UI changes (M2 especially), show desktop screenshots first, then mobile (390x844), with a localhost link, and wait for my approval before full responsive work, tests and polish.
  Small, clear fixes skip the preview.
- Be picky: if anything on screen looks off, even outside your change, fix it along the way.

Long reports, plans and status overviews go to a hosted HTML page with a short summary and the link in the terminal; quick updates stay in the terminal.
```
