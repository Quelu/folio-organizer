import {
  addMod,
  banish,
  cardOf,
  damageCard,
  discardFromHand,
  drawCards,
  emit,
  enterPlay,
  gainLore,
  inPlay,
  isRestricted,
  keywordOf,
  KEYWORDS,
  listenersOf,
  loseLore,
  moveCharacter,
  putIntoDeck,
  putIntoInkwell,
  putUnder,
  returnToHand,
  say,
  shuffleInPlace,
  statOf,
} from './engine.js';
import { acceptOptional, chooseCards, chooseFromHand, chooseOption, choosePlayer, rankForHand } from './decisions.js';
import { isSupported } from './abilities.js';

/**
 * The card abilities as Lorcanito describes them (src/data/cardAbilities.json, see
 * scripts/sync-card-abilities.mjs): what each effect, target, filter, condition and amount does,
 * next to the check that tells whether the engine knows it. An ability with a single piece the
 * engine does not know is left out whole (abilities.js): a card is played as printed or flagged.
 *
 * ctx, an ability resolving: { p: its controller, source: the card it comes from, ability,
 * trigger: the event that set it off, targets: the cards chosen by the last step ("that
 * character"), count: how many, did: whether the last step happened ("if you do") }.
 */

// ---------- Comparisons, amounts, durations ----------

const COMPARE = {
  'less-or-equal': (a, b) => a <= b,
  lte: (a, b) => a <= b,
  'greater-or-equal': (a, b) => a >= b,
  gte: (a, b) => a >= b,
  less: (a, b) => a < b,
  lt: (a, b) => a < b,
  greater: (a, b) => a > b,
  gt: (a, b) => a > b,
  'greater-than': (a, b) => a > b,
  'or-more': (a, b) => a >= b,
  'or-less': (a, b) => a <= b,
  'less-than': (a, b) => a < b,
  equal: (a, b) => a === b,
  eq: (a, b) => a === b,
};

const compare = (a, op, b) => COMPARE[op](a, b);

// A comparison is a string with a value next to it, or { operator, value }
const okComparison = (c) => (typeof c === 'string' ? !!COMPARE[c] : !!COMPARE[c?.operator] && typeof c.value === 'number');

const DURATIONS = new Set(['this-turn', 'until-start-of-next-turn', 'their-next-turn', 'next-play-this-turn', 'permanent', 'while-in-play']);

/** Turn at whose end an effect wears off; owner: the player whose "next turn" counts. */
const untilOf = (game, ctx, duration, owner = ctx.p) => {
  switch (duration) {
    case 'this-turn':
    case 'next-play-this-turn':
      return game.turn;
    case 'until-start-of-next-turn':
      return game.current === ctx.p ? game.turn + 1 : game.turn;
    case 'their-next-turn':
      return game.current === owner ? game.turn + 2 : game.turn + 1;
    default:
      return Infinity;
  }
};

const countCards = (game, ctx, { owner = 'you', cardType = 'character', zones = ['play'], filters = [], excludeSelf = false }) => {
  const players = owner === 'any' ? [0, 1] : [owner === 'opponent' ? 1 - ctx.p : ctx.p];
  let n = 0;
  for (const q of players) {
    if (zones.includes('play')) {
      for (const inst of inPlay(game, q)) {
        if (excludeSelf && inst === ctx.source) continue;
        if ((!cardType || inst.card.kind === cardType) && filters.every((f) => passes(game, ctx, inst, f))) n++;
      }
    }
    if (zones.includes('discard')) {
      for (const idx of game.players[q].discard) {
        const card = cardOf(game, q, idx);
        if ((!cardType || card.kind === cardType) && filters.every((f) => passes(game, ctx, { card, owner: q, mods: [], damage: 0 }, f))) n++;
      }
    }
  }
  return n;
};

const ownerOf = (controller) => (controller === 'opponent' ? 'opponent' : 'you');

const AMOUNTS = {
  'up-to': { check: (a) => typeof a.value === 'number', value: (game, ctx, a) => a.value },
  'cards-in-hand': { check: () => true, value: (game, ctx, a) => game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p].hand.length },
  'classification-character-count': {
    check: (a) => typeof a.classification === 'string',
    value: (game, ctx, a) =>
      countCards(game, ctx, { owner: ownerOf(a.controller), excludeSelf: a.excludeSelf, filters: [{ type: 'has-classification', classification: a.classification }] }),
  },
  'filtered-count': {
    check: (a) => (a.zones ?? ['play']).every((z) => z === 'play' || z === 'discard') && (a.filters ?? []).every(okFilter),
    value: (game, ctx, a) => countCards(game, ctx, { owner: a.owner ?? 'you', cardType: a.cardType, zones: a.zones ?? ['play'], filters: a.filters ?? [], excludeSelf: a.excludeSelf }),
  },
  'last-effect-target-count': { check: () => true, value: (game, ctx) => ctx.count ?? 0 },
  'cards-under-self': { check: () => true, value: (game, ctx) => ctx.source.under?.length ?? 0 },
  // The cards a banished card had under it
  'trigger-target-attribute': {
    check: (a) => a.attribute === 'cards-under-count-before-banish',
    value: (game, ctx) => ctx.trigger?.subject?.underBefore ?? 0,
  },
  'strength-of': { check: (a) => isOwnCard(a.target), value: (game, ctx, a) => statOfRef(game, ctx, a.target, 'strength') },
  'willpower-of': { check: (a) => isOwnCard(a.target), value: (game, ctx, a) => statOfRef(game, ctx, a.target, 'willpower') },
  clamp: {
    check: (a) => okAmount(a.value) && typeof (a.min ?? 0) === 'number' && typeof (a.max ?? Infinity) === 'number',
    value: (game, ctx, a) => Math.min(a.max ?? Infinity, Math.max(a.min ?? 0, amountOf(game, ctx, a.value))),
  },
  'source-attribute': {
    check: (a) => ['cards-under-them', 'location-lore'].includes(a.attribute),
    value: (game, ctx, a) => (a.attribute === 'cards-under-them' ? (ctx.source.under?.length ?? 0) : ctx.source.at ? statOf(game, ctx.source.at, 'lore') : 0),
  },
  count: {
    check: (a) => a.what === 'distinct-character-ink-types',
    value: (game, ctx, a) => new Set(game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p].characters.flatMap((c) => c.card.inks)).size,
  },
  'for-each': { check: (a) => !!COUNTERS[a.counter?.type], value: (game, ctx, a) => COUNTERS[a.counter.type](ctx) },
  'characters-in-play': { check: () => true, value: (game, ctx, a) => game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p].characters.length },
  // The lore of a card an earlier step named
  'lore-value-of': {
    check: (a) => a.target?.ref === 'previous-target' || a.target?.ref === 'trigger-subject',
    value: (game, ctx, a) => {
      const [inst] = refTargets(ctx, a.target.ref);
      return inst ? (inst.zone === 'play' ? statOf(game, inst, 'lore') : inst.card.lore) : 0;
    },
  },
  difference: { check: (a) => okAmount(a.left) && okAmount(a.right), value: (game, ctx, a) => amountOf(game, ctx, a.left) - amountOf(game, ctx, a.right) },
};

// What an earlier step did, counted: "for each damage removed", "for each lore lost"
const COUNTERS = {
  'last-effect-target-count': (ctx) => ctx.count ?? 0,
  'damage-removed': (ctx) => ctx.removed ?? 0,
  'lore-lost': (ctx) => ctx.loreLost ?? 0,
};

// Amounts written as a word
const NAMED_AMOUNTS = { DAMAGE_REMOVED: (game, ctx) => ctx.removed ?? 0 };

// The card an amount reads: the source, or a card an earlier step named
const isOwnCard = (t) => t === 'SELF' || t?.ref === 'self' || t?.ref === 'previous-target' || t?.ref === 'trigger-subject';
const statOfRef = (game, ctx, t, stat) => {
  const inst = t === 'SELF' ? ctx.source : refTargets(ctx, t.ref)[0];
  return !inst ? 0 : inst.zone === 'play' ? statOf(game, inst, stat) : (inst.card[stat] ?? 0);
};

const okAmount = (a) => typeof a === 'number' || !!NAMED_AMOUNTS[a] || (a != null && typeof a === 'object' && !!AMOUNTS[a.type]?.check(a));

const amountOf = (game, ctx, a) => (typeof a === 'number' ? a : NAMED_AMOUNTS[a] ? NAMED_AMOUNTS[a](game, ctx) : AMOUNTS[a.type].value(game, ctx, a));

// ---------- Filters ----------

const statFilter = (stat) => ({
  check: (f) => okComparison(f.comparison ?? f.operator) && typeof f.value === 'number',
  test: (game, ctx, inst, f) => compare(inst.zone === 'play' ? statOf(game, inst, stat) : (inst.card[stat] ?? 0), f.comparison ?? f.operator, f.value),
});

/** Whether a card has a classification: printed, or added by an effect or a static ability ("gains Detective"). */
export const hasClass = (game, inst, classification) =>
  inst.card.classifications.includes(classification) ||
  (inst.zone === 'play' &&
    !!game &&
    (inst.mods.some((m) => m.kind === 'classification' && m.value === classification) ||
      applyingStatics(game, inst, 'property-modification').some(({ effect }) => effect.property === 'classification' && effect.value === classification)));

const INKS = { amber: 'Amber', amethyst: 'Amethyst', emerald: 'Emerald', ruby: 'Ruby', sapphire: 'Sapphire', steel: 'Steel' };

const isType = (card, type) => (type === 'song' ? card.song : card.kind === type);

