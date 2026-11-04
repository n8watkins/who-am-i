import { describe, expect, it } from "vitest";
import { PACK_META } from "../src/shared/packs";
import { PACK_IDS } from "../src/shared/protocol";
import { ALL_PACK_IDENTITIES, packIdentities, SOURCE_PACKS } from "../src/worker/content";
import { identitiesClash, normalizeName } from "../src/worker/engine";

describe("content packs", () => {
  it("has metadata for every pack", () => {
    for (const id of PACK_IDS) expect(PACK_META[id].name).toBeTruthy();
  });

  it("has about 40 identities in each source pack", () => {
    for (const [id, list] of Object.entries(SOURCE_PACKS)) {
      expect(list.length, id).toBeGreaterThanOrEqual(38);
      expect(list.length, id).toBeLessThanOrEqual(45);
    }
  });

  it("uses unique, stable, prefixed ids", () => {
    const ids = ALL_PACK_IDENTITIES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const identity of ALL_PACK_IDENTITIES) {
      expect(identity.id).toMatch(/^[a-z-]+\.[a-z0-9-]+$/);
      expect(identity.id.startsWith(`${identity.categoryId}.`)).toBe(true);
    }
  });

  it("keeps each pack to its own category (Actors gives actors only)", () => {
    for (const [id, list] of Object.entries(SOURCE_PACKS)) {
      for (const identity of list) expect(identity.categoryId).toBe(id);
    }
    expect(packIdentities("mixed").length).toBe(ALL_PACK_IDENTITIES.length);
  });

  it("has no duplicate or overlapping names across all packs", () => {
    const clashes: string[] = [];
    for (let i = 0; i < ALL_PACK_IDENTITIES.length; i++) {
      for (let j = i + 1; j < ALL_PACK_IDENTITIES.length; j++) {
        const x = ALL_PACK_IDENTITIES[i]!;
        const y = ALL_PACK_IDENTITIES[j]!;
        if (identitiesClash(x, y)) clashes.push(`${x.canonicalName} / ${y.canonicalName}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("uses names that do not contain the em dash and are non-empty", () => {
    for (const identity of ALL_PACK_IDENTITIES) {
      expect(identity.canonicalName.trim()).toBe(identity.canonicalName);
      expect(identity.canonicalName).not.toContain("—");
      expect(["easy", "medium", "hard"]).toContain(identity.difficulty);
    }
  });

  it("normalizes names for alias matching", () => {
    expect(normalizeName("The Kool-Aid Man")).toBe("kool aid man");
    expect(normalizeName("Timothée Chalamet")).toBe("timothee chalamet");
  });
});
