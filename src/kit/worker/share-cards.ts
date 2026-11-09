// Party kit: storage and public pages for shareable result cards (see kit/shared/share-cards.ts).
// Needs a D1 binding with the share_cards table (migrations/0002_share_cards.sql) and the
// static assets binding; games call createCard() from their own authenticated route.
import {
  CARD_HEIGHT,
  CARD_ID_PATTERN,
  CARD_MAX_BYTES,
  CARD_TTL_MS,
  CARD_WIDTH,
  cardImagePath,
  SHARE_PATH_PREFIX,
  type CreatedCard,
  type PublicCard,
} from "../shared/share-cards";

export interface ShareCardEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Accepts only a PNG of exactly the card size, so the store cannot host arbitrary files. */
export function checkCardPng(bytes: Uint8Array): string | null {
  if (bytes.byteLength > CARD_MAX_BYTES) return "The card image is too large.";
  if (bytes.byteLength < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return "The card must be a PNG image.";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (ihdr !== "IHDR" || view.getUint32(16) !== CARD_WIDTH || view.getUint32(20) !== CARD_HEIGHT) {
    return `The card must be ${CARD_WIDTH}x${CARD_HEIGHT} pixels.`;
  }
  return null;
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores a private card and sweeps expired ones. The caller has already checked the image. */
export async function createCard(
  env: ShareCardEnv,
  origin: string,
  card: { game: string; title: string; description: string; png: Uint8Array },
  now = Date.now(),
): Promise<CreatedCard> {
  const id = randomToken(16);
  const ownerKey = randomToken(24);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM share_cards WHERE created_at < ?").bind(now - CARD_TTL_MS),
    env.DB.prepare(
      "INSERT INTO share_cards (id, game, owner_key_hash, title, description, image, public, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
    ).bind(id, card.game, await sha256Hex(ownerKey), card.title, card.description, card.png.slice().buffer, now),
  ]);
  return { ok: true, id, ownerKey, url: `${origin}${SHARE_PATH_PREFIX}${id}` };
}

interface CardRow {
  id: string;
  title: string;
  description: string;
  public: number;
  owner_key_hash: string;
  created_at: number;
}

async function findCard(env: ShareCardEnv, id: string, now: number): Promise<CardRow | null> {
  if (!CARD_ID_PATTERN.test(id)) return null;
  const row = await env.DB.prepare("SELECT id, title, description, public, owner_key_hash, created_at FROM share_cards WHERE id = ?")
    .bind(id)
    .first<CardRow>();
  return row && now - row.created_at < CARD_TTL_MS ? row : null;
}

async function ownsCard(row: CardRow, ownerKey: string | null): Promise<boolean> {
  return !!ownerKey && ownerKey.length <= 64 && (await sha256Hex(ownerKey)) === row.owner_key_hash;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notShared = () => json({ ok: false, error: "not_found", message: "This result is not shared." }, 404);

/**
 * Handles /api/share/:id (public details), /api/share/:id/image.png (the image, public, or private
 * with ?key=<ownerKey> for the sharer's preview) and POST /api/share/:id/visibility.
 * Returns null for any other path.
 */
export async function handleShareApi(request: Request, env: ShareCardEnv, url: URL, now = Date.now()): Promise<Response | null> {
  const match = /^\/api\/share\/([^/]+)(\/image\.png|\/visibility)?$/.exec(url.pathname);
  if (!match) return null;
  const [, id, action] = match;
  const row = await findCard(env, id!, now);

  if (action === "/visibility") {
    if (request.method !== "POST") return json({ ok: false, error: "not_found", message: "Unknown endpoint." }, 404);
    let body: { ownerKey?: unknown; public?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "bad_request", message: "Expected a JSON body." }, 400);
    }
    if (typeof body.public !== "boolean" || typeof body.ownerKey !== "string") {
      return json({ ok: false, error: "bad_request", message: "Expected ownerKey and public." }, 400);
    }
    if (!row || !(await ownsCard(row, body.ownerKey))) return notShared();
    await env.DB.prepare("UPDATE share_cards SET public = ? WHERE id = ?").bind(body.public ? 1 : 0, row.id).run();
    return json({ ok: true, public: body.public });
  }

  if (request.method !== "GET") return json({ ok: false, error: "not_found", message: "Unknown endpoint." }, 404);
  const visible = !!row && (row.public === 1 || (action === "/image.png" && (await ownsCard(row, url.searchParams.get("key")))));
  if (!row || !visible) return notShared();

  if (action === "/image.png") {
    const image = await env.DB.prepare("SELECT image FROM share_cards WHERE id = ?").bind(row.id).first<{ image: ArrayBuffer | number[] }>();
    if (!image) return notShared();
    const bytes = image.image instanceof ArrayBuffer ? image.image : new Uint8Array(image.image).buffer;
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        // Short, because the owner can stop sharing at any time.
        "Cache-Control": row.public === 1 ? "public, max-age=300" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  }
  return json({ ok: true, id: row.id, title: row.title, description: row.description, imageUrl: cardImagePath(row.id) } satisfies PublicCard);
}

/**
 * Serves /s/:id: the app's own index.html with the card's link-preview tags, so a pasted link
 * shows the card. An unknown or unshared card gets the plain page with a 404 status.
 */
export async function shareCardPage(request: Request, env: ShareCardEnv, url: URL, now = Date.now()): Promise<Response | null> {
  if (!url.pathname.startsWith(SHARE_PATH_PREFIX)) return null;
  const id = url.pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/$/, "");
  const row = await findCard(env, id, now);
  // "/" is the SPA's index.html ("/index.html" itself redirects to "/").
  const page = await env.ASSETS.fetch(new Request(new URL("/", url), { headers: { Accept: request.headers.get("Accept") ?? "text/html" } }));
  const shared = row?.public === 1 ? row : null;
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex");
  headers.delete("Content-Length");
  headers.delete("ETag");
  const pageUrl = `${url.origin}${SHARE_PATH_PREFIX}${id}`;
  const image = shared ? `${url.origin}${cardImagePath(shared.id)}` : null;
  const set = (value: string) => ({
    element: (el: Element) => {
      el.setAttribute("content", value);
    },
  });
  let rewriter = new HTMLRewriter().on("head", {
    element: (el) => {
      el.append('<meta name="robots" content="noindex" />', { html: true });
    },
  });
  if (shared && image) {
    rewriter = rewriter
      .on("title", {
        element: (el) => {
          el.setInnerContent(shared.title);
        },
      })
      .on('meta[name="description"]', set(shared.description))
      .on('meta[property="og:title"]', set(shared.title))
      .on('meta[property="og:description"]', set(shared.description))
      .on('meta[property="og:url"]', set(pageUrl))
      .on('meta[property="og:image"]', set(image))
      .on('meta[property="og:image:alt"]', set(shared.title))
      .on('meta[name="twitter:title"]', set(shared.title))
      .on('meta[name="twitter:description"]', set(shared.description))
      .on('meta[name="twitter:image"]', set(image))
      .on('link[rel="canonical"]', {
        element: (el) => {
          el.setAttribute("href", pageUrl);
        },
      });
  }
  return rewriter.transform(new Response(page.body, { status: shared ? 200 : 404, headers }));
}