const FILTERS = {
  'has-classification': { check: (f) => typeof f.classification === 'string', test: (game, ctx, inst, f) => hasClass(game, inst, f.classification) },
  classification: { check: (f) => typeof f.classification === 'string', test: (game, ctx, inst, f) => hasClass(game, inst, f.classification) },
  'card-type': { check: (f) => typeof (f.cardType ?? f.value) === 'string', test: (game, ctx, inst, f) => isType(inst.card, f.cardType ?? f.value) },
  'strength-comparison': statFilter('strength'),
  'willpower-comparison': statFilter('willpower'),
  'cost-comparison': {
    check: (f) => okComparison(f.comparison ?? f.operator) && typeof f.value === 'number',
    test: (game, ctx, inst, f) => compare(inst.card.cost, f.comparison ?? f.operator, f.value),
  },
  cost: {
    check: (f) => okComparison(f.comparison ?? f.operator) && typeof f.value === 'number',
    test: (game, ctx, inst, f) => compare(inst.card.cost, f.comparison ?? f.operator, f.value),
  },
  'has-keyword': {
    check: (f) => KEYWORDS.includes(f.keyword),
    test: (game, ctx, inst, f) => (inst.zone === 'play' ? keywordOf(game, inst, f.keyword) : (inst.card.keywords[f.keyword] ?? 0)) > 0,
  },
  exerted: { check: () => true, test: (game, ctx, inst) => inst.exerted },
  ready: { check: () => true, test: (game, ctx, inst) => !inst.exerted },
  damaged: { check: () => true, test: (game, ctx, inst) => inst.damage > 0 },
  status: {
    check: (f) => ['ready', 'exerted', 'damaged', 'undamaged'].includes(f.status),
    test: (game, ctx, inst, f) => ({ ready: !inst.exerted, exerted: inst.exerted, damaged: inst.damage > 0, undamaged: inst.damage === 0 })[f.status],
  },
  // A character at the location the ability comes from, or at the same location as its character
  'same-location-as-source': {
    check: () => true,
    test: (game, ctx, inst) => !!inst.at && (inst.at === ctx.source || inst.at === ctx.source.at),
  },
  'at-location': { check: () => true, test: (game, ctx, inst) => !!inst.at },
  'cards-under': {
    check: (f) => okComparison(f.comparison ?? f.operator) && typeof f.value === 'number',
    test: (game, ctx, inst, f) => compare(inst.under?.length ?? 0, f.comparison ?? f.operator, f.value),
  },
  'has-name': { check: (f) => typeof (f.name ?? f.equals ?? f.value) === 'string', test: (game, ctx, inst, f) => inst.card.title === (f.name ?? f.equals ?? f.value) },
  name: { check: (f) => typeof (f.name ?? f.equals ?? f.value) === 'string', test: (game, ctx, inst, f) => inst.card.title === (f.name ?? f.equals ?? f.value) },
  'ink-type': {
    check: (f) => !!INKS[String(f.inkType ?? f.ink ?? f.value).toLowerCase()],
    test: (game, ctx, inst, f) => inst.card.inks.includes(INKS[String(f.inkType ?? f.ink ?? f.value).toLowerCase()]),
  },
  song: { check: () => true, test: (game, ctx, inst) => inst.card.song },
  'is-song': { check: () => true, test: (game, ctx, inst) => inst.card.song },
  and: { check: (f) => Array.isArray(f.filters) && f.filters.every(okFilter), test: (game, ctx, inst, f) => f.filters.every((x) => passes(game, ctx, inst, x)) },
  or: { check: (f) => Array.isArray(f.filters) && f.filters.every(okFilter), test: (game, ctx, inst, f) => f.filters.some((x) => passes(game, ctx, inst, x)) },
  // "another" card: not the one the ability comes from
  source: { check: (f) => f.ref === 'other', test: (game, ctx, inst) => !(inst.idx === ctx.source.idx && inst.owner === ctx.source.owner) },
  not: {
    check: (f) => okFilter(f.filter ?? f.filters?.[0]),
    test: (game, ctx, inst, f) => !passes(game, ctx, inst, f.filter ?? f.filters[0]),
  },
};

// A filter without a type: { cardType, maxCost, minCost, classification, name }
const SHORT_FILTER = new Set(['cardType', 'notCardType', 'maxCost', 'minCost', 'classification', 'name']);

const okFilter = (f) => {
  if (!f || typeof f !== 'object') return false;
  if (!f.type) return Object.keys(f).length > 0 && Object.keys(f).every((k) => SHORT_FILTER.has(k));
  return !!FILTERS[f.type]?.check(f);
};

const passes = (game, ctx, inst, f) => {
  if (!f.type) {
    return (
      (f.cardType == null || isType(inst.card, f.cardType)) &&
      (f.notCardType == null || !isType(inst.card, f.notCardType)) &&
      (f.maxCost == null || inst.card.cost <= f.maxCost) &&
      (f.minCost == null || inst.card.cost >= f.minCost) &&
      (f.classification == null || inst.card.classifications.includes(f.classification)) &&
      (f.name == null || inst.card.title === f.name)
    );
  }
  return FILTERS[f.type].test(game, ctx, inst, f);
};

const filtersOf = (x) => [...[].concat(x.filter ?? []), ...[].concat(x.filters ?? [])];

// ---------- Targets ----------

const PLAYER_TARGETS = new Set([
  'CONTROLLER',
  'OPPONENT',
  'EACH_OPPONENT',
  'OPPONENTS',
  'EACH_PLAYER',
  'ALL_PLAYERS',
  'CHOSEN_PLAYER',
  'CARD_OWNER',
  'TRIGGER_SOURCE_OWNER',
]);

/** The players an effect is about; CHOSEN_PLAYER asks the controller. */
const playersOf = (game, ctx, target, effect) => {
  switch (target ?? 'CONTROLLER') {
    case 'CONTROLLER':
      return [ctx.p];
    case 'OPPONENT':
    case 'EACH_OPPONENT':
    case 'OPPONENTS':
      return [1 - ctx.p];
    case 'CHOSEN_PLAYER':
      return [choosePlayer(game, ctx, effect)];
    case 'CARD_OWNER':
    case 'TRIGGER_SOURCE_OWNER':
      return [ctx.trigger?.subject?.owner ?? ctx.p];
    default:
      return [ctx.p, 1 - ctx.p];
  }
};

const okPlayers = (t) => t == null || PLAYER_TARGETS.has(t);

const character = (owner, more = {}) => ({ selector: 'chosen', owner, cardTypes: ['character'], count: 1, filters: [], ...more });
const allOf = (owner, more = {}) => ({ selector: 'all', owner, cardTypes: ['character'], count: 'all', filters: [], ...more });

const NAMED_TARGETS = {
  CHOSEN_CHARACTER: character('any'),
  'chosen-character': character('any'),
  CHOSEN_OPPOSING_CHARACTER: character('opponent'),
  CHOSEN_CHARACTER_OF_YOURS: character('you'),
  YOUR_CHOSEN_CHARACTER: character('you'),
  ANOTHER_CHOSEN_CHARACTER_OF_YOURS: character('you', { excludeSelf: true }),
  CHOSEN_DAMAGED_CHARACTER: character('any', { filters: [{ type: 'damaged' }] }),
  CHOSEN_OPPOSING_DAMAGED_CHARACTER: character('opponent', { filters: [{ type: 'damaged' }] }),
  CHOSEN_EXERTED_CHARACTER: character('any', { filters: [{ type: 'exerted' }] }),
  'chosen-card-in-play': character('any', { cardTypes: ['character', 'item', 'location'] }),
  YOUR_CHARACTERS: allOf('you'),
  YOUR_OTHER_CHARACTERS: allOf('you', { excludeSelf: true }),
  ALL_OPPOSING_CHARACTERS: allOf('opponent'),
  OPPOSING_CHARACTERS: allOf('opponent'),
  ALL_CHARACTERS: allOf('any'),
  YOUR_ITEMS: allOf('you', { cardTypes: ['item'] }),
  YOUR_LOCATIONS: allOf('you', { cardTypes: ['location'] }),
  YOUR_CHARACTERS_OR_LOCATIONS: allOf('you', { cardTypes: ['character', 'location'] }),
  CHARACTERS_HERE: allOf('you', { filters: [{ type: 'same-location-as-source' }] }),
  CHOSEN_DAMAGED_OPPOSING_CHARACTER: character('opponent', { filters: [{ type: 'damaged' }] }),
  CHOSEN_CHARACTER_ITEM_OR_LOCATION: character('any', { cardTypes: ['character', 'item', 'location'] }),
};

const SELF_TARGETS = new Set(['SELF', 'self', 'this-card', 'THIS_ITEM', 'this']);
const REFS = new Set(['self', 'source', 'previous-target', 'selected-all', 'selected-first', 'trigger-subject', 'trigger-source', 'trigger-destination', 'attacker']);
const SPEC_KEYS = new Set(['selector', 'owner', 'zones', 'cardTypes', 'cardType', 'count', 'filter', 'filters', 'excludeSelf']);
const CARD_TYPES = ['character', 'item', 'location', 'action'];

// YOUR_OTHER_HERO_CHARACTERS, YOUR_EVASIVE_CHARACTERS, YOUR_OTHER_AMBER_CHARACTERS...
const groupTarget = (name) => {
  const m = /^YOUR_(OTHER_)?([A-Z]+)_CHARACTERS$/.exec(name);
  if (!m) return null;
  const word = m[2].charAt(0) + m[2].slice(1).toLowerCase();
  const keyword = KEYWORDS.find((k) => k.toUpperCase() === m[2]);
  const filter = INKS[m[2].toLowerCase()]
    ? { type: 'ink-type', inkType: m[2].toLowerCase() }
    : keyword
      ? { type: 'has-keyword', keyword }
      : { type: 'has-classification', classification: word };
  return allOf('you', { excludeSelf: !!m[1], filters: [filter] });
};

/**
 * A target as { self: true }, { ref } or { spec: { selector: 'chosen'|'all', owner, cardTypes,
 * count, filters, excludeSelf } }, or null when the engine does not know it.
 */
export const normalizeTarget = (target) => {
  if (typeof target === 'string') {
    if (SELF_TARGETS.has(target)) return { self: true };
    const spec = NAMED_TARGETS[target] ?? groupTarget(target);
    return spec ? { spec } : null;
  }
  if (!target || typeof target !== 'object') return null;
  if (target.ref) return REFS.has(target.ref) && Object.keys(target).length === 1 ? { ref: target.ref } : null;
  // { selector: 'all', reference: 'trigger-subject', filters }: the cards a step named, if they match
  if (target.reference) {
    if (!REFS.has(target.reference) || !filtersOf(target).every(okFilter)) return null;
    if (!Object.keys(target).every((k) => ['selector', 'reference', 'count', 'zones', 'filter', 'filters'].includes(k))) return null;
    return { ref: target.reference, filters: filtersOf(target) };
  }
  if (!Object.keys(target).every((k) => SPEC_KEYS.has(k))) return null;
  if (target.selector === 'self') return { self: true };
  if (!['chosen', 'all'].includes(target.selector)) return null;
  const zone = target.zones?.length === 1 ? target.zones[0] : target.zones ? null : 'play';
  if (zone !== 'play' && zone !== 'discard') return null;
  // "card" means any card
  const types = target.cardTypes ?? (target.cardType ? [target.cardType] : null);
  const cardTypes = !types || types.includes('card') ? (zone === 'play' ? ['character', 'item', 'location'] : CARD_TYPES) : types;
  if (!cardTypes.every((t) => CARD_TYPES.includes(t)) || (zone === 'play' && cardTypes.includes('action'))) return null;
  const filters = filtersOf(target);
  if (!filters.every(okFilter)) return null;
  const count = typeof target.count?.exactly === 'number' ? target.count.exactly : (target.count ?? (target.selector === 'all' ? 'all' : 1));
  if (!(count === 'all' || typeof count === 'number' || typeof count?.upTo === 'number')) return null;
  return { spec: { selector: target.selector, owner: target.owner ?? 'any', zone, cardTypes, count, filters, excludeSelf: !!target.excludeSelf } };
};

/** Whether the engine knows a card target; inDiscard: the effect also handles cards in a discard. */
const okCards = (t, { inDiscard = false } = {}) => {
  const n = normalizeTarget(t);
  return n != null && (inDiscard || n.spec?.zone !== 'discard');
};

// A card of a discard, as a target: its position changes, its index stays
const discardCard = (game, q, idx) => ({ id: `d${q}:${idx}`, idx, owner: q, card: cardOf(game, q, idx), zone: 'discard', damage: 0, exerted: false, mods: [] });

