import { normalizeName, baseNumber } from './catalog.js';

/** Cardmarket public files for Lorcana singles (game 19), fetched through the dev server proxy. */
export const CARDMARKET_PRODUCTS_URL = '/cardmarket/productCatalog/productList/products_singles_19.json';
export const CARDMARKET_PRICES_URL = '/cardmarket/productCatalog/priceGuide/price_guide_19.json';

const positive = (...values) => values.find((v) => typeof v === 'number' && v > 0) ?? null;

const groupBy = (items, getKey) => {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

/**
 * Matches Cardmarket prices to catalog printings.
 *
 * Cardmarket products carry no collector number, only "Name - Version" and an expansion id.
 * Each Lorcast set is paired with the expansion sharing the most card names; inside it, the
 * printings of a same card (regular, Enchanted, Epic…) are paired in order: idProduct order on
 * Cardmarket, collector number order on Lorcast.
 *
 * @param {object[]} products products_singles_19.json `products`
 * @param {object[]} priceGuides price_guide_19.json `priceGuides`
 * @param {object} index catalog index
 * @returns {Map<string, { eur: number|null, eurFoil: number|null }>} by catalog card id
 */
export const matchCardmarketPrices = (products, priceGuides, index) => {
  const guides = new Map(priceGuides.map((g) => [g.idProduct, g]));
  const named = products.map((p) => ({ ...p, key: normalizeName(p.name) }));
  const byExpansion = groupBy(named, (p) => p.idExpansion);
  const prices = new Map();

  for (const cards of index.bySet.values()) {
    const keys = new Set(cards.map((c) => c.key));
    let best = null;
    let bestOverlap = 0;
    for (const expansionProducts of byExpansion.values()) {
      const overlap = expansionProducts.filter((p) => keys.has(p.key)).length;
      if (overlap > bestOverlap) {
        best = expansionProducts;
        bestOverlap = overlap;
      }
    }
    // Too few shared names: promo or unrelated expansion, better no price than a wrong one
    if (!best || bestOverlap < cards.length / 4) continue;

    const productGroups = groupBy(
      [...best].sort((a, b) => a.idProduct - b.idProduct),
      (p) => p.key
    );
    const cardGroups = groupBy(
      [...cards].sort((a, b) => baseNumber(a.number) - baseNumber(b.number) || a.number.localeCompare(b.number)),
      (c) => c.key
    );
    for (const [key, group] of cardGroups) {
      const matching = productGroups.get(key) ?? [];
      group.slice(0, matching.length).forEach((card, i) => {
        const guide = guides.get(matching[i].idProduct);
        if (!guide) return;
        prices.set(card.id, {
          eur: positive(guide.trend, guide.avg30),
          eurFoil: positive(guide['trend-foil'], guide['avg30-foil']),
        });
      });
    }
  }
  return prices;
};
