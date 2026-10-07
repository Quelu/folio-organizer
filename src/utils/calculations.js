export const getPockets = (gridRows, gridCols) => gridRows * gridCols;

export const getPage = (cardNumber, pockets) => Math.ceil(cardNumber / pockets);

export const getPositionInPage = (cardNumber, pockets) => (cardNumber - 1) % pockets;

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
  const pockets = getPockets(binder.gridRows, binder.gridCols);
  const page = getPage(cardNumber, pockets);
  const position = getPositionInPage(cardNumber, pockets);
  return {
    page,
    row: getRow(position, binder.gridCols) + 1,
    col: getCol(position, binder.gridCols) + 1,
    sheet: getSheet(page),
    side: page % 2 === 1 ? 'recto' : 'verso',
  };
};

/**
 * Returns the list of card numbers that should appear on a given page.
 * @param {number} page - 1-indexed page number
 * @param {number} pockets - total pockets per page
 * @returns {number[]}
 */
export const getCardsOnPage = (page, pockets) => {
  const start = (page - 1) * pockets + 1;
  return Array.from({ length: pockets }, (_, i) => start + i);
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
  return { unique, copies, foils, owned, progress };
};
