export const getPockets = (gridRows, gridCols) => gridRows * gridCols;

export const getPage = (cardNumber, pockets) => Math.ceil(cardNumber / pockets);

export const getPositionInPage = (cardNumber, pockets) => (cardNumber - 1) % pockets;

export const getRow = (position, gridCols) => Math.floor(position / gridCols);

export const getCol = (position, gridCols) => position % gridCols;

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
