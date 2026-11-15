// Fixed-window rate limiter, one Durable Object per (bucket, client IP).
// Used to slow down room-code guessing (joins and lookups) and room creation.
import { DurableObject } from "cloudflare:workers";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  create: { limit: 20, windowMs: 60_000 },
  join: { limit: 30, windowMs: 60_000 },
  lookup: { limit: 60, windowMs: 60_000 },
  // PINs are only 4 digits, so guessing them is limited far harder than room codes.
  pin_short: { limit: 10, windowMs: 10 * 60_000 },
  pin_long: { limit: 30, windowMs: 60 * 60_000 },
  pin_new: { limit: 6, windowMs: 60_000 },
  // Result cards: a player shares a match once or twice, never dozens of times.
  share: { limit: 10, windowMs: 10 * 60_000 },
  // Room sockets. A page backs off from 0.5 s to 8 s between tries and starts over only once the
  // room has sent its socket a view, so even a socket that opens and is dropped every time makes
  // about ten tries a minute. This leaves room for two such tabs, while a flood of silent sockets
  // and room-code guesses through the socket route stay well under the lookup limit.
  socket: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

interface Window {
  start: number;
  count: number;
}

export class RateLimiterDurableObject extends DurableObject<Env> {
  /** Records one attempt. Returns false when the caller is over the limit. */
  async hit(rule: RateLimitRule, now = Date.now()): Promise<boolean> {
    const current = (await this.ctx.storage.get<Window>("window")) ?? { start: now, count: 0 };
    const window = now - current.start >= rule.windowMs ? { start: now, count: 0 } : current;
    window.count += 1;
    await this.ctx.storage.put("window", window);
    await this.ctx.storage.setAlarm(window.start + rule.windowMs * 2);
    return window.count <= rule.limit;
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/** IPv4 addresses (including IPv4-mapped IPv6 ones) as they are; IPv6 cut to its first `groups`. */
function ipPrefix(ip: string, groups: number): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : new Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0");
  const kept = [...left, ...zeros, ...right].slice(0, groups);
  return `${kept.map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/${groups * 16}`;
}

/**
 * The key a client is limited by for joins, lookups, creates, PINs and shares. One IPv6 customer
 * usually holds a whole /64, so all of it counts as one client. Not the /48: mobile carriers give
 * each phone its own /64 out of a shared /48, so keying these on the /48 would make thousands of
 * unrelated phones share one small allowance.
 */
export function clientKey(ip: string): string {
  return ipPrefix(ip, 4);
}

/**
 * The key for room sockets (the `socket` bucket and a room's cap on silent sockets). One customer
 * can be handed a whole /48 (65,536 /64s), so counting per /64 would let one person hold
 * thousands of silent sockets. The cost: phones that share a carrier /48 also share this
 * allowance (see RATE_LIMITS.socket and MAX_SILENT_PER_CLIENT).
 */
export function socketClientKey(ip: string): string {
  return ipPrefix(ip, 3);
}

/** The address Cloudflare saw ("local" in tests without one). */
const clientAddress = (request: Request) => request.headers.get("CF-Connecting-IP") ?? "local";

/** The socket client key of a request: what a room caps silent sockets by. */
export function requestSocketClientKey(request: Request): string {
  return socketClientKey(clientAddress(request));
}

export async function allowRequest(env: Env, request: Request, bucket: RateLimitBucket): Promise<boolean> {
  const ip = bucket === "socket" ? requestSocketClientKey(request) : clientKey(clientAddress(request));
  const stub = env.RATE_LIMITER.getByName(`${bucket}:${ip}`);
  return stub.hit(RATE_LIMITS[bucket]);
}
