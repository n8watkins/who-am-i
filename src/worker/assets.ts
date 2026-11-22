// Requests under /assets/ are Vite's content-hashed files. The static-assets layer answers a
// missing path with the single-page-app fallback (200 text/html, the app's index.html), which is
// right for a deep link but wrong here: a page that is still open after a deploy and asks for the
// previous release's chunk would get HTML and fail on a baffling syntax error. wrangler.jsonc
// sends /assets/* through the Worker first so this can turn that into a plain 404.
export const ASSETS_PATH_PREFIX = "/assets/";

export async function hashedAsset(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  // Only a real file (200, or 304 for a revalidation) may pass: anything else (a 404, a 405 for a
  // POST, a redirect from a crafted path such as /assets/..%2Findex.html) would otherwise pick up the
  // immutable header. Nothing under /assets/ is HTML, so an HTML answer is the SPA fallback.
  const real = response.status === 200 || response.status === 304;
  if (!real || response.headers.get("Content-Type")?.startsWith("text/html")) {
    await response.body?.cancel();
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  return response;
}