/** Cards in play a spec reaches, before any choice. chooser: who chooses (Ward keeps the others' away). */
const candidatesOf = (game, ctx, spec, chooser = ctx.p) => {
  const players = spec.owner === 'any' ? [ctx.p, 1 - ctx.p] : [spec.owner === 'opponent' ? 1 - ctx.p : ctx.p];
  const out = [];
  for (const q of players) {
    const cards = spec.zone === 'discard' ? [...new Set(game.players[q].discard)].map((idx) => discardCard(game, q, idx)) : inPlay(game, q);
    for (const inst of cards) {
      if (!spec.cardTypes.includes(inst.card.kind)) continue;
      if (spec.excludeSelf && inst === ctx.source) continue;
      if (spec.selector === 'chosen' && inst.zone === 'play' && inst.owner !== chooser && keywordOf(game, inst, 'Ward') > 0) continue;
      if (spec.filters.every((f) => passes(game, ctx, inst, f))) out.push(inst);
    }
  }
  return out;
};

const refTargets = (ctx, ref) => {
  switch (ref) {
    case 'self':
    case 'source':
      return [ctx.source];
    case 'previous-target':
    case 'selected-all':
      return ctx.targets ?? [];
    case 'trigger-destination':
      return ctx.trigger?.location ? [ctx.trigger.location] : [];
    case 'selected-first':
      return (ctx.targets ?? []).slice(0, 1);
    case 'attacker':
      return ctx.trigger?.attacker ? [ctx.trigger.attacker] : [];
    default:
      return ctx.trigger?.subject?.card ? [ctx.trigger.subject] : [];
  }
};

/**
 * The cards an effect lands on: the source, a card named by an earlier step, everything a spec
 * reaches, or the ones a player chooses (chosenBy: 'opponent' lets the opponent pick theirs).
 * Remembers them for "that character". A character with Vanish an opponent chooses for an
 * action is banished instead.
 */
const targetsOf = (game, ctx, effect, target = effect.target) => {
  const t = normalizeTarget(target);
  let cards;
  if (t.self) cards = [ctx.source];
  else if (t.ref) cards = refTargets(ctx, t.ref).filter((c) => (t.filters ?? []).every((f) => passes(game, ctx, c, f)));
  else {
    const chooser = effect.chosenBy === 'opponent' ? 1 - ctx.p : ctx.p;
    let candidates = candidatesOf(game, ctx, t.spec, chooser);
    if (t.spec.selector === 'chosen') {
      const forced = candidates.filter((c) => c.zone === 'play' && c.owner !== chooser && isRestricted(game, c, 'must-be-chosen-for-effects'));
      if (forced.length) candidates = forced;
    }
    if (t.spec.selector === 'all') cards = candidates;
    else {
      const max = typeof t.spec.count === 'number' ? t.spec.count : t.spec.count.upTo;
      const min = typeof t.spec.count === 'number' ? Math.min(max, candidates.length) : 0;
      cards = candidates.length ? chooseCards(game, chooser, ctx, effect, candidates, min, max) : [];
      if (ctx.source.card.kind === 'action') {
        for (const inst of cards.filter((c) => c.owner !== chooser && keywordOf(game, c, 'Vanish') > 0)) {
          say(game, inst.owner, `${inst.card.name} disparaît (Dissipation)`);
          banish(game, inst);
        }
        cards = cards.filter((c) => c.zone === 'play');
      }
    }
  }
  ctx.targets = cards;
  ctx.count = cards.length;
  return cards;
};

/** The cards an effect could land on, without choosing: for a pilot weighing it. */
export const previewTargets = (game, ctx, effect, target = effect.target) => {
  const t = normalizeTarget(target);
  if (!t) return { all: true, cards: [] };
  if (t.self) return { all: true, cards: [ctx.source] };
  if (t.ref) return { all: true, cards: refTargets(ctx, t.ref) };
  const chooser = effect.chosenBy === 'opponent' ? 1 - ctx.p : ctx.p;
  return { all: t.spec.selector === 'all', cards: candidatesOf(game, ctx, t.spec, chooser), chooser };
};

// ---------- Conditions ----------

const playerOf = (ctx, controller) => (controller === 'opponent' ? 1 - ctx.p : ctx.p);

const charactersOf = (game, ctx, controller) =>
  controller === 'any' ? [...game.players[0].characters, ...game.players[1].characters] : game.players[playerOf(ctx, controller)].characters;

const RESOURCES = {
  'cards-in-hand': (game, q) => game.players[q].hand.length,
  'cards-in-discard': (game, q) => game.players[q].discard.length,
  'cards-in-inkwell': (game, q) => game.players[q].inkwell,
  'ink-drops': (game, q) => game.players[q].inkwell,
  'ready-cards-in-inkwell': (game, q) => game.players[q].ink,
  'damaged-characters': (game, q) => game.players[q].characters.filter((c) => c.damage > 0).length,
  'exerted-characters': (game, q) => game.players[q].characters.filter((c) => c.exerted).length,
};

// What happened this turn, by player (turnStats, reset at the start of every turn)
const METRICS = {
  'played-songs': (game, q) => game.players[q].turnStats.songs,
  'played-cards': (game, q) => game.players[q].turnStats.played.length,
  'cards-drawn-by-player': (game, q) => game.players[q].turnStats.drawn,
  'damage-removed-by-player': (game, q) => game.players[q].turnStats.damageRemoved,
  'played-actions': (game, q) => game.players[q].turnStats.actions,
  'challenges-by-player': (game, q) => game.players[q].turnStats.challenges,
  'quested-characters': (game, q) => game.players[q].turnStats.quested,
  'discard-cards-entered': (game, q) => game.players[q].turnStats.discarded,
  // Characters banished this turn, of both players, by name
  'banished-characters': (game, q, c) =>
    game.players.reduce((s, pl) => s + pl.turnStats.banished.filter((card) => !c.name || card.title === c.name).length, 0),
  // Characters played, of a classification, the source itself left out
  'played-character-with-classification': (game, q, c, ctx) =>
    game.players[q].turnStats.played.filter(
      (x) => x.card.kind === 'character' && (!c.classification || x.card.classifications.includes(c.classification)) && !(c.excludeSource && x.id === ctx.source.id)
    ).length,
};

// Two quantities a comparison may weigh, by player
const QUANTITIES = {
  'character-count': (game, q) => game.players[q].characters.length,
  'cards-in-hand': (game, q) => game.players[q].hand.length,
  'cards-in-inkwell': (game, q) => game.players[q].inkwell,
  lore: (game, q) => game.players[q].lore,
};

const countOf = (comparison, value, n) => (typeof comparison === 'string' ? compare(n, comparison, value) : compare(n, comparison.operator, comparison.value));

const CONDITIONS = {
  'if-you-do': { check: () => true, test: (game, ctx) => !!ctx.did },
  // How many cards match: in play or in a discard, or among the cards an earlier step named
  'target-query': {
    check: (c) => {
      const q = c.query ?? {};
      return (
        okComparison(c.comparison) &&
        (q.reference == null || REFS.has(q.reference)) &&
        (q.zones ?? ['play']).every((z) => z === 'play' || z === 'discard') &&
        filtersOf(q).every(okFilter) &&
        Object.keys(q).every((k) => ['selector', 'owner', 'zones', 'cardType', 'cardTypes', 'excludeSelf', 'filter', 'filters', 'count', 'reference'].includes(k))
      );
    },
    test: (game, ctx, c) => {
      const q = c.query;
      const types = q.cardTypes ?? (q.cardType ? [q.cardType] : null);
      let cards;
      if (q.reference) cards = refTargets(ctx, q.reference);
      else {
        const players = q.owner === 'any' ? [0, 1] : [q.owner === 'opponent' ? 1 - ctx.p : ctx.p];
        const zones = q.zones ?? ['play'];
        cards = players.flatMap((x) => [
          ...(zones.includes('play') ? inPlay(game, x) : []),
          ...(zones.includes('discard') ? game.players[x].discard.map((idx) => discardCard(game, x, idx)) : []),
        ]);
      }
      const n = cards.filter(
        (i) => (!types || types.some((t) => isType(i.card, t))) && !(q.excludeSelf && i === ctx.source) && filtersOf(q).every((f) => passes(game, ctx, i, f))
      ).length;
      return countOf(c.comparison, c.value, n);
    },
  },
  'resource-count': {
    check: (c) => !!RESOURCES[c.what] && okComparison(c.comparison) && (typeof c.comparison !== 'string' || typeof c.value === 'number'),
    test: (game, ctx, c) => countOf(c.comparison, c.value, RESOURCES[c.what](game, playerOf(ctx, c.controller))),
  },
  'turn-metric': {
    check: (c) =>
      !!METRICS[c.metric] &&
      okComparison(c.comparison) &&
      Object.keys(c).every((k) => ['type', 'metric', 'comparison', 'value', 'ownerScope', 'playerScope', 'classification', 'excludeSource', 'name'].includes(k)),
    test: (game, ctx, c) =>
      countOf(c.comparison, c.value, METRICS[c.metric](game, (c.ownerScope ?? c.playerScope) === 'opponent' ? 1 - ctx.p : ctx.p, c, ctx)),
  },
  // The second player's first turn
  'first-turn-non-otp': { check: () => true, test: (game, ctx) => ctx.p !== game.first && game.turn === 2 },
  'banished-in-challenge-this-turn': {
    check: (c) => ['you', 'opponent', 'any', undefined].includes(c.owner),
    test: (game, ctx, c) =>
      (c.owner === 'any' ? [0, 1] : [c.owner === 'opponent' ? 1 - ctx.p : ctx.p]).some((q) => game.players[q].turnStats.banishedInChallenge > 0),
  },
  'has-character-count': {
    check: (c) => okComparison(c.comparison) && typeof c.count === 'number',
    test: (game, ctx, c) =>
      compare(charactersOf(game, ctx, c.controller).filter((i) => !c.classification || i.card.classifications.includes(c.classification)).length, c.comparison, c.count),
  },
  'has-named-character': { check: (c) => typeof c.name === 'string', test: (game, ctx, c) => charactersOf(game, ctx, c.controller).some((i) => i.card.title === c.name) },
  'has-character-with-classification': {
    check: (c) => typeof c.classification === 'string',
    test: (game, ctx, c) => charactersOf(game, ctx, c.controller).some((i) => i !== ctx.source && hasClass(game, i, c.classification)),
  },
  'has-character-with-keyword': { check: (c) => KEYWORDS.includes(c.keyword), test: (game, ctx, c) => charactersOf(game, ctx, c.controller).some((i) => keywordOf(game, i, c.keyword) > 0) },
  'has-character-with-strength': {
    check: (c) => okComparison(c.comparison) && typeof c.value === 'number',
    test: (game, ctx, c) => charactersOf(game, ctx, c.controller).some((i) => compare(statOf(game, i, 'strength'), c.comparison, c.value)),
  },
  'has-item-count': {
    check: (c) => okComparison(c.comparison) && typeof c.count === 'number',
    test: (game, ctx, c) => compare(game.players[playerOf(ctx, c.controller)].items.length, c.comparison, c.count),
  },
  'has-location-in-play': { check: () => true, test: (game, ctx, c) => game.players[playerOf(ctx, c.controller)].locations.length > 0 },
  'has-named-item': { check: (c) => typeof c.name === 'string', test: (game, ctx, c) => game.players[playerOf(ctx, c.controller)].items.some((i) => i.card.title === c.name) },
  'is-exerted': { check: () => true, test: (game, ctx) => !!ctx.source.exerted },
  exerted: { check: () => true, test: (game, ctx) => !!ctx.source.exerted },
  'no-damage': { check: () => true, test: (game, ctx) => ctx.source.damage === 0 },
  'used-shift': { check: () => true, test: (game, ctx) => !!ctx.source.shifted },
  'at-location': { check: () => true, test: (game, ctx) => !!ctx.source.at },
  'self-has-damage': { check: () => true, test: (game, ctx) => ctx.source.damage > 0 },
  // While its challenge damage is worked out
  'in-challenge': {
    check: (c) => ['attacker', 'defender'].includes(c.role),
    test: (game, ctx, c) => game.challenging?.[c.role === 'attacker' ? 'attacker' : 'defender'] === ctx.source,
  },
  'being-challenged': { check: () => true, test: (game, ctx) => game.challenging?.defender === ctx.source },
  'damage-comparison': {
    check: (c) => okComparison(c.comparison) && typeof c.value === 'number',
    test: (game, ctx, c) => compare(ctx.source.damage, c.comparison, c.value),
  },
  'trigger-subject-had-card-under': { check: () => true, test: (game, ctx) => (ctx.trigger?.subject?.underBefore ?? ctx.trigger?.subject?.under?.length ?? 0) > 0 },
  'has-card-under': { check: () => true, test: (game, ctx) => (ctx.source.under?.length ?? 0) > 0 },
  'previous-target-has-card-under': { check: () => true, test: (game, ctx) => (ctx.targets?.at(-1)?.under?.length ?? 0) > 0 },
  'put-card-under-self-this-turn': { check: () => true, test: (game, ctx) => ctx.source.underTurn === game.turn },
  'put-card-under-any-this-turn': { check: () => true, test: (game, ctx) => game.players[ctx.p].turnStats.putUnder > 0 },
  'your-turn': { check: () => true, test: (game, ctx) => game.current === ctx.p },
  'during-turn': { check: (c) => ['your', 'opponent'].includes(c.whose), test: (game, ctx, c) => (game.current === ctx.p) === (c.whose === 'your') },
  turn: { check: (c) => ['your', 'opponent'].includes(c.whose), test: (game, ctx, c) => (game.current === ctx.p) === (c.whose === 'your') },
  'opponent-has-damaged-character': { check: () => true, test: (game, ctx) => game.players[1 - ctx.p].characters.some((i) => i.damage > 0) },
  'stat-threshold': {
    check: (c) => ['strength', 'willpower', 'lore'].includes(c.stat) && okComparison(c.comparison) && (c.target == null || c.target === 'SELF'),
    test: (game, ctx, c) => ctx.source.zone === 'play' && compare(statOf(game, ctx.source, c.stat), c.comparison, c.value),
  },
  comparison: {
    check: (c) => okComparison(c.comparison) && [c.left, c.right].every((x) => !!QUANTITIES[x?.type]),
    test: (game, ctx, c) =>
      compare(QUANTITIES[c.left.type](game, playerOf(ctx, c.left.controller)), c.comparison, QUANTITIES[c.right.type](game, playerOf(ctx, c.right.controller))),
  },
  and: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okCondition), test: (game, ctx, c) => c.conditions.every((x) => holds(game, ctx, x)) },
  or: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okCondition), test: (game, ctx, c) => c.conditions.some((x) => holds(game, ctx, x)) },
  not: { check: (c) => okCondition(c.condition), test: (game, ctx, c) => !holds(game, ctx, c.condition) },
};

