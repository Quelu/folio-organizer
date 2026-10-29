import { SPECIAL_RARITIES, baseNumber } from './catalog.js';
import { getWantList } from './wantList.js';
import { LORCANA_RARITIES } from '../data/games.js';

/**
 * Trades between two players: the cards one of them looks for against the surplus copies of the
 * other, both ways, and balanced trades under three rules.
 *
 * A want is { id, key, card, qty, for }: for 'binder', an empty pocket asking for that printing;
 * for 'deck', copies a deck misses under any printing (id names one for display).
 * A trade item is a surplus copy answering wants: { id, key, card, foil, qty, price, for: string[] }.
 */

/**
 * Points of the rarities for trades by points, and the factor of a foil copy. By default each
 * rarity is worth twice the one below (1 rare = 2 uncommons = 4 commons), a foil twice its rarity.
 * The user can change them (prefs.tradePoints).
 */
export const DEFAULT_TRADE_POINTS = {
  rarities: {
    Common: 1,
    Uncommon: 2,
    Rare: 4,
    Super_rare: 8,
    Legendary: 16,
    Epic: 32,
    Enchanted: 64,
    Iconic: 128,
  },
  foil: 2,
};

/** A saved scale completed with the default points (rarities added since, older saves). */
export const getPointsScale = (saved) => ({
  rarities: { ...DEFAULT_TRADE_POINTS.rarities, ...saved?.rarities },
  foil: saved?.foil ?? DEFAULT_TRADE_POINTS.foil,
});

export const isDefaultPointsScale = (scale) =>
  scale.foil === DEFAULT_TRADE_POINTS.foil &&
  Object.entries(DEFAULT_TRADE_POINTS.rarities).every(([key, points]) => scale.rarities[key] === points);

export const formatPoints = (points) => points.toLocaleString('fr-BE', { maximumFractionDigits: 2 });

/** "Commune 1 · Peu commune 2 · … · foil ×2" */
export const describePointsScale = (scale) =>
  `${LORCANA_RARITIES.filter((r) => scale.rarities[r.key] != null)
    .map((r) => `${r.label} ${formatPoints(scale.rarities[r.key])}`)
    .join(' · ')} · foil ×${formatPoints(scale.foil)}`;

/** Two prices are even within this share of the larger one. */
export const VALUE_TOLERANCE = 0.05;

export const TRADE_RULES = [
  {
    key: 'rarity',
    label: 'Même rareté',
    hint: 'Une commune pour une commune, une rare pour une rare, foil pour foil.',
  },
  {
    key: 'points',
    label: 'Points de rareté',
    hint: 'Chaque rareté vaut le double de la précédente : 1 rare = 2 peu communes = 4 communes. Un foil compte double.',
  },
  {
    key: 'value',
    label: 'Valeur égale',
    hint: 'Les prix du marché des deux côtés s’équilibrent à 5 % près.',
  },
];

// Alternate arts only exist in foil: their foil copies are no rarer than the others
const isFoilTier = (card, foil) => foil && !SPECIAL_RARITIES.includes(card.rarity);

/** Rarity tier a copy trades in: its rarity, foils apart. */
export const getTradeClass = (card, foil) => `${card.rarity ?? '?'}${isFoilTier(card, foil) ? ':foil' : ''}`;

export const getTradePoints = (card, foil, scale = DEFAULT_TRADE_POINTS) =>
  (scale.rarities[card.rarity] ?? 1) * (isFoilTier(card, foil) ? scale.foil : 1);

/** A rule's explanation; the points one follows the user's scale. */
export const getRuleHint = (rule, scale = DEFAULT_TRADE_POINTS) => {
  if (rule.key !== 'points' || isDefaultPointsScale(scale)) return rule.hint;
  const first = LORCANA_RARITIES.slice(0, 3)
    .map((r) => `${r.label.toLowerCase()} ${formatPoints(scale.rarities[r.key])}`)
    .join(', ');
  return `Chaque carte vaut les points de sa rareté : ${first}… Un foil compte ×${formatPoints(scale.foil)}.`;
};

const RARITY_RANK = new Map(LORCANA_RARITIES.map((r, i) => [r.key, i]));

/** Tiers from the most common to the rarest, each foil tier after its normal one. */
export const compareTradeClasses = (a, b) => {
  const [ra, fa] = a.split(':');
  const [rb, fb] = b.split(':');
  return (RARITY_RANK.get(ra) ?? 99) - (RARITY_RANK.get(rb) ?? 99) || Boolean(fa) - Boolean(fb);
};

export const getTradeClassLabel = (tradeClass) => {
  const [rarity, foil] = tradeClass.split(':');
  const label = LORCANA_RARITIES.find((r) => r.key === rarity)?.label ?? (rarity === '?' ? 'Rareté inconnue' : rarity);
  return { label, foil: Boolean(foil) };
};

