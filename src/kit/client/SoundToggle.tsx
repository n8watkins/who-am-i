// Party kit: the mute switch for sound and vibration. Styled with the collection's shared theme
// tokens (text-muted, bg-brand-soft), so every game that uses the kit theme gets the same control.
import { useFeedback } from "./feedback";

export function SoundToggle({ className = "" }: { className?: string }) {
  const { muted, setMuted } = useFeedback();
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      aria-label="Sound and vibration"
      title={muted ? "Sound and vibration are off" : "Sound and vibration are on"}
      data-testid="sound-toggle"
      className={`grid min-h-11 min-w-11 place-items-center rounded-xl text-muted transition hover:bg-brand-soft hover:text-brand-ink ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
        {muted ? (
          <path d="m16 9 6 6m0-6-6 6" />
        ) : (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        )}
      </svg>
    </button>
  );
}
