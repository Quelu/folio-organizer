import { INKS, CARD_TYPES, SPECIAL_RARITIES, baseNumber, getLegality, getMainType, matchesQuery } from './catalog.js';
import { LORCANA_RARITIES } from '../data/games.js';

/**
 * Filters of the collection explorer, shared by its tabs. Empty lists mean "any".
 * inkwell: null (any), true or false. copies: buckets of copies owned by full name ('1'…'4+').
 */
export const EMPTY_FILTERS = {
  sets: [],
  inks: [],
  costs: [],
  rarities: [],
  types: [],
  inkwell: null,
  copies: [],
  foil: false,
  core: false,
  decks: [],
  binders: [],
};

export const COPY_BUCKETS = ['1', '2', '3', '4+'];

export const getCostBucket = (cost) => (cost >= 9 ? '9+' : String(cost));
export const getCopyBucket = (total) => (total >= 4 ? '4+' : String(total));

/** Number of active filters, a multi-choice filter counting once per chosen value. */
export const countFilters = (filters) =>
  Object.entries(filters).reduce(
    (n, [, value]) => n + (Array.isArray(value) ? value.length : value === null || value === false ? 0 : 1),
    0
  );

/**
 * Keeps only the filters a tab uses: the card filters everywhere, the owned-copies ones where
 * the tab lists owned copies.
 */
export const pickFilters = (filters, names) =>
  Object.fromEntries(Object.entries(EMPTY_FILTERS).map(([name, empty]) => [name, names.includes(name) ? filters[name] : empty]));

/**
 * Tests a card on its own fields (set, ink, cost, rarity, type, inkwell, Core legality), the
 * text query and the decks playing it.
 * @param {{ index: object, usage: Map<string, { deck: object }[]> }} ctx
 */
export const matchesCard = (card, filters, query, { index, usage }) => {
  if (filters.sets.length && !filters.sets.includes(card.set)) return false;
  if (filters.inks.length && !card.inks.some((i) => filters.inks.includes(i))) return false;
  if (filters.costs.length && !filters.costs.includes(getCostBucket(card.cost))) return false;
  if (filters.rarities.length && !filters.rarities.includes(card.rarity)) return false;
  if (filters.types.length && !filters.types.includes(getMainType(card))) return false;
  if (filters.inkwell !== null && card.inkwell !== filters.inkwell) return false;
  if (filters.core && getLegality(index, card.key, 'core') !== 'legal') return false;
  if (filters.decks.length && !(usage.get(card.key) ?? []).some((u) => filters.decks.includes(u.deck.id))) return false;
  return matchesQuery(card, query);
};

/** Tests the owned copies of an explorer item: binders holding them, foils, copies by full name. */
export const matchesCopies = (item, filters) => {
  if (filters.binders.length && !item.copies.some((c) => filters.binders.includes(c.binder.id))) return false;
  if (filters.foil && item.foil === 0) return false;
  if (filters.copies.length && (item.keyTotal === 0 || !filters.copies.includes(getCopyBucket(item.keyTotal)))) return false;
  return true;
};

/**
 * Owned copies by printing (a binder pocket's card), all binders together.
 * keyTotal: copies of the card under any printing, as deck rules and playsets count them.
 * @returns {Map<string, { card, key, normal, foil, total, keyTotal, copies: object[] }>} by card id
 */
export const getOwnedPrintings = (collection) => {
  const items = new Map();
  for (const entry of collection.entries.values()) {
    for (const copy of entry.copies) {
      const item = items.get(copy.card.id) ?? {
        card: copy.card,
        key: entry.key,
        normal: 0,
        foil: 0,
        total: 0,
        keyTotal: entry.total,
        copies: [],
      };
      item.normal += copy.normal;
      item.foil += copy.foil;
      item.total += copy.normal + copy.foil;
      item.copies.push(copy);
      items.set(copy.card.id, item);
    }
  }
  return items;
};

/**
 * Printings filling the pockets of a chapter, one per number: art variants 4a–4e share pocket 4,
 * the binder stores them as the first one (findPocketCard).
 */
export const getPocketPrintings = (index, setCode) => {
  const seen = new Set();
  const cards = [];
  for (const card of index.bySet.get(setCode) ?? []) {
    const n = baseNumber(card.number);
    if (seen.has(n)) continue;
    seen.add(n);
    cards.push(card);
  }
  return cards;
};