/** Binder pocket of a printing: art variants 4a–4e fill pocket 4. */
const pocketOf = (card) => `${card.set}-${baseNumber(card.number)}`;

/**
 * Cards the user looks for: the want list of the given binders and decks (see getWantList), the
 * empty pockets one by one and the copies the decks miss, one want per card.
 * @param {{ binders: object[], decks: object[], index: object, collection: object,
 *   groups?: object[], allocations?: object, specials?: boolean }} options decks: the ones to take into account
 * @returns {object[]} wants
 */
export const getWants = (options) => {
  const { binders, units } = getWantList(options);
  const wants = binders.flatMap((b) =>
    b.wanted.map(({ card }) => ({ id: card.id, key: card.key, card, qty: 1, for: 'binder' }))
  );
  const deckMissing = new Map();
  for (const line of units.flatMap((u) => u.cards)) {
    if (!line.card || line.missing <= 0) continue;
    const want = deckMissing.get(line.key) ?? { id: line.card.id, key: line.key, card: line.card, qty: 0, for: 'deck' };
    want.qty += line.missing;
    deckMissing.set(line.key, want);
  }
  return [...wants, ...deckMissing.values()];
};

/**
 * Surplus copies answering wants. For each card, the binders' printings first (a copy filling a
 * pocket also counts for the decks, which pull their cards from the binders), then any printing
 * for the copies the decks still miss; normal copies before foils, the cheapest first.
 * @param {object[]} wants
 * @param {{ id, key, card, foil, qty, price }[]} haves
 * @returns {object[]} trade items, the copies they hold capped to what is wanted
 */
export const matchWants = (wants, haves) => {
  const havesByKey = new Map();
  for (const have of haves) havesByKey.set(have.key, [...(havesByKey.get(have.key) ?? []), have]);
  const wantsByKey = new Map();
  for (const want of wants) wantsByKey.set(want.key, [...(wantsByKey.get(want.key) ?? []), want]);

  const items = [];
  for (const [key, list] of wantsByKey) {
    const pool = (havesByKey.get(key) ?? [])
      .map((have) => ({ have, left: have.qty }))
      .sort((a, b) => a.have.foil - b.have.foil || (a.have.price ?? 0) - (b.have.price ?? 0));
    if (pool.length === 0) continue;
    const taken = new Map();
    const take = (slot, qty, reasons) => {
      slot.left -= qty;
      const item = taken.get(slot.have.id) ?? { ...slot.have, qty: 0, for: [] };
      item.qty += qty;
      item.for = [...new Set([...item.for, ...reasons])];
      taken.set(slot.have.id, item);
    };

    let forDecks = list.filter((w) => w.for === 'deck').reduce((s, w) => s + w.qty, 0);
    for (const want of list.filter((w) => w.for === 'binder')) {
      let needed = want.qty;
      for (const slot of pool) {
        if (needed <= 0) break;
        if (slot.left <= 0 || pocketOf(slot.have.card) !== pocketOf(want.card)) continue;
        const qty = Math.min(slot.left, needed);
        take(slot, qty, forDecks > 0 ? ['binder', 'deck'] : ['binder']);
        needed -= qty;
        forDecks = Math.max(0, forDecks - qty);
      }
    }
    for (const slot of pool) {
      if (forDecks <= 0) break;
      const qty = Math.min(slot.left, forDecks);
      if (qty <= 0) continue;
      take(slot, qty, ['deck']);
      forDecks -= qty;
    }
    items.push(...taken.values());
  }
  return items;
};

// A unit is one copy of an item: distinct objects, so sets of units can hold several copies
const toUnits = (items) => items.flatMap((item) => Array.from({ length: item.qty }, () => ({ item })));

const toSelection = (units) => {
  const selection = {};
  for (const { item } of units) selection[item.id] = (selection[item.id] ?? 0) + 1;
  return selection;
};

const priceOf = (unit) => unit.item.price ?? 0;

/** Repeatable random numbers in [0, 1) from a seed (mulberry32): a seed always gives the same proposal. */
export const seededRandom = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = (list, random) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * One for one within each rarity tier. When one side has more copies of a tier, each copy of the
 * other side takes the closest one in price, so the pairs stay even in value too; with random,
 * one of the three closest, for another proposal.
 */
