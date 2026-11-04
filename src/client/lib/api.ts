// HTTP client for the Worker API. Session tokens are stored per room in localStorage so a
// refresh restores the same seat. Nothing identity-related is ever stored on the client.
import type {
  ApiError,
  Command,
  CommandResponse,
  CreateRoomRequest,
  JoinLookupResponse,
  PackInfo,
  RoomPreview,
  RoomView,
  SessionResponse,
  ViewResponse,
} from "../../shared/protocol";

export interface StoredSession {
  token: string;
  playerId: string;
}

const sessionKey = (code: string) => `whoami:session:${code.toUpperCase()}`;

export function loadSession(code: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return typeof parsed.token === "string" && typeof parsed.playerId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, session: StoredSession): void {
  try {
    localStorage.setItem(sessionKey(code), JSON.stringify(session));
  } catch {
    // Private mode: the session lasts for this page only.
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(sessionKey(code));
  } catch {
    // Ignore.
  }
}

const NICKNAME_KEY = "whoami:nickname";
export function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // Ignore.
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiRequestError(0, { ok: false, error: "internal", message: "You appear to be offline. Check your connection." });
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiRequestError(res.status, { ok: false, error: "internal", message: "The server sent an unexpected response." });
  }
  if (!res.ok) throw new ApiRequestError(res.status, body as ApiError);
  return body as T;
}

export const api = {
  packs: () => request<{ packs: PackInfo[] }>("/api/packs").then((r) => r.packs),
  createRoom: (body: CreateRoomRequest) =>
    request<SessionResponse>("/api/rooms", { method: "POST", body: JSON.stringify(body) }),
  preview: (code: string) => request<{ preview: RoomPreview }>(`/api/rooms/${encodeURIComponent(code)}`).then((r) => r.preview),
  join: (code: string, nickname: string) =>
    request<SessionResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify({ nickname }),
    }),
  lookUpJoin: (pinOrCode: string) =>
    request<JoinLookupResponse>(`/api/join/${encodeURIComponent(pinOrCode)}`).then((r) => r.preview),
  renewPin: (code: string, token: string) =>
    request<ViewResponse>(`/api/rooms/${encodeURIComponent(code)}/pin`, { method: "POST", token }).then((r) => r.view),
  state: (code: string, token: string) =>
    request<ViewResponse>(`/api/rooms/${encodeURIComponent(code)}/state`, { token }).then((r) => r.view),
  command: (code: string, token: string, command: Command) =>
    request<CommandResponse>(`/api/rooms/${encodeURIComponent(code)}/commands`, {
      method: "POST",
      token,
      body: JSON.stringify(command),
    }),
};

export function newCommandId(): string {
  return crypto.randomUUID();
}

export type { RoomView };
