import { generate } from "lean-qr";

/** Blank modules around the code; scanners need at least 4. */
const QUIET_ZONE = 4;

/** The SVG path of a QR code for `text`, and the side of its square viewBox in modules. */
export function qrPath(text: string): { d: string; size: number } {
  const code = generate(text);
  let d = "";
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.get(x, y)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { d, size: code.size + QUIET_ZONE * 2 };
}