const pairByTier = (receive, give, random = null) => {
  const tiers = new Map();
  for (const [side, units] of [
    ['receive', receive],
    ['give', give],
  ]) {
    for (const unit of units) {
      const tier = getTradeClass(unit.item.card, unit.item.foil);
      if (!tiers.has(tier)) tiers.set(tier, { receive: [], give: [] });
      tiers.get(tier)[side].push(unit);
    }
  }
  const picked = { receive: [], give: [] };
  for (const tier of tiers.values()) {
    const [fewer, more] = tier.receive.length <= tier.give.length ? ['receive', 'give'] : ['give', 'receive'];
    const pool = [...tier[more]];
    for (const unit of [...tier[fewer]].sort((a, b) => priceOf(b) - priceOf(a))) {
      const gap = (i) => Math.abs(priceOf(pool[i]) - priceOf(unit));
      const closest = pool.map((_, i) => i).sort((a, b) => gap(a) - gap(b));
      const best = random ? closest[Math.floor(random() * Math.min(3, closest.length))] : closest[0];
      picked[fewer].push(unit);
      picked[more].push(pool.splice(best, 1)[0]);
    }
  }
  return picked;
};

/**
 * Units worth about target: the ones that fit, the most valuable first (or the least valuable
 * with ascending, so more cards change hands; in random order with random), then single units
 * added or removed while that brings the total closer.
 */
const pickToTarget = (units, target, valueOf, ascending = false, random = null) => {
  const sorted = random
    ? shuffle(units, random)
    : [...units].sort((a, b) => (ascending ? -1 : 1) * (valueOf(b) - valueOf(a)) || priceOf(a) - priceOf(b));
  const picked = new Set();
  let sum = 0;
  for (const unit of sorted) {
    if (sum + valueOf(unit) > target + 1e-9) continue;
    picked.add(unit);
    sum += valueOf(unit);
  }
  for (let step = 0; step < 50; step++) {
    let best = null;
    let bestDiff = Math.abs(sum - target);
    for (const unit of sorted) {
      const diff = Math.abs(sum + (picked.has(unit) ? -1 : 1) * valueOf(unit) - target);
      if (diff < bestDiff - 1e-9) {
        best = unit;
        bestDiff = diff;
      }
    }
    if (!best) break;
    sum += (picked.has(best) ? -1 : 1) * valueOf(best);
    if (picked.has(best)) picked.delete(best);
    else picked.add(best);
  }
  return sorted.filter((unit) => picked.has(unit));
};

const sumOf = (units, valueOf) => units.reduce((s, u) => s + valueOf(u), 0);

/** Trims the richer side down to the other one until both are even (within tolerance). */
const balanceSides = (receive, give, valueOf, tolerance, ascending = false, random = null) => {
  let r = receive;
  let g = give;
  for (let round = 0; round < 6; round++) {
    const vr = sumOf(r, valueOf);
    const vg = sumOf(g, valueOf);
    if (Math.abs(vr - vg) <= tolerance(Math.max(vr, vg)) + 1e-9) break;
    if (vr > vg) r = pickToTarget(r, vg, valueOf, ascending, random);
    else g = pickToTarget(g, vr, valueOf, ascending, random);
  }
  return { receive: r, give: g };
};

/**
 * The trade a rule proposes from the copies each side can give.
 * @param {'rarity'|'points'|'value'} rule
 * @param {object[]} receive trade items the other player can give
 * @param {object[]} give trade items the user can give
 * @param {object} scale points of the rarities (see getPointsScale)
 * @param {number} variant 0 for the rule's best proposal, another number for another proposal
 *   (the same number always gives the same one)
 * @returns {{ receive: { [itemId]: number }, give: { [itemId]: number } }}
 */
export const proposeTrade = (rule, receive, give, scale = DEFAULT_TRADE_POINTS, variant = 0) => {
  const random = variant ? seededRandom(variant) : null;
  let picked;
  if (rule === 'rarity') {
    picked = pairByTier(toUnits(receive), toUnits(give), random);
  } else if (rule === 'points') {
    // The commonest cards first: many cards completed rather than a few rare ones
    const points = (u) => getTradePoints(u.item.card, u.item.foil, scale);
    picked = balanceSides(toUnits(receive), toUnits(give), points, () => 0, true, random);
  } else {
    // Copies without a known price cannot weigh in a trade by value
    const priced = (items) => toUnits(items.filter((i) => i.price != null));
    picked = balanceSides(priced(receive), priced(give), priceOf, (max) => max * VALUE_TOLERANCE, false, random);
  }
  return { receive: toSelection(picked.receive), give: toSelection(picked.give) };
};

const sameSelection = (a, b) => {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ids].every((id) => (a[id] ?? 0) === (b[id] ?? 0));
};

/** Whether two proposals pick the same copies. */
export const sameTrade = (a, b) => sameSelection(a.receive, b.receive) && sameSelection(a.give, b.give);

/**
 * Totals of the chosen copies of one side.
 * @returns {{ cards: number, points: number, value: number, unpriced: number, tiers: Map<string, number> }}
 */