export const okCondition = (c) => !!c && !!CONDITIONS[c.type]?.check(c);

const holds = (game, ctx, c) => CONDITIONS[c.type].test(game, ctx, c);

// ---------- Effects ----------

const label = (ctx) => (ctx.ability?.name ? `${ctx.source.card.name} · ${ctx.ability.name}` : ctx.source.card.name);
const tell = (game, ctx, text) => say(game, ctx.p, `${label(ctx)} : ${text}`);
const names = (cards) => cards.map((c) => c.card.name).join(', ');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const STAT_NAMES = { strength: 'force', willpower: 'volonté', lore: 'lore' };

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

const RESTRICTIONS = new Set([
  'cant-quest',
  'cant-challenge',
  'cant-quest-or-challenge',
  'cant-ready',
  'cant-ready-at-start-of-turn',
  'cant-move',
  'cant-sing',
  // A permission written as a restriction
  'can-quest-turn-played',
  'cant-sing-without-sing-together',
  'challenge-limit',
  // An opponent choosing a character for an effect must choose this one
  'must-be-chosen-for-effects',
  'cant-be-challenged',
  'cant-be-dealt-damage',
  'enters-play-exerted',
  'cant-play-actions',
  'cant-play-items',
  'must-quest',
  // The pilot never chooses to: nothing to play
  'may-enter-play-exerted',
]);
const PLAYER_RESTRICTIONS = new Set(['cant-play-actions', 'cant-play-items', 'challenge-limit']);

// All the cards of your inkwell: readying or exerting them is your ink for the turn
const isAllInk = (t) => t?.selector === 'all' && t.owner === 'you' && t.zones?.length === 1 && t.zones[0] === 'inkwell';

// Abilities an effect can grant that the engine plays
const GRANTS = new Set(['can-challenge-ready', 'takes-no-damage-from-challenges']);

const okGrant = (ability) => {
  if (typeof ability === 'string') return GRANTS.has(ability);
  if (ability?.type === 'can-challenge-ready') return Object.keys(ability).every((k) => ['type', 'classification'].includes(k));
  return (ability?.type === 'triggered' || ability?.type === 'activated') && isSupported(ability);
};

// What a revealed card is checked for
const REVEALED = {
  'revealed-has-classification': { check: (c) => typeof c.classification === 'string', test: (card, c) => card.classifications.includes(c.classification) },
  'revealed-is-card-type': { check: (c) => typeof (c.cardType ?? c.value) === 'string', test: (card, c) => isType(card, c.cardType ?? c.value) },
  'revealed-is-character-named': { check: (c) => typeof c.name === 'string', test: (card, c) => card.kind === 'character' && card.title === c.name },
  and: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okRevealed), test: (card, c) => c.conditions.every((x) => REVEALED[x.type].test(card, x)) },
  or: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okRevealed), test: (card, c) => c.conditions.some((x) => REVEALED[x.type].test(card, x)) },
  not: { check: (c) => okRevealed(c.condition), test: (card, c) => !REVEALED[c.condition.type].test(card, c.condition) },
};
const okRevealed = (c) => !!REVEALED[c?.type]?.check(c);
const ROUTE_ZONES = new Set(['hand', 'deck-top', 'deck-bottom', 'discard', 'inkwell']);

/** A card off the top of the deck to a zone. */
const routeCard = (game, p, idx, zone) => {
  const me = game.players[p];
  if (zone === 'hand') {
    me.hand.push(idx);
    if (me.seen) me.seen[idx] = 1;
  } else if (zone === 'deck-top') me.library.unshift(idx);
  else if (zone === 'deck-bottom') me.library.push(idx);
  else if (zone === 'discard') me.discard.push(idx);
  else me.inkwell++;
};

const RESTRICTION_TEXT = {
  'cant-quest': 'ne peut pas partir en quête',
  'cant-challenge': 'ne peut pas défier',
  'cant-quest-or-challenge': 'ne peut ni partir en quête ni défier',
  'cant-ready': 'ne peut pas se redresser',
  'cant-be-challenged': 'ne peut pas être défié',
  'cant-be-dealt-damage': 'ne peut pas subir de dégâts',
};

// Stats a modify-stat may change, with a fixed or a counted amount
const okModifier = (m) => okAmount(m);

/** Runs a list of steps in order: "if you do" and "that character" read the step before. */
const runSteps = (game, ctx, steps) => {
  for (const step of steps) {
    if (game.over) return;
    runEffect(game, ctx, step);
  }
};

