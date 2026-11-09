import { describe, expect, it } from "vitest";
import { versionInfo } from "../src/kit/worker/version";

describe("party kit version info", () => {
  it("uses a real commit hash and ignores anything else", () => {
    const pkg = { name: "game", version: "1.2.3" };
    expect(versionInfo(pkg, { BUILD_COMMIT: "abc1234" })).toEqual({ ok: true, name: "game", version: "1.2.3", commit: "abc1234" });
    expect(versionInfo(pkg, { BUILD_COMMIT: "<script>" }).commit).toBe("dev");
    expect(versionInfo(pkg, {}).commit).toBe("dev");
  });
});
