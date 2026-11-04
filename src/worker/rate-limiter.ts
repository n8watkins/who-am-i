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

/**
 * The key a client is limited by. One IPv6 customer usually holds a whole /64, so all of it counts
 * as one client; IPv4 addresses, including IPv4-mapped IPv6 ones, are used as they are.
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : new Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0");
  const groups = [...left, ...zeros, ...right].slice(0, 4);
  return `${groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export async function allowRequest(env: Env, request: Request, bucket: RateLimitBucket): Promise<boolean> {
  const ip = clientKey(request.headers.get("CF-Connecting-IP") ?? "local");
  const stub = env.RATE_LIMITER.getByName(`${bucket}:${ip}`);
  return stub.hit(RATE_LIMITS[bucket]);
}