const EFFECTS = {
  sequence: {
    keys: ['steps', 'effects'],
    check: (e) => Array.isArray(e.steps ?? e.effects) && (e.steps ?? e.effects).every(okEffect),
    run: (game, ctx, e) => runSteps(game, ctx, e.steps ?? e.effects),
  },
  optional: {
    keys: ['effect', 'chooser'],
    check: (e) => [undefined, 'CONTROLLER', 'OPPONENT'].includes(e.chooser) && okEffect(e.effect),
    run: (game, ctx, e) => {
      if (acceptOptional(game, e.chooser === 'OPPONENT' ? 1 - ctx.p : ctx.p, ctx, e.effect)) runEffect(game, ctx, e.effect);
      else ctx.did = false;
    },
  },
  conditional: {
    keys: ['condition', 'then', 'effect', 'ifTrue', 'else', 'ifFalse'],
    check: (e) => okCondition(e.condition) && okEffect(e.then ?? e.effect ?? e.ifTrue) && [e.else ?? e.ifFalse].every((x) => x == null || okEffect(x)),
    run: (game, ctx, e) => {
      if (holds(game, ctx, e.condition)) runEffect(game, ctx, e.then ?? e.effect ?? e.ifTrue);
      else if (e.else ?? e.ifFalse) runEffect(game, ctx, e.else ?? e.ifFalse);
      else ctx.did = false;
    },
  },
  choice: {
    keys: ['options', 'optionLabels', 'chooser'],
    check: (e) => [undefined, 'CONTROLLER', 'OPPONENT'].includes(e.chooser) && Array.isArray(e.options) && e.options.every(okEffect),
    run: (game, ctx, e) => runEffect(game, ctx, e.options[chooseOption(game, e.chooser === 'OPPONENT' ? 1 - ctx.p : ctx.p, ctx, e.options)]),
  },
  'pay-cost': {
    keys: ['cost', 'effect'],
    check: (e) => Object.keys(e.cost ?? {}).every((k) => k === 'ink') && typeof e.cost.ink === 'number' && okEffect(e.effect),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      if (me.ink < e.cost.ink) {
        ctx.did = false;
        return;
      }
      me.ink -= e.cost.ink;
      runEffect(game, ctx, e.effect);
    },
  },
  'for-each-opponent': { keys: ['effect'], check: (e) => okEffect(e.effect), run: (game, ctx, e) => runEffect(game, ctx, e.effect) },
  'for-each': {
    keys: ['counter', 'effect'],
    check: (e) => !!COUNTERS[e.counter?.type] && okEffect(e.effect),
    run: (game, ctx, e) => {
      const n = COUNTERS[e.counter.type](ctx);
      for (let i = 0; i < n && !game.over; i++) runEffect(game, ctx, e.effect);
    },
  },
  draw: {
    keys: ['amount', 'target', 'source'],
    check: (e) => okAmount(e.amount ?? 1) && okPlayers(e.target) && (e.source == null || e.source === 'deck-bottom'),
    run: (game, ctx, e) => {
      for (const q of playersOf(game, ctx, e.target, e)) {
        const n = drawCards(game, q, amountOf(game, ctx, e.amount ?? 1), { bottom: e.source === 'deck-bottom' });
        if (n) say(game, q, `${label(ctx)} : pioche ${plural(n, 'carte')}`);
        ctx.did = n > 0;
      }
    },
  },
  'draw-until-hand-size': {
    keys: ['size', 'target'],
    check: (e) => typeof e.size === 'number' && okPlayers(e.target),
    run: (game, ctx, e) => {
      for (const q of playersOf(game, ctx, e.target, e)) {
        const n = drawCards(game, q, Math.max(0, e.size - game.players[q].hand.length));
        if (n) say(game, q, `${label(ctx)} : pioche ${plural(n, 'carte')}`);
      }
    },
  },
  'gain-lore': {
    keys: ['amount', 'target'],
    check: (e) => okAmount(e.amount) && okPlayers(e.target),
    run: (game, ctx, e) => {
      const n = amountOf(game, ctx, e.amount);
      for (const q of playersOf(game, ctx, e.target, e)) {
        say(game, q, `${label(ctx)} : gagne ${n} lore (→ ${game.players[q].lore + n})`);
        gainLore(game, q, n);
      }
      ctx.did = n > 0;
    },
  },
  'lose-lore': {
    keys: ['amount', 'target'],
    check: (e) => okAmount(e.amount) && okPlayers(e.target),
    run: (game, ctx, e) => {
      const n = amountOf(game, ctx, e.amount);
      ctx.loreLost = 0;
      for (const q of playersOf(game, ctx, e.target, e)) {
        say(game, q, `${label(ctx)} : perd ${n} lore`);
        ctx.loreLost += Math.min(n, game.players[q].lore);
        loseLore(game, q, n);
      }
      ctx.did = n > 0;
    },
  },
  banish: {
    keys: ['target', 'chosenBy'],
    check: (e) => okCards(e.target) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      if (cards.length) tell(game, ctx, `bannit ${names(cards)}`);
      for (const c of cards) banish(game, c);
      ctx.did = cards.length > 0;
    },
  },
  'deal-damage': {
    keys: ['amount', 'target', 'chosenBy', 'ignoreResist'],
    check: (e) => okAmount(e.amount) && okCards(e.target) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const n = amountOf(game, ctx, e.amount);
      const cards = targetsOf(game, ctx, e);
      if (cards.length) tell(game, ctx, `inflige ${plural(n, 'dégât')} à ${names(cards)}`);
      let landed = 0;
      for (const c of cards) landed += damageCard(game, c, n, { ignoreResist: !!e.ignoreResist, by: ctx.source });
      ctx.did = landed > 0;
    },
  },
  'put-damage': {
    keys: ['amount', 'target'],
    check: (e) => okAmount(e.amount) && okCards(e.target),
    run: (game, ctx, e) => {
      const n = amountOf(game, ctx, e.amount);
      const cards = targetsOf(game, ctx, e);
      if (cards.length) tell(game, ctx, `place ${plural(n, 'dégât')} sur ${names(cards)}`);
      for (const c of cards) damageCard(game, c, n, { put: true });
      ctx.did = cards.length > 0;
    },
  },
  'remove-damage': {
    keys: ['amount', 'target'],
    check: (e) => (okAmount(e.amount) || e.amount === 'all') && okCards(e.target),
    run: (game, ctx, e) => {
      const n = e.amount === 'all' ? Infinity : amountOf(game, ctx, e.amount);
      let removed = 0;
      for (const c of targetsOf(game, ctx, e)) {
        const r = Math.min(n, c.damage);
        if (!r) continue;
        c.damage -= r;
        removed += r;
        game.players[ctx.p].turnStats.damageRemoved += r;
        ctx.removed = (ctx.removed ?? 0) + r;
        tell(game, ctx, `retire ${plural(r, 'dégât')} à ${c.card.name}`);
        emit(game, 'remove-damage', { p: c.owner, subject: c, amount: r, by: ctx.p });
      }
      ctx.did = removed > 0;
    },
  },
  'move-damage': {
    keys: ['amount', 'from', 'to'],
    check: (e) => (okAmount(e.amount) || e.amount === 'all') && okCards(e.from) && okCards(e.to),
    run: (game, ctx, e) => {
      const [from] = targetsOf(game, ctx, { ...e, type: 'remove-damage' }, e.from);
      if (!from) return;
      const n = e.amount === 'all' ? from.damage : Math.min(amountOf(game, ctx, e.amount), from.damage);
      const [to] = targetsOf(game, ctx, { ...e, type: 'put-damage' }, e.to);
      if (!to || !n) return;
      from.damage -= n;
      tell(game, ctx, `déplace ${plural(n, 'dégât')} de ${from.card.name} vers ${to.card.name}`);
      damageCard(game, to, n, { put: true });
      ctx.did = true;
    },
  },
  'return-to-hand': {
    keys: ['target', 'chosenBy'],
    check: (e) => okCards(e.target, { inDiscard: true }) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => returnToHand(game, c));
      if (cards.length) tell(game, ctx, `renvoie ${names(cards)} dans la main`);
      ctx.did = cards.length > 0;
    },
  },
  'put-on-bottom': {
    keys: ['target', 'chosenBy', 'ordering', 'orderBy'],
    check: (e) => okCards(e.target, { inDiscard: true }) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => putIntoDeck(game, c, 'bottom'));
      if (cards.length) tell(game, ctx, `met ${names(cards)} sous la pioche`);
      ctx.did = cards.length > 0;
    },
  },
  'put-on-top': {
    keys: ['target', 'chosenBy'],
    check: (e) => okCards(e.target, { inDiscard: true }) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => putIntoDeck(game, c, 'top'));
      if (cards.length) tell(game, ctx, `met ${names(cards)} sur la pioche`);
      ctx.did = cards.length > 0;
    },
  },
  'shuffle-into-deck': {
    keys: ['target', 'intoDeck'],
    check: (e) => okCards(e.target, { inDiscard: true }) && (e.intoDeck == null || e.intoDeck === 'owner'),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => putIntoDeck(game, c, 'shuffle'));
      if (cards.length) tell(game, ctx, `mélange ${names(cards)} dans la pioche`);
      ctx.did = cards.length > 0;
    },
  },
  ready: {
    keys: ['target'],
    check: (e) => okCards(e.target) || isAllInk(e.target),
    run: (game, ctx, e) => {
      if (isAllInk(e.target)) {
        game.players[ctx.p].ink = game.players[ctx.p].inkwell;
        tell(game, ctx, "redresse toute l'encre");
        return void (ctx.did = true);
      }
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play' && c.exerted);
      for (const c of cards) c.exerted = false;
      if (cards.length) tell(game, ctx, `redresse ${names(cards)}`);
      ctx.did = cards.length > 0;
    },
  },
  exert: {
    keys: ['target', 'chosenBy'],
    check: (e) => (okCards(e.target) || isAllInk(e.target)) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      if (isAllInk(e.target)) {
        game.players[ctx.p].ink = 0;
        return void (ctx.did = true);
      }
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play' && !c.exerted);
      for (const c of cards) c.exerted = true;
      if (cards.length) tell(game, ctx, `épuise ${names(cards)}`);
      ctx.did = cards.length > 0;
    },
  },
  'modify-stat': {
    keys: ['stat', 'modifier', 'target', 'duration'],
    check: (e) => ['strength', 'willpower', 'lore'].includes(e.stat) && okModifier(e.modifier) && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const amount = amountOf(game, ctx, e.modifier);
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      for (const c of cards) addMod(c, { kind: 'stat', stat: e.stat, amount, until: untilOf(game, ctx, e.duration, c.owner) });
      if (cards.length) tell(game, ctx, `${names(cards)} : ${signed(amount)} ${STAT_NAMES[e.stat]}`);
      ctx.did = cards.length > 0;
    },
  },
  'gain-keyword': {
    keys: ['keyword', 'value', 'target', 'duration'],
    check: (e) => KEYWORDS.includes(e.keyword) && (e.value == null || okAmount(e.value)) && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      const value = e.value == null ? 1 : amountOf(game, ctx, e.value);
      for (const c of cards) addMod(c, { kind: 'keyword', keyword: e.keyword, value, until: untilOf(game, ctx, e.duration, c.owner) });
      if (cards.length) tell(game, ctx, `${names(cards)} gagne ${e.keyword}${e.value ? ` +${e.value}` : ''}`);
      ctx.did = cards.length > 0;
    },
  },
  'gain-keywords': {
    keys: ['keywords', 'target', 'duration'],
    check: (e) => Array.isArray(e.keywords) && e.keywords.every((k) => KEYWORDS.includes(k.keyword)) && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      for (const c of cards) {
        for (const k of e.keywords) addMod(c, { kind: 'keyword', keyword: k.keyword, value: k.value ?? 1, until: untilOf(game, ctx, e.duration, c.owner) });
      }
      if (cards.length) tell(game, ctx, `${names(cards)} gagne ${e.keywords.map((k) => k.keyword).join(', ')}`);
      ctx.did = cards.length > 0;
    },
  },
  'lose-keyword': {
    keys: ['keyword', 'target', 'duration'],
    check: (e) => KEYWORDS.includes(e.keyword) && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      for (const c of cards) addMod(c, { kind: 'lose-keyword', keyword: e.keyword, until: untilOf(game, ctx, e.duration, c.owner) });
      ctx.did = cards.length > 0;
    },
  },
  restriction: {
    keys: ['restriction', 'target', 'duration'],
    check: (e) =>
      RESTRICTIONS.has(e.restriction) &&
      (PLAYER_RESTRICTIONS.has(e.restriction) ? okPlayers(e.target) : okCards(e.target)) &&
      (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      if (PLAYER_RESTRICTIONS.has(e.restriction)) {
        for (const q of playersOf(game, ctx, e.target, e)) {
          game.players[q].effects.push({ kind: 'restriction', restriction: e.restriction, until: untilOf(game, ctx, e.duration, q) });
        }
        ctx.did = true;
        return;
      }
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      for (const c of cards) addMod(c, { kind: 'restriction', restriction: e.restriction, until: untilOf(game, ctx, e.duration, c.owner) });
      if (cards.length && RESTRICTION_TEXT[e.restriction]) tell(game, ctx, `${names(cards)} ${RESTRICTION_TEXT[e.restriction]}`);
      ctx.did = cards.length > 0;
    },
  },
  'cost-reduction': {
    keys: ['amount', 'cardType', 'classification', 'cardName', 'duration', 'target', 'playMethod'],
    check: (e) =>
      typeof e.amount === 'number' &&
      (e.target == null || e.target === 'CONTROLLER') &&
      (e.duration == null || e.duration === 'next-play-this-turn' || e.duration === 'this-turn') &&
      (e.playMethod == null || e.playMethod === 'standard') &&
      (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)),
    run: (game, ctx, e) => {
      game.players[ctx.p].effects.push({
        kind: 'cost-reduction',
        amount: e.amount,
        cardType: e.cardType,
        classification: e.classification,
        cardName: e.cardName,
        once: e.duration !== 'this-turn',
        until: game.turn,
      });
      ctx.did = true;
    },
  },
  discard: {
    keys: ['amount', 'target', 'chosen', 'from', 'random', 'chosenBy', 'filter', 'filters'],
    check: (e) =>
      (okAmount(e.amount) || e.amount === 'all') &&
      okPlayers(e.target) &&
      (e.from == null || e.from === 'hand') &&
      [undefined, 'you', 'TARGET', 'opponent'].includes(e.chosenBy) &&
      filtersOf(e).every(okFilter),
    run: (game, ctx, e) => {
      const filters = filtersOf(e);
      let any = false;
      for (const q of playersOf(game, ctx, e.target, e)) {
        const hand = game.players[q].hand;
        const eligible = hand.map((idx, pos) => pos).filter((pos) => filters.every((f) => passes(game, ctx, { card: cardOf(game, q, hand[pos]), owner: q, mods: [], damage: 0 }, f)));
        const n = e.amount === 'all' ? eligible.length : Math.min(amountOf(game, ctx, e.amount), eligible.length);
        if (!n) continue;
        let picked;
        if (e.random) picked = shuffleInPlace(game, eligible.slice()).slice(0, n);
        else picked = chooseFromHand(game, e.chosenBy === 'you' ? ctx.p : q, q, eligible, n, 'discard');
        const discarded = picked
          .sort((a, b) => b - a)
          .map((pos) => cardOf(game, q, discardFromHand(game, q, pos)).name);
        say(game, q, `${label(ctx)} : défausse ${discarded.join(', ')}`);
        any = true;
      }
      ctx.did = any;
    },
  },
  mill: {
    keys: ['amount', 'target'],
    check: (e) => okAmount(e.amount) && okPlayers(e.target),
    run: (game, ctx, e) => {
      for (const q of playersOf(game, ctx, e.target, e)) {
        const me = game.players[q];
        const cards = me.library.splice(0, amountOf(game, ctx, e.amount));
        me.discard.push(...cards);
        ctx.did = cards.length > 0;
      }
    },
  },
  'put-into-inkwell': {
    keys: ['source', 'target', 'exerted', 'facedown', 'chosenBy', 'chooser'],
    check: (e) => {
      if ([e.chooser].some((c) => c != null && c !== 'CONTROLLER') || ![undefined, 'you'].includes(e.chosenBy)) return false;
      if (e.source === 'hand' || e.source === 'top-of-deck' || e.source === 'discard') return okPlayers(e.target);
      if (e.source === 'chosen-card-in-play' || e.source === 'chosen-character') return okCards(e.target);
      if (SELF_TARGETS.has(e.source)) return true;
      return okCards(e.source, { inDiscard: true }) && okPlayers(e.target);
    },
    run: (game, ctx, e) => {
      const exerted = e.exerted !== false;
      if (e.source === 'hand' || e.source === 'top-of-deck' || e.source === 'discard') {
        const q = playersOf(game, ctx, e.target, e)[0];
        const me = game.players[q];
        let idx;
        if (e.source === 'discard') {
          if (!me.discard.length) return void (ctx.did = false);
          [idx] = me.discard.splice(chooseFromHand(game, q, q, me.discard.map((x, i) => i), 1, 'ink', me.discard)[0], 1);
        } else if (e.source === 'hand') {
          const pos = me.hand.map((x, i) => i).filter((i) => cardOf(game, q, me.hand[i]).inkwell);
          if (!pos.length) return void (ctx.did = false);
          [idx] = me.hand.splice(chooseFromHand(game, q, q, pos, 1, 'ink')[0], 1);
        } else idx = me.library.shift();
        if (idx == null) return void (ctx.did = false);
        me.inkwell++;
        if (!exerted) me.ink++;
        tell(game, ctx, `met ${e.source === 'top-of-deck' ? 'la carte du dessus de la pioche' : cardOf(game, q, idx).name} dans l'encrier`);
        ctx.did = true;
        return;
      }
      // "Put this card into your inkwell", a card chosen in play or in a discard
      const target = SELF_TARGETS.has(e.source) ? 'SELF' : typeof e.source === 'object' ? e.source : e.target;
      const cards = targetsOf(game, ctx, e, target).filter((c) => putIntoInkwell(game, c, { exerted }));
      if (cards.length) tell(game, ctx, `met ${names(cards)} dans l'encrier`);
      ctx.did = cards.length > 0;
    },
  },
  'play-card': {
    keys: ['from', 'cardType', 'cost', 'filter', 'costRestriction', 'afterPlay'],
    check: (e) =>
      [].concat(e.from).every((z) => z === 'hand' || z === 'discard') &&
      (e.afterPlay == null || e.afterPlay === 'bottom-of-deck') &&
      e.cost === 'free' &&
      (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
      (e.costRestriction == null || (okComparison(e.costRestriction.comparison) && typeof e.costRestriction.value === 'number')) &&
      filtersOf(e).every(okFilter),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const fits = (card) =>
        (!e.cardType || isType(card, e.cardType)) &&
        (card.kind !== 'action' || !!card.abilities?.action) &&
        (!e.costRestriction || compare(card.cost, e.costRestriction.comparison, e.costRestriction.value)) &&
        filtersOf(e).every((f) => passes(game, ctx, { card, owner: ctx.p, mods: [], damage: 0 }, f));
      // The best card of the zones it may come from
      let best = null;
      for (const zone of [].concat(e.from).map((z) => (z === 'hand' ? me.hand : me.discard))) {
        const options = zone.map((idx, pos) => pos).filter((pos) => fits(cardOf(game, ctx.p, zone[pos])));
        if (!options.length) continue;
        const [pos] = chooseFromHand(game, ctx.p, ctx.p, options, 1, 'play', zone);
        if (!best || cardOf(game, ctx.p, zone[pos]).cost > cardOf(game, ctx.p, best.zone[best.pos]).cost) best = { zone, pos };
      }
      if (!best) return void (ctx.did = false);
      const [idx] = best.zone.splice(best.pos, 1);
      tell(game, ctx, `joue ${cardOf(game, ctx.p, idx).name} gratuitement`);
      enterPlay(game, ctx.p, idx, { afterPlay: e.afterPlay });
      ctx.did = true;
    },
  },
  'return-from-discard': {
    keys: ['target', 'cardType', 'cardName', 'count', 'destination', 'costRestriction', 'filter'],
    check: (e) =>
      (e.target == null || e.target === 'CONTROLLER') &&
      (e.destination == null || e.destination === 'hand' || e.destination === 'top-of-deck') &&
      (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
      (e.count == null || typeof e.count === 'number') &&
      (e.costRestriction == null || (okComparison(e.costRestriction.comparison) && typeof e.costRestriction.value === 'number')) &&
      filtersOf(e).every(okFilter),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const fits = (card) =>
        (!e.cardType || isType(card, e.cardType)) &&
        (!e.cardName || card.title === e.cardName) &&
        (!e.costRestriction || compare(card.cost, e.costRestriction.comparison, e.costRestriction.value)) &&
        filtersOf(e).every((f) => passes(game, ctx, { card, idx: -1, owner: ctx.p, mods: [], damage: 0 }, f));
      const options = me.discard.map((idx, pos) => pos).filter((pos) => fits(cardOf(game, ctx.p, me.discard[pos])));
      const picked = options.length ? chooseFromHand(game, ctx.p, ctx.p, options, Math.min(e.count ?? 1, options.length), 'return', me.discard) : [];
      const back = picked.sort((a, b) => b - a).map((pos) => me.discard.splice(pos, 1)[0]);
      if (e.destination === 'top-of-deck') me.library.unshift(...back);
      else me.hand.push(...back);
      if (back.length) tell(game, ctx, `reprend ${back.map((idx) => cardOf(game, ctx.p, idx).name).join(', ')} de la défausse`);
      ctx.did = back.length > 0;
    },
  },
  'search-deck': {
    keys: ['cardType', 'classification', 'putInto', 'reveal', 'shuffle'],
    check: (e) => e.putInto === 'hand' && (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const options = me.library
        .map((idx, pos) => pos)
        .filter((pos) => {
          const card = cardOf(game, ctx.p, me.library[pos]);
          return (!e.cardType || isType(card, e.cardType)) && (!e.classification || card.classifications.includes(e.classification));
        });
      if (options.length) {
        const [pos] = chooseFromHand(game, ctx.p, ctx.p, options, 1, 'hand', me.library);
        const [idx] = me.library.splice(pos, 1);
        me.hand.push(idx);
        if (me.seen) me.seen[idx] = 1;
        tell(game, ctx, `cherche ${cardOf(game, ctx.p, idx).name} dans la pioche`);
      }
      shuffleInPlace(game, me.library);
      ctx.did = options.length > 0;
    },
  },
  scry: {
    keys: ['amount', 'target', 'destinations', 'chooser', 'revealAll'],
    check: (e) =>
      okAmount(e.amount) &&
      ['CONTROLLER', 'OPPONENT', 'CHOSEN_PLAYER', undefined].includes(e.target) &&
      [undefined, 'CONTROLLER', 'OPPONENT'].includes(e.chooser) &&
      Array.isArray(e.destinations) &&
      e.destinations.every(
        (d) =>
          ['hand', 'deck-top', 'deck-bottom', 'discard', 'play', 'inkwell'].includes(d.zone) &&
          (d.zone !== 'play' || d.cost === 'free') &&
          filtersOf(d).every(okFilter) &&
          (d.playFilters ?? []).every(okFilter) &&
          Object.keys(d).every((k) =>
            ['zone', 'min', 'max', 'reveal', 'filter', 'filters', 'playFilters', 'entersExerted', 'remainder', 'ordering', 'cost', 'exerted', 'facedown'].includes(k)
          )
      ),
    run: (game, ctx, e) => {
      // The deck looked at, and who decides: an opponent sends the best cards away
      const q = playersOf(game, ctx, e.target, e)[0];
      const chooser = e.chooser === 'OPPONENT' ? 1 - ctx.p : ctx.p;
      const me = game.players[q];
      let looked = me.library.splice(0, amountOf(game, ctx, e.amount));
      const moved = [];
      for (const d of e.destinations) {
        if (!looked.length) break;
        const filters = [...filtersOf(d), ...(d.playFilters ?? [])];
        const fits = (idx) => filters.every((f) => passes(game, ctx, { card: cardOf(game, q, idx), owner: q, mods: [], damage: 0 }, f));
        let take = d.remainder ? looked.slice() : looked.filter(fits);
        if (!d.remainder) {
          const max = d.max ?? take.length;
          const ranked = rankForHand(game, q, take, d.zone);
          take = (chooser === q ? ranked : ranked.reverse()).slice(0, max);
          if (take.length < (d.min ?? 0)) take = [];
        }
        looked = looked.filter((idx) => !take.includes(idx));
        for (const idx of take) {
          if (d.zone === 'hand') {
            me.hand.push(idx);
            if (me.seen) me.seen[idx] = 1;
            moved.push(`${cardOf(game, q, idx).name} en main`);
          } else if (d.zone === 'deck-top') me.library.unshift(idx);
          else if (d.zone === 'deck-bottom') me.library.push(idx);
          else if (d.zone === 'discard') me.discard.push(idx);
          else if (d.zone === 'inkwell') {
            me.inkwell++;
            if (d.exerted === false) me.ink++;
          } else if (d.zone === 'play') {
            moved.push(`joue ${cardOf(game, q, idx).name}`);
            enterPlay(game, q, idx, { exerted: !!d.entersExerted });
          }
        }
      }
      me.library.push(...looked);
      tell(game, ctx, `regarde le dessus de ${q === ctx.p ? 'sa' : 'la'} pioche${moved.length ? ` : ${moved.join(', ')}` : ''}`);
      ctx.did = moved.length > 0;
    },
  },
  'select-target': {
    keys: ['target'],
    check: (e) => okCards(e.target, { inDiscard: true }),
    run: (game, ctx, e) => {
      ctx.did = targetsOf(game, ctx, e).length > 0;
    },
  },
  'reveal-hand': { keys: ['target'], check: (e) => okPlayers(e.target), run: (game, ctx) => void (ctx.did = true) },
  'put-under': {
    keys: ['source', 'under'],
    check: (e) => e.source === 'top-of-deck' && okCards(e.under),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const [inst] = targetsOf(game, ctx, { ...e, type: 'put-under' }, e.under).filter((c) => c.zone === 'play');
      if (!inst || !me.library.length) return void (ctx.did = false);
      tell(game, ctx, `place une carte sous ${inst.card.name}`);
      putUnder(game, inst, me.library.shift());
      ctx.did = true;
    },
  },
  'move-cards-from-under': {
    keys: ['destination', 'target'],
    check: (e) => e.destination === 'hand' && okCards(e.target),
    run: (game, ctx, e) => {
      let n = 0;
      for (const inst of targetsOf(game, ctx, e).filter((c) => c.zone === 'play')) {
        game.players[inst.owner].hand.push(...inst.under);
        n += inst.under.length;
        inst.under = [];
      }
      if (n) tell(game, ctx, `reprend en main ${plural(n, 'carte')} de dessous`);
      ctx.did = n > 0;
    },
  },
  'move-to-location': {
    keys: ['character', 'location', 'cost'],
    check: (e) => e.cost === 'free' && okCards(e.character) && okCards(e.location),
    run: (game, ctx, e) => {
      const [loc] = targetsOf(game, ctx, { ...e, type: 'move-to-location' }, e.location).filter((c) => c.card.kind === 'location' && c.owner === ctx.p);
      if (!loc) return void (ctx.did = false);
      const chars = targetsOf(game, ctx, { ...e, type: 'move-to-location', location: loc }, e.character).filter((c) => c.card.kind === 'character');
      let moved = 0;
      for (const c of chars) if (moveCharacter(game, ctx.p, c, loc, { free: true })) moved++;
      ctx.targets = chars;
      ctx.did = moved > 0;
    },
  },
  // A named ability ("can challenge ready characters"), or a whole triggered or activated one
  'grant-ability': {
    keys: ['ability', 'duration', 'target'],
    check: (e) => okGrant(e.ability) && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      for (const c of cards) {
        const until = untilOf(game, ctx, e.duration, c.owner);
        if (typeof e.ability === 'string') addMod(c, { kind: 'grant', ability: e.ability, until });
        else if (e.ability.type === 'can-challenge-ready') addMod(c, { kind: 'grant', ability: 'can-challenge-ready', classification: e.ability.classification, until });
        else {
          addMod(c, { kind: 'ability', ability: e.ability, until });
          game.boardVersion++;
        }
      }
      ctx.did = cards.length > 0;
    },
  },
  // "Prevent the next challenge damage dealt to this character this turn"
  'create-replacement-effect': {
    keys: ['duration', 'replacement'],
    check: (e) => {
      const r = e.replacement ?? {};
      return (
        r.type === 'prevent-damage' &&
        r.targetRef === 'source' &&
        r.consumeOnApply === true &&
        JSON.stringify(r.eventKinds) === '["challenge-damage"]' &&
        (e.duration == null || DURATIONS.has(e.duration)) &&
        Object.keys(r).every((k) => ['type', 'targetRef', 'consumeOnApply', 'eventKinds'].includes(k))
      );
    },
    run: (game, ctx, e) => {
      addMod(ctx.source, { kind: 'shield', until: untilOf(game, ctx, e.duration) });
      ctx.did = true;
    },
  },
  // Reveal the top card: where it goes depends on what it is
  'reveal-and-route': {
    keys: ['target', 'routes', 'fallback'],
    check: (e) =>
      (e.target == null || e.target === 'CONTROLLER') &&
      Array.isArray(e.routes) &&
      e.routes.every(
        (r) =>
          !!REVEALED[r.condition?.type]?.check(r.condition) &&
          ROUTE_ZONES.has(r.destination?.zone) &&
          (r.sideEffects ?? []).every(okEffect) &&
          Object.keys(r).every((k) => ['condition', 'destination', 'sideEffects', 'optional'].includes(k))
      ) &&
      ROUTE_ZONES.has(e.fallback?.zone) &&
      Object.keys(e.fallback).length === 1,
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const idx = me.library.shift();
      if (idx == null) return void (ctx.did = false);
      const card = cardOf(game, ctx.p, idx);
      const route = e.routes.find((r) => REVEALED[r.condition.type].test(card, r.condition));
      const zone = route ? route.destination.zone : e.fallback.zone;
      tell(game, ctx, `révèle ${card.name}`);
      routeCard(game, ctx.p, idx, zone);
      ctx.did = !!route;
      if (route) for (const side of route.sideEffects ?? []) runEffect(game, ctx, side);
    },
  },
  // "This turn, whenever one of your characters quests, ...": an ability for the turn
  'create-triggered-ability': {
    keys: ['lifecycle', 'ability'],
    check: (e) =>
      e.lifecycle?.kind === 'floating' &&
      DURATIONS.has(e.lifecycle.duration) &&
      Object.keys(e.lifecycle).every((k) => ['kind', 'duration'].includes(k)) &&
      isSupported({ ...e.ability, type: 'triggered' }),
    run: (game, ctx, e) => {
      game.players[ctx.p].effects.push({ kind: 'trigger', ability: { ...e.ability, type: 'triggered' }, source: ctx.source, until: untilOf(game, ctx, e.lifecycle.duration) });
      ctx.did = true;
    },
  },
  'property-modification': {
    keys: ['property', 'operation', 'value', 'target', 'duration'],
    check: (e) => e.property === 'classification' && e.operation === 'add' && typeof e.value === 'string' && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      for (const c of cards) addMod(c, { kind: 'classification', value: e.value, until: untilOf(game, ctx, e.duration, c.owner) });
      ctx.did = cards.length > 0;
    },
  },
};
EFFECTS.or = { ...EFFECTS.choice };

