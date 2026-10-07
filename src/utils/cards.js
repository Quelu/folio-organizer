/**
 * A stored card is { quantity, foil, exportedQuantity, exportedFoil, imageUrl }:
 * quantity and exportedQuantity are totals, foil and exportedFoil the foil part of them.
 * Cards saved before foils existed simply have no foil fields.
 */

/** Normal / foil copies of a card. */
export const getCounts = (card) => {
  const foil = card?.foil ?? 0;
  return { normal: (card?.quantity ?? 0) - foil, foil };
};

/** Normal / foil copies already exported to Dreamborn. */
export const getExportedCounts = (card) => {
  const foil = card?.exportedFoil ?? 0;
  return { normal: (card?.exportedQuantity ?? 0) - foil, foil };
};

/** Returns the cards map with new counts for one card, keeping export marks consistent. */
export const withCounts = (cards, numStr, normal, foil) => {
  const next = { ...cards };
  const n = Math.max(0, normal);
  const f = Math.max(0, foil);
  if (n + f === 0) {
    delete next[numStr];
    return next;
  }
  const existing = cards[numStr];
  const exported = getExportedCounts(existing);
  const exportedNormal = Math.min(exported.normal, n);
  const exportedFoil = Math.min(exported.foil, f);
  next[numStr] = {
    quantity: n + f,
    foil: f,
    exportedQuantity: exportedNormal + exportedFoil,
    exportedFoil,
    imageUrl: existing?.imageUrl ?? null,
  };
  return next;
};

/** Adds (qty > 0) or removes (qty < 0) copies of one variant. Removal falls back to the other variant. */
export const changeCopies = (cards, numStr, qty, foil) => {
  const { normal, foil: foils } = getCounts(cards[numStr]);
  if (qty >= 0) {
    return foil ? withCounts(cards, numStr, normal, foils + qty) : withCounts(cards, numStr, normal + qty, foils);
  }
  let toRemove = -qty;
  let n = normal;
  let f = foils;
  const take = (have) => {
    const removed = Math.min(have, toRemove);
    toRemove -= removed;
    return have - removed;
  };
  if (foil) {
    f = take(f);
    n = take(n);
  } else {
    n = take(n);
    f = take(f);
  }
  return withCounts(cards, numStr, n, f);
};
