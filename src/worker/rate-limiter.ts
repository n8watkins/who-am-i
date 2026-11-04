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

export async function allowRequest(env: Env, request: Request, bucket: RateLimitBucket): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const stub = env.RATE_LIMITER.getByName(`${bucket}:${ip}`);
  return stub.hit(RATE_LIMITS[bucket]);
}