/** Whether the engine knows an effect, everything inside it included. */
export const okEffect = (e) => {
  const def = e && EFFECTS[e.type];
  if (!def) return false;
  return Object.keys(e).every((k) => k === 'type' || def.keys.includes(k)) && !!def.check(e);
};

const runEffect = (game, ctx, e) => {
  if (game.over) return;
  EFFECTS[e.type].run(game, ctx, e);
};

/** Resolves an ability: its condition, then its effect. */
export const resolveAbility = (game, ctx) => {
  const { ability } = ctx;
  if (ability.condition && !holds(game, ctx, ability.condition)) return;
  ctx.targets = [];
  ctx.count = 0;
  ctx.did = false;
  runEffect(game, ctx, ability.effect);
};

/** Runs one effect for a pilot weighing it in a copy of the game. */
export const runEffectFor = (game, ctx, effect) => runEffect(game, { targets: [], count: 0, did: false, ...ctx }, effect);

// ---------- Static abilities ----------

// Static effects the engine applies while their card is in play
const STATIC_EFFECTS = {
  'modify-stat': (e) => ['strength', 'willpower', 'lore'].includes(e.stat) && okModifier(e.modifier) && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'stat', 'modifier', 'target'].includes(k)),
  'gain-keyword': (e) =>
    KEYWORDS.includes(e.keyword) &&
    (e.value == null || okAmount(e.value)) &&
    staticTarget(e.target) &&
    Object.keys(e).every((k) => ['type', 'keyword', 'value', 'target'].includes(k)),
  restriction: (e) =>
    RESTRICTIONS.has(e.restriction) &&
    (PLAYER_RESTRICTIONS.has(e.restriction) ? okPlayers(e.target) : staticTarget(e.target)) &&
    (e.condition == null || okCondition(e.condition)) &&
    (e.restriction !== 'challenge-limit' || typeof e.limit === 'number') &&
    (e.minCost == null || typeof e.minCost === 'number') &&
    Object.keys(e).every((k) => ['type', 'restriction', 'target', 'condition', 'limit', 'minCost'].includes(k)),
  'lose-keyword': (e) => KEYWORDS.includes(e.keyword) && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'keyword', 'target'].includes(k)),
  // "Can't go below its printed strength"
  'stat-floor': (e) =>
    ['strength', 'willpower', 'lore'].includes(e.stat) && e.minimum === 'printed' && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'stat', 'minimum', 'target'].includes(k)),
  'cost-reduction': (e) =>
    typeof e.amount === 'number' &&
    (e.target == null || e.target === 'CONTROLLER') &&
    (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
    Object.keys(e).every((k) => ['type', 'amount', 'cardType', 'classification', 'cardName', 'target'].includes(k)),
  'enters-with-damage': (e) => typeof e.amount === 'number' && Object.keys(e).every((k) => ['type', 'amount'].includes(k)),
  'property-modification': (e) =>
    e.operation === 'add' &&
    ((e.property === 'classification' && typeof e.value === 'string') || (e.property === 'singer-threshold' && Number.isFinite(Number(e.value)))) &&
    staticTarget(e.target) &&
    Object.keys(e).every((k) => ['type', 'property', 'operation', 'value', 'target'].includes(k)),
  // "This character can challenge ready characters", "takes no damage from challenges"
  'grant-ability': (e) =>
    (GRANTS.has(e.ability) || (e.ability?.type === 'can-challenge-ready' && Object.keys(e.ability).every((k) => ['type', 'classification'].includes(k)))) &&
    staticTarget(e.target) &&
    Object.keys(e).every((k) => ['type', 'ability', 'target', 'duration'].includes(k)),
  // Activated abilities a location gives the characters at it
  'grant-abilities-while-here': (e) =>
    staticTarget(e.target) &&
    Array.isArray(e.abilities) &&
    e.abilities.every((a) => a.type === 'activated' && isSupported(a)) &&
    Object.keys(e).every((k) => ['type', 'target', 'abilities'].includes(k)),
  // "This character moves for 1 less", "characters move here for free"
  'move-cost-reduction': (e) =>
    (typeof e.reduction === 'number' || e.reduction === 'free') &&
    (e.target === 'SELF' || e.location === 'here') &&
    filtersOf(e).every(okFilter) &&
    Object.keys(e).every((k) => ['type', 'reduction', 'target', 'location', 'filter', 'filters'].includes(k)),
};

