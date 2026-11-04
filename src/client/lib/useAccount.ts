// The signed-in account, loaded once and shared by every screen.
import { useEffect, useState } from "react";
import type { MeResponse } from "../../shared/protocol";
import { api } from "./api";

const SIGNED_OUT: MeResponse = { ok: true, signInAvailable: false, user: null };
let cached: Promise<MeResponse> | null = null;

export function useAccount(): MeResponse {
  const [me, setMe] = useState<MeResponse>(SIGNED_OUT);
  useEffect(() => {
    let active = true;
    cached ??= api.me().catch(() => SIGNED_OUT);
    void cached.then((value) => active && setMe(value));
    return () => {
      active = false;
    };
  }, []);
  return me;
}
