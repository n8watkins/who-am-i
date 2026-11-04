import { useState } from "react";
import { PackArt } from "../components/PackArt";
import { Button, Dialog, HowToPlay, Shell } from "../components/ui";
import { navigate } from "../lib/router";

export function Landing() {
  const [howOpen, setHowOpen] = useState(false);
  return (
    <Shell wide>
      <div className="grid items-center gap-8 pt-6 md:min-h-[70dvh] md:grid-cols-2 md:gap-12 md:pt-0">
        <div className="flex flex-col items-center text-center md:items-start md:text-left">
          <h1 className="text-balance text-4xl font-extrabold leading-tight tracking-tight lg:text-6xl">
            Who are you?
            <br />
            <span className="text-brand">Your friend knows.</span>
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted">
            A two-player guessing game. You each get a secret identity, and only your opponent can see yours.
          </p>
          <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
            <Button size="lg" block onClick={() => navigate("/new")}>
              Create game
            </Button>
            <Button size="lg" variant="secondary" block onClick={() => navigate("/join")}>
              Join with PIN or code
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" onClick={() => setHowOpen(true)}>
              How to play
            </Button>
            <span className="text-sm text-muted">No account needed.</span>
          </div>
        </div>
        <CategoryFan />
      </div>
      <Dialog open={howOpen} onClose={() => setHowOpen(false)} title="How to play">
        <HowToPlay />
      </Dialog>
    </Shell>
  );
}

/** A loose hand of category cards. */
function CategoryFan() {
  const packs = ["actors", "historical-figures", "video-games", "anime-cartoons", "brand-mascots", "movie-characters"] as const;
  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-2.5 md:max-w-md md:gap-4" aria-hidden="true">
      {packs.map((pack, i) => (
        <PackArt key={pack} pack={pack} className={`w-full shadow-md ${i % 2 ? "translate-y-3 rotate-2" : "-rotate-2"}`} />
      ))}
    </div>
  );
}
