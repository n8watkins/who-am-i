// Anonymous player sessions: an HMAC-SHA256 signed token scoped to one room and one seat.
// Format: v1.<base64url(JSON payload)>.<base64url(signature)>

export interface SessionClaims {
  /** Room id (changes if a code is ever reused, which invalidates old tokens). */
  roomId: string;
  code: string;
  playerId: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 16;
const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

export class MissingSecretError extends Error {
  constructor() {
    super("SESSION_SECRET is not configured");
  }
}

function hmacKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new MissingSecretError();
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function signSession(
  secret: string | undefined,
  claims: Omit<SessionClaims, "exp">,
  now = Date.now(),
): Promise<string> {
  const key = await hmacKey(secret);
  const payload = toBase64Url(encoder.encode(JSON.stringify({ ...claims, exp: now + SESSION_TTL_MS })));
  const signed = `v1.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signed)));
  return `${signed}.${toBase64Url(signature)}`;
}

const ACCOUNT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A signed-in account's cookie value: `a1` keeps it from ever passing as a room token. */
export async function signAccount(secret: string | undefined, userId: string, now = Date.now()): Promise<string> {
  const key = await hmacKey(secret);
  const payload = toBase64Url(encoder.encode(JSON.stringify({ userId, exp: now + ACCOUNT_TTL_MS })));
  const signed = `a1.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signed)));
  return `${signed}.${toBase64Url(signature)}`;
}

/** Returns the account's user id, or null for a missing, altered or expired value. */
export async function verifyAccount(secret: string | undefined, value: string | null | undefined, now = Date.now()): Promise<string | null> {
  const key = await hmacKey(secret);
  if (!value || value.length > 1024) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "a1") return null;
  const payload = fromBase64Url(parts[1]!);
  const signature = fromBase64Url(parts[2]!);
  if (!payload || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`a1.${parts[1]}`));
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payload)) as { userId?: unknown; exp?: unknown };
    return typeof claims.userId === "string" && typeof claims.exp === "number" && claims.exp >= now ? claims.userId : null;
  } catch {
    return null;
  }
}

export async function verifySession(
  secret: string | undefined,
  token: string | null | undefined,
  now = Date.now(),
): Promise<SessionClaims | null> {
  const key = await hmacKey(secret);
  if (!token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payloadBytes = fromBase64Url(parts[1]!);
  const signature = fromBase64Url(parts[2]!);
  if (!payloadBytes || !signature) return null;
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`v1.${parts[1]}`));
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionClaims;
    if (
      typeof claims.roomId !== "string" ||
      typeof claims.code !== "string" ||
      typeof claims.playerId !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp < now
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
