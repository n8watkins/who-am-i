import { useEffect, useRef, useState } from "react";
import type { AccountUser } from "../../shared/protocol";
import { api } from "../lib/api";
import { useAccount } from "../lib/useAccount";
import { Banner, Button, Dialog } from "./ui";

const failedSignIn = () => new URLSearchParams(location.search).get("signin") === "failed";

/** Sign in for guests, and an account menu once signed in. Nothing shows until sign-in is set up. */
export function AccountControl() {
  const { user, signInAvailable } = useAccount();
  const [open, setOpen] = useState(failedSignIn);
  const [failed] = useState(failedSignIn);

  useEffect(() => {
    if (failed) history.replaceState(null, "", location.pathname);
  }, [failed]);

  if (user) return <AccountMenu user={user} />;
  if (!signInAvailable) return null;
  const next = encodeURIComponent(location.pathname);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Sign in
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Sign in">
        <div className="space-y-4">
          {failed && (
            <Banner tone="error" role="alert">
              Sign-in did not finish. Nothing was lost, so you can try again.
            </Banner>
          )}
          <p className="text-muted">Keep your progress on every device. You never need an account to play.</p>
          <Button block onClick={() => location.assign(`/api/auth/github/start?next=${next}`)}>
            Continue with GitHub
          </Button>
          <Button variant="secondary" block onClick={() => setOpen(false)}>
            Continue without an account
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function AccountMenu({ user }: { user: AccountUser }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const label = user.name ?? user.login;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        onClick={() => setOpen((v) => !v)}
        className="grid size-11 place-items-center rounded-full"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-9 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid size-9 place-items-center rounded-full bg-brand-soft font-black text-brand-ink" aria-hidden="true">
            {label.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-40 mt-1 w-56 rounded-2xl border border-line bg-card p-2 shadow-lg">
          <p className="truncate px-3 py-2 text-sm font-bold">
            {label}
            <span className="block truncate font-semibold text-muted">@{user.login}</span>
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await api.signOut().catch(() => undefined);
              location.reload();
            }}
            className="min-h-11 w-full rounded-xl px-3 text-left font-bold text-coral-ink hover:bg-coral-soft"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
