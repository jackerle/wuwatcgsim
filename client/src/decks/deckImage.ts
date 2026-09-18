// Renders a deck as one shareable PNG: a leader row up top (so whoever you
// send it to knows the team at a glance), then every action card in the
// deck with its copy count — in the same order the builder's own card pool
// shows them, so the picture matches what building it looked like.

import { allImageIds, cardPoolFor, getCard, type DeckList } from "@wuwatcg/shared";
import { portraitOf } from "./portraits";

const CARD_W = 110;
const CARD_H = Math.round((CARD_W * 7) / 5);
const GAP = 14;
const COLUMNS = 8;
const PADDING = 28;
const LEADER_W = 150;
const LEADER_H = Math.round((LEADER_W * 7) / 5);

const COLOR_HEX: Record<string, string> = { red: "#ff8a8a", green: "#8be0a8", blue: "#8ab8ff" };

/** Every file that might hold a card's art, best first — same fallback chain CardArt uses. */
function imageUrls(cardId: string | undefined, imageId: string): string[] {
  const definition = cardId ? getCard(cardId) : undefined;
  const fromDb = definition ? allImageIds(definition) : [];
  return [...new Set([imageId, ...fromDb])].map((id) => `/cards/${id}.jpg`);
}

/** Tries each candidate URL in turn; null once none of them load. */
function loadImage(urls: string[]): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        i += 1;
        tryNext();
      };
      img.src = urls[i];
    };
    tryNext();
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws `img` covering the box exactly, cropping rather than squashing. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 8
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#20242f";
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
}

export interface DeckImageLabels {
  leaders: string;
  cards: string;
  total: (n: number) => string;
}

/** Builds the deck-list PNG and hands back a data: URL ready to show or download. */
export async function renderDeckImage(deck: DeckList, labels: DeckImageLabels): Promise<string> {
  const leaders = deck.characters.map((name) => portraitOf(name));
  const pool = cardPoolFor(deck.characters).filter((card) => (deck.cards[card.id] ?? 0) > 0);
  const total = pool.reduce((sum, card) => sum + (deck.cards[card.id] ?? 0), 0);

  // Every image the picture needs, fetched in parallel — most of this is
  // already sitting in the browser's cache from the deck screen's own
  // warm-up (see board/imagePreload.ts), so this is rarely a real wait.
  const [leaderImages, cardImages] = await Promise.all([
    Promise.all(leaders.map((art) => (art ? loadImage(imageUrls(art.id, art.imageId)) : Promise.resolve(null)))),
    Promise.all(pool.map((card) => loadImage(imageUrls(card.id, card.imageId)))),
  ]);

  const rows = Math.max(1, Math.ceil(pool.length / COLUMNS));
  const width = PADDING * 2 + COLUMNS * CARD_W + (COLUMNS - 1) * GAP;
  const titleH = 56;
  const leaderSectionH = leaders.length > 0 ? 24 + LEADER_H + 22 : 0;
  const cardsLabelH = 24;
  const cardsH = rows * CARD_H + (rows - 1) * GAP;
  const footerH = 30;
  const height = PADDING + titleH + leaderSectionH + cardsLabelH + cardsH + footerH + PADDING;

  const canvas = document.createElement("canvas");
  const scale = 2; // export at 2x so it stays crisp when shared/zoomed
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#171b27");
  bg.addColorStop(1, "#10131a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = "top";
  ctx.fillStyle = "#e6e8ef";
  ctx.font = "700 24px 'Segoe UI', sans-serif";
  ctx.fillText(deck.name || "-", PADDING, PADDING);
  ctx.font = "400 13px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#8b93a8";
  ctx.fillText(labels.total(total), PADDING, PADDING + 30);

  let y = PADDING + titleH;

  if (leaders.length > 0) {
    ctx.fillStyle = "#f0b23f";
    ctx.font = "700 12px 'Segoe UI', sans-serif";
    ctx.fillText(labels.leaders.toUpperCase(), PADDING, y);
    y += 24;
    let x = PADDING;
    for (const img of leaderImages) {
      if (img) drawCover(ctx, img, x, y, LEADER_W, LEADER_H, 10);
      else drawPlaceholder(ctx, x, y, LEADER_W, LEADER_H);
      x += LEADER_W + GAP;
    }
    y += LEADER_H + 22;
  }

  ctx.fillStyle = "#f0b23f";
  ctx.font = "700 12px 'Segoe UI', sans-serif";
  ctx.fillText(labels.cards.toUpperCase(), PADDING, y);
  y += cardsLabelH;

  pool.forEach((card, index) => {
    const copies = deck.cards[card.id] ?? 0;
    const col = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = PADDING + col * (CARD_W + GAP);
    const cy = y + row * (CARD_H + GAP);

    const img = cardImages[index];
    if (img) drawCover(ctx, img, x, cy, CARD_W, CARD_H, 8);
    else drawPlaceholder(ctx, x, cy, CARD_W, CARD_H);

    // Cost chip, top-left — same corner CardBuilder's own pool uses.
    roundRect(ctx, x + 4, cy + 4, 22, 18, 4);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fill();
    ctx.fillStyle = COLOR_HEX[card.color] ?? "#e6e8ef";
    ctx.font = "700 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(card.cost), x + 15, cy + 7);

    // Copy-count badge, bottom-right.
    const bx = x + CARD_W - 20;
    const by = cy + CARD_H - 20;
    ctx.beginPath();
    ctx.arc(bx, by, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#f0b23f";
    ctx.fill();
    ctx.fillStyle = "#17130a";
    ctx.font = "700 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(copies), bx, by + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  });

  ctx.fillStyle = "#4b5166";
  ctx.font = "700 11px 'Segoe UI', sans-serif";
  ctx.fillText("WUWATCGSIM", PADDING, height - PADDING - 12);

  return canvas.toDataURL("image/png");
}
