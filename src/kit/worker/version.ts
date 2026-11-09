// Party kit: the version endpoint every game serves at /api/version.
import type { VersionInfo } from "../shared/version";

/** BUILD_COMMIT is set at deploy time (`wrangler deploy --var BUILD_COMMIT:<sha>`). */
export interface VersionEnv {
  BUILD_COMMIT?: string;
}

export function versionInfo(pkg: { name: string; version: string }, env: VersionEnv): VersionInfo {
  const commit = env.BUILD_COMMIT && /^[0-9a-f]{7,40}$/.test(env.BUILD_COMMIT) ? env.BUILD_COMMIT : "dev";
  return { ok: true, name: pkg.name, version: pkg.version, commit };
}

export function versionResponse(pkg: { name: string; version: string }, env: VersionEnv): Response {
  return Response.json(versionInfo(pkg, env), { headers: { "Cache-Control": "no-store" } });
}
