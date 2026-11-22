// Requests under /assets/ are Vite's content-hashed files. The static-assets layer answers a
// missing path with the single-page-app fallback (200 text/html, the app's index.html), which is
// right for a deep link but wrong here: a page that is still open after a deploy and asks for the
// previous release's chunk would get HTML and fail on a baffling syntax error. wrangler.jsonc
// sends /assets/* through the Worker first so this can turn that into a plain 404.
export const ASSETS_PATH_PREFIX = "/assets/";

export async function hashedAsset(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  // Nothing under /assets/ is HTML, so an HTML answer is always the fallback for a missing file.
  if (response.status === 404 || response.headers.get("Content-Type")?.startsWith("text/html")) {
    await response.body?.cancel();
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  return response;
}
