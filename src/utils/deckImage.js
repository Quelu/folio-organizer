import { getInk, getMainType, CARD_TYPES } from './catalog.js';

/**
 * A deck as one PNG picture, to share on Discord or print: name, inks, format and cost curve
 * above every card with its number of copies. Browser only (canvas).
 */

const WIDTH = 1920;
const PADDING = 56;
const COLUMNS = 10;
const GAP = 16;
const CARD_WIDTH = (WIDTH - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
const CARD_HEIGHT = CARD_WIDTH * (7 / 5);
const HEADER = 260;
const FOOTER = 72;
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

const COLORS = {
  background: '#0b0d14',
  text: '#ffffff',
  muted: '#94a3b8',
  faint: '#475569',
  bar: '#8b8cf8',
  badge: 'rgba(2, 6, 23, 0.88)',
};

// Picture hosts behind the dev / preview proxy (see vite.config.js): drawn pictures must not taint the canvas
const PROXIED_HOSTS = [
  ['https://cards.lorcast.io/', '/card-images/lorcast/'],
  ['https://api.lorcana.ravensburger.com/', '/card-images/ravensburger/'],
];

const proxied = (url) => {
  const host = PROXIED_HOSTS.find(([origin]) => url.startsWith(origin));
  return host ? host[1] + url.slice(host[0].length) : url;
};

/** Loads a picture for the canvas; null when it cannot be drawn (offline, static deploy). */
const loadImage = (url) =>
  new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = proxied(url);
  });

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/** Card name on its ink color, when the picture is missing. */
const drawPlaceholder = (ctx, x, y, name, color) => {
  roundRect(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, 12);
  ctx.fillStyle = `${color}33`;
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = 'center';
  const words = name.split(' ');
  const lines = [];
  for (const word of words) {
    const line = lines.at(-1);
    if (line && ctx.measureText(`${line} ${word}`).width < CARD_WIDTH - 20) lines[lines.length - 1] = `${line} ${word}`;
    else lines.push(word);
  }
  lines.slice(0, 6).forEach((line, i) => ctx.fillText(line, x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2 - (lines.length - 1) * 10 + i * 20));
  ctx.textAlign = 'left';
};

const drawCostCurve = (ctx, curve, right, top) => {
  const barWidth = 28;
  const gap = 10;
  const height = 96;
  const max = Math.max(1, ...curve);
  const left = right - curve.length * barWidth - (curve.length - 1) * gap;
  ctx.font = `600 15px ${FONT}`;
  ctx.textAlign = 'center';
  curve.forEach((count, cost) => {
    const x = left + cost * (barWidth + gap);
    const h = (count / max) * height;
    if (count) {
      roundRect(ctx, x, top + height - h, barWidth, h, [4, 4, 0, 0]);
      ctx.fillStyle = COLORS.bar;
      ctx.fill();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(String(count), x + barWidth / 2, top + height - h - 8);
    }
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(cost === 7 ? '7+' : String(cost), x + barWidth / 2, top + height + 22);
  });
  ctx.textAlign = 'left';
};

/**
 * @param {object} p
 * @param {object} p.deck
 * @param {object} p.analysis analyzeDeck's result
 * @param {(card) => string|null} p.imageOf picture of a card in the chosen language
 * @param {(entry) => string} p.nameOf name of a deck entry in the chosen language
 * @returns {Promise<Blob>} PNG
 */
export const renderDeckImage = async ({ deck, analysis, imageOf, nameOf }) => {
  const typeOrder = CARD_TYPES.map((t) => t.key);
  const entries = [...analysis.entries].sort(
    (a, b) =>
      typeOrder.indexOf(a.card ? getMainType(a.card) : 'Character') - typeOrder.indexOf(b.card ? getMainType(b.card) : 'Character') ||
      (a.card?.cost ?? 99) - (b.card?.cost ?? 99) ||
      nameOf(a).localeCompare(nameOf(b))
  );
  const rows = Math.max(1, Math.ceil(entries.length / COLUMNS));
  const height = HEADER + rows * CARD_HEIGHT + (rows - 1) * GAP + FOOTER + PADDING;

  const [images] = await Promise.all([
    Promise.all(entries.map((e) => loadImage(e.card ? imageOf(e.card) : null))),
    document.fonts?.ready,
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#141833');
  background.addColorStop(0.35, COLORS.background);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header: name, inks and figures, cost curve on the right
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 56px ${FONT}`;
  ctx.fillText(deck.name, PADDING, PADDING + 52, WIDTH - PADDING * 2 - 420);
  let x = PADDING;
  const inkLine = PADDING + 108;
  ctx.font = `600 24px ${FONT}`;
  for (const ink of analysis.inks) {
    const { color, label } = getInk(ink);
    ctx.beginPath();
    ctx.arc(x + 10, inkLine - 8, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(label, x + 28, inkLine);
    x += 28 + ctx.measureText(label).width + 28;
  }
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 22px ${FONT}`;
  const format = deck.format === 'infinity' ? 'Infinity' : 'Core';
  const average = analysis.averageCost.toLocaleString('fr-BE', { maximumFractionDigits: 1 });
  ctx.fillText(
    `${format} · ${analysis.total} cartes · ${analysis.inkable} encrables · coût moyen ${average}`,
    PADDING,
    inkLine + 44
  );
  drawCostCurve(ctx, analysis.curve, WIDTH - PADDING, PADDING + 4);

  // Cards
  entries.forEach((entry, i) => {
    const cx = PADDING + (i % COLUMNS) * (CARD_WIDTH + GAP);
    const cy = HEADER + Math.floor(i / COLUMNS) * (CARD_HEIGHT + GAP);
    const img = images[i];
    if (img) {
      ctx.save();
      roundRect(ctx, cx, cy, CARD_WIDTH, CARD_HEIGHT, 12);
      ctx.clip();
      ctx.drawImage(img, cx, cy, CARD_WIDTH, CARD_HEIGHT);
      ctx.restore();
    } else {
      drawPlaceholder(ctx, cx, cy, nameOf(entry), getInk(entry.card?.inks[0]).color);
    }
    // Copies badge
    const label = `×${entry.qty}`;
    ctx.font = `800 26px ${FONT}`;
    const badgeWidth = ctx.measureText(label).width + 22;
    roundRect(ctx, cx + CARD_WIDTH - badgeWidth - 8, cy + CARD_HEIGHT - 46, badgeWidth, 38, 10);
    ctx.fillStyle = COLORS.badge;
    ctx.fill();
    ctx.strokeStyle = getInk(entry.card?.inks[0]).color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(label, cx + CARD_WIDTH - badgeWidth + 3, cy + CARD_HEIGHT - 18);
  });

  ctx.fillStyle = COLORS.faint;
  ctx.font = `500 18px ${FONT}`;
  const date = new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(`Folio · ${date}`, PADDING, height - PADDING / 2 - 4);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG'))), 'image/png'));
};
