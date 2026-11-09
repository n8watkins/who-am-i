// The short-lived PIN directory: one Durable Object maps 4-digit PINs to lobbies.
// A PIN is only an alias for typing on a phone; the room code stays the real address.
// All state changes run synchronously against SQLite, so concurrent calls cannot share a PIN.
import { DurableObject } from "cloudflare:workers";
import { PIN_LENGTH } from "../shared/protocol";

export const PIN_DIRECTORY_NAME = "pins";
/** A PIN lasts this long unless it is refreshed. */
export const PIN_TTL_MS = 15 * 60_000;
/** A released PIN is not reused for this long, so a late typist never lands in another room. */
export const PIN_COOLDOWN_MS = 10 * 60_000;
export const PIN_SPACE = 10 ** PIN_LENGTH;
/** Above this many live PINs none are issued, which keeps guessing odds at 50% or lower. */
export const MAX_LIVE_PINS = PIN_SPACE / 2;

export interface IssuedPin {
  value: string;
  expiresAt: number;
}

export interface PinTarget {
  code: string;
  roomId: string;
}

export function randomIndex(size: number): number {
  // Rejection sampling keeps every index equally likely.
  const limit = 2 ** 32 - (2 ** 32 % size);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % size;
  }
}

/** Picks uniformly among the PINs not in `occupied`, or null when none are free. */
export function pickFreePin(occupied: ReadonlySet<string>, pick: (size: number) => number = randomIndex): string | null {
  const free: string[] = [];
  for (let n = 0; n < PIN_SPACE; n++) {
    const pin = String(n).padStart(PIN_LENGTH, "0");
    if (!occupied.has(pin)) free.push(pin);
  }
  return free.length ? free[pick(free.length)]! : null;
}

export class PinDirectoryDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A row is live until expires_at and stays reserved until free_at.
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pins (
        pin TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        room_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        free_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pins_code ON pins (code);
    `);
  }

  /** Gives the room a new PIN, replacing any it had. Returns null when the directory is at capacity. */
  async issue(code: string, roomId: string, now = Date.now()): Promise<IssuedPin | null> {
    this.purge(now);
    this.expire(code, now);
    const sql = this.ctx.storage.sql;
    const live = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pins WHERE expires_at > ?", now).one().n;
    if (live >= MAX_LIVE_PINS) return null;
    const occupied = new Set(sql.exec<{ pin: string }>("SELECT pin FROM pins").toArray().map((row) => row.pin));
    const value = pickFreePin(occupied);
    if (!value) return null;
    const expiresAt = now + PIN_TTL_MS;
    sql.exec(
      "INSERT INTO pins (pin, code, room_id, expires_at, free_at) VALUES (?, ?, ?, ?, ?)",
      value,
      code,
      roomId,
      expiresAt,
      expiresAt + PIN_COOLDOWN_MS,
    );
    await this.scheduleCleanup();
    return { value, expiresAt };
  }

  /** Extends the room's live PIN. Returns the new expiry, or null if it has no live PIN. */
  async refresh(code: string, now = Date.now()): Promise<number | null> {
    const expiresAt = now + PIN_TTL_MS;
    const updated = this.ctx.storage.sql.exec(
      "UPDATE pins SET expires_at = ?, free_at = ? WHERE code = ? AND expires_at > ?",
      expiresAt,
      expiresAt + PIN_COOLDOWN_MS,
      code,
      now,
    );
    return updated.rowsWritten > 0 ? expiresAt : null;
  }

  /** Ends the room's PIN now; it stays reserved for the cooldown. */
  async release(code: string, now = Date.now()): Promise<void> {
    this.expire(code, now);
    await this.scheduleCleanup();
  }

  async resolve(pin: string, now = Date.now()): Promise<PinTarget | null> {
    const rows = this.ctx.storage.sql
      .exec<{ code: string; room_id: string }>("SELECT code, room_id FROM pins WHERE pin = ? AND expires_at > ?", pin, now)
      .toArray();
    const row = rows[0];
    return row ? { code: row.code, roomId: row.room_id } : null;
  }

  override async alarm(): Promise<void> {
    this.purge(Date.now());
    await this.scheduleCleanup();
  }

  private expire(code: string, now: number): void {
    this.ctx.storage.sql.exec(
      "UPDATE pins SET expires_at = ?, free_at = ? WHERE code = ? AND expires_at > ?",
      now,
      now + PIN_COOLDOWN_MS,
      code,
      now,
    );
  }

  private purge(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM pins WHERE free_at <= ?", now);
  }

  private async scheduleCleanup(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ at: number | null }>("SELECT MIN(free_at) AS at FROM pins").one().at;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }
}
