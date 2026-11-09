// Party kit: what /api/version answers, so a player, a monitor or a stale client can tell
// which build is live.
export interface VersionInfo {
  ok: true;
  /** The game's package name. */
  name: string;
  /** The released version (package.json), e.g. "0.2.0". */
  version: string;
  /** The short git commit the deploy was built from, or "dev" for local builds. */
  commit: string;
}
