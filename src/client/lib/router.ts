import { useEffect, useState } from "react";

export type Route =
  | { name: "landing" }
  | { name: "create" }
  | { name: "join"; code?: string }
  | { name: "room"; code: string }
  | { name: "not_found" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "landing" };
  if (pathname === "/new") return { name: "create" };
  if (pathname === "/join") return { name: "join" };
  const room = /^\/r\/([A-Za-z0-9-]{4,12})\/?$/.exec(pathname);
  if (room) return { name: "room", code: room[1]!.toUpperCase() };
  return { name: "not_found" };
}

const listeners = new Set<() => void>();

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.pathname));
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

export function roomUrl(code: string): string {
  return `${location.origin}/r/${code}`;
}
