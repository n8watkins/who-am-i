import { useState } from "react";
import { Button, Dialog, HowToPlay, Shell } from "../components/ui";
import { navigate } from "../lib/router";

export function Landing() {
  const [howOpen, setHowOpen] = useState(false);
  return (
    <Shell>
      <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
        <IdentityIllustration />
        <h1 className="mt-8 text-balance text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Who are you?
          <br />
          <span className="text-brand">Your friend knows.</span>
        </h1>
        <p className="mt-4 max-w-sm text-lg text-muted">
          A two-player guessing game. You each get a secret identity, and only your opponent can see yours.
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
          <Button size="lg" block onClick={() => navigate("/new")}>
            Create game
          </Button>
          <Button size="lg" variant="secondary" block onClick={() => navigate("/join")}>
            Join with a code
          </Button>
          <Button variant="ghost" onClick={() => setHowOpen(true)} className="mx-auto">
            How to play
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted">No account needed. Two phones, about 30 seconds to start.</p>
      </div>
      <Dialog open={howOpen} onClose={() => setHowOpen(false)} title="How to play">
        <HowToPlay />
      </Dialog>
    </Shell>
  );
}

/** Two cards: the one you can see (your opponent's) and your own, hidden. */
function IdentityIllustration() {
  return (
    <div className="relative h-40 w-64" aria-hidden="true">
      <div className="absolute left-2 top-4 h-32 w-36 -rotate-6 rounded-3xl border-2 border-line bg-white p-4 text-left shadow-md">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Opponent</div>
        <div className="mt-2 h-3 w-24 rounded-full bg-brand/80" />
        <div className="mt-2 h-3 w-16 rounded-full bg-brand/30" />
        <div className="mt-5 inline-block rounded-full bg-mint-soft px-2 py-0.5 text-[10px] font-bold text-mint">visible</div>
      </div>
      <div className="absolute right-2 top-0 grid h-32 w-36 rotate-6 place-items-center rounded-3xl bg-brand text-white shadow-lg">
        <div className="text-center">
          <div className="text-5xl font-black leading-none">?</div>
          <div className="mt-2 text-[10px] font-extrabold uppercase tracking-wider text-white/80">You</div>
        </div>
      </div>
    </div>
  );
}
