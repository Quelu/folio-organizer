export const getPockets = (gridRows, gridCols) => gridRows * gridCols;

const segmentCache = new WeakMap();

/**
 * Where each section of a binder starts. With ink dividers (binder.sections, see getInkSections),
 * each ink of the set and the cards numbered past it start a new page, the end of the previous page
 * staying empty. Without them, a single section holds every card.
 * @returns {{ from: number, slot: number, ink: string|null, label: string|null }[]} from: first card
 *   number; slot: its pocket, counted from the first pocket of page 1
 */
const getSegments = (binder) => {
  if (segmentCache.has(binder)) return segmentCache.get(binder);
  const pockets = getPockets(binder.gridRows, binder.gridCols);
  const sections = binder.sections ?? [];
  const first = sections[0]?.from === 1 ? sections[0] : null;
  const segments = [{ from: 1, slot: 0, ink: first?.ink ?? null, label: first?.label ?? null }];
  let empty = 0; // pockets left empty so far
  for (const { from, ink = null, label = null } of sections) {
    if (from <= segments.at(-1).from) continue;
    const slot = from - 1 + empty;
    if (slot % pockets) empty += pockets - (slot % pockets);
    segments.push({ from, slot: from - 1 + empty, ink, label });
  }
  segmentCache.set(binder, segments);
  return segments;
};

/** Pocket of a card, counted from the first pocket of page 1. */
const getSlot = (cardNumber, binder) => {
  const segments = getSegments(binder);
  const segment = segments.findLast((s) => s.from <= cardNumber) ?? segments[0];
  return segment.slot + cardNumber - segment.from;
};

/** Card number of a pocket, null for a pocket left empty before a section. */
const getCardAtSlot = (slot, binder) => {
  const segments = getSegments(binder);
  const i = segments.findLastIndex((s) => s.slot <= slot);
  const cardNumber = segments[i].from + slot - segments[i].slot;
  return segments[i + 1] && cardNumber >= segments[i + 1].from ? null : cardNumber;
};

export const getPage = (cardNumber, binder) =>
  Math.floor(getSlot(cardNumber, binder) / getPockets(binder.gridRows, binder.gridCols)) + 1;

export const getPositionInPage = (cardNumber, binder) => {
  const pockets = getPockets(binder.gridRows, binder.gridCols);
  return ((getSlot(cardNumber, binder) % pockets) + pockets) % pockets;
};

export const getRow = (position, gridCols) => Math.floor(position / gridCols);

export const getCol = (position, gridCols) => position % gridCols;

/** Physical sheet holding a grid page (recto = odd page, verso = even page). */
export const getSheet = (page) => Math.ceil(page / 2);

/**
 * Spread shown when the binder lies open: verso of sheet N on the left, recto of sheet N+1
 * on the right. Spread 0 only has page 1 on the right.
 */
export const getSpread = (page) => Math.floor(page / 2);

export const getSpreadPages = (spread) => [spread * 2 || null, spread * 2 + 1];

/**
 * Full physical location of a card in a binder.
 * @returns {{ page: number, row: number, col: number, sheet: number, side: 'recto'|'verso' }}
 */
export const getLocation = (cardNumber, binder) => {
  const page = getPage(cardNumber, binder);
  const position = getPositionInPage(cardNumber, binder);
  return {
    page,
    row: getRow(position, binder.gridCols) + 1,
    col: getCol(position, binder.gridCols) + 1,
    sheet: getSheet(page),
    side: page % 2 === 1 ? 'recto' : 'verso',
  };
};

/**
 * Card numbers of a page's pockets, in order; null for a pocket left empty before a section.
 * @param {number} page - 1-indexed page number
 * @returns {(number|null)[]}
 */
export const getCardsOnPage = (page, binder) => {
  const pockets = getPockets(binder.gridRows, binder.gridCols);
  const start = (page - 1) * pockets;
  return Array.from({ length: pockets }, (_, i) => getCardAtSlot(start + i, binder));
};

/** Pages the binder needs: the whole set, and every card owned past it. */
export const getPageCount = (binder) => {
  const last = Object.keys(binder.cards).reduce((max, num) => Math.max(max, parseInt(num, 10) || 0), binder.setSize ?? 0);
  return Math.max(1, last ? getPage(last, binder) : 1);
};

/** Section (ink or cards past the set) a page belongs to, null without ink dividers. */
export const getPageSection = (page, binder) => {
  if (!binder.sections?.length) return null;
  const slot = (page - 1) * getPockets(binder.gridRows, binder.gridCols);
  return getSegments(binder).findLast((s) => s.slot <= slot) ?? null;
};

/**
 * Parses the card input field. Accepts a single number, a quantity suffix, an "f" foil marker
 * and lists: "12", "12x3", "12f", "12fx2", "12x2f", "4, 8f 15x2".
 * @param {string} raw
 * @param {boolean} [foilMode] marks every entry as foil
 * @returns {{ cardNumber: number, qty: number, foil: boolean }[] | null} null when invalid
 */
export const parseCardInput = (raw, foilMode = false) => {
  const tokens = raw.trim().split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const entries = [];
  for (const token of tokens) {
    const single = token.match(/^(\d+)(f)?(?:[x*×](\d+))?(f)?$/i);
    if (!single) return null;
    const cardNumber = parseInt(single[1], 10);
    const qty = single[3] ? parseInt(single[3], 10) : 1;
    if (cardNumber < 1 || qty < 1 || qty > 99) return null;
    entries.push({ cardNumber, qty, foil: foilMode || Boolean(single[2] || single[4]) });
  }
  return entries;
};

/** Collection statistics for a binder. */
export const getBinderStats = (binder) => {
  const entries = Object.entries(binder.cards);
  const unique = entries.length;
  const copies = entries.reduce((s, [, c]) => s + c.quantity, 0);
  const foils = entries.reduce((s, [, c]) => s + (c.foil ?? 0), 0);
  const owned = binder.setSize
    ? entries.filter(([num]) => parseInt(num, 10) <= binder.setSize).length
    : unique;
  const progress = binder.setSize ? Math.min(1, owned / binder.setSize) : null;
  // Special / enchanted cards numbered past the set: owned, but outside the completion count
  const outOfSet = unique - owned;
  return { unique, copies, foils, owned, outOfSet, progress };
};
