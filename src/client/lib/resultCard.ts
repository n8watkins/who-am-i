// Paints the Who Am I? result card (1200x630 PNG) in the browser from the match summary the
// player already sees, so every nickname renders with the phone's own fonts, emoji included.
// It shows names, scores, the category and the round count: never an identity.
import { CARD_HEIGHT, CARD_WIDTH } from "../../kit/shared/share-cards";
import type { RoomView } from "../../shared/protocol";

const FONT = '"Nunito Variable", "Segoe UI", system-ui, sans-serif';
const INK = "#1d1a2e";
const CREAM = "#fff8ef";
const BRAND = "#4c35b5";
const CORAL = "#ff6b4a";
const AMBER = "#f5b52e";

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function resultHeadline(view: RoomView): string {
  const match = view.matchSummary;
  if (!match || match.tie) return "It's a tie!";
  const winner = view.players.find((p) => p.playerId === match.winnerId);
  return `${winner?.nickname ?? "Someone"} wins!`;
}

export async function paintResultCard(view: RoomView): Promise<{ blob: Blob; previewUrl: string }> {
  await Promise.all(["900 88px", "800 44px", "700 30px"].map((f) => document.fonts.load(`${f} "Nunito Variable"`).catch(() => [])));
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  const match = view.matchSummary!;
  const players = [...view.players].sort((a, b) => a.seat.localeCompare(b.seat));

  // Background: flat brand purple with two soft circles. Flat colors keep the PNG small
  // (a gradient makes it several times larger).
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = "#5841c4";
  ctx.beginPath();
  ctx.arc(1110, 70, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(60, 640, 180, 0, Math.PI * 2);
  ctx.fill();

  // Logo and name.
  roundRect(ctx, 72, 56, 72, 72, 18);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.fillStyle = BRAND;
  ctx.font = `900 50px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", 108, 90);
  ctx.fillStyle = CORAL;
  ctx.beginPath();
  ctx.arc(126, 112, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 40px ${FONT}`;
  ctx.fillText("Who Am I?", 164, 92);

  // Headline.
  ctx.textAlign = "center";
  ctx.font = `900 84px ${FONT}`;
  ctx.fillText(fit(ctx, resultHeadline(view), 1040), CARD_WIDTH / 2, 222);

  // Two score cards.
  const cardW = 440;
  const cardH = 200;
  const top = 300;
  players.forEach((p, i) => {
    const x = i === 0 ? 120 : CARD_WIDTH - 120 - cardW;
    const won = !match.tie && p.playerId === match.winnerId;
    roundRect(ctx, x, top, cardW, cardH, 32);
    ctx.fillStyle = CREAM;
    ctx.fill();
    if (won) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = AMBER;
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = `800 42px ${FONT}`;
    ctx.fillText(fit(ctx, p.nickname, cardW - 60), x + cardW / 2, top + 58);
    ctx.font = `900 96px ${FONT}`;
    ctx.fillStyle = won ? BRAND : INK;
    ctx.fillText(String(p.score), x + cardW / 2, top + 140);
  });
  ctx.fillStyle = "#e4defa";
  ctx.font = `900 56px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("vs", CARD_WIDTH / 2, top + cardH / 2);

  // Footer line.
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillStyle = "#e4defa";
  ctx.fillText(`${view.pack.name} · ${match.rounds} ${match.rounds === 1 ? "round" : "rounds"}`, 72, 572);
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(location.host, CARD_WIDTH - 72, 572);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the card."))), "image/png"));
  return { blob, previewUrl: canvas.toDataURL("image/png") };
}
