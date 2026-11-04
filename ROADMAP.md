# Roadmap

Where Who Am I? could go after the two-friends MVP.
Each item lists what it is, why it matters, and what has to exist first.

## 1. Play with random people online

**What:** a "Play online" button that pairs you with another player who is waiting, instead of sharing a room code.

**Why:** today you need a friend on hand.
Matchmaking makes the game playable any time, and the in-app questions and answers already let two strangers play without a call.

**Prerequisites:**

- **Lobby and queue:** a matchmaking Durable Object that holds waiting players by pack and mode, pairs them, creates a room and hands both players a session.
  It needs timeouts, cancellation and a fallback when nobody is waiting.
- **Identity and accounts:** at least a persistent anonymous player id, and probably optional sign-in, so that reports and blocks stick to a person rather than a browser tab.
- **Reporting and blocking:** report and block buttons in the game and on the summary screens, a block list that the matchmaker respects, and a place where reports are reviewed.
- **Rate limits:** per-player limits on queue joins, rooms per hour, questions and reports, on top of today's per-IP join limits.
- **Abuse handling:** typed questions become a chat channel between strangers.
  They need a profanity and harassment filter, link and contact-detail blocking, escalating mutes and bans, and logs kept long enough to act on reports.
- **Age considerations:** a clear minimum age, an age gate before online play, and stricter defaults (suggested questions only, no free text) for anyone who may be a minor.
  Check COPPA and similar rules before launch.
- **Terms and privacy:** terms of use and a privacy policy that cover strangers, reports and retained logs.

## 2. Optional video chat between matched players

**What:** an opt-in camera and microphone call inside the game, so remote players can ask questions face to face like they would on a couch.

**Why:** spoken questions and reactions are the most fun part of the game, and today remote players need a separate call app.

**Prerequisites:**

- **Media:** Cloudflare Realtime (Calls) for WebRTC sessions, with TURN for players behind strict NATs.
  The room Durable Object already coordinates both players and can hand out session tokens.
- **Consent:** both players must opt in separately, with clear camera and mic indicators and a one-tap way to turn either off.
- **Moderation:** video between strangers needs more than text filters: an instant end-and-report button, blocking, possibly automated nudity detection, and a policy that limits video to signed-in adults.
  Friends-only video (room code, no matchmaking) is a much safer first step.
- **Cost and limits:** per-minute media pricing, per-player caps and a fallback to audio only.

## 3. AI-generated hints for custom packs

**What:** let players build their own packs (for example, "people in our office" or "our favorite bands") and have AI write the three hints for each entry.

**Why:** custom packs keep the game fresh for groups, and writing three good hints per identity by hand is the slow part.

**Prerequisites:**

- **Custom packs:** creation and storage (D1 or Durable Object storage), ownership and sharing, and the P2 custom-pack feature from the original PRD.
- **Generation:** Workers AI or another model producing vague-to-strong hints, run through the same checks as the curated packs: no name or alias in any hint, bounded length, and no names of other entries.
- **Safety:** filters against defamatory or hurtful hints about real people, a review and edit step before a pack can be used, and reporting for shared packs.
- **Cost controls:** cache generated hints and limit generations per user.
