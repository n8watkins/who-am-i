// GitHub sign-in. An account is optional: every game works without one.
// The GitHub access token is used once to read the public profile and is never stored.
import type { AccountUser, MeResponse } from "../shared/protocol";
import { signAccount, verifyAccount } from "./session";

const ACCOUNT_COOKIE = "whoami_account";
const OAUTH_COOKIE = "whoami_oauth";
const OAUTH_COOKIE_MAX_AGE_S = 600;
export const ACCOUNT_MAX_AGE_S = 30 * 24 * 60 * 60;
const FAILED_PATH = "/?signin=failed";

/** The URLs can be overridden only so tests can run against a fake GitHub. */
export type AuthEnv = Env & {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_OAUTH_URL?: string;
  GITHUB_API_URL?: string;
};

const oauthUrl = (env: AuthEnv) => env.GITHUB_OAUTH_URL ?? "https://github.com";
const apiUrl = (env: AuthEnv) => env.GITHUB_API_URL ?? "https://api.github.com";
const isConfigured = (env: AuthEnv) => !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET;

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function cookie(url: URL, name: string, value: string, maxAge: number): string {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/** Only same-site paths, so the sign-in link can never send someone to another site. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export function startGitHubSignIn(request: Request, env: AuthEnv, url: URL): Response {
  if (!isConfigured(env)) return redirect(FAILED_PATH);
  const state = crypto.randomUUID();
  const next = safeNext(url.searchParams.get("next"));
  const authorize = new URL("/login/oauth/authorize", oauthUrl(env));
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  authorize.searchParams.set("redirect_uri", `${url.origin}/api/auth/github/callback`);
  authorize.searchParams.set("state", state);
  const pending = encodeURIComponent(JSON.stringify({ state, next }));
  return redirect(authorize.toString(), [cookie(url, OAUTH_COOKIE, pending, OAUTH_COOKIE_MAX_AGE_S)]);
}

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

async function fetchProfile(env: AuthEnv, code: string, redirectUri: string): Promise<GitHubProfile | null> {
  const tokenResponse = await fetch(new URL("/login/oauth/access_token", oauthUrl(env)), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  });
  if (!tokenResponse.ok) return null;
  const { access_token: token } = (await tokenResponse.json()) as { access_token?: string };
  if (!token) return null;
  const userResponse = await fetch(new URL("/user", apiUrl(env)), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "who-am-i-game" },
  });
  if (!userResponse.ok) return null;
  const profile = (await userResponse.json()) as Partial<GitHubProfile>;
  if (typeof profile.id !== "number" || typeof profile.login !== "string") return null;
  return { id: profile.id, login: profile.login, name: profile.name ?? null, avatar_url: profile.avatar_url ?? null };
}

async function saveUser(env: AuthEnv, profile: GitHubProfile, now: number): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO users (id, github_id, login, name, avatar_url, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET
       login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, last_seen_at = excluded.last_seen_at
     RETURNING id`,
  )
    .bind(crypto.randomUUID(), profile.id, profile.login, profile.name, profile.avatar_url, now, now)
    .first<{ id: string }>();
  return row!.id;
}

export async function finishGitHubSignIn(request: Request, env: AuthEnv, url: URL): Promise<Response> {
  const clearPending = cookie(url, OAUTH_COOKIE, "", 0);
  const failed = () => redirect(FAILED_PATH, [clearPending]);
  if (!isConfigured(env)) return failed();
  let pending: { state?: string; next?: string };
  try {
    pending = JSON.parse(decodeURIComponent(readCookie(request, OAUTH_COOKIE) ?? "")) as typeof pending;
  } catch {
    return failed();
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== pending.state) return failed();
  const profile = await fetchProfile(env, code, `${url.origin}/api/auth/github/callback`);
  if (!profile) return failed();
  const userId = await saveUser(env, profile, Date.now());
  const account = await signAccount(env.SESSION_SECRET, userId);
  return redirect(safeNext(pending.next ?? null), [clearPending, cookie(url, ACCOUNT_COOKIE, account, ACCOUNT_MAX_AGE_S)]);
}

export function signOut(url: URL): Response {
  const headers = new Headers({ "Cache-Control": "no-store", "Set-Cookie": cookie(url, ACCOUNT_COOKIE, "", 0) });
  return Response.json({ ok: true }, { headers });
}

export async function currentUser(request: Request, env: AuthEnv): Promise<AccountUser | null> {
  const userId = await verifyAccount(env.SESSION_SECRET, readCookie(request, ACCOUNT_COOKIE));
  if (!userId) return null;
  const row = await env.DB.prepare("SELECT login, name, avatar_url FROM users WHERE id = ?")
    .bind(userId)
    .first<{ login: string; name: string | null; avatar_url: string | null }>();
  return row ? { login: row.login, name: row.name, avatarUrl: row.avatar_url } : null;
}

export async function me(request: Request, env: AuthEnv): Promise<MeResponse> {
  return { ok: true, signInAvailable: isConfigured(env), user: await currentUser(request, env) };
}
