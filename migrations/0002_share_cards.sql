-- Result cards a player chose to share (party kit, src/kit/worker/share-cards.ts).
-- A card is private when created and public only while its owner shares it. The owner key
-- is stored as a SHA-256 hash. Cards expire after 90 days.
CREATE TABLE share_cards (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  owner_key_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image BLOB NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX share_cards_created ON share_cards (created_at);