export const summarizeSide = (items, selection, scale = DEFAULT_TRADE_POINTS) => {
  const summary = { cards: 0, points: 0, value: 0, unpriced: 0, tiers: new Map() };
  for (const item of items) {
    const n = selection[item.id] ?? 0;
    if (n <= 0) continue;
    const tier = getTradeClass(item.card, item.foil);
    summary.cards += n;
    summary.points += n * getTradePoints(item.card, item.foil, scale);
    summary.value += n * (item.price ?? 0);
    if (item.price == null) summary.unpriced += n;
    summary.tiers.set(tier, (summary.tiers.get(tier) ?? 0) + n);
  }
  return summary;
};

/**
 * Whether a trade is even under a rule.
 * @returns {{ even: boolean, diff: number, tiers: { tier: string, diff: number }[] }}
 *   diff and each tier's diff: received minus given (cards, points or value)
 */
export const getTradeBalance = (rule, received, given) => {
  const tierNames = [...new Set([...received.tiers.keys(), ...given.tiers.keys()])].sort(compareTradeClasses);
  const tiers = tierNames
    .map((tier) => ({ tier, diff: (received.tiers.get(tier) ?? 0) - (given.tiers.get(tier) ?? 0) }))
    .filter((t) => t.diff !== 0);
  if (rule === 'rarity') return { even: tiers.length === 0, diff: received.cards - given.cards, tiers };
  if (rule === 'points') {
    const diff = received.points - given.points;
    return { even: Math.abs(diff) < 1e-9, diff, tiers };
  }
  const diff = received.value - given.value;
  return { even: Math.abs(diff) <= Math.max(received.value, given.value) * VALUE_TOLERANCE + 1e-9, diff, tiers };
};

/** What the chosen trade looks like under the rule: even, or which side gets more. */
export const describeBalance = (rule, balance, partner, format) => {
  if (rule === 'rarity') {
    if (balance.even) return 'Équilibré : même rareté des deux côtés';
    return balance.tiers
      .slice(0, 3)
      .map(({ tier, diff }) => {
        const { label, foil } = getTradeClassLabel(tier);
        return `${label}${foil ? ' foil' : ''} +${Math.abs(diff)} ${diff > 0 ? 'pour toi' : `pour ${partner}`}`;
      })
      .join(' · ');
  }
  if (rule === 'points') {
    if (balance.even) return 'Équilibré en points de rareté';
    const points = `${formatPoints(Math.abs(balance.diff))} point${Math.abs(balance.diff) > 1 ? 's' : ''}`;
    return balance.diff > 0 ? `Tu reçois ${points} de plus` : `Tu donnes ${points} de plus`;
  }
  if (balance.even) return 'Équilibré à 5 % près';
  return balance.diff > 0 ? `Tu reçois ${format(balance.diff)} de plus` : `Tu donnes ${format(-balance.diff)} de plus`;
};

/**
 * Trade proposal to paste in a message, with each card's rarity and the totals of both sides.
 * @param {{ me: string, partner: string, rule: string, receive: object[], give: object[],
 *   format: (value: number|null) => string, nameOf: (card: object) => string, scale?: object }} options
 *   receive, give: the chosen copies { card, foil, qty, price }
 */
export const buildPartnerTradeText = ({ me, partner, rule, receive, give, format, nameOf, scale = DEFAULT_TRADE_POINTS }) => {
  const line = ({ card, foil, qty, price }) =>
    `- ${qty}× ${nameOf(card)}${foil ? ' (foil)' : ''} · chapitre ${card.set} n° ${card.number} · ${getTradeClassLabel(card.rarity ?? '?').label} — ${format(price == null ? null : price * qty)}`;
  const totals = (items) => ({
    cards: items.reduce((s, i) => s + i.qty, 0),
    points: items.reduce((s, i) => s + i.qty * getTradePoints(i.card, i.foil, scale), 0),
    value: items.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0),
  });
  // In binder order, so the other player finds each card at once
  const byNumber = (a, b) =>
    Number(a.card.set) - Number(b.card.set) || baseNumber(a.card.number) - baseNumber(b.card.number) || a.foil - b.foil;
  const r = totals(receive);
  const g = totals(give);
  const ruleInfo = TRADE_RULES.find((x) => x.key === rule);
  return [
    `Proposition d'échange${me ? ` · ${me}` : ''} ↔ ${partner}`,
    rule === 'points'
      ? `Règle : points de rareté (${describePointsScale(scale)}).`
      : ruleInfo
        ? `Règle : ${ruleInfo.label.toLowerCase()}. ${ruleInfo.hint}`
        : null,
    '',
    `Je reçois (${r.cards}) :`,
    ...[...receive].sort(byNumber).map(line),
    '',
    `Je donne (${g.cards}) :`,
    ...[...give].sort(byNumber).map(line),
    '',
    `Bilan : ${r.cards} contre ${g.cards} cartes · ${formatPoints(r.points)} contre ${formatPoints(g.points)} points de rareté · ${format(r.value)} contre ${format(g.value)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
};
