-- Accounts, from GitHub sign-in. No access tokens are stored.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- One row per identity per finished round: how hard it really was.
-- It holds no player, room or question text, so it cannot be traced to anyone.
CREATE TABLE identity_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_id TEXT NOT NULL,
  result TEXT NOT NULL,
  questions INTEGER NOT NULL,
  hints INTEGER NOT NULL,
  level TEXT NOT NULL,
  mode TEXT NOT NULL,
  turn_format TEXT NOT NULL,
  played_at INTEGER NOT NULL
);
CREATE INDEX identity_plays_identity ON identity_plays (identity_id);