const RARITY_RANK = new Map(LORCANA_RARITIES.map((r, i) => [r.key, i]));
const INK_RANK = new Map(INKS.map((ink, i) => [ink.key, i]));
const TYPE_RANK = new Map(CARD_TYPES.map((t, i) => [t.key, i]));

const bySetNumber = (a, b) =>
  Number(a.card.set) - Number(b.card.set) ||
  baseNumber(a.card.number) - baseNumber(b.card.number) ||
  a.card.number.localeCompare(b.card.number);

// Dual-ink cards after the single inks
const inkRank = (card) => (card.inks.length > 1 ? INKS.length : (INK_RANK.get(card.inks[0]) ?? INKS.length + 1));

/** Sorts of the explorer. desc: natural direction, the rarest or most valuable first. */
export const SORTS = [
  { key: 'number', label: 'Numéro', compare: bySetNumber },
  { key: 'name', label: 'Nom', compare: (a, b, ctx) => ctx.name(a.card).localeCompare(ctx.name(b.card)) },
  { key: 'cost', label: 'Coût', compare: (a, b) => a.card.cost - b.card.cost || inkRank(a.card) - inkRank(b.card) },
  { key: 'ink', label: 'Encre', compare: (a, b) => inkRank(a.card) - inkRank(b.card) || a.card.cost - b.card.cost },
  {
    key: 'rarity',
    label: 'Rareté',
    desc: true,
    compare: (a, b) => (RARITY_RANK.get(a.card.rarity) ?? -1) - (RARITY_RANK.get(b.card.rarity) ?? -1),
  },
  { key: 'price', label: 'Prix', desc: true, compare: (a, b) => (a.price ?? -1) - (b.price ?? -1) },
  { key: 'quantity', label: 'Exemplaires', desc: true, compare: (a, b) => a.total - b.total },
];

/**
 * Sorts explorer items; ties fall back to name then set and number, in the natural direction.
 * @param {{ name: (card: object) => string }} ctx localized card names
 */
export const sortItems = (items, sortKey, reverse, ctx) => {
  const sort = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];
  const sign = (sort.desc ? -1 : 1) * (reverse ? -1 : 1);
  return [...items].sort(
    (a, b) => sign * sort.compare(a, b, ctx) || ctx.name(a.card).localeCompare(ctx.name(b.card)) || bySetNumber(a, b)
  );
};

/** Ways to split the explorer results into sections: key and rank of each card's section. */
export const GROUPS = [
  { key: 'none', label: 'Aucun' },
  { key: 'set', label: 'Chapitre', of: (card) => card.set, rank: (key) => Number(key) },
  {
    key: 'ink',
    label: 'Encre',
    of: (card) => (card.inks.length > 1 ? 'dual' : (card.inks[0] ?? '?')),
    rank: (key) => (key === 'dual' ? INKS.length : (INK_RANK.get(key) ?? INKS.length + 1)),
  },
  { key: 'cost', label: 'Coût', of: (card) => getCostBucket(card.cost), rank: (key) => parseInt(key, 10) },
  { key: 'rarity', label: 'Rareté', of: (card) => card.rarity ?? '?', rank: (key) => RARITY_RANK.get(key) ?? 99 },
  { key: 'type', label: 'Type', of: getMainType, rank: (key) => TYPE_RANK.get(key) ?? 99 },
];

/** Splits sorted items into sections, keeping their order inside each. */
export const groupItems = (items, groupKey) => {
  const group = GROUPS.find((g) => g.key === groupKey);
  if (!group?.of) return [{ key: 'all', items }];
  const sections = new Map();
  for (const item of items) {
    const key = group.of(item.card);
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(item);
  }
  return [...sections.entries()]
    .sort(([a], [b]) => group.rank(a) - group.rank(b))
    .map(([key, list]) => ({ key, items: list }));
};

/** Regular cards of the chapters, one per full name: the cards a playset is made of. */
export const getPlaysetCards = (index, sets) => {
  const cards = new Map();
  for (const set of sets) {
    for (const card of index.bySet.get(set) ?? []) {
      if (SPECIAL_RARITIES.includes(card.rarity) || cards.has(card.key)) continue;
      cards.set(card.key, card);
    }
  }
  return cards;
};
