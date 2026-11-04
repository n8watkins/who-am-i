import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_PINS,
  PIN_COOLDOWN_MS,
  PIN_SPACE,
  PIN_TTL_MS,
  pickFreePin,
  type PinDirectoryDurableObject,
} from "../src/worker/pin-directory";
import { clientKey } from "../src/worker/rate-limiter";

let counter = 0;
/** Each test gets its own directory; production uses a single named instance. */
const directory = () => env.PINS.getByName(`test-${++counter}`);
/** Ahead of the real clock, so the directory's real alarm cannot fire during a test. */
const T0 = Date.now() + 60 * 60_000;

const occupiedExcept = (...free: string[]) => {
  const occupied = new Set<string>();
  for (let n = 0; n < PIN_SPACE; n++) occupied.add(String(n).padStart(4, "0"));
  for (const pin of free) occupied.delete(pin);
  return occupied;
};

describe("pickFreePin", () => {
  it("only picks free PINs, and is uniform across them", () => {
    const free = ["0007", "1234", "5000", "9999"];
    const occupied = occupiedExcept(...free);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const pin = pickFreePin(occupied)!;
      counts.set(pin, (counts.get(pin) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(free);
    for (const count of counts.values()) expect(Math.abs(count - 1000)).toBeLessThan(200);
  });

  it("returns null when nothing is free", () => {
    expect(pickFreePin(occupiedExcept())).toBeNull();
  });

  it("keeps leading zeros", () => {
    expect(pickFreePin(new Set(), () => 7)).toBe("0007");
  });
});

describe("PinDirectoryDurableObject", () => {
  it("resolves a live PIN to its room and stops at expiry", async () => {
    const dir = directory();
    const pin = (await dir.issue("AAAAAA", "room-1", T0))!;
    expect(pin.value).toMatch(/^\d{4}$/);
    expect(pin.expiresAt).toBe(T0 + PIN_TTL_MS);
    expect(await dir.resolve(pin.value, T0 + PIN_TTL_MS - 1)).toEqual({ code: "AAAAAA", roomId: "room-1" });
    expect(await dir.resolve(pin.value, T0 + PIN_TTL_MS)).toBeNull();
  });

  it("refresh extends a live PIN but cannot revive an expired one", async () => {
    const dir = directory();
    const pin = (await dir.issue("AAAAAA", "room-1", T0))!;
    const later = T0 + PIN_TTL_MS - 1000;
    expect(await dir.refresh("AAAAAA", later)).toBe(later + PIN_TTL_MS);
    expect(await dir.resolve(pin.value, later + PIN_TTL_MS - 1)).not.toBeNull();
    expect(await dir.refresh("AAAAAA", later + PIN_TTL_MS)).toBeNull();
  });

  it("gives a room one PIN at a time", async () => {
    const dir = directory();
    const first = (await dir.issue("AAAAAA", "room-1", T0))!;
    const second = (await dir.issue("AAAAAA", "room-1", T0 + 1))!;
    expect(second.value).not.toBe(first.value);
    expect(await dir.resolve(first.value, T0 + 2)).toBeNull();
    expect(await dir.resolve(second.value, T0 + 2)).toEqual({ code: "AAAAAA", roomId: "room-1" });
  });

  it("holds a released PIN back for the cooldown, then frees it", async () => {
    const stub = directory();
    await runInDurableObject(stub, async (dir: PinDirectoryDurableObject, state) => {
      const { value } = (await dir.issue("AAAAAA", "room-1", T0))!;
      await dir.release("AAAAAA", T0 + 5);
      expect(await dir.resolve(value, T0 + 6)).toBeNull();
      const held = () => state.storage.sql.exec("SELECT pin FROM pins WHERE pin = ?", value).toArray().length;
      await dir.issue("BBBBBB", "room-2", T0 + PIN_COOLDOWN_MS + 4);
      expect(held()).toBe(1);
      await dir.issue("CCCCCC", "room-3", T0 + PIN_COOLDOWN_MS + 5);
      expect(held()).toBe(0);
    });
  });

  it("never reissues a PIN on cooldown", async () => {
    const stub = directory();
    await runInDurableObject(stub, async (dir: PinDirectoryDurableObject, state) => {
      const sql = state.storage.sql;
      // Every PIN but two is cooling down, so the released one is the only other way to fail.
      for (let n = 2; n < PIN_SPACE; n++) {
        sql.exec("INSERT INTO pins VALUES (?, 'OLD', 'old', ?, ?)", String(n).padStart(4, "0"), T0 - 1, T0 + PIN_COOLDOWN_MS);
      }
      const first = (await dir.issue("AAAAAA", "room-1", T0))!;
      await dir.release("AAAAAA", T0);
      const second = (await dir.issue("BBBBBB", "room-2", T0))!;
      expect(second.value).not.toBe(first.value);
      await dir.release("BBBBBB", T0);
      expect(await dir.issue("CCCCCC", "room-3", T0)).toBeNull();
    });
  });

  it("issues nothing at capacity, and recovers as PINs lapse", async () => {
    const stub = directory();
    await runInDurableObject(stub, async (dir: PinDirectoryDurableObject, state) => {
      const sql = state.storage.sql;
      for (let n = 0; n < MAX_LIVE_PINS; n++) {
        sql.exec("INSERT INTO pins VALUES (?, ?, 'r', ?, ?)", String(n).padStart(4, "0"), `C${n}`, T0 + 1000, T0 + 2000);
      }
      expect(await dir.issue("AAAAAA", "room-1", T0)).toBeNull();
      expect(await dir.issue("AAAAAA", "room-1", T0 + 1000)).not.toBeNull();
    });
  });

  it("clears old rows on its alarm and stops when empty", async () => {
    const stub = directory();
    await stub.issue("AAAAAA", "room-1", 1);
    // Issued at time 1, the cleanup alarm is already due, so the runtime may
    // start it on its own and race runDurableObjectAlarm. Run the handler
    // directly instead.
    await runInDurableObject(stub, (dir: PinDirectoryDurableObject) => dir.alarm());
    await runInDurableObject(stub, async (_dir: PinDirectoryDurableObject, state) => {
      expect(state.storage.sql.exec("SELECT pin FROM pins").toArray()).toEqual([]);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});

describe("clientKey", () => {
  it("groups an IPv6 /64 however it is written", () => {
    const key = clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(key).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:0DB8:0001:0002::1")).toBe(key);
    expect(clientKey("2001:db8:1:2::ffff")).toBe(key);
    expect(clientKey("2001:db8:1:3::1")).not.toBe(key);
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
  });

  it("keeps IPv4 addresses apart, including mapped ones", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("local")).toBe("local");
  });
});