/** Ink a character saves moving to a location: its own abilities, the location's. */
export const moveReduction = (game, loc, char) => {
  let saved = 0;
  for (const src of [char, loc]) {
    for (const a of src.card.abilities?.statics ?? []) {
      const e = a.effect;
      if (e.type !== 'move-cost-reduction') continue;
      const ctx = { p: src.owner, source: src };
      if (a.condition && !holds(game, ctx, a.condition)) continue;
      if (src === char ? e.target !== 'SELF' : e.location !== 'here') continue;
      if (src === loc && !filtersOf(e).every((f) => passes(game, ctx, char, f))) continue;
      saved += e.reduction === 'free' ? Infinity : e.reduction;
    }
  }
  return saved;
};

// A static effect reaches the cards it names for as long as it applies: no choosing
const staticTarget = (t) => {
  const n = normalizeTarget(t);
  return !!n && (n.self || (n.spec && n.spec.selector === 'all'));
};

export const okStaticEffect = (e) => !!e && !!STATIC_EFFECTS[e.type]?.(e);

/** A static ability of a card in hand: "you pay less to play this character" under a condition. */
export const okHandStatic = (e) =>
  e?.type === 'cost-reduction' &&
  okAmount(e.amount) &&
  (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
  Object.keys(e).every((k) => ['type', 'amount', 'cardType'].includes(k));

/** Ink a card in hand saves itself, its conditions met. */
export const handReduction = (game, p, card) => {
  const abilities = card.abilities?.handStatics;
  if (!abilities?.length) return 0;
  const ctx = { p, source: { id: -1, idx: -1, owner: p, card, zone: 'hand', damage: 0, exerted: false, mods: [] } };
  return abilities.reduce((s, a) => s + (!a.condition || holds(game, ctx, a.condition) ? amountOf(game, ctx, a.effect.amount) : 0), 0);
};

/** Whether a static ability reaches a card in play, or a player ({ owner, player: true }). */
const staticReaches = (game, src, effect, inst) => {
  const ctx = { p: src.owner, source: src };
  if (inst.player) {
    if (effect.type === 'cost-reduction') return inst.owner === src.owner;
    switch (effect.target ?? 'CONTROLLER') {
      case 'CONTROLLER':
        return inst.owner === src.owner;
      case 'OPPONENT':
      case 'EACH_OPPONENT':
      case 'OPPONENTS':
        return inst.owner !== src.owner;
      default:
        return true;
    }
  }
  // Effects on players, or on the card itself only, reach no card in play
  if (['cost-reduction', 'enters-with-damage', 'move-cost-reduction'].includes(effect.type)) return false;
  if (effect.type === 'restriction' && PLAYER_RESTRICTIONS.has(effect.restriction)) return false;
  const t = normalizeTarget(effect.target);
  if (t.self) return inst === src;
  const { spec } = t;
  if (!spec.cardTypes.includes(inst.card.kind)) return false;
  if (spec.excludeSelf && inst === src) return false;
  if (spec.owner === 'you' && inst.owner !== src.owner) return false;
  if (spec.owner === 'opponent' && inst.owner === src.owner) return false;
  return spec.filters.every((f) => passes(game, ctx, inst, f));
};

/**
 * The static abilities in play that reach a card (or a player) for one kind of effect, with
 * their amount. Their own conditions and targets read printed values: no static loops.
 */
export const applyingStatics = (game, inst, type, sources = null) => {
  if (game.staticDepth) return NONE;
  let out = NONE;
  const visit = (src) => {
    const statics = src.card.abilities?.statics;
    if (!statics?.length) return;
    for (const ability of statics) {
      const { effect } = ability;
      if (effect.type !== type) continue;
      const ctx = { p: src.owner, source: src };
      game.staticDepth++;
      try {
        if (ability.condition && !holds(game, ctx, ability.condition)) continue;
        if (effect.condition && !holds(game, ctx, effect.condition)) continue;
        if (!staticReaches(game, src, effect, inst)) continue;
        // The amount: a stat change, a keyword's value (Resist +N, counted or fixed), ink saved
        const amount =
          type === 'modify-stat'
            ? amountOf(game, ctx, effect.modifier)
            : type === 'gain-keyword'
              ? effect.value == null
                ? 1
                : amountOf(game, ctx, effect.value)
              : type === 'cost-reduction'
                ? effect.amount
                : 0;
        if (out === NONE) out = [];
        out.push({ effect, amount });
      } finally {
        game.staticDepth--;
      }
    }
  };
  // Called for every stat a pilot reads: only the cards with this kind of static effect
  for (const src of sources ?? listenersOf(game).statics[type] ?? NONE) visit(src);
  return out;
};

const NONE = [];

// ---------- Triggers ----------

export const TRIGGER_EVENTS = new Set([
  'play',
  'quest',
  'banish',
  'challenge',
  'challenged',
  'banish-in-challenge',
  'challenged-and-banished',
  'start-turn',
  'end-turn',
  'sing',
  'ink',
  'leave-play',
  'move',
  'put-card-under',
  'remove-damage',
  'exert',
  'draw',
  'boost',
]);

const ON_PLAYER = new Set(['YOU', 'CONTROLLER', 'OPPONENT']);
const ON_GROUPS = {
  YOUR_CHARACTERS: (inst, s) => s.card.kind === 'character' && s.owner === inst.owner,
  YOUR_OTHER_CHARACTERS: (inst, s) => s.card.kind === 'character' && s.owner === inst.owner && s !== inst,
  OPPOSING_CHARACTERS: (inst, s) => s.card.kind === 'character' && s.owner !== inst.owner,
  ANY_CHARACTER: (inst, s) => s.card.kind === 'character',
  ANY_ITEM: (inst, s) => s.card.kind === 'item',
  YOUR_CHARACTERS_OR_LOCATIONS: (inst, s) => (s.card.kind === 'character' || s.card.kind === 'location') && s.owner === inst.owner,
  // The characters at this location
  CHARACTERS_HERE: (inst, s) => s.card.kind === 'character' && s.at === inst,
  OPPONENT_CHARACTERS: (inst, s) => s.card.kind === 'character' && s.owner !== inst.owner,
  OTHER_CHARACTERS: (inst, s) => s.card.kind === 'character' && s !== inst,
  YOUR_LOCATIONS: (inst, s) => s.card.kind === 'location' && s.owner === inst.owner,
};
const ON_KEYS = new Set(['cardType', 'controller', 'classification', 'filters', 'shiftedOntoSelf', 'hasKeyword', 'excludeSelf']);
// Who a challenge trigger's defender must be
const DEFENDER_KEYS = new Set(['controller', 'filters']);

// YOUR_OTHER_AMETHYST_CHARACTERS and the like: your characters of an ink, keyword or classification
const onGroup = (on) => (typeof on === 'string' && !ON_GROUPS[on] ? groupTarget(on) : null);

const inGroup = (game, spec, inst, s) =>
  s.card.kind === 'character' && s.owner === inst.owner && !(spec.excludeSelf && s === inst) && spec.filters.every((f) => passes(game, { p: inst.owner, source: inst }, s, f));

export const okTrigger = (trigger) => {
  const events = [trigger.event, ...(trigger.events ?? [])].filter(Boolean);
  if (!events.length || !events.every((e) => TRIGGER_EVENTS.has(e))) return false;
  const { on } = trigger;
  const okOn =
    on === 'SELF' ||
    ON_PLAYER.has(on) ||
    !!ON_GROUPS[on] ||
    !!onGroup(on) ||
    (on && typeof on === 'object' && Object.keys(on).every((k) => ON_KEYS.has(k)) && (on.filters ?? []).every(okFilter) && (on.hasKeyword == null || KEYWORDS.includes(on.hasKeyword)));
  const okRestrictions = (trigger.restrictions ?? []).every(
    (r) =>
      ['in-challenge', 'once-per-turn', 'first-time-each-turn', 'defender-is-character'].includes(r.type) ||
      (r.type === 'during-turn' && ['your', 'opponent'].includes(r.whose))
  );
  const okDefender = trigger.defender == null || (Object.keys(trigger.defender).every((k) => DEFENDER_KEYS.has(k)) && (trigger.defender.filters ?? []).every(okFilter));
  const okContext = trigger.challengeContext == null || ['attacker', 'defender'].includes(trigger.challengeContext.role);
  const okWhen = trigger.condition == null || okCondition(trigger.condition);
  // Whose effect it was: "whenever you remove damage"
  const okSource = trigger.sourceFilter == null || (Object.keys(trigger.sourceFilter).length === 1 && ['you', 'opponent'].includes(trigger.sourceFilter.sourceController));
  return (
    okOn &&
    okRestrictions &&
    okDefender &&
    okContext &&
    okWhen &&
    okSource &&
    Object.keys(trigger).every((k) => ['event', 'events', 'on', 'timing', 'restrictions', 'defender', 'challengeContext', 'condition', 'sourceFilter'].includes(k))
  );
};

/** Whether an event sets off a triggered ability of a card. */
export const triggerMatches = (game, inst, ability, payload, floating = false) => {
  const { trigger } = ability;
  const { on } = trigger;
  const subject = payload.subject;
  let hit;
  if (on === 'SELF') hit = subject === inst || (subject && subject.id === inst.id);
  else if (on === 'YOU' || on === 'CONTROLLER') hit = payload.p === inst.owner;
  else if (on === 'OPPONENT') hit = payload.p !== inst.owner;
  else if (ON_GROUPS[on]) hit = !!subject?.card && ON_GROUPS[on](inst, subject);
  else if (typeof on === 'string') hit = !!subject?.card && inGroup(game, onGroup(on), inst, subject);
  else {
    hit =
      !!subject?.card &&
      (!on.cardType || isType(subject.card, on.cardType)) &&
      (!on.controller || on.controller === 'any' || (on.controller === 'you') === (subject.owner === inst.owner)) &&
      (!on.classification || hasClass(game, subject, on.classification)) &&
      (!on.shiftedOntoSelf || (payload.shifted && subject === inst)) &&
      (!on.excludeSelf || subject !== inst) &&
      (!on.hasKeyword || (subject.zone === 'play' ? keywordOf(game, subject, on.hasKeyword) : (subject.card.keywords[on.hasKeyword] ?? 0)) > 0) &&
      (on.filters ?? []).every((f) => passes(game, { p: inst.owner, source: inst }, subject, f));
  }
  if (!hit) return false;
  // A card entering play sees its own entry only through "when you play this character"
  if (payload.event === 'play' && on !== 'SELF' && subject === inst) return false;
  // Only the card in play listens, except a card leaving play for its own "when banished"
  if (!floating && inst.zone !== 'play' && !(on === 'SELF' && subject === inst)) return false;
  const { defender, challengeContext } = trigger;
  if (defender) {
    const d = payload.defender;
    if (!d) return false;
    if (defender.controller && (defender.controller === 'opponent') === (d.owner === inst.owner)) return false;
    if (!(defender.filters ?? []).every((f) => passes(game, { p: inst.owner, source: inst }, d, f))) return false;
  }
  if (challengeContext && payload.role !== challengeContext.role) return false;
  if (trigger.condition && !holds(game, { p: inst.owner, source: inst, trigger: payload }, trigger.condition)) return false;
  if (trigger.sourceFilter && (payload.by === inst.owner) !== (trigger.sourceFilter.sourceController === 'you')) return false;
  for (const r of trigger.restrictions ?? []) {
    if (r.type === 'defender-is-character' && payload.defender?.card.kind !== 'character') return false;
    if (r.type === 'in-challenge' && !payload.inChallenge) return false;
    if (r.type === 'during-turn' && (game.current === inst.owner) !== (r.whose === 'your')) return false;
  }
  return true;
};
