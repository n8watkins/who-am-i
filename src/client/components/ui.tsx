import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { navigate } from "../lib/router";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-[0_3px_0_var(--color-brand-dark)] hover:bg-brand-dark active:translate-y-px",
  secondary: "bg-card text-ink border-2 border-line hover:border-brand/50 hover:bg-brand-soft/40",
  ghost: "bg-transparent text-brand hover:bg-brand-soft",
  danger: "bg-card text-coral border-2 border-coral/40 hover:bg-coral-soft",
  success: "bg-mint text-white shadow-[0_3px_0_#0a5a45] hover:brightness-95 active:translate-y-px",
};

export function Button({
  variant = "primary",
  block = false,
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      {...props}
      className={[
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-2xl px-5 font-bold transition",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:translate-y-0",
        size === "lg" ? "py-3.5 text-lg" : "py-2.5 text-base",
        block ? "w-full" : "",
        VARIANTS[variant],
        className,
      ].join(" ")}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-line bg-card p-5 shadow-sm sm:p-6 ${className}`}>{children}</section>;
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#4c35b5" />
      <circle cx="32" cy="32" r="21" fill="#fff6e9" />
      <path d="M25.5 26.5a6.5 6.5 0 1 1 9.4 5.8c-1.9 1-2.9 2.3-2.9 4.2v1.5" fill="none" stroke="#4c35b5" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="45" r="3" fill="#ff6b4a" />
    </svg>
  );
}

export function Shell({ children, wide = false, aside }: { children: ReactNode; wide?: boolean; aside?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex min-h-11 items-center gap-2.5 rounded-xl pr-2 text-xl font-extrabold tracking-tight"
        >
          <Logo size={36} />
          <span>Who Am I?</span>
        </a>
        {aside}
      </header>
      {/* On phones, reserve room for the sticky turn action bar (its height is published as --action-bar-h). */}
      <main
        className={`mx-auto w-full flex-1 px-4 pb-[calc(2.5rem+var(--action-bar-h,0px))] pt-4 sm:px-6 sm:pb-10 ${wide ? "max-w-5xl" : "max-w-lg"}`}
      >
        {children}
      </main>
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        className={`min-h-12 rounded-2xl border-2 border-line bg-white px-4 text-lg font-semibold text-ink placeholder:font-normal placeholder:text-muted/70 focus:border-brand focus:outline-none ${className}`}
      />
      {(hint || error) && (
        <p id={`${id}-hint`} className={`text-sm ${error ? "font-semibold text-coral" : "text-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

type Tone = "info" | "warn" | "error" | "success";
const TONES: Record<Tone, string> = {
  info: "bg-brand-soft text-brand-dark border-brand/20",
  warn: "bg-amber-soft text-amber border-amber/20",
  error: "bg-coral-soft text-[#9b2c12] border-coral/30",
  success: "bg-mint-soft text-mint border-mint/20",
};
const TONE_ICONS: Record<Tone, string> = { info: "i", warn: "!", error: "!", success: "✓" };

export function Banner({
  tone = "info",
  children,
  onDismiss,
  role,
}: {
  tone?: Tone;
  children: ReactNode;
  onDismiss?: () => void;
  role?: "status" | "alert";
}) {
  return (
    <div role={role} className={`animate-pop flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${TONES[tone]}`}>
      <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-current/15 text-xs font-black">
        {TONE_ICONS[tone]}
      </span>
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="-m-2 grid min-h-11 min-w-11 place-items-center rounded-xl" aria-label="Dismiss message">
          <span aria-hidden="true" className="text-lg leading-none">
            {"×"}
          </span>
        </button>
      )}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "mint" | "coral" | "amber" }) {
  const tones = {
    neutral: "bg-paper text-muted border-line",
    brand: "bg-brand-soft text-brand-dark border-brand/20",
    mint: "bg-mint-soft text-mint border-mint/25",
    coral: "bg-coral-soft text-[#9b2c12] border-coral/25",
    amber: "bg-amber-soft text-amber border-amber/25",
  };
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-muted">
      <span className="size-8 rounded-full border-4 border-brand-soft border-t-brand motion-safe:animate-spin" aria-hidden="true" />
      <span className="font-semibold">{label}</span>
    </div>
  );
}

/** Modal dialog built on <dialog>, which provides focus trapping and Escape to close. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl bg-card p-0 text-ink shadow-2xl backdrop:bg-ink/50"
    >
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-xl font-extrabold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-paper" aria-label="Close">
            <span aria-hidden="true" className="text-2xl leading-none">
              {"×"}
            </span>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function HowToPlay() {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      <ol className="space-y-3">
        {[
          ["Get a secret identity.", "Each player is assigned a famous person, character or mascot. You can see your opponent's, but never your own."],
          ["Take turns guessing.", "On your turn, ask yes/no questions (20 Questions) or listen to clues (Describe It) until you know who you are."],
          ["Say your guess out loud.", "Tap I Guessed It. Your opponent confirms if you got it right. A correct guess scores 1 point; a skip scores 0."],
          ["Win the match.", "First to 5 points, or the best score after 10 rounds, depending on the room's settings."],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft font-extrabold text-brand" aria-hidden="true">
              {i + 1}
            </span>
            <p>
              <strong>{title}</strong> {body}
            </p>
          </li>
        ))}
      </ol>
      <p className="rounded-2xl bg-paper p-3 text-sm text-muted">Play side by side or on a call. Each player uses their own phone.</p>
    </div>
  );
}
