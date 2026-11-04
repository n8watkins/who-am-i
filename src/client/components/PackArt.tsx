// Original placeholder art for each category, and a portrait built from it. These are simple
// drawn shapes on purpose: no real person's likeness and no character or brand artwork.
import type { ReactNode } from "react";
import { PACK_ORDER } from "../../shared/packs";
import type { PackId } from "../../shared/protocol";

const LIGHT = "#fff8ef";

const ART: Record<PackId, { from: string; to: string; shape: ReactNode }> = {
  mixed: {
    from: "#4c35b5",
    to: "#8a6fe8",
    shape: (
      <>
        <rect x="26" y="28" width="48" height="48" rx="11" fill={LIGHT} transform="rotate(-10 50 52)" />
        <circle cx="39" cy="44" r="4.5" fill="#4c35b5" />
        <circle cx="52" cy="53" r="4.5" fill="#4c35b5" />
        <circle cx="65" cy="62" r="4.5" fill="#4c35b5" />
      </>
    ),
  },
  actors: {
    from: "#c2410c",
    to: "#f59e0b",
    shape: (
      <>
        <path d="M50 18l9.4 19.6 21.6 2.9-15.8 15 3.9 21.400L50 66.5 30.9 77.900l3.9-21.4-15.8-15 21.6-2.900z" fill={LIGHT} />
        <circle cx="50" cy="49" r="6" fill="#c2410c" />
      </>
    ),
  },
  "movie-characters": {
    from: "#0f766e",
    to: "#34d399",
    shape: (
      <>
        <circle cx="50" cy="50" r="31" fill={LIGHT} />
        <circle cx="50" cy="50" r="6" fill="#0f766e" />
        {[0, 72, 144, 216, 288].map((deg) => (
          <circle key={deg} cx="50" cy="30" r="8" fill="#0f766e" transform={`rotate(${deg} 50 50)`} />
        ))}
      </>
    ),
  },
  "historical-figures": {
    from: "#57534e",
    to: "#c4a35a",
    shape: (
      <>
        <path d="M50 20L80 36H20z" fill={LIGHT} />
        <rect x="26" y="40" width="9" height="30" rx="2" fill={LIGHT} />
        <rect x="45.5" y="40" width="9" height="30" rx="2" fill={LIGHT} />
        <rect x="65" y="40" width="9" height="30" rx="2" fill={LIGHT} />
        <rect x="19" y="72" width="62" height="8" rx="3" fill={LIGHT} />
      </>
    ),
  },
  "video-games": {
    from: "#1d4ed8",
    to: "#22d3ee",
    shape: (
      <>
        <rect x="16" y="33" width="68" height="38" rx="19" fill={LIGHT} />
        <rect x="29" y="49" width="17" height="6" rx="2" fill="#1d4ed8" />
        <rect x="34.5" y="43.5" width="6" height="17" rx="2" fill="#1d4ed8" />
        <circle cx="62" cy="56" r="4.5" fill="#1d4ed8" />
        <circle cx="71" cy="47" r="4.5" fill="#1d4ed8" />
      </>
    ),
  },
  "brand-mascots": {
    from: "#be123c",
    to: "#fb7185",
    shape: (
      <>
        <circle cx="50" cy="50" r="31" fill={LIGHT} />
        <circle cx="39" cy="44" r="5" fill="#be123c" />
        <circle cx="61" cy="44" r="5" fill="#be123c" />
        <path d="M34 57c4 11 28 11 32 0" fill="none" stroke="#be123c" strokeWidth="5.5" strokeLinecap="round" />
      </>
    ),
  },
  "anime-cartoons": {
    from: "#a21caf",
    to: "#f472b6",
    shape: (
      <>
        <path d="M50 14l9 18 19-7-7 19 18 9-18 9 7 19-19-7-9 18-9-18-19 7 7-19-18-9 18-9-7-19 19 7z" fill={LIGHT} />
        <path d="M43 40v14M57 40v14" stroke="#a21caf" strokeWidth="6" strokeLinecap="round" />
      </>
    ),
  },
};

const isPack = (id: string): id is PackId => (PACK_ORDER as string[]).includes(id);

const background = (pack: PackId) => `linear-gradient(135deg, ${ART[pack].from}, ${ART[pack].to})`;

export function PackArt({ pack, className = "" }: { pack: PackId; className?: string }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-2xl ${className}`} style={{ background: background(pack) }} aria-hidden="true">
      <svg viewBox="0 0 100 100" focusable="false" className="aspect-square max-h-full max-w-full">
        {ART[pack].shape}
      </svg>
    </span>
  );
}

function initials(name: string): string {
  const words = name.replace(/^the\s+/i, "").split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

/** A stand-in portrait: the identity's initials on their category's colors. */
export function Portrait({ name, categoryId, className = "" }: { name: string; categoryId: string; className?: string }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-2xl font-black text-white ${className}`}
      style={{ background: background(isPack(categoryId) ? categoryId : "mixed") }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
