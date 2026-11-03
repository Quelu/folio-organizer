import {
  addMod,
  banish,
  cardOf,
  checkBanish,
  costOf,
  discardRef,
  damageCard,
  discardFromHand,
  drawCards,
  emit,
  enterPlay,
  gainInkDrops,
  gainLore,
  inPlay,
  isRestricted,
  keywordOf,
  KEYWORDS,
  listenersOf,
  loseLore,
  moveCharacter,
  moveUnder,
  addToInkwell,
  payInk,
  putIntoDeck,
  putIntoInkwell,
  putUnder,
  returnToHand,
  say,
  random,
  shuffleInPlace,
  statOf,
  takeFromDiscard,
  takeFromInkwell,
} from './engine.js';
import { acceptOptional, cardWorth, chooseCards, chooseFromHand, chooseOption, choosePlayer, nameACard, rankForHand } from './decisions.js';
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
  equals: (a, b) => a === b,
  eq: (a, b) => a === b,
};

const compare = (a, op, b) => COMPARE[op](a, b);

// A comparison is a string with a value next to it, or { operator, value }
const okComparison = (c) => (typeof c === 'string' ? !!COMPARE[c] : !!COMPARE[c?.operator] && typeof c.value === 'number');

const DURATIONS = new Set(['this-turn', 'until-start-of-next-turn', 'their-next-turn', 'next-turn', 'next-play-this-turn', 'permanent', 'while-in-play', 'during-challenge']);

// "During that challenge": for the turn, while the card is in the challenge being worked out
const IN_THIS_CHALLENGE = { type: 'in-this-challenge' };

/** Turn at whose end an effect wears off; owner: the player whose "next turn" counts. */
const untilOf = (game, ctx, duration, owner = ctx.p) => {
  switch (duration) {
    case 'this-turn':
    case 'next-play-this-turn':
    case 'during-challenge':
      return game.turn;
    case 'until-start-of-next-turn':
      return game.current === ctx.p ? game.turn + 1 : game.turn;
    // "During their next turn": the next turn of the card's owner
    case 'their-next-turn':
    case 'next-turn':
      return game.current === owner ? game.turn + 2 : game.turn + 1;
    default:
      return Infinity;
  }
};

const countCards = (game, ctx, { owner = 'you', cardType = 'character', zones = ['play'], filters = [], excludeSelf = false }) => {
  const players = owner === 'any' ? [0, 1] : [owner === 'opponent' ? 1 - ctx.p : ctx.p];
  let n = 0;
  for (const q of players) {
    // The inkwell is facedown: its cards are only counted
    if (zones.includes('inkwell')) n += game.players[q].inkwell;
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
    check: (a) =>
      (a.zones ?? ['play']).every((z) => z === 'play' || z === 'discard' || (z === 'inkwell' && !a.filters?.length)) && (a.filters ?? []).every(okFilter),
    value: (game, ctx, a) => countCards(game, ctx, { owner: a.owner ?? 'you', cardType: a.cardType, zones: a.zones ?? ['play'], filters: a.filters ?? [], excludeSelf: a.excludeSelf }),
  },
  'last-effect-target-count': { check: () => true, value: (game, ctx) => ctx.count ?? 0 },
  // What an earlier step counted ("for each action card discarded this way"), or the event's amount ("the same amount of damage")
  'trigger-amount': { check: () => true, value: (game, ctx) => ctx.amount ?? ctx.trigger?.amount ?? 0 },
  // A stat of the card an earlier step chose ("draw cards equal to that character's {L}")
  'target-attribute': {
    check: (a) => ['lore', 'strength', 'willpower', 'cost', 'damage'].includes(a.attribute),
    value: (game, ctx, a) => {
      const inst = ctx.targets?.[0];
      if (!inst) return 0;
      if (a.attribute === 'damage') return inst.damage ?? 0;
      if (a.attribute === 'cost') return inst.card.cost;
      return inst.zone === 'play' ? statOf(game, inst, a.attribute) : (inst.last?.[a.attribute] ?? inst.card[a.attribute] ?? 0);
    },
  },
  // The location a character just moved to
  'target-location-attribute': { check: (a) => a.attribute === 'lore', value: (game, ctx) => (ctx.location ? statOf(game, ctx.location, 'lore') : 0) },
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
  // Of the card the ability comes from: the cards under it, its location's lore, the characters at it (a location), a stat
  'source-attribute': {
    check: (a) => ['cards-under-them', 'location-lore', 'chars-at-location', 'lore', 'strength', 'willpower'].includes(a.attribute),
    value: (game, ctx, a) => {
      switch (a.attribute) {
        case 'cards-under-them':
          return ctx.source.under?.length ?? 0;
        case 'location-lore':
          return ctx.source.at ? statOf(game, ctx.source.at, 'lore') : 0;
        case 'chars-at-location':
          return game.players[ctx.source.owner].characters.filter((c) => c.at === ctx.source).length;
        default:
          return currentStat(game, ctx.source, a.attribute);
      }
    },
  },
  // "Gain lore equal to the lore lost this way"
  'lore-lost': { check: () => true, value: (game, ctx) => ctx.loreLost ?? 0 },
  // "For each 1 damage on opposing characters"
  reducer: {
    check: (a) => a.reducer === 'damage' && (a.filters ?? []).every(okFilter),
    value: (game, ctx, a) =>
      charactersOf(game, ctx, a.owner === 'opponent' ? 'opponent' : a.owner === 'any' ? 'any' : 'you')
        .filter((c) => (a.filters ?? []).every((f) => passes(game, ctx, c, f)))
        .reduce((s, c) => s + c.damage, 0),
  },
  // "For each opposing character banished in a challenge this turn, 2 less"
  'turn-metric': {
    check: (a) => !!METRICS[a.metric] && (a.multiplier == null || typeof a.multiplier === 'number'),
    value: (game, ctx, a) => METRICS[a.metric](game, a.owner === 'opponent' ? 1 - ctx.p : ctx.p, a, ctx) * (a.multiplier ?? 1),
  },
  // "+1 {S} this turn for each 1 damage on them": the chosen character
  'damage-on-target': { check: () => true, value: (game, ctx) => ctx.targets?.[0]?.damage ?? 0 },
  count: {
    check: (a) => a.what === 'distinct-character-ink-types' || a.what === 'distinct-item-names-in-play',
    value: (game, ctx, a) => {
      const pl = game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p];
      return a.what === 'distinct-item-names-in-play' ? new Set(pl.items.map((c) => c.card.title)).size : new Set(pl.characters.flatMap((c) => c.card.inks)).size;
    },
  },
  'for-each': {
    check: (a) => okCounter(a.counter) || !!BOARD_COUNTS[a.counter],
    value: (game, ctx, a) => (BOARD_COUNTS[a.counter] ? BOARD_COUNTS[a.counter](game, ctx.p) : COUNTERS[a.counter.type](ctx, game, a.counter)),
  },
  'characters-in-play': { check: () => true, value: (game, ctx, a) => game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p].characters.length },
  'items-in-play': { check: () => true, value: (game, ctx, a) => game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p].items.length },
  'cards-in-discard': { check: () => true, value: (game, ctx, a) => game.players[a.controller === 'opponent' ? 1 - ctx.p : ctx.p].discard.length },
  // "+1 {L} for each 1 damage on him"
  'damage-on-self': { check: () => true, value: (game, ctx) => ctx.source.damage ?? 0 },
  // "For each other character named The Queen you have in play"
  'name-character-count': {
    check: (a) => typeof a.name === 'string',
    value: (game, ctx, a) => charactersOf(game, ctx, a.controller ?? 'you').filter((c) => c.card.title === a.name && !(a.excludeSelf && c === ctx.source)).length,
  },
  // The lore of a card an earlier step named, or of one chosen now (the one with the most)
  'lore-value-of': {
    check: (a) => a.target?.ref === 'previous-target' || a.target?.ref === 'trigger-subject' || normalizeTarget(a.target)?.spec?.selector === 'chosen',
    value: (game, ctx, a) => {
      const spec = normalizeTarget(a.target).spec;
      const [inst] = spec
        ? candidatesOf(game, ctx, spec).sort((x, y) => statOf(game, y, 'lore') - statOf(game, x, 'lore'))
        : refTargets(ctx, a.target.ref);
      return inst ? (inst.zone === 'play' ? statOf(game, inst, 'lore') : inst.card.lore) : 0;
    },
  },
  difference: { check: (a) => okAmount(a.left) && okAmount(a.right), value: (game, ctx, a) => amountOf(game, ctx, a.left) - amountOf(game, ctx, a.right) },
};

// What an earlier step did, counted: "for each damage removed", "for each lore lost", the damage on the chosen character
const COUNTERS = {
  'last-effect-target-count': (ctx) => ctx.count ?? 0,
  'damage-removed': (ctx) => ctx.removed ?? 0,
  'lore-lost': (ctx) => ctx.loreLost ?? 0,
  'damage-on-target': (ctx) => ctx.targets?.[0]?.damage ?? 0,
  // "For each exerted character you have in play", "for each damaged character opponents have in play"
  'exerted-characters': (ctx, game, c) => game.players[c.controller === 'opponent' ? 1 - ctx.p : ctx.p].characters.filter((x) => x.exerted).length,
  'damaged-characters': (ctx, game, c) => game.players[c.controller === 'opponent' ? 1 - ctx.p : ctx.p].characters.filter((x) => x.damage > 0).length,
  // "For each character you have here": the cards a query finds
  'target-query': (ctx, game, c) => queryCount(game, ctx, c.query),
  // "For each character that sang this song", "for each item banished this way"
  'characters-that-sang': (ctx) => ctx.singers?.length ?? 0,
  'banished-this-way': (ctx) => ctx.count ?? 0,
};

const okCounter = (c) => !!COUNTERS[c?.type] && (c.type !== 'target-query' || okQuery(c.query));

// What a player has in play, counted ("for each location you have in play")
const BOARD_COUNTS = {
  locations: (game, p) => game.players[p].locations.length,
  items: (game, p) => game.players[p].items.length,
  characters: (game, p) => game.players[p].characters.length,
};

// Amounts written as a word; the card a cost discarded
const NAMED_AMOUNTS = {
  DAMAGE_REMOVED: (game, ctx) => ctx.removed ?? 0,
  DISCARDED_CARD_LORE: (game, ctx) => ctx.paid?.[0]?.card.lore ?? 0,
  // "The cost of one of your items" chosen before; "for each card discarded this way"
  TARGET_COST: (game, ctx) => ctx.targets?.[0]?.card.cost ?? 0,
  DISCARDED_COUNT: (game, ctx) => ctx.discarded?.length ?? 0,
};

// The card an amount reads: the source, or a card an earlier step named
const isOwnCard = (t) => t === 'SELF' || t?.ref === 'self' || t?.ref === 'previous-target' || t?.ref === 'trigger-subject';
const statOfRef = (game, ctx, t, stat) => {
  const inst = t === 'SELF' ? ctx.source : refTargets(ctx, t.ref)[0];
  return !inst ? 0 : inst.zone === 'play' ? statOf(game, inst, stat) : (inst.card[stat] ?? 0);
};

const okAmount = (a) => typeof a === 'number' || !!NAMED_AMOUNTS[a] || (a != null && typeof a === 'object' && !!AMOUNTS[a.type]?.check(a));

const amountOf = (game, ctx, a) => (typeof a === 'number' ? a : NAMED_AMOUNTS[a] ? NAMED_AMOUNTS[a](game, ctx) : AMOUNTS[a.type].value(game, ctx, a));

// ---------- Filters ----------

// A stat as it is now, or as it was in play for a card that left ("the {S} he had in play")
const currentStat = (game, inst, stat) => (inst.zone === 'play' ? statOf(game, inst, stat) : (inst.last?.[stat] ?? inst.card[stat] ?? 0));

// value: a number, 'source' (the stat of the card the ability comes from) or 'target' (of the card chosen before)
const statFilter = (stat) => ({
  check: (f) => okComparison(f.comparison ?? f.operator) && (typeof f.value === 'number' || f.value === 'source' || f.value === 'target'),
  test: (game, ctx, inst, f) => {
    const than = f.value === 'source' ? currentStat(game, ctx.source, stat) : f.value === 'target' ? (ctx.targets?.[0] ? currentStat(game, ctx.targets[0], stat) : -Infinity) : f.value;
    return compare(inst.zone === 'play' ? statOf(game, inst, stat) : (inst.card[stat] ?? 0), f.comparison ?? f.operator, than);
  },
});

// A name equal to a value, or containing it ("a location named Sleepy Hollow")
const nameMatches = (title, f) => (f.contains ? title.includes(f.contains) : title === (f.name ?? f.equals ?? f.value));
const okName = (f) => typeof (f.contains ?? f.name ?? f.equals ?? f.value) === 'string';

const ATTRIBUTES = { cost: (game, inst) => inst.card.cost, strength: currentStat, willpower: currentStat, lore: currentStat };

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
  'challenged-this-turn': { check: () => true, test: (game, ctx, inst) => inst.challengedTurn === game.turn },
  // The card a player named
  'named-card': { check: () => true, test: (game, ctx, inst) => inst.card.title === ctx.named },
  // A card its player played this turn ("a song card you played this turn")
  'played-this-turn': { check: () => true, test: (game, ctx, inst) => game.players[inst.owner].turnStats.played.some((x) => x.idx === inst.idx) },
  // A character defending in the challenge being worked out
  'challenge-role': { check: (f) => ['attacker', 'defender'].includes(f.role), test: (game, ctx, inst, f) => game.challenging?.[f.role] === inst },
  ready: { check: () => true, test: (game, ctx, inst) => !inst.exerted },
  damaged: { check: () => true, test: (game, ctx, inst) => inst.damage > 0 },
  'is-damaged': { check: () => true, test: (game, ctx, inst) => inst.damage > 0 },
  undamaged: { check: () => true, test: (game, ctx, inst) => inst.damage === 0 },
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
  'has-name': { check: okName, test: (game, ctx, inst, f) => nameMatches(inst.card.title, f) },
  name: { check: okName, test: (game, ctx, inst, f) => nameMatches(inst.card.title, f) },
  // { attribute: 'name', comparison: 'equals', value }, or a stat compared to a number
  attribute: {
    check: (f) =>
      (f.attribute === 'inkwell' && typeof f.value === 'boolean') ||
      (f.attribute === 'name' && typeof f.value === 'string' && ['equals', 'equal', 'eq', undefined].includes(f.comparison)) ||
      (!!ATTRIBUTES[f.attribute] && okComparison(f.comparison ?? f.operator) && typeof f.value === 'number'),
    test: (game, ctx, inst, f) => {
      if (f.attribute === 'inkwell') return !!inst.card.inkwell === f.value;
      return f.attribute === 'name' ? inst.card.title === f.value : compare(ATTRIBUTES[f.attribute](game, inst, f.attribute), f.comparison ?? f.operator, f.value);
    },
  },
  // A card under one of a player's cards in play (zone 'limbo')
  'under-parent': {
    check: (f) => ['you', 'opponent', 'any', undefined].includes(f.owner) && (f.cardTypes ?? []).every((t) => CARD_TYPES.includes(t)),
    test: (game, ctx, inst, f) =>
      !!inst.parent &&
      (f.owner == null || f.owner === 'any' || (f.owner === 'you') === (inst.parent.owner === ctx.p)) &&
      (!f.cardTypes || f.cardTypes.includes(inst.parent.card.kind)),
  },
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

/**
 * A filter without a type: { cardType, maxCost, minCost, classification, name }, or about the
 * cards of the ability: the same name as the card chosen before (and not that card), the card the
 * ability comes from or the event's card, one of the cards that were under a banished card.
 */
const SHORT_FILTER = new Set([
  'cardType',
  'notCardType',
  'maxCost',
  'minCost',
  'classification',
  'name',
  'sameNameAsChosenCard',
  'excludeChosenCard',
  'sameInstanceAsSource',
  'sameInstanceAsTriggerSubject',
  'inEventSnapshotCardsUnder',
  'inEventSnapshotDiscardedCards',
  'sameNameAsSource',
]);

const okFilter = (f) => {
  if (!f || typeof f !== 'object') return false;
  if (!f.type) return Object.keys(f).length > 0 && Object.keys(f).every((k) => SHORT_FILTER.has(k));
  return !!FILTERS[f.type]?.check(f);
};

const sameCard = (a, b) => !!a && !!b && a.idx === b.idx && a.owner === b.owner;

const passes = (game, ctx, inst, f) => {
  if (!f.type) {
    const chosen = ctx.targets?.[0];
    return (
      (f.cardType == null || isType(inst.card, f.cardType)) &&
      (f.notCardType == null || !isType(inst.card, f.notCardType)) &&
      (f.maxCost == null || inst.card.cost <= f.maxCost) &&
      (f.minCost == null || inst.card.cost >= f.minCost) &&
      (f.classification == null || inst.card.classifications.includes(f.classification)) &&
      (f.name == null || inst.card.title === f.name) &&
      (!f.sameNameAsChosenCard || (!!chosen && inst.card.title === chosen.card.title)) &&
      (!f.excludeChosenCard || inst !== chosen) &&
      (!f.sameInstanceAsSource || sameCard(inst, ctx.source)) &&
      (!f.sameInstanceAsTriggerSubject || sameCard(inst, ctx.trigger?.subject)) &&
      (!f.inEventSnapshotCardsUnder || (ctx.trigger?.subject?.underCards ?? []).includes(inst.idx)) &&
      (!f.inEventSnapshotDiscardedCards || (ctx.discarded ?? []).some((d) => d.q === inst.owner && d.idx === inst.idx)) &&
      (!f.sameNameAsSource || inst.card.title === ctx.source.card.title)
    );
  }
  return FILTERS[f.type].test(game, ctx, inst, f);
};

/** Whether an effect on a card that lasts only while a condition holds applies now (engine.js). */
export const modHolds = (game, inst, mod) => !mod.condition || holds(game, { p: inst.owner, source: inst }, mod.condition);

/** Whether a card passes a filter, for an ability of src's controller (engine.js: "can't be challenged by..."). */
export const matchesFilter = (game, ctx, inst, f) => passes(game, ctx, inst, f);

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
  'CHALLENGING_PLAYER',
]);

// "The player or players with the most cards in their hands"
const RANKED_ZONES = { hand: (pl) => pl.hand.length, discard: (pl) => pl.discard.length, play: (pl) => pl.characters.length + pl.items.length + pl.locations.length };
const okRanked = (f) => f?.type === 'zone-count-rank' && !!RANKED_ZONES[f.zone] && ['highest', 'lowest'].includes(f.rank) && (f.ties == null || f.ties === 'all');

/** The players an effect is about; CHOSEN_PLAYER asks the controller. */
const playersOf = (game, ctx, target, effect) => {
  if (isOtherPlayer(target)) return [1 - ctx.p];
  if (target && typeof target === 'object') {
    const counts = game.players.map((pl) => RANKED_ZONES[target.filter.zone](pl));
    const best = target.filter.rank === 'highest' ? Math.max(...counts) : Math.min(...counts);
    return [ctx.p, 1 - ctx.p].filter((q) => counts[q] === best && counts[q] >= (target.filter.minCount ?? 0));
  }
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
      return [ctx.trigger?.subject?.owner ?? ctx.p];
    // The player whose card or effect set the event off ("whenever an opponent chooses this character")
    case 'TRIGGER_SOURCE_OWNER':
      return [ctx.trigger?.by ?? ctx.trigger?.subject?.owner ?? ctx.p];
    case 'CHALLENGING_PLAYER':
      return [ctx.trigger?.attacker?.owner ?? 1 - ctx.p];
    default:
      return [ctx.p, 1 - ctx.p];
  }
};

// "Another chosen player", in a game of two: the opponent
const isOtherPlayer = (t) => t?.selector === 'chosen' && t.count === 1 && t.excludeSelf === true && Object.keys(t).length === 3;

const okPlayers = (t) =>
  t == null ||
  PLAYER_TARGETS.has(t) ||
  isOtherPlayer(t) ||
  (typeof t === 'object' && t.selector === 'each-player' && Object.keys(t).every((k) => ['selector', 'filter'].includes(k)) && okRanked(t.filter));

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
  YOUR_CHOSEN_DAMAGED_CHARACTER: character('you', { filters: [{ type: 'damaged' }] }),
  CHOSEN_OPPOSING_CHARACTER_3_STRENGTH_OR_LESS: character('opponent', { filters: [{ type: 'strength-comparison', comparison: 'lte', value: 3 }] }),
  ANOTHER_CHOSEN_CHARACTER: character('any', { excludeSelf: true }),
  UP_TO_2_CHOSEN_CHARACTERS: character('any', { count: { upTo: 2 } }),
  CHOSEN_CHARACTER_ITEM_OR_LOCATION: character('any', { cardTypes: ['character', 'item', 'location'] }),
};

const SELF_TARGETS = new Set(['SELF', 'self', 'this-card', 'THIS_ITEM', 'this']);
const REFS = new Set([
  'self',
  'source',
  'previous-target',
  'selected-all',
  'selected-first',
  'trigger-subject',
  'trigger-source',
  'trigger-destination',
  'attacker',
  'defender',
  // The characters who sang the song
  'singers',
  // The card the step before chose or played
  'chosen-or-source',
]);
/**
 * A spec's keys. requireDifferentTargets: not a card an earlier step chose ("another chosen
 * character"); requireSameOwner: all from one player's discard; excludeTriggerSubject: not the
 * event's cards; totalStrengthBudget: chosen cards with that much {S} in all.
 */
const SPEC_KEYS = new Set([
  'selector',
  'owner',
  'zones',
  'cardTypes',
  'cardType',
  'count',
  'filter',
  'filters',
  'excludeSelf',
  'requireDifferentTargets',
  'requireSameOwner',
  'excludeTriggerSubject',
  'excludeChallenger',
  'totalStrengthBudget',
]);
const CARD_TYPES = ['character', 'item', 'location', 'action'];
// Zones a spec may read besides play: a discard, a hand, the cards under the cards in play, an inkwell
const ZONES = new Set(['play', 'discard', 'hand', 'limbo', 'inkwell']);

// YOUR_OTHER_HERO_CHARACTERS, YOUR_EVASIVE_CHARACTERS, YOUR_OTHER_AMBER_CHARACTERS...
const groupTarget = (name) => {
  const m = /^YOUR_(OTHER_)?([A-Z_]+?)_CHARACTERS$/.exec(name);
  if (!m) return null;
  const word = m[2]
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
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
// CHOSEN_ITEM, CHOSEN_CHARACTER_OR_LOCATION, ALL_OPPOSING_ITEMS, YOUR_LOCATIONS_OR_ITEMS...: the card types a name lists
const TYPE_WORDS = { CHARACTER: 'character', CHARACTERS: 'character', ITEM: 'item', ITEMS: 'item', LOCATION: 'location', LOCATIONS: 'location' };
const typedTarget = (name) => {
  const m = /^(CHOSEN|CHOSEN_OPPOSING|ALL_OPPOSING|ALL|YOUR)_([A-Z_]+)$/.exec(name);
  const types = m?.[2].split('_OR_').map((w) => TYPE_WORDS[w]);
  if (!types || !types.every(Boolean)) return null;
  const owner = m[1].includes('OPPOSING') ? 'opponent' : m[1] === 'YOUR' ? 'you' : 'any';
  return m[1].startsWith('CHOSEN') ? character(owner, { cardTypes: types }) : allOf(owner, { cardTypes: types });
};

// Targets are data that never change: read once
const normalized = new Map();
const normalizedObjects = new WeakMap();

export const normalizeTarget = (target) => {
  const cache = typeof target === 'string' ? normalized : target && typeof target === 'object' ? normalizedObjects : null;
  if (!cache) return null;
  if (!cache.has(target)) cache.set(target, readTarget(target));
  return cache.get(target);
};

const readTarget = (target) => {
  if (typeof target === 'string') {
    if (SELF_TARGETS.has(target)) return { self: true };
    if (target === 'TRIGGERING_CHARACTER') return { ref: 'trigger-subject' };
    const spec = NAMED_TARGETS[target] ?? groupTarget(target) ?? typedTarget(target);
    return spec ? { spec } : null;
  }
  if (!target || typeof target !== 'object') return null;
  if (target.ref) {
    if (!REFS.has(target.ref) || Object.keys(target).length !== 1) return null;
    return target.ref === 'self' || target.ref === 'source' ? { self: true } : { ref: target.ref };
  }
  // { selector: 'all', reference: 'trigger-subject', filters }: the cards a step named, if they match
  if (target.reference) {
    if (!REFS.has(target.reference) || !filtersOf(target).every(okFilter)) return null;
    if (!Object.keys(target).every((k) => ['selector', 'reference', 'count', 'zones', 'filter', 'filters', 'cardTypes', 'cardType'].includes(k))) return null;
    const types = target.cardTypes ?? (target.cardType ? [target.cardType] : null);
    if (types && !types.every((t) => CARD_TYPES.includes(t))) return null;
    return { ref: target.reference, filters: [...filtersOf(target), ...(types ? [{ type: 'or', filters: types.map((t) => ({ type: 'card-type', cardType: t })) }] : [])] };
  }
  if (!Object.keys(target).every((k) => SPEC_KEYS.has(k))) return null;
  if (target.selector === 'self') return { self: true };
  if (!['chosen', 'all'].includes(target.selector)) return null;
  const zone = target.zones?.length === 1 ? target.zones[0] : target.zones ? null : 'play';
  if (!ZONES.has(zone)) return null;
  // "card" means any card; a song is an action that is a song
  let types = target.cardTypes ?? (target.cardType ? [target.cardType] : null);
  const song = !!types?.includes('song');
  if (song) types = types.map((t) => (t === 'song' ? 'action' : t));
  const cardTypes = !types || types.includes('card') ? (zone === 'play' ? ['character', 'item', 'location'] : CARD_TYPES) : types;
  if (!cardTypes.every((t) => CARD_TYPES.includes(t)) || (zone === 'play' && cardTypes.includes('action'))) return null;
  const filters = [...filtersOf(target), ...(song ? [{ type: 'is-song' }] : [])];
  if (!filters.every(okFilter)) return null;
  const count = typeof target.count?.exactly === 'number' ? target.count.exactly : (target.count ?? (target.selector === 'all' ? 'all' : 1));
  if (!(count === 'all' || typeof count === 'number' || typeof count?.upTo === 'number')) return null;
  if (target.totalStrengthBudget != null && typeof target.totalStrengthBudget !== 'number') return null;
  return {
    spec: {
      selector: target.selector,
      owner: target.owner ?? 'any',
      zone,
      cardTypes,
      count,
      filters,
      excludeSelf: !!target.excludeSelf,
      different: !!target.requireDifferentTargets,
      sameOwner: !!target.requireSameOwner,
      notTrigger: !!(target.excludeTriggerSubject || target.excludeChallenger),
      budget: target.totalStrengthBudget ?? null,
    },
  };
};

/**
 * Whether the engine knows a card target; inDiscard: the effect also handles cards in a discard,
 * inHand: cards in a hand, under: cards under the cards in play.
 */
const okCards = (t, { inDiscard = false, inHand = false, under = false, inInkwell = false } = {}) => {
  const n = normalizeTarget(t);
  const zone = n?.spec?.zone;
  return n != null && (zone !== 'discard' || inDiscard) && (zone !== 'hand' || inHand) && (zone !== 'limbo' || under) && (zone !== 'inkwell' || inInkwell) && !isAllInk(t);
};

// A card of a discard, as a target: its position changes, its index stays
const discardCard = (game, q, idx) => ({ id: `d${q}:${idx}`, idx, owner: q, card: cardOf(game, q, idx), zone: 'discard', damage: 0, exerted: false, mods: [] });

// A card of a hand (by position), as a target
const handCard = (game, q, pos) => {
  const idx = game.players[q].hand[pos];
  return { id: `h${q}:${pos}`, idx, pos, owner: q, card: cardOf(game, q, idx), zone: 'hand', damage: 0, exerted: false, mods: [] };
};

// A card under a card in play (parent), as a target
const underCard = (game, parent, pos) => ({
  id: `u${parent.id}:${pos}`,
  idx: parent.under[pos],
  pos,
  parent,
  owner: parent.owner,
  card: cardOf(game, parent.owner, parent.under[pos]),
  zone: 'limbo',
  damage: 0,
  exerted: false,
  mods: [],
});

const zoneCards = (game, q, zone) => {
  switch (zone) {
    case 'discard':
      return [...new Set(game.players[q].discard)].map((idx) => discardCard(game, q, idx));
    case 'hand':
      return game.players[q].hand.map((idx, pos) => handCard(game, q, pos));
    case 'limbo':
      return inPlay(game, q).flatMap((parent) => parent.under.map((idx, pos) => underCard(game, parent, pos)));
    case 'inkwell':
      return game.players[q].inkCards.map((idx, pos) => ({ ...handCard(game, q, 0), id: `i${q}:${pos}`, idx, pos, card: cardOf(game, q, idx), zone: 'inkwell' }));
    default:
      return inPlay(game, q);
  }
};

/** Cards a spec reaches, before any choice. chooser: who chooses (Ward keeps the others' away). */
const candidatesOf = (game, ctx, spec, chooser = ctx.p) => {
  const players = spec.owner === 'any' ? [ctx.p, 1 - ctx.p] : [spec.owner === 'opponent' ? 1 - ctx.p : ctx.p];
  const triggered = spec.notTrigger ? [ctx.trigger?.subject, ctx.trigger?.target].filter(Boolean) : NONE;
  const out = [];
  for (const q of players) {
    for (const inst of zoneCards(game, q, spec.zone)) {
      if (!spec.cardTypes.includes(inst.card.kind)) continue;
      if (spec.excludeSelf && inst === ctx.source) continue;
      if (spec.different && ctx.targets?.includes(inst)) continue;
      if (triggered.includes(inst)) continue;
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
    case 'defender':
      return ctx.trigger?.defender ? [ctx.trigger.defender] : [];
    case 'singers':
      return ctx.singers ?? [];
    case 'chosen-or-source':
      return ctx.targets?.length ? ctx.targets : [ctx.source];
    default:
      return ctx.trigger?.subject?.card ? [ctx.trigger.subject] : [];
  }
};

/** Chosen cards whose {S} fit a total ("any number of chosen characters with total {S} 10 or less"): the best first. */
const withinBudget = (game, cards, budget) => {
  let left = budget;
  return cards.filter((c) => {
    const s = statOf(game, c, 'strength');
    if (s > left) return false;
    left -= s;
    return true;
  });
};

/**
 * The cards an effect lands on: the source, a card named by an earlier step, everything a spec
 * reaches, or the ones a player chooses (chosenBy: 'opponent' lets the opponent pick theirs).
 * Remembers them for "that character", and the cards in play chosen for "whenever this character
 * is chosen". A character with Vanish an opponent chooses for an action is banished instead.
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
      if (t.spec.sameOwner && cards.length) cards = cards.filter((c) => c.owner === cards[0].owner);
      if (t.spec.budget != null) cards = withinBudget(game, cards, t.spec.budget);
      for (const c of cards) if (c.zone === 'play') (ctx.chosen ??= []).push({ inst: c, by: chooser });
      if (ctx.source.card.kind === 'action') {
        for (const inst of cards.filter((c) => c.owner !== chooser && keywordOf(game, c, 'Vanish') > 0)) {
          say(game, inst.owner, `${inst.card.name} disparaît (Dissipation)`, 'effect', [inst]);
          banish(game, inst);
        }
        cards = cards.filter((c) => c.zone !== 'discard' || t.spec.zone === 'discard');
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
  lore: (game, q) => game.players[q].lore,
  characters: (game, q) => game.players[q].characters.length,
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
  // Cards played, those passing filters only ("if you've played a character with cost 5 or more this turn")
  'played-cards': (game, q, c, ctx) => game.players[q].turnStats.played.filter((x) => (c.filters ?? []).every((f) => passes(game, ctx, x, f))).length,
  'cards-drawn-by-player': (game, q) => game.players[q].turnStats.drawn,
  'damage-removed-by-player': (game, q) => game.players[q].turnStats.damageRemoved,
  'played-actions': (game, q) => game.players[q].turnStats.actions,
  'challenges-by-player': (game, q) => game.players[q].turnStats.challenges,
  'quested-characters': (game, q) => game.players[q].turnStats.quested,
  'discard-cards-entered': (game, q) => game.players[q].turnStats.discarded,
  // A player's characters damaged this turn
  'damaged-characters-by-owner': (game, q) => game.players[q].turnStats.damaged,
  'cards-inked': (game, q) => game.players[q].turnStats.inked,
  'banished-in-challenge-count': (game, q) => game.players[q].turnStats.banishedInChallenge,
  'ink-drops-gained': (game, q) => game.players[q].turnStats.dropsGained,
  'cards-discarded-from-hand': (game, q) => game.players[q].turnStats.discardedFromHand,
  // Cards that left a player's discard, of both players
  'discard-cards-left': (game) => game.players.reduce((s, pl) => s + pl.turnStats.leftDiscard, 0),
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
  'item-count': (game, q) => game.players[q].items.length,
  lore: (game, q) => game.players[q].lore,
};

const countOf = (comparison, value, n) => (typeof comparison === 'string' ? compare(n, comparison, value) : compare(n, comparison.operator, comparison.value));

// A query of cards: in play, in a discard, under the cards in play, or the cards a step named
const okQuery = (q) =>
  !!q &&
  (q.reference == null || REFS.has(q.reference)) &&
  (q.zones ?? ['play']).every((z) => ['play', 'discard', 'limbo', 'hand'].includes(z)) &&
  filtersOf(q).every(okFilter) &&
  Object.keys(q).every((k) => ['selector', 'owner', 'zones', 'cardType', 'cardTypes', 'excludeSelf', 'filter', 'filters', 'count', 'reference'].includes(k));

const queryCards = (game, ctx, q) => {
  const types = q.cardTypes ?? (q.cardType ? [q.cardType] : null);
  let cards;
  if (q.reference) cards = refTargets(ctx, q.reference);
  else {
    const players = q.owner === 'any' ? [0, 1] : [q.owner === 'opponent' ? 1 - ctx.p : ctx.p];
    cards = players.flatMap((x) => (q.zones ?? ['play']).flatMap((zone) => zoneCards(game, x, zone)));
  }
  return cards.filter((i) => (!types || types.some((t) => isType(i.card, t))) && !(q.excludeSelf && i === ctx.source) && filtersOf(q).every((f) => passes(game, ctx, i, f)));
};

const queryCount = (game, ctx, q) => queryCards(game, ctx, q).length;

const CONDITIONS = {
  'if-you-do': { check: () => true, test: (game, ctx) => !!ctx.did },
  // "If you have a character in play with more {S} than each opposing character": the most (or least) of a stat on each side
  'target-aggregate-comparison': {
    check: (c) =>
      [c.left, c.right].every((x) => okQuery(x?.query) && ['strength', 'willpower', 'lore', 'cost'].includes(x.attribute) && ['max', 'min'].includes(x.aggregate)) &&
      okComparison(c.comparison) &&
      [undefined, 'pass', 'fail'].includes(c.ifRightEmpty),
    test: (game, ctx, c) => {
      const side = (x) => queryCards(game, ctx, x.query).map((i) => (x.attribute === 'cost' ? i.card.cost : currentStat(game, i, x.attribute)));
      const left = side(c.left);
      const right = side(c.right);
      if (!left.length) return !c.requireLeftNonEmpty && c.ifRightEmpty === 'pass' && !right.length;
      if (!right.length) return c.ifRightEmpty !== 'fail';
      const agg = (list, x) => (x.aggregate === 'max' ? Math.max(...list) : Math.min(...list));
      return compare(agg(left, c.left), c.comparison, agg(right, c.right));
    },
  },
  // "If the challenging character has 6 {S} or more"
  'trigger-subject-strength-gte': {
    check: (c) => typeof c.value === 'number',
    test: (game, ctx, c) => !!ctx.trigger?.subject?.card && currentStat(game, ctx.trigger.subject, 'strength') >= c.value,
  },
  // During the challenge the card is in, attacking or defending
  'in-this-challenge': { check: () => true, test: (game, ctx) => game.challenging?.attacker === ctx.source || game.challenging?.defender === ctx.source },
  // How many cards match: in play, in a discard or under the cards in play, or among the cards an
  // earlier step named. No comparison: one or more.
  'target-query': {
    check: (c) => (c.comparison == null || okComparison(c.comparison)) && okQuery(c.query ?? {}),
    test: (game, ctx, c) => {
      const n = queryCount(game, ctx, c.query);
      return c.comparison == null ? n > 0 : countOf(c.comparison, c.value, n);
    },
  },
  // A song sung with Sing Together ("whenever this character sings a song with Sing Together")
  'played-card-has-keyword': {
    check: (c) => c.keyword === 'SingTogether' || KEYWORDS.includes(c.keyword),
    test: (game, ctx, c) => {
      const card = ctx.trigger?.song?.card ?? ctx.trigger?.subject?.card;
      return !!card && (c.keyword === 'SingTogether' ? card.singTogether > 0 : (card.keywords[c.keyword] ?? 0) > 0);
    },
  },
  // How a song was played: "if 2 or more characters sang this song"
  // How a card was played: "if 2 or more characters sang this song", "if you removed an ink drop to play her"
  'play-context': {
    check: (c) => (c.context === 'characters-sang-this-song' && okComparison(c.comparison)) || c.context === 'paid-with-ink-drop' || c.context === 'used-shift',
    test: (game, ctx, c) => {
      if (c.context === 'paid-with-ink-drop') return !!ctx.source.paidWithDrop;
      // "If you used Shift to play them": the card that was played
      if (c.context === 'used-shift') return !!(ctx.trigger?.shifted ?? ctx.source.shifted);
      return countOf(c.comparison, c.value, ctx.singers?.length ?? 0);
    },
  },
  // The card an earlier step returned to the hand
  'returned-card-is-named': { check: (c) => typeof c.name === 'string', test: (game, ctx, c) => (ctx.returned ?? []).some((card) => card.title === c.name) },
  'returned-card-has-classification': {
    check: (c) => typeof c.classification === 'string',
    test: (game, ctx, c) => (ctx.returned ?? []).some((card) => card.classifications.includes(c.classification)),
  },
  // The card an earlier step chose ("if a character named Darkwing Duck is chosen", "if that character has damage")
  'selected-target-name': { check: (c) => typeof c.name === 'string', test: (game, ctx, c) => ctx.targets?.[0]?.card.title === c.name },
  'selected-target-has-damage': { check: () => true, test: (game, ctx) => (ctx.targets?.[0]?.damage ?? 0) > 0 },
  // The event's card ("if the moved character is a Knight")
  'trigger-subject-classification': {
    check: (c) => typeof c.classification === 'string',
    test: (game, ctx, c) => !!ctx.trigger?.subject?.card && hasClass(game, ctx.trigger.subject, c.classification),
  },
  condition: { check: (c) => okCondition(c.condition), test: (game, ctx, c) => holds(game, ctx, c.condition) },
  'resource-count': {
    check: (c) => !!RESOURCES[c.what] && okComparison(c.comparison) && (typeof c.comparison !== 'string' || typeof c.value === 'number'),
    test: (game, ctx, c) => countOf(c.comparison, c.value, RESOURCES[c.what](game, playerOf(ctx, c.controller))),
  },
  'turn-metric': {
    check: (c) =>
      !!METRICS[c.metric] &&
      okComparison(c.comparison) &&
      (c.filters ?? []).every(okFilter) &&
      Object.keys(c).every((k) => ['type', 'metric', 'comparison', 'value', 'ownerScope', 'playerScope', 'classification', 'excludeSource', 'name', 'filters'].includes(k)),
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
  // "While you have another (Pirate) character in play", "another character named Pete"
  'has-another-character': {
    check: (c) => Object.keys(c).every((k) => ['type', 'name', 'classification', 'controller'].includes(k)),
    test: (game, ctx, c) =>
      charactersOf(game, ctx, c.controller ?? 'you').some(
        (i) => i !== ctx.source && (!c.name || i.card.title === c.name) && (!c.classification || hasClass(game, i, c.classification))
      ),
  },
  'inkwell-count': {
    check: (c) => okComparison(c.comparison) && typeof c.count === 'number',
    test: (game, ctx, c) => compare(game.players[playerOf(ctx, c.controller)].inkwell, c.comparison, c.count),
  },
  'has-location-count': {
    check: (c) => okComparison(c.comparison) && typeof c.count === 'number',
    test: (game, ctx, c) => compare(game.players[playerOf(ctx, c.controller)].locations.length, c.comparison, c.count),
  },
  'has-any-damage': { check: () => true, test: (game, ctx) => ctx.source.damage > 0 },
  // "If the chosen character is named Pain", "if the banished item is named Maurice's Machine"
  'is-named': {
    check: (c) => typeof c.name === 'string' && [undefined, 'previous-target'].includes(c.target),
    test: (game, ctx, c) => (c.target ? ctx.targets?.[0]?.card.title : ctx.source.card.title) === c.name,
  },
  // A card returned or moved by an earlier step is a Princess ("if any Princess cards were moved this way")
  'returned-card-is-princess': {
    check: () => true,
    test: (game, ctx) => (ctx.returned ?? (ctx.targets ?? []).map((t) => t.card)).some((card) => card.classifications.includes('Princess')),
  },
  // The cards an earlier step discarded ("if a Pirate character card was discarded", "if you discarded a location card")
  'discarded-card-has-classification': {
    check: (c) => typeof c.classification === 'string',
    test: (game, ctx, c) =>
      (ctx.discarded ?? []).some(({ q, idx }) => {
        const card = cardOf(game, q, idx);
        return card.classifications.includes(c.classification) && (!c.cardType || isType(card, c.cardType));
      }),
  },
  'discarded-card-is-card-type': {
    check: (c) => typeof c.cardType === 'string',
    test: (game, ctx, c) => (ctx.discarded ?? []).some(({ q, idx }) => isType(cardOf(game, q, idx), c.cardType)),
  },
  // "While you have a character in play with the highest cost, or tied for highest cost"
  'has-character-with-highest-cost': {
    check: () => true,
    test: (game, ctx) => {
      const top = (q) => Math.max(-1, ...game.players[q].characters.map((c) => c.card.cost));
      return game.players[ctx.p].characters.length > 0 && top(ctx.p) >= top(1 - ctx.p);
    },
  },
  // "Choose another character and reveal a character card in your hand. If they have the same name": a pair the player can show
  'revealed-matches-chosen-name': {
    check: () => true,
    test: (game, ctx) => {
      const names = new Set(charactersOf(game, ctx, 'any').filter((c) => c !== ctx.source).map((c) => c.card.title));
      return game.players[ctx.p].hand.some((idx) => cardOf(game, ctx.p, idx).kind === 'character' && names.has(cardOf(game, ctx.p, idx).title));
    },
  },
  // The players against you: one, in a game of two
  'opponent-count': { check: (c) => okComparison(c.comparison) && typeof c.value === 'number', test: (game, ctx, c) => compare(1, c.comparison, c.value) },
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
  // While its challenge damage is worked out; "while challenging a damaged character", "a location"
  'in-challenge': {
    check: (c) => ['attacker', 'defender'].includes(c.role) && (c.againstCardType == null || CARD_TYPES.includes(c.againstCardType)),
    test: (game, ctx, c) =>
      game.challenging?.[c.role === 'attacker' ? 'attacker' : 'defender'] === ctx.source &&
      (!c.againstDamaged || game.challenging.defender.damage > 0) &&
      (!c.againstCardType || game.challenging.defender.card.kind === c.againstCardType),
  },
  // "If the item you played has a different name than each other item you have in play"
  'played-card-name': {
    check: (c) => (c.requireAbsent === true && c.zone === 'play') || (c.zone === 'discard' && !c.requireAbsent),
    test: (game, ctx, c) => {
      const played = ctx.trigger?.subject;
      if (!played) return false;
      // The song played is in the discard itself: another card of that name
      if (c.zone === 'discard') return game.players[ctx.p].discard.filter((idx) => cardOf(game, ctx.p, idx).title === played.card.title).length > (played.zone === 'discard' ? 1 : 0);
      return !inPlay(game, ctx.p).some((x) => x !== played && (!c.cardTypes || c.cardTypes.includes(x.card.kind)) && x.card.title === played.card.title);
    },
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
    check: (c) => okComparison(c.comparison) && [c.left, c.right].every((x) => !!QUANTITIES[x?.type] || (x?.type === 'constant' && typeof x.value === 'number')),
    test: (game, ctx, c) => {
      const side = (x) => (x.type === 'constant' ? x.value : QUANTITIES[x.type](game, playerOf(ctx, x.controller)));
      return compare(side(c.left), c.comparison, side(c.right));
    },
  },
  and: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okCondition), test: (game, ctx, c) => c.conditions.every((x) => holds(game, ctx, x)) },
  or: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okCondition), test: (game, ctx, c) => c.conditions.some((x) => holds(game, ctx, x)) },
  not: { check: (c) => okCondition(c.condition), test: (game, ctx, c) => !holds(game, ctx, c.condition) },
};

export const okCondition = (c) => !!c && !!CONDITIONS[c.type]?.check(c);

const holds = (game, ctx, c) => CONDITIONS[c.type].test(game, ctx, c);

// ---------- Effects ----------

const label = (ctx) => (ctx.ability?.name ? `${ctx.source.card.name} · ${ctx.ability.name}` : ctx.source.card.name);
// cards: the cards in play it acts on, besides its source
const tell = (game, ctx, text, cards = []) => say(game, ctx.p, `${label(ctx)} : ${text}`, 'effect', [ctx.source, ...cards]);
const names = (cards) => cards.map((c) => c.card.name).join(', ');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const STAT_NAMES = { strength: 'force', willpower: 'volonté', lore: 'lore', 'singer-threshold': 'pour chanter' };

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
  // "Can't ready more than 1 of their characters at the start of their next turn"
  'ready-only-one-character',
  // "Each opposing player can't gain lore", "skip your turn's Draw step"
  'cant-gain-lore',
  'skip-draw-step',
]);
const PLAYER_RESTRICTIONS = new Set(['cant-play-actions', 'cant-play-items', 'challenge-limit', 'ready-only-one-character', 'cant-gain-lore', 'skip-draw-step']);

// All the cards of your inkwell (or of each player's): readying or exerting them is the ink for the turn
const isAllInk = (t) => t?.selector === 'all' && (t.owner === 'you' || t.owner === 'any') && t.zones?.length === 1 && t.zones[0] === 'inkwell';

// Abilities an effect can grant that the engine plays, some written as a whole ability
const GRANTS = new Set([
  'can-challenge-ready',
  'takes-no-damage-from-challenges',
  'takes-no-damage-while-challenging',
  'gain-lore-when-challenging',
  'return-to-hand-when-banished',
  'banish-damaged-when-exerted',
]);
const GRANTED_ABILITIES = {
  // "When this character is banished in a challenge, return this card to your hand"
  'return-to-hand-when-banished': {
    type: 'triggered',
    name: 'RETURN TO HAND',
    trigger: { event: 'banish', on: 'SELF', restrictions: [{ type: 'in-challenge' }] },
    effect: { type: 'return-to-hand', target: 'SELF' },
  },
  // "{E} — Banish chosen damaged character"
  'banish-damaged-when-exerted': { type: 'activated', name: 'BANISH DAMAGED', cost: { exert: true }, effect: { type: 'banish', target: 'CHOSEN_DAMAGED_CHARACTER' } },
  // "The next time they challenge a character this turn, gain 1 lore"
  'gain-lore-when-challenging': {
    type: 'triggered',
    trigger: { event: 'challenge', on: 'SELF', restrictions: [{ type: 'defender-is-character' }] },
    effect: { type: 'gain-lore', amount: 1, target: 'CONTROLLER' },
    once: true,
  },
};

const okGrant = (ability) => {
  if (typeof ability === 'string') return GRANTS.has(ability);
  // { type: 'takes-no-damage-while-challenging', text }
  if (GRANTS.has(ability?.type) && !GRANTED_ABILITIES[ability.type] && ability.type !== 'can-challenge-ready') return Object.keys(ability).every((k) => ['type', 'text'].includes(k));
  if (ability?.type === 'can-challenge-ready') return Object.keys(ability).every((k) => ['type', 'classification'].includes(k));
  return (ability?.type === 'triggered' || ability?.type === 'activated') && isSupported(ability);
};

// Card types a revealed card may be ("if it's an action or item card")
const okTypes = (t) => (Array.isArray(t) ? t.every((x) => typeof x === 'string') : typeof t === 'string');
const isAnyType = (card, t) => [].concat(t).some((x) => isType(card, x));

// What a revealed card is checked for; ctx.named: the card a player named
const REVEALED = {
  'revealed-has-classification': { check: (c) => typeof c.classification === 'string', test: (card, c) => card.classifications.includes(c.classification) },
  'revealed-is-card-type': { check: (c) => okTypes(c.cardType ?? c.value), test: (card, c) => isAnyType(card, c.cardType ?? c.value) },
  'revealed-is-character-named': { check: (c) => typeof c.name === 'string', test: (card, c) => card.kind === 'character' && card.title === c.name },
  'revealed-matches-named': { check: () => true, test: (card, c, ctx) => card.title === ctx.named },
  'revealed-matches-chosen-name': { check: () => true, test: (card, c, ctx) => card.title === ctx.targets?.[0]?.card.title },
  and: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okRevealed), test: (card, c, ctx) => c.conditions.every((x) => REVEALED[x.type].test(card, x, ctx)) },
  or: { check: (c) => Array.isArray(c.conditions) && c.conditions.every(okRevealed), test: (card, c, ctx) => c.conditions.some((x) => REVEALED[x.type].test(card, x, ctx)) },
  not: { check: (c) => okRevealed(c.condition), test: (card, c, ctx) => !REVEALED[c.condition.type].test(card, c.condition, ctx) },
};
const okRevealed = (c) => !!REVEALED[c?.type]?.check(c);
const ROUTE_ZONES = new Set(['hand', 'deck-top', 'deck-bottom', 'discard', 'inkwell', 'play']);

/** A card off the top of the deck to a zone; 'play': played for free. */
const routeCard = (game, p, idx, zone) => {
  const me = game.players[p];
  if (zone === 'hand') {
    me.hand.push(idx);
    if (me.seen) me.seen[idx] = 1;
  } else if (zone === 'deck-top') me.library.unshift(idx);
  else if (zone === 'deck-bottom') me.library.push(idx);
  else if (zone === 'discard') me.discard.push(idx);
  else if (zone === 'play') enterPlay(game, p, idx);
  else addToInkwell(game, p, idx);
};

// "Put it on either the top or the bottom of your deck"
const isTopOrBottom = (f) =>
  Array.isArray(f?.destinations) &&
  Object.keys(f).length === 1 &&
  f.destinations.length === 2 &&
  f.destinations.every((d) => (d.zone === 'deck-top' || d.zone === 'deck-bottom') && Object.keys(d).every((k) => ['zone', 'max', 'remainder'].includes(k)));

// What a count step counts, among the cards earlier steps discarded or revealed
const COUNTED = {
  'discarded-action-cards': (game, ctx) => (ctx.discarded ?? []).filter(({ q, idx }) => cardOf(game, q, idx).kind === 'action').length,
  'discarded-item-cards': (game, ctx) => (ctx.discarded ?? []).filter(({ q, idx }) => cardOf(game, q, idx).kind === 'item').length,
  'distinct-revealed-ink-types': (game, ctx) => new Set((ctx.revealed ?? []).flatMap(({ q, idx }) => cardOf(game, q, idx).inks)).size,
  'distinct-character-ink-types': (game, ctx, e) => new Set(game.players[e.controller === 'opponent' ? 1 - ctx.p : ctx.p].characters.flatMap((c) => c.card.inks)).size,
};

// A card worth keeping on top of the deck: better than the deck's average card
const keepOnTop = (game, p, idx) => {
  const lib = game.players[p].library;
  const avg = lib.reduce((s, x) => s + cardWorth(cardOf(game, p, x)), 0) / Math.max(1, lib.length);
  return cardWorth(cardOf(game, p, idx)) >= avg;
};

/** Plays a card a deck's zone holds ("play a character from your discard"); free, or paid like from the hand. Returns whether it was played. */
const playFrom = (game, ctx, q, zone, pos, { free = true, base = null, exerted = false, afterPlay = null } = {}) => {
  const me = game.players[q];
  const card = cardOf(game, q, zone[pos]);
  const cost = free ? 0 : costOf(game, q, card, { shift: !!base, base });
  if (cost > me.ink || (card.kind === 'action' && !card.abilities?.action)) return null;
  payInk(game, q, cost);
  const idx = zone === me.discard ? takeFromDiscard(game, q, pos, 'play') : zone === me.inkCards ? takeFromInkwell(game, q, pos) : zone.splice(pos, 1)[0];
  tell(game, ctx, `joue ${card.name}${free ? ' gratuitement' : ''}`);
  return enterPlay(game, q, idx, { base, exerted, afterPlay, cost: free ? null : cost });
};

// Characters a Shift card can go onto, the ready ones first
const shiftBases = (game, p, card) =>
  card.shift ? game.players[p].characters.filter((c) => card.shift.bases.includes(c.card.key)).sort((a, b) => a.exerted - b.exerted) : NONE;

/** The zones a card may be played from, named by an effect: the hand, the discard, the revealed top card of the deck. */
const zonesNamed = (game, ctx, from) =>
  [].concat(from).map((name) => {
    const me = game.players[ctx.p];
    if (name === 'discard') return { zone: me.discard, positions: me.discard.map((_, i) => i) };
    if (name === 'revealed') return { zone: me.library, positions: ctx.revealed?.some((r) => r.q === ctx.p && r.idx === me.library[0]) ? [0] : [] };
    if (name === 'inkwell') return { zone: me.inkCards, positions: me.inkCards.map((_, i) => i) };
    return { zone: me.hand, positions: me.hand.map((_, i) => i) };
  });
const PLAY_ZONES = new Set(['hand', 'discard', 'revealed', 'inkwell']);

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

// Where the cards under a card may go, and how the log says it
const UNDER_DESTINATIONS = new Map([
  ['hand', 'en main'],
  ['deck-bottom', 'sous la pioche'],
  ['deck-bottom-random', 'sous la pioche'],
  ['inkwell-facedown-exerted', "dans l'encrier"],
  ['under-chosen', 'sous une autre carte'],
]);

// Another amount when a condition holds ("if 2 or more cards were put into your discard this turn, deal 2 damage instead")
const okReplacing = (r) => r == null || (okCondition(r.condition) && typeof r.value === 'number' && Object.keys(r).every((k) => ['condition', 'value'].includes(k)));
const replaced = (game, ctx, e, n) => (e.selfReplacement && holds(game, ctx, e.selfReplacement.condition) ? e.selfReplacement.value : n);

/** Takes a card out of a hand, a discard or from under a card, for an effect moving it elsewhere: its index. */
const takeCardFrom = (game, inst) => {
  if (inst.zone === 'hand') {
    const pos = game.players[inst.owner].hand.indexOf(inst.idx);
    return pos < 0 ? null : game.players[inst.owner].hand.splice(pos, 1)[0];
  }
  if (inst.zone === 'limbo') {
    const pos = inst.parent.under.indexOf(inst.idx);
    return pos < 0 ? null : inst.parent.under.splice(pos, 1)[0];
  }
  if (inst.zone === 'inkwell') return takeFromInkwell(game, inst.owner, game.players[inst.owner].inkCards.indexOf(inst.idx));
  const pos = game.players[inst.owner].discard.lastIndexOf(inst.idx);
  return pos < 0 ? null : takeFromDiscard(game, inst.owner, pos);
};

// Who decides a "may" or a choice: the controller, the opponent ("chosen opponent chooses one")
const okChooser = (c) => [undefined, 'CONTROLLER', 'OPPONENT', 'EACH_OPPONENT'].includes(c) || isOtherPlayer(c);
const chooserOf = (ctx, c) => (c === 'OPPONENT' || c === 'EACH_OPPONENT' || isOtherPlayer(c) ? 1 - ctx.p : ctx.p);

/**
 * Runs a list of steps in order: "if you do" and "that character" read the step before. ctx.rest:
 * the steps still to come, for a player choosing a card the next steps act on.
 */
const runSteps = (game, ctx, steps) => {
  const outer = ctx.rest ?? NONE;
  for (let i = 0; i < steps.length; i++) {
    if (game.over) break;
    ctx.rest = [...steps.slice(i + 1), ...outer];
    runEffect(game, ctx, steps[i]);
  }
  ctx.rest = outer;
};

const EFFECTS = {
  sequence: {
    keys: ['steps', 'effects'],
    check: (e) => Array.isArray(e.steps ?? e.effects) && (e.steps ?? e.effects).every(okEffect),
    run: (game, ctx, e) => runSteps(game, ctx, e.steps ?? e.effects),
  },
  optional: {
    keys: ['effect', 'chooser'],
    check: (e) => okChooser(e.chooser) && okEffect(e.effect),
    run: (game, ctx, e) => {
      if (acceptOptional(game, chooserOf(ctx, e.chooser), ctx, e.effect)) runEffect(game, ctx, e.effect);
      else ctx.did = false;
    },
  },
  conditional: {
    keys: ['condition', 'then', 'effect', 'ifTrue', 'else', 'ifFalse'],
    check: (e) =>
      okCondition(e.condition) &&
      [e.then ?? e.effect ?? e.ifTrue, e.else ?? e.ifFalse].some((x) => x != null) &&
      [e.then ?? e.effect ?? e.ifTrue, e.else ?? e.ifFalse].every((x) => x == null || okEffect(x)),
    run: (game, ctx, e) => {
      const then = e.then ?? e.effect ?? e.ifTrue;
      // "For each opponent who doesn't, ...": only an else
      if (holds(game, ctx, e.condition)) {
        if (then) runEffect(game, ctx, then);
      }
      else if (e.else ?? e.ifFalse) runEffect(game, ctx, e.else ?? e.ifFalse);
      else ctx.did = false;
    },
  },
  choice: {
    keys: ['options', 'optionLabels', 'chooser'],
    check: (e) => okChooser(e.chooser) && Array.isArray(e.options) && e.options.every(okEffect),
    run: (game, ctx, e) => runEffect(game, ctx, e.options[chooseOption(game, chooserOf(ctx, e.chooser), ctx, e.options)]),
  },
  // A cost in ink, or "put the top 3 cards of your deck into your discard to..."
  'pay-cost': {
    keys: ['cost', 'effect'],
    check: (e) =>
      Object.keys(e.cost ?? {}).length > 0 &&
      Object.keys(e.cost).every((k) => (k === 'ink' || k === 'millTopDeck') && typeof e.cost[k] === 'number') &&
      okEffect(e.effect),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const { ink = 0, millTopDeck = 0 } = e.cost;
      if (me.ink < ink || me.library.length < millTopDeck) return void (ctx.did = false);
      payInk(game, ctx.p, ink);
      if (millTopDeck) runEffect(game, ctx, { type: 'mill', amount: millTopDeck, target: 'CONTROLLER' });
      runEffect(game, ctx, e.effect);
    },
  },
  // condition: for each opponent it holds for ("each opponent with more lore than you")
  'for-each-opponent': {
    keys: ['effect', 'condition'],
    check: (e) => okEffect(e.effect) && (e.condition == null || okCondition(e.condition)),
    run: (game, ctx, e) => {
      if (!e.condition || holds(game, ctx, e.condition)) runEffect(game, ctx, e.effect);
      else ctx.did = false;
    },
  },
  // target: the card the counter reads, chosen first ("equal to the damage on chosen character of yours"); maximum: at most
  'for-each': {
    keys: ['counter', 'effect', 'target', 'maximum'],
    check: (e) => okCounter(e.counter) && okEffect(e.effect) && (e.target == null || okCards(e.target)) && (e.maximum == null || typeof e.maximum === 'number'),
    run: (game, ctx, e) => {
      if (e.target) targetsOf(game, ctx, e);
      const n = Math.min(e.maximum ?? Infinity, COUNTERS[e.counter.type](ctx, game, e.counter));
      for (let i = 0; i < n && !game.over; i++) runEffect(game, ctx, e.effect);
    },
  },
  draw: {
    keys: ['amount', 'target', 'source'],
    check: (e) => okAmount(e.amount ?? 1) && okPlayers(e.target) && (e.source == null || e.source === 'deck-bottom'),
    run: (game, ctx, e) => {
      for (const q of playersOf(game, ctx, e.target, e)) {
        const n = drawCards(game, q, amountOf(game, ctx, e.amount ?? 1), { bottom: e.source === 'deck-bottom' });
        if (n) say(game, q, `${label(ctx)} : pioche ${plural(n, 'carte')}`, 'effect', [ctx.source]);
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
        if (n) say(game, q, `${label(ctx)} : pioche ${plural(n, 'carte')}`, 'effect', [ctx.source]);
      }
    },
  },
  'gain-lore': {
    keys: ['amount', 'target', 'selfReplacement'],
    check: (e) => okAmount(e.amount) && okPlayers(e.target) && okReplacing(e.selfReplacement),
    run: (game, ctx, e) => {
      const n = replaced(game, ctx, e, amountOf(game, ctx, e.amount));
      for (const q of playersOf(game, ctx, e.target, e)) {
        say(game, q, `${label(ctx)} : gagne ${n} lore (→ ${game.players[q].lore + n})`, 'effect', [ctx.source]);
        gainLore(game, q, n);
      }
      ctx.did = n > 0;
    },
  },
  // "Get 1 ink drop" (each ink drop may be removed to pay 1 {I})
  'gain-ink-drop': {
    keys: ['amount', 'target'],
    check: (e) => okAmount(e.amount) && okPlayers(e.target),
    run: (game, ctx, e) => {
      const n = amountOf(game, ctx, e.amount);
      for (const q of playersOf(game, ctx, e.target, e)) {
        gainInkDrops(game, q, n);
        say(game, q, `${label(ctx)} : ${plural(n, 'goutte')} d'encre`, 'effect', [ctx.source]);
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
        const lost = loseLore(game, q, n);
        if (lost) say(game, q, `${label(ctx)} : perd ${lost} lore`, 'effect', [ctx.source]);
        ctx.loreLost += lost;
      }
      ctx.did = ctx.loreLost > 0;
    },
  },
  banish: {
    keys: ['target', 'chosenBy'],
    check: (e) => okCards(e.target) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      if (cards.length) tell(game, ctx, `bannit ${names(cards)}`, cards);
      for (const c of cards) banish(game, c);
      ctx.did = cards.length > 0;
    },
  },
  'deal-damage': {
    keys: ['amount', 'target', 'chosenBy', 'ignoreResist', 'selfReplacement'],
    check: (e) => okAmount(e.amount) && okCards(e.target) && [undefined, 'opponent'].includes(e.chosenBy) && okReplacing(e.selfReplacement),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e);
      const n = replaced(game, ctx, e, amountOf(game, ctx, e.amount));
      if (cards.length) tell(game, ctx, `inflige ${plural(n, 'dégât')} à ${names(cards)}`, cards);
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
      if (cards.length) tell(game, ctx, `place ${plural(n, 'dégât')} sur ${names(cards)}`, cards);
      for (const c of cards) damageCard(game, c, n, { put: true });
      ctx.did = cards.length > 0;
    },
  },
  // distribution 'aggregate': the amount in all, shared among the chosen characters
  // thenReady: "ready each character you removed damage from" (a chosen one: ready anyway)
  'remove-damage': {
    keys: ['amount', 'target', 'distribution', 'selfReplacement', 'thenReady'],
    check: (e) => (okAmount(e.amount) || e.amount === 'all') && okCards(e.target) && [undefined, 'aggregate'].includes(e.distribution) && okReplacing(e.selfReplacement),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e);
      // "Damage counters can't be removed"
      if (replacementFor(game, 'remove-damage', null)) return void (ctx.did = false);
      let n = e.amount === 'all' ? Infinity : replaced(game, ctx, e, amountOf(game, ctx, e.amount));
      let removed = 0;
      const healed = [];
      for (const c of cards) {
        const r = Math.min(n, c.damage);
        if (!r) continue;
        healed.push(c);
        if (e.distribution === 'aggregate') n -= r;
        c.damage -= r;
        removed += r;
        game.players[ctx.p].turnStats.damageRemoved += r;
        ctx.removed = (ctx.removed ?? 0) + r;
        tell(game, ctx, `retire ${plural(r, 'dégât')} à ${c.card.name}`, [c]);
        emit(game, 'remove-damage', { p: c.owner, subject: c, amount: r, by: ctx.p });
      }
      if (e.thenReady) {
        ctx.targets = normalizeTarget(e.target).spec?.selector === 'chosen' ? cards : healed;
        runEffect(game, ctx, { type: 'ready', target: { ref: 'selected-all' } });
      }
      ctx.did = removed > 0;
    },
  },
  // from: one card, or every card a spec reaches ("move all damage counters from all other characters to that character");
  // no amount: all of it; deferLethalBanish: the damage it gets is checked once the whole ability is done
  'move-damage': {
    keys: ['amount', 'from', 'to', 'deferLethalBanish', 'distribution'],
    check: (e) => (e.amount == null || okAmount(e.amount) || e.amount === 'all') && okCards(e.from) && okCards(e.to),
    run: (game, ctx, e) => {
      const many = normalizeTarget(e.from).spec?.selector === 'all';
      const take = (to) => targetsOf(game, ctx, { ...e, type: 'remove-damage' }, e.from).filter((c) => c !== to && c.damage > 0);
      let from;
      let to;
      if (many) {
        [to] = targetsOf(game, ctx, { ...e, type: 'put-damage' }, e.to);
        from = to ? take(to) : [];
      } else {
        from = take(null).slice(0, 1);
        [to] = from.length ? targetsOf(game, ctx, { ...e, type: 'put-damage' }, e.to).filter((c) => c !== from[0]) : [];
      }
      if (!to || !from.length) return void (ctx.did = false);
      let moved = 0;
      for (const c of from) {
        const n = (e.amount ?? 'all') === 'all' ? c.damage : Math.min(amountOf(game, ctx, e.amount), c.damage);
        c.damage -= n;
        moved += n;
      }
      if (!moved) return void (ctx.did = false);
      // "Draw a card for each damage counter moved this way"
      ctx.removed = (ctx.removed ?? 0) + moved;
      tell(game, ctx, `déplace ${plural(moved, 'dégât')} de ${names(from)} vers ${to.card.name}`, [...from, to]);
      if (e.deferLethalBanish) {
        to.damage += moved;
        (ctx.deferred ??= []).push(to);
      } else damageCard(game, to, moved, { put: true });
      ctx.targets = [to];
      ctx.did = true;
    },
  },
  'return-to-hand': {
    keys: ['target', 'chosenBy'],
    check: (e) => okCards(e.target, { inDiscard: true, inInkwell: true }) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => returnToHand(game, c));
      if (cards.length) tell(game, ctx, `renvoie ${names(cards)} dans la main`, cards);
      ctx.returned = cards.map((c) => c.card);
      ctx.did = cards.length > 0;
    },
  },
  // Cards in play, in a discard, or of the hand ("put any number of cards from your hand on the bottom of your deck")
  'put-on-bottom': {
    keys: ['target', 'chosenBy', 'ordering', 'orderBy'],
    check: (e) => okCards(e.target, { inDiscard: true, inHand: true }) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => {
        if (c.zone === 'play' || c.zone === 'discard') return putIntoDeck(game, c, 'bottom');
        const idx = takeCardFrom(game, c);
        if (idx != null) game.players[c.owner].library.push(idx);
        return idx != null;
      });
      if (cards.length) tell(game, ctx, cards[0].zone === 'hand' ? `met ${plural(cards.length, 'carte')} de sa main sous la pioche` : `met ${names(cards)} sous la pioche`, cards);
      ctx.did = cards.length > 0;
    },
  },
  // The cards: target, or source ("put an item card from your discard on the top of your deck", "2 cards from your hand")
  'put-on-top': {
    keys: ['target', 'chosenBy', 'source'],
    check: (e) => okCards(e.target ?? e.source, { inDiscard: true, inHand: true }) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e, e.target ?? e.source).filter((c) => {
        if (c.zone === 'play' || c.zone === 'discard') return putIntoDeck(game, c, 'top');
        const idx = takeCardFrom(game, c);
        if (idx != null) game.players[c.owner].library.unshift(idx);
        return idx != null;
      });
      if (cards.length) tell(game, ctx, `met ${names(cards)} sur la pioche`, cards);
      ctx.did = cards.length > 0;
    },
  },
  // Cards shuffled into their deck, or a player's deck shuffled ("each player shuffles their deck")
  'shuffle-into-deck': {
    keys: ['target', 'intoDeck'],
    check: (e) => (okCards(e.target, { inDiscard: true }) || (typeof e.target === 'string' && PLAYER_TARGETS.has(e.target))) && (e.intoDeck == null || e.intoDeck === 'owner'),
    run: (game, ctx, e) => {
      if (typeof e.target === 'string' && PLAYER_TARGETS.has(e.target)) {
        for (const q of playersOf(game, ctx, e.target, e)) shuffleInPlace(game, game.players[q].library);
        return void (ctx.did = true);
      }
      const cards = targetsOf(game, ctx, e).filter((c) => putIntoDeck(game, c, 'shuffle'));
      if (cards.length) tell(game, ctx, `mélange ${names(cards)} dans la pioche`, cards);
      ctx.did = cards.length > 0;
    },
  },
  // restriction: what they can't do for the rest of this turn ("ready them. They can't quest")
  ready: {
    keys: ['target', 'restriction'],
    check: (e) => (okCards(e.target) || isAllInk(e.target)) && (e.restriction == null || RESTRICTIONS.has(e.restriction)),
    run: (game, ctx, e) => {
      if (isAllInk(e.target)) {
        game.players[ctx.p].ink = game.players[ctx.p].inkwell + game.players[ctx.p].drops;
        tell(game, ctx, "redresse toute l'encre");
        return void (ctx.did = true);
      }
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play' && c.exerted);
      for (const c of cards) c.exerted = false;
      if (cards.length) tell(game, ctx, `redresse ${names(cards)}`, cards);
      if (e.restriction) for (const c of ctx.targets.filter((x) => x.zone === 'play')) addMod(c, { kind: 'restriction', restriction: e.restriction, until: game.turn });
      for (const c of cards) emit(game, 'ready', { p: c.owner, subject: c });
      ctx.did = cards.length > 0;
    },
  },
  exert: {
    keys: ['target', 'chosenBy'],
    check: (e) => (okCards(e.target) || isAllInk(e.target)) && [undefined, 'opponent'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      if (isAllInk(e.target)) {
        for (const q of e.target.owner === 'any' ? [0, 1] : [ctx.p]) game.players[q].ink = game.players[q].drops;
        return void (ctx.did = true);
      }
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play' && !c.exerted);
      for (const c of cards) c.exerted = true;
      if (cards.length) tell(game, ctx, `épuise ${names(cards)}`, cards);
      for (const c of cards) emit(game, 'exert', { p: c.owner, subject: c });
      ctx.did = cards.length > 0;
    },
  },
  /**
   * A stat changes for a while. 'singer-threshold': the cost a character counts as to sing; condition:
   * only while it holds ("+3 {S} while challenging a location this turn"); an amount reading the chosen
   * character ("for each 1 damage on them") or replaced when it is chosen is worked out once it is.
   */
  'modify-stat': {
    keys: ['stat', 'modifier', 'target', 'duration', 'selfReplacement', 'condition', 'chosenBy'],
    check: (e) =>
      ['strength', 'willpower', 'lore', 'singer-threshold'].includes(e.stat) &&
      okModifier(e.modifier) &&
      okCards(e.target) &&
      (e.duration == null || DURATIONS.has(e.duration)) &&
      okReplacing(e.selfReplacement) &&
      (e.condition == null || okCondition(e.condition)) &&
      [undefined, 'you'].includes(e.chosenBy),
    run: (game, ctx, e) => {
      const late = e.selfReplacement || e.modifier?.type === 'damage-on-target';
      let amount = late ? 0 : amountOf(game, ctx, e.modifier);
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      if (late) amount = replaced(game, ctx, e, amountOf(game, ctx, e.modifier));
      for (const c of cards) addMod(c, { kind: 'stat', stat: e.stat, amount, until: untilOf(game, ctx, e.duration, c.owner), condition: e.condition });
      if (cards.length) tell(game, ctx, `${names(cards)} : ${signed(amount)} ${STAT_NAMES[e.stat]}`, cards);
      ctx.did = cards.length > 0;
    },
  },
  'gain-keyword': {
    keys: ['keyword', 'value', 'target', 'duration'],
    check: (e) => KEYWORDS.includes(e.keyword) && (e.value == null || okAmount(e.value)) && okCards(e.target) && (e.duration == null || DURATIONS.has(e.duration)),
    run: (game, ctx, e) => {
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      const value = e.value == null ? 1 : amountOf(game, ctx, e.value);
      const condition = e.duration === 'during-challenge' ? IN_THIS_CHALLENGE : undefined;
      for (const c of cards) addMod(c, { kind: 'keyword', keyword: e.keyword, value, until: untilOf(game, ctx, e.duration, c.owner), condition });
      if (cards.length) tell(game, ctx, `${names(cards)} gagne ${e.keyword}${e.value ? ` +${e.value}` : ''}`, cards);
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
      if (cards.length) tell(game, ctx, `${names(cards)} gagne ${e.keywords.map((k) => k.keyword).join(', ')}`, cards);
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
  // linkedToSource: for as long as the card of the ability stays in play ("while this item is in play");
  // condition: only while it holds for the card ("unless they're at a location"); defenderPlayers: against whom
  restriction: {
    keys: ['restriction', 'target', 'duration', 'linkedToSource', 'condition', 'defenderPlayers'],
    check: (e) =>
      RESTRICTIONS.has(e.restriction) &&
      (PLAYER_RESTRICTIONS.has(e.restriction) ? okPlayers(e.target) : okCards(e.target)) &&
      (e.duration == null || DURATIONS.has(e.duration)) &&
      (e.condition == null || okCondition(e.condition)),
    run: (game, ctx, e) => {
      if (PLAYER_RESTRICTIONS.has(e.restriction)) {
        for (const q of playersOf(game, ctx, e.target, e)) {
          game.players[q].effects.push({ kind: 'restriction', restriction: e.restriction, until: untilOf(game, ctx, e.duration, q) });
        }
        ctx.did = true;
        return;
      }
      const cards = targetsOf(game, ctx, e).filter((c) => c.zone === 'play');
      const linked = e.linkedToSource ? ctx.source : null;
      for (const c of cards) addMod(c, { kind: 'restriction', restriction: e.restriction, until: untilOf(game, ctx, e.duration, c.owner), linked, condition: e.condition });
      if (cards.length && RESTRICTION_TEXT[e.restriction]) tell(game, ctx, `${names(cards)} ${RESTRICTION_TEXT[e.restriction]}`, cards);
      ctx.did = cards.length > 0;
    },
  },
  // playMethod 'shift': the next character shifted; amount counted when it resolves ("for each 1 damage removed this way")
  // cardNameFrom 'chosen-card': the name a cost revealed ("the next card you play with that name")
  'cost-reduction': {
    keys: ['amount', 'cardType', 'classification', 'cardName', 'duration', 'target', 'playMethod', 'cardNameFrom'],
    check: (e) =>
      okAmount(e.amount) &&
      (e.target == null || e.target === 'CONTROLLER') &&
      (e.duration == null || e.duration === 'next-play-this-turn' || e.duration === 'this-turn') &&
      (e.playMethod == null || e.playMethod === 'standard' || e.playMethod === 'shift') &&
      (e.cardType == null || [].concat(e.cardType).every((t) => ['character', 'action', 'item', 'location', 'song'].includes(t))),
    run: (game, ctx, e) => {
      const amount = amountOf(game, ctx, e.amount);
      if (amount <= 0) return void (ctx.did = false);
      game.players[ctx.p].effects.push({
        kind: 'cost-reduction',
        amount,
        cardType: e.cardType,
        classification: e.classification,
        cardName: e.cardNameFrom === 'chosen-card' ? ctx.named : e.cardName,
        playMethod: e.playMethod === 'shift' ? 'shift' : null,
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
      ctx.discarded = [];
      for (const q of playersOf(game, ctx, e.target, e)) {
        // "If an effect would cause you to discard, you don't discard"
        if (replacementFor(game, 'discard', { owner: q, player: true })) continue;
        const hand = game.players[q].hand;
        const eligible = hand.map((idx, pos) => pos).filter((pos) => filters.every((f) => passes(game, ctx, { card: cardOf(game, q, hand[pos]), owner: q, mods: [], damage: 0 }, f)));
        const n = e.amount === 'all' ? eligible.length : Math.min(amountOf(game, ctx, e.amount), eligible.length);
        if (!n) continue;
        let picked;
        if (e.random) picked = shuffleInPlace(game, eligible.slice()).slice(0, n);
        else picked = chooseFromHand(game, e.chosenBy === 'you' ? ctx.p : q, q, eligible, n, 'discard');
        const discarded = picked.sort((a, b) => b - a).map((pos) => discardFromHand(game, q, pos));
        ctx.discarded.push(...discarded.map((idx) => ({ q, idx })));
        say(game, q, `${label(ctx)} : défausse ${discarded.map((idx) => cardOf(game, q, idx).name).join(', ')}`, 'effect', [ctx.source]);
        any = true;
      }
      ctx.did = any;
    },
  },
  mill: {
    keys: ['amount', 'target'],
    check: (e) => okAmount(e.amount) && okPlayers(e.target),
    run: (game, ctx, e) => {
      ctx.discarded = [];
      for (const q of playersOf(game, ctx, e.target, e)) {
        const me = game.players[q];
        const cards = me.library.splice(0, amountOf(game, ctx, e.amount));
        me.discard.push(...cards);
        me.turnStats.discarded += cards.length;
        ctx.discarded.push(...cards.map((idx) => ({ q, idx })));
        if (cards.length) emit(game, 'mill', { p: q, subject: null, amount: cards.length });
        for (const idx of cards) emit(game, 'discard', { p: q, subject: discardRef(game, q, idx), fromDeck: true });
        ctx.did = cards.length > 0;
      }
    },
  },
  'put-into-inkwell': {
    keys: ['source', 'target', 'exerted', 'facedown', 'chosenBy', 'chooser'],
    check: (e) => {
      // The opponent chooses their own cards ("each player chooses 2 of their characters")
      const opponent = e.chosenBy === 'opponent' && [undefined, 'OPPONENT'].includes(e.chooser);
      if (!opponent && ([e.chooser].some((c) => c != null && c !== 'CONTROLLER') || ![undefined, 'you'].includes(e.chosenBy))) return false;
      if (e.source === 'top-of-deck' && e.target?.ref) return REFS.has(e.target.ref);
      // "Put up to 2 cards from your discard into your inkwell": the cards named by the target
      if (e.source === 'discard' && typeof e.target === 'object' && e.target) return okCards(e.target, { inDiscard: true });
      if (e.source === 'hand' || e.source === 'top-of-deck' || e.source === 'discard') return okPlayers(e.target);
      if (e.source === 'chosen-card-in-play' || e.source === 'chosen-character') return okCards(e.target);
      if (SELF_TARGETS.has(e.source)) return true;
      return okCards(e.source, { inDiscard: true, inHand: true }) && okPlayers(e.target);
    },
    run: (game, ctx, e) => {
      const exerted = e.exerted !== false;
      if ((e.source === 'hand' || e.source === 'top-of-deck' || e.source === 'discard') && !(e.source === 'discard' && typeof e.target === 'object' && e.target)) {
        // "Its player puts the top card of their deck into their inkwell": the player of a card chosen before
        const q = e.target?.ref ? (refTargets(ctx, e.target.ref)[0]?.owner ?? ctx.p) : playersOf(game, ctx, e.target, e)[0];
        const me = game.players[q];
        let idx;
        if (e.source === 'discard') {
          if (!me.discard.length) return void (ctx.did = false);
          idx = takeFromDiscard(game, q, chooseFromHand(game, q, q, me.discard.map((x, i) => i), 1, 'ink', me.discard)[0], 'inkwell');
        } else if (e.source === 'hand') {
          const pos = me.hand.map((x, i) => i).filter((i) => cardOf(game, q, me.hand[i]).inkwell);
          if (!pos.length) return void (ctx.did = false);
          [idx] = me.hand.splice(chooseFromHand(game, q, q, pos, 1, 'ink')[0], 1);
        } else idx = me.library.shift();
        if (idx == null) return void (ctx.did = false);
        addToInkwell(game, q, idx, { exerted });
        tell(game, ctx, `met ${e.source === 'top-of-deck' ? 'la carte du dessus de la pioche' : cardOf(game, q, idx).name} dans l'encrier`);
        ctx.did = true;
        return;
      }
      // "Put this card into your inkwell", cards chosen in play, in a discard or a hand ("all cards from your hand")
      const target = SELF_TARGETS.has(e.source) ? 'SELF' : typeof e.source === 'object' && e.source ? e.source : e.target;
      const cards = targetsOf(game, ctx, e, target).filter((c) => {
        if (c.zone !== 'hand') return putIntoInkwell(game, c, { exerted });
        const idx = takeCardFrom(game, c);
        if (idx == null) return false;
        addToInkwell(game, c.owner, idx, { exerted });
        return true;
      });
      if (cards.length) tell(game, ctx, `met ${names(cards)} dans l'encrier`, cards);
      ctx.did = cards.length > 0;
    },
  },
  /**
   * Plays a card from the hand, the discard or the revealed top card of the deck: for free, or
   * paying its cost (no cost given: "you pay all costs"). playMethod: 'shift' onto one of your
   * characters, 'either'; grantsRush and banishAtEndOfTurn: "they gain Rush. At the end of your
   * turn, banish them"; entersExerted: it enters play exerted.
   */
  'play-card': {
    keys: ['from', 'cardType', 'cost', 'filter', 'filters', 'costRestriction', 'afterPlay', 'target', 'playMethod', 'grantsRush', 'banishAtEndOfTurn', 'entersExerted'],
    check: (e) =>
      [].concat(e.from ?? 'hand').every((z) => PLAY_ZONES.has(z)) &&
      (e.afterPlay == null || e.afterPlay === 'bottom-of-deck') &&
      (e.cost == null || e.cost === 'free') &&
      [undefined, 'CONTROLLER', 'OPPONENT', 'CHOSEN_CHARACTER'].includes(e.target) &&
      [undefined, 'standard', 'shift', 'either'].includes(e.playMethod) &&
      (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
      (e.costRestriction == null || (okComparison(e.costRestriction.comparison) && typeof e.costRestriction.value === 'number')) &&
      filtersOf(e).every((f) => okFilter(f) || (f.type === 'has-keyword' && f.keyword === 'Shift')),
    run: (game, ctx, e) => {
      // The opponent plays one of theirs ("each player may reveal a character card from their hand and play it")
      if (e.target === 'OPPONENT') return void runEffect(game, { ...ctx, p: 1 - ctx.p }, { ...e, target: 'CONTROLLER' });
      const me = game.players[ctx.p];
      const free = e.cost === 'free';
      const shifting = e.playMethod === 'shift' || e.playMethod === 'either';
      const fits = (card, idx) =>
        (!e.cardType || isType(card, e.cardType)) &&
        (card.kind !== 'action' || !!card.abilities?.action) &&
        (!e.costRestriction || compare(card.cost, e.costRestriction.comparison, e.costRestriction.value)) &&
        filtersOf(e).every((f) => (f.type === 'has-keyword' && f.keyword === 'Shift' ? !!card.shift : passes(game, ctx, { card, idx, owner: ctx.p, zone: 'hand', mods: [], damage: 0 }, f)));
      // The best card it may play, and how: shifted onto a base, or played as it is
      let best = null;
      for (const { zone, positions } of zonesNamed(game, ctx, e.from ?? 'hand')) {
        for (const pos of positions) {
          const card = cardOf(game, ctx.p, zone[pos]);
          if (!fits(card, zone[pos])) continue;
          const base = shifting ? (shiftBases(game, ctx.p, card)[0] ?? null) : null;
          if (e.playMethod === 'shift' && !base) continue;
          if (!free && costOf(game, ctx.p, card, { shift: !!base, base }) > me.ink) continue;
          const worth = cardWorth(card) + (base ? 1 : 0);
          if (!best || worth > best.worth) best = { zone, pos, base, worth };
        }
      }
      const inst = best && playFrom(game, ctx, ctx.p, best.zone, best.pos, { free, base: best.base, exerted: !!e.entersExerted, afterPlay: e.afterPlay });
      if (!inst) return void (ctx.did = false);
      if (e.grantsRush) addMod(inst, { kind: 'keyword', keyword: 'Rush', value: 1, until: game.turn });
      if (e.banishAtEndOfTurn) me.effects.push({ kind: 'banish-at-end', target: inst, until: game.turn });
      ctx.targets = [inst];
      ctx.did = true;
    },
  },
  // Enables playing cards from somewhere else this turn: from under this card, the card that was discarded
  'enable-play-from-under': {
    keys: ['duration', 'cardType'],
    check: (e) => (e.duration == null || e.duration === 'this-turn') && (e.cardType == null || CARD_TYPES.includes(e.cardType)),
    run: (game, ctx, e) => {
      game.players[ctx.p].effects.push({ kind: 'play-from-under', source: ctx.source, cardType: e.cardType, until: game.turn });
      ctx.did = true;
    },
  },
  // A card ("you may play it from your discard"), or every card of a type ("you may play characters from your discard, they enter play exerted")
  'enable-play-from-discard': {
    keys: ['source', 'duration', 'cardType', 'entersExerted', 'scope', 'uniqueByName'],
    check: (e) =>
      (e.source === 'trigger-subject' || SELF_TARGETS.has(e.source) || (e.source == null && e.scope === 'all-cards')) && (e.duration == null || e.duration === 'this-turn'),
    run: (game, ctx, e) => {
      if (e.scope === 'all-cards') {
        game.players[ctx.p].effects.push({ kind: 'play-from-discard', cardType: e.cardType, exerted: !!e.entersExerted, uniqueByName: !!e.uniqueByName, until: game.turn });
        return void (ctx.did = true);
      }
      const card = e.source === 'trigger-subject' ? ctx.trigger?.subject : ctx.source;
      if (!card) return void (ctx.did = false);
      game.players[ctx.p].effects.push({ kind: 'play-from-discard', idx: card.idx, until: game.turn });
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
      const back = picked.sort((a, b) => b - a).map((pos) => takeFromDiscard(game, ctx.p, pos, e.destination === 'top-of-deck' ? 'deck' : 'hand'));
      if (e.destination === 'top-of-deck') me.library.unshift(...back);
      else me.hand.push(...back);
      if (back.length) tell(game, ctx, `reprend ${back.map((idx) => cardOf(game, ctx.p, idx).name).join(', ')} de la défausse`);
      ctx.returned = back.map((idx) => cardOf(game, ctx.p, idx));
      ctx.did = back.length > 0;
    },
  },
  // Searches the deck for the best card that fits, into the hand or on top of the shuffled deck
  'search-deck': {
    keys: ['cardType', 'classification', 'putInto', 'reveal', 'shuffle', 'source', 'filters', 'maxCost', 'cardName'],
    check: (e) =>
      (e.putInto === 'hand' || e.putInto === 'top-of-deck') &&
      (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
      // "Search your deck for any card"
      (e.source == null || (e.source.selector === 'chosen' && e.source.owner === 'you' && JSON.stringify(e.source.zones) === '["deck"]')) &&
      filtersOf(e).every(okFilter),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const options = me.library
        .map((idx, pos) => pos)
        .filter((pos) => {
          const card = cardOf(game, ctx.p, me.library[pos]);
          return (
            (!e.cardType || isType(card, e.cardType)) &&
            (!e.classification || card.classifications.includes(e.classification)) &&
            (e.maxCost == null || card.cost <= e.maxCost) &&
            (!e.cardName || card.title === e.cardName) &&
            filtersOf(e).every((f) => passes(game, ctx, { card, owner: ctx.p, mods: [], damage: 0 }, f))
          );
        });
      let idx = null;
      if (options.length) {
        const [pos] = chooseFromHand(game, ctx.p, ctx.p, options, 1, 'hand', me.library);
        [idx] = me.library.splice(pos, 1);
        tell(game, ctx, `cherche ${cardOf(game, ctx.p, idx).name} dans la pioche`);
      }
      shuffleInPlace(game, me.library);
      if (idx != null && e.putInto === 'top-of-deck') me.library.unshift(idx);
      else if (idx != null) {
        me.hand.push(idx);
        if (me.seen) me.seen[idx] = 1;
      }
      ctx.did = options.length > 0;
    },
  },
  /**
   * Looks at the top cards of a deck and sends them to destinations, in order. A destination keeps
   * enough cards for the ones after it that need some (min); one of an exclusive group taking cards
   * closes the others; requiresLookedAtLeast: only when that many cards were looked at; deck-top:
   * the cards worth keeping there only. repeatOnHandMatch: again while a card goes to the hand.
   */
  scry: {
    keys: ['amount', 'target', 'destinations', 'chooser', 'revealAll', 'repeatOnHandMatch'],
    check: (e) =>
      okAmount(e.amount ?? 1) &&
      ['CONTROLLER', 'OPPONENT', 'EACH_OPPONENT', 'CHOSEN_PLAYER', undefined].includes(e.target) &&
      [undefined, 'CONTROLLER', 'OPPONENT'].includes(e.chooser) &&
      Array.isArray(e.destinations) &&
      e.destinations.every(
        (d) =>
          ['hand', 'deck-top', 'deck-bottom', 'discard', 'play', 'inkwell'].includes(d.zone) &&
          (d.zone !== 'play' || d.cost === 'free') &&
          filtersOf(d).every(okFilter) &&
          (d.playFilters ?? []).every(okFilter) &&
          Object.keys(d).every((k) =>
            [
              'zone',
              'min',
              'max',
              'reveal',
              'filter',
              'filters',
              'playFilters',
              'entersExerted',
              'remainder',
              'ordering',
              'cost',
              'exerted',
              'facedown',
              'label',
              'exclusiveGroup',
              'requiresLookedAtLeast',
            ].includes(k)
          )
      ),
    run: (game, ctx, e) => {
      // The deck looked at, and who decides: an opponent sends the best cards away
      const q = playersOf(game, ctx, e.target, e)[0];
      const chooser = e.chooser === 'OPPONENT' ? 1 - ctx.p : ctx.p;
      const me = game.players[q];
      const moved = [];
      let milled = 0;
      let again = true;
      while (again && !game.over) {
        again = false;
        let looked = me.library.splice(0, amountOf(game, ctx, e.amount ?? 1));
        const seen = looked.length;
        const closed = new Set();
        e.destinations.forEach((d, i) => {
          if (!looked.length || closed.has(d.exclusiveGroup) || seen < (d.requiresLookedAtLeast ?? 0)) return;
          const filters = [...filtersOf(d), ...(d.playFilters ?? [])];
          const fits = (idx) => filters.every((f) => passes(game, ctx, { card: cardOf(game, q, idx), owner: q, mods: [], damage: 0 }, f));
          let take = d.remainder ? looked.slice() : looked.filter(fits);
          if (!d.remainder) {
            const later = e.destinations.slice(i + 1).filter((x) => !x.remainder && seen >= (x.requiresLookedAtLeast ?? 0));
            const max = Math.min(d.max ?? take.length, looked.length - later.reduce((s, x) => s + (x.min ?? 0), 0));
            const ranked = rankForHand(game, q, take, d.zone);
            take = (chooser === q ? ranked : ranked.reverse()).slice(0, Math.max(0, max));
            if (d.zone === 'deck-top' && !d.min && chooser === q) take = take.filter((idx) => keepOnTop(game, q, idx));
            if (take.length < (d.min ?? 0)) take = [];
          }
          if (take.length && d.exclusiveGroup) closed.add(d.exclusiveGroup);
          looked = looked.filter((idx) => !take.includes(idx));
          for (const idx of take) {
            if (d.zone === 'hand') {
              me.hand.push(idx);
              if (me.seen) me.seen[idx] = 1;
              moved.push(`${cardOf(game, q, idx).name} en main`);
              again = !!e.repeatOnHandMatch;
            } else if (d.zone === 'deck-top') me.library.unshift(idx);
            else if (d.zone === 'deck-bottom') me.library.push(idx);
            else if (d.zone === 'discard') {
              me.discard.push(idx);
              me.turnStats.discarded++;
              milled++;
            } else if (d.zone === 'inkwell') addToInkwell(game, q, idx, { exerted: d.exerted !== false });
            else if (d.zone === 'play') {
              moved.push(`joue ${cardOf(game, q, idx).name}`);
              enterPlay(game, q, idx, { exerted: !!d.entersExerted });
            }
          }
        });
        me.library.push(...looked);
      }
      if (milled) emit(game, 'mill', { p: q, subject: null, amount: milled });
      tell(game, ctx, `regarde le dessus de ${q === ctx.p ? 'sa' : 'la'} pioche${moved.length ? ` : ${moved.join(', ')}` : ''}`);
      ctx.did = moved.length > 0;
    },
  },
  // Chooses cards (in play, a discard, the hand) or a player for the next steps
  'select-target': {
    keys: ['target'],
    check: (e) => okCards(e.target, { inDiscard: true, inHand: true }) || (typeof e.target === 'string' && PLAYER_TARGETS.has(e.target)),
    run: (game, ctx, e) => {
      ctx.did = typeof e.target === 'string' && PLAYER_TARGETS.has(e.target) ? true : targetsOf(game, ctx, e).length > 0;
    },
  },
  // Looking at cards tells the pilots nothing they use: nothing to play
  'reveal-hand': { keys: ['target', 'visibility'], check: (e) => okPlayers(e.target), run: (game, ctx) => void (ctx.did = true) },
  'reveal-inkwell': { keys: ['target'], check: (e) => okPlayers(e.target), run: (game, ctx) => void (ctx.did = true) },
  reveal: { keys: ['target', 'amount'], check: (e) => e.target == null || e.target === 'previous-target', run: (game, ctx) => void (ctx.did = true) },
  // "Return 2 cards at random from your inkwell to your hand", "until they have 3 cards in their inkwell"
  'return-random-from-inkwell': {
    keys: ['count', 'target', 'leave'],
    check: (e) => (typeof e.count === 'number' || typeof e.leave === 'number') && okPlayers(e.target),
    run: (game, ctx, e) => {
      let any = false;
      for (const q of playersOf(game, ctx, e.target, e)) {
        const me = game.players[q];
        const n = e.leave != null ? Math.max(0, me.inkCards.length - e.leave) : Math.min(e.count, me.inkCards.length);
        for (let i = 0; i < n; i++) me.hand.push(takeFromInkwell(game, q, Math.floor(random(game) * me.inkCards.length)));
        if (n) say(game, q, `${label(ctx)} : reprend ${plural(n, 'carte')} de l'encrier`, 'effect', [ctx.source]);
        any ||= n > 0;
      }
      ctx.did = any;
    },
  },
  // "This turn, you may put an additional card from your hand into your inkwell"
  'additional-inkwell': {
    keys: ['amount'],
    check: (e) => e.amount == null || typeof e.amount === 'number',
    run: (game, ctx, e) => {
      game.players[ctx.p].effects.push({ kind: 'additional-inkwell', amount: e.amount ?? 1, until: game.turn });
      ctx.did = true;
    },
  },
  // "Reveal cards from the top of your deck until you reveal a Floodborn character card. Put it into your hand, shuffle the rest in"
  'reveal-until-match': {
    keys: ['target', 'cardType', 'classification', 'putInto', 'shuffle'],
    check: (e) => (e.target == null || e.target === 'CONTROLLER') && e.putInto === 'hand' && (e.cardType == null || CARD_TYPES.includes(e.cardType)),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const pos = me.library.findIndex((idx) => {
        const card = cardOf(game, ctx.p, idx);
        return (!e.cardType || isType(card, e.cardType)) && (!e.classification || card.classifications.includes(e.classification));
      });
      if (pos >= 0) {
        const [idx] = me.library.splice(pos, 1);
        me.hand.push(idx);
        if (me.seen) me.seen[idx] = 1;
        tell(game, ctx, `révèle jusqu'à ${cardOf(game, ctx.p, idx).name}`);
      }
      shuffleInPlace(game, me.library);
      ctx.did = pos >= 0;
    },
  },
  // "Each player reveals the top card of their deck. Put the card with the highest cost (or each tied) into its player's hand, the rest on the bottom"
  'reveal-tops-highest-cost-to-hand': {
    keys: [],
    check: () => true,
    run: (game, ctx) => {
      const tops = [ctx.p, 1 - ctx.p].filter((q) => game.players[q].library.length).map((q) => ({ q, idx: game.players[q].library.shift() }));
      const best = Math.max(...tops.map(({ q, idx }) => cardOf(game, q, idx).cost));
      for (const { q, idx } of tops) {
        if (cardOf(game, q, idx).cost === best) game.players[q].hand.push(idx);
        else game.players[q].library.push(idx);
      }
      if (tops.length) tell(game, ctx, `révèle ${tops.map(({ q, idx }) => cardOf(game, q, idx).name).join(', ')}`);
      ctx.did = tops.some(({ q, idx }) => q === ctx.p && cardOf(game, q, idx).cost === best);
    },
  },
  // Puts a card under a card in play: the top card of the deck, a card of the discard (the best
  // one of a type), or this card itself ("put this character facedown under one of your characters")
  'put-under': {
    keys: ['source', 'under', 'cardType', 'faceup'],
    check: (e) => ['top-of-deck', 'discard'].concat([...SELF_TARGETS]).includes(e.source) && okCards(e.under) && (e.cardType == null || CARD_TYPES.includes(e.cardType)),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const self = SELF_TARGETS.has(e.source);
      const [inst] = targetsOf(game, ctx, { ...e, type: 'put-under' }, e.under).filter((c) => c.zone === 'play' && !(self && c === ctx.source));
      if (!inst) return void (ctx.did = false);
      let idx = null;
      if (e.source === 'top-of-deck') idx = me.library.shift() ?? null;
      else if (e.source === 'discard') {
        const options = me.discard.map((x, pos) => pos).filter((pos) => !e.cardType || cardOf(game, ctx.p, me.discard[pos]).kind === e.cardType);
        if (options.length) idx = takeFromDiscard(game, ctx.p, chooseFromHand(game, ctx.p, ctx.p, options, 1, 'play', me.discard)[0], 'under');
      } else {
        // This card leaves play for under the other one
        ctx.did = moveUnder(game, ctx.source, inst);
        if (ctx.did) tell(game, ctx, `se place sous ${inst.card.name}`, [inst]);
        return;
      }
      if (idx == null) return void (ctx.did = false);
      tell(game, ctx, `place ${e.source === 'top-of-deck' ? 'une carte' : cardOf(game, ctx.p, idx).name} sous ${inst.card.name}`, [inst]);
      putUnder(game, inst, idx);
      ctx.did = true;
    },
  },
  /**
   * The cards under cards in play go elsewhere: to the hand, the bottom of the deck, the inkwell,
   * under another card. source 'selected': the cards under them chosen in limbo; 'snapshot-cards-under':
   * the cards a banished card had under it, now in the discard.
   */
  'move-cards-from-under': {
    keys: ['destination', 'target', 'source', 'underTarget'],
    check: (e) =>
      UNDER_DESTINATIONS.has(e.destination) &&
      (e.destination !== 'under-chosen' || okCards(e.underTarget)) &&
      (e.source === 'snapshot-cards-under' ? e.target == null : okCards(e.target, { under: true })) &&
      [undefined, 'target', 'selected', 'snapshot-cards-under'].includes(e.source),
    run: (game, ctx, e) => {
      // The cards moved, by owner: { q, idx }
      const cards = [];
      if (e.source === 'snapshot-cards-under') {
        const banished = ctx.trigger?.subject ?? ctx.source;
        for (const idx of banished.underCards ?? []) {
          const pos = game.players[banished.owner].discard.lastIndexOf(idx);
          if (pos >= 0) cards.push({ q: banished.owner, idx: takeFromDiscard(game, banished.owner, pos, 'under') });
        }
      } else {
        for (const inst of targetsOf(game, ctx, e)) {
          if (inst.zone === 'limbo') {
            const idx = takeCardFrom(game, inst);
            if (idx != null) cards.push({ q: inst.owner, idx });
          } else if (inst.zone === 'play') {
            cards.push(...inst.under.map((idx) => ({ q: inst.owner, idx })));
            inst.under = [];
          }
        }
      }
      if (!cards.length) return void (ctx.did = false);
      if (e.destination === 'under-chosen') {
        const [to] = targetsOf(game, ctx, { ...e, type: 'put-under' }, e.underTarget).filter((c) => c.zone === 'play');
        if (to) for (const { idx } of cards) putUnder(game, to, idx);
        else for (const { q, idx } of cards) game.players[q].discard.push(idx);
      } else {
        for (const { q, idx } of shuffleInPlace(game, cards)) {
          const me = game.players[q];
          if (e.destination === 'hand') me.hand.push(idx);
          else if (e.destination === 'inkwell-facedown-exerted') addToInkwell(game, q, idx);
          else me.library.push(idx);
        }
      }
      tell(game, ctx, `déplace ${plural(cards.length, 'carte')} de dessous ${UNDER_DESTINATIONS.get(e.destination)}`);
      ctx.count = cards.length;
      ctx.did = true;
    },
  },
  // includeSelf: the character of the ability moves too; forEach: effects for each character moved ("if you do, gain 1 lore")
  'move-to-location': {
    keys: ['character', 'location', 'cost', 'includeSelf', 'forEach'],
    check: (e) => e.cost === 'free' && okCards(e.character) && okCards(e.location) && (e.forEach ?? []).every(okEffect),
    run: (game, ctx, e) => {
      const [loc] = targetsOf(game, ctx, { ...e, type: 'move-to-location' }, e.location).filter((c) => c.card.kind === 'location' && c.owner === ctx.p);
      if (!loc) return void (ctx.did = false);
      const chosen = targetsOf(game, ctx, { ...e, type: 'move-to-location', location: loc }, e.character).filter((c) => c.card.kind === 'character');
      const chars = e.includeSelf && ctx.source.card.kind === 'character' && !chosen.includes(ctx.source) ? [ctx.source, ...chosen] : chosen;
      let moved = 0;
      for (const c of chars) {
        if (!moveCharacter(game, ctx.p, c, loc, { free: true })) continue;
        moved++;
        for (const step of e.forEach ?? []) runEffect(game, ctx, step);
      }
      ctx.targets = chars;
      ctx.location = loc;
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
        const whole = GRANTED_ABILITIES[e.ability];
        const named = typeof e.ability === 'object' && GRANTS.has(e.ability.type) && e.ability.type !== 'can-challenge-ready' ? e.ability.type : null;
        if (named) addMod(c, { kind: 'grant', ability: named, until });
        else if (whole) {
          addMod(c, { kind: 'ability', ability: whole, until, once: !!whole.once });
          game.boardVersion++;
        } else if (typeof e.ability === 'string') addMod(c, { kind: 'grant', ability: e.ability, until });
        else if (e.ability.type === 'can-challenge-ready') addMod(c, { kind: 'grant', ability: 'can-challenge-ready', classification: e.ability.classification, until });
        else {
          addMod(c, { kind: 'ability', ability: e.ability, until });
          game.boardVersion++;
        }
      }
      ctx.did = cards.length > 0;
    },
  },
  // "Prevent the next challenge damage dealt to this character this turn"; with 'deal-damage', any damage
  // ("the next time they would be dealt damage they take no damage instead"); on the event's character
  'create-replacement-effect': {
    keys: ['duration', 'replacement'],
    check: (e) => {
      const r = e.replacement ?? {};
      const kinds = JSON.stringify(r.eventKinds);
      return (
        r.type === 'prevent-damage' &&
        (r.targetRef === 'source' || r.targetRef === 'trigger-subject') &&
        r.consumeOnApply === true &&
        (kinds === '["challenge-damage"]' || kinds === '["deal-damage","challenge-damage"]') &&
        (e.duration == null || DURATIONS.has(e.duration)) &&
        Object.keys(r).every((k) => ['type', 'targetRef', 'consumeOnApply', 'eventKinds'].includes(k))
      );
    },
    run: (game, ctx, e) => {
      const r = e.replacement;
      const inst = r.targetRef === 'source' ? ctx.source : ctx.trigger?.subject;
      if (!inst?.card) return void (ctx.did = false);
      addMod(inst, { kind: 'shield', all: r.eventKinds.includes('deal-damage'), until: untilOf(game, ctx, e.duration) });
      ctx.did = true;
    },
  },
  /**
   * Reveal the top card: where it goes depends on what it is. A route to 'play' plays it for free
   * (an action needs a known effect); an optional route is taken when it helps. The fallback is a
   * zone, or the top or the bottom of the deck as the player likes ({ destinations }).
   */
  'reveal-and-route': {
    keys: ['target', 'routes', 'fallback'],
    check: (e) =>
      (e.target == null || e.target === 'CONTROLLER') &&
      Array.isArray(e.routes) &&
      e.routes.every(
        (r) =>
          !!REVEALED[r.condition?.type]?.check(r.condition) &&
          ROUTE_ZONES.has(r.destination?.zone) &&
          (r.destination.zone !== 'play' || r.destination.cost === 'free') &&
          Object.keys(r.destination).every((k) => ['zone', 'cost', 'exerted'].includes(k)) &&
          (r.sideEffects ?? []).every(okEffect) &&
          Object.keys(r).every((k) => ['condition', 'destination', 'sideEffects', 'optional'].includes(k))
      ) &&
      (ROUTE_ZONES.has(e.fallback?.zone) ? Object.keys(e.fallback).length === 1 : isTopOrBottom(e.fallback)),
    run: (game, ctx, e) => {
      const me = game.players[ctx.p];
      const idx = me.library.shift();
      if (idx == null) return void (ctx.did = false);
      const card = cardOf(game, ctx.p, idx);
      let route = e.routes.find((r) => REVEALED[r.condition.type].test(card, r.condition, ctx));
      if (route?.destination.zone === 'play' && card.kind === 'action' && !card.abilities?.action) route = null;
      tell(game, ctx, `révèle ${card.name}`);
      if (route) routeCard(game, ctx.p, idx, route.destination.zone);
      else if (e.fallback.zone) routeCard(game, ctx.p, idx, e.fallback.zone);
      else routeCard(game, ctx.p, idx, keepOnTop(game, ctx.p, idx) ? 'deck-top' : 'deck-bottom');
      ctx.did = !!route;
      if (route) for (const side of route.sideEffects ?? []) runEffect(game, ctx, side);
    },
  },
  // "Name a card": the card the player has most copies of in their deck
  'name-a-card': {
    keys: [],
    check: () => true,
    run: (game, ctx) => {
      ctx.named = nameACard(game, ctx.p);
      if (ctx.named) tell(game, ctx, `nomme ${ctx.named}`);
      ctx.did = !!ctx.named;
    },
  },
  // Reveals the top card of decks: what later steps read ("play it", "for each ink revealed")
  'reveal-top-card': {
    keys: ['target'],
    check: (e) => okPlayers(e.target),
    run: (game, ctx, e) => {
      ctx.revealed = playersOf(game, ctx, e.target, e)
        .filter((q) => game.players[q].library.length)
        .map((q) => ({ q, idx: game.players[q].library[0] }));
      if (ctx.revealed.length) tell(game, ctx, `révèle ${ctx.revealed.map((r) => cardOf(game, r.q, r.idx).name).join(', ')}`);
      ctx.did = ctx.revealed.length > 0;
    },
  },
  // Counts what earlier steps did, for a later "for each" ({ type: 'trigger-amount' })
  count: {
    keys: ['what', 'multiplier', 'controller'],
    check: (e) => !!COUNTED[e.what] && (e.multiplier == null || typeof e.multiplier === 'number'),
    run: (game, ctx, e) => {
      const n = COUNTED[e.what](game, ctx, e);
      ctx.amount = n * (e.multiplier ?? 1);
      ctx.did = n > 0;
    },
  },
  // "This turn, whenever one of your characters quests, ...": an ability for the turn
  // A delayed one ("at the end of your turn, banish them") keeps the cards chosen before it
  'create-triggered-ability': {
    keys: ['lifecycle', 'ability'],
    check: (e) =>
      ((e.lifecycle?.kind === 'floating' && DURATIONS.has(e.lifecycle.duration) && Object.keys(e.lifecycle).every((k) => ['kind', 'duration'].includes(k))) ||
        (e.lifecycle?.kind === 'delayed' && e.lifecycle.timing === 'end-of-turn' && Object.keys(e.lifecycle).length === 2)) &&
      isSupported({ ...e.ability, type: 'triggered' }),
    run: (game, ctx, e) => {
      const until = e.lifecycle.kind === 'delayed' ? game.turn : untilOf(game, ctx, e.lifecycle.duration);
      game.players[ctx.p].effects.push({ kind: 'trigger', ability: { ...e.ability, type: 'triggered' }, source: ctx.source, targets: ctx.targets.slice(), until });
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

// ctx.current: the effect resolving, which a player choosing its card may play ahead
const runEffect = (game, ctx, e) => {
  if (game.over) return;
  const outer = ctx.current;
  ctx.current = e;
  EFFECTS[e.type].run(game, ctx, e);
  ctx.current = outer;
};

/**
 * Resolves an ability: its condition, then its effect. Then the damage it put off checking, and
 * "whenever this character is chosen" for the cards in play it chose.
 */
export const resolveAbility = (game, ctx) => {
  const { ability } = ctx;
  if (ability.condition && !holds(game, ctx, ability.condition)) return;
  // The cards a cost took are the ones the effect speaks of ("the banished character"), or the ones a delayed ability kept
  ctx.targets = ctx.paid ?? ctx.carried ?? [];
  ctx.count = 0;
  ctx.did = false;
  runEffect(game, ctx, ability.effect);
  settle(game, ctx);
};

const settle = (game, ctx) => {
  for (const inst of ctx.deferred ?? NONE) checkBanish(game, inst);
  // Chosen while in play: it sets off its abilities even if the effect made it leave
  for (const { inst, by } of ctx.chosen ?? NONE) emit(game, 'be-chosen', { p: inst.owner, subject: inst, by, source: ctx.source });
  ctx.deferred = null;
  ctx.chosen = null;
};

/** Runs effects for a pilot weighing them in a copy of the game. pick: the card the first choice goes to. */
export const runEffectFor = (game, ctx, effect, rest = NONE) => {
  const run = { targets: [], count: 0, did: false, ...ctx, rest: NONE };
  runSteps(game, run, [effect, ...rest]);
  settle(game, run);
};

// ---------- Static abilities ----------

// Static effects the engine applies while their card is in play. A static effect lasts while its
// condition holds: a "this turn" in it says no more.
const STATIC_EFFECTS = {
  'modify-stat': (e) =>
    ['strength', 'willpower', 'lore'].includes(e.stat) &&
    okModifier(e.modifier) &&
    staticTarget(e.target) &&
    Object.keys(e).every((k) => ['type', 'stat', 'modifier', 'target', 'duration'].includes(k)),
  'gain-keyword': (e) =>
    KEYWORDS.includes(e.keyword) &&
    (e.value == null || okAmount(e.value)) &&
    staticTarget(e.target) &&
    Object.keys(e).every((k) => ['type', 'keyword', 'value', 'target', 'duration'].includes(k)),
  // bypass: lifted by paying ink each time; challengerFilter: only against the challengers it names
  restriction: (e) =>
    RESTRICTIONS.has(e.restriction) &&
    (PLAYER_RESTRICTIONS.has(e.restriction) ? okPlayers(e.target) : staticTarget(e.target)) &&
    (e.condition == null || okCondition(e.condition)) &&
    (e.restriction !== 'challenge-limit' || typeof e.limit === 'number') &&
    (e.minCost == null || typeof e.minCost === 'number') &&
    (e.bypass == null || (Object.keys(e.bypass).length === 1 && Object.keys(e.bypass.cost ?? {}).join() === 'ink' && typeof e.bypass.cost.ink === 'number')) &&
    (e.challengerFilter == null || okFilter(e.challengerFilter)) &&
    Object.keys(e).every((k) => ['type', 'restriction', 'target', 'condition', 'limit', 'minCost', 'bypass', 'challengerFilter'].includes(k)),
  // "During challenges, your characters deal damage with their {W} instead of their {S}"
  'damage-source-stat-override': (e) => e.stat === 'willpower' && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'stat', 'target'].includes(k)),
  // "Your Gargoyle characters lose the Stone by Day ability"
  'suppress-ability': (e) => typeof e.abilityName === 'string' && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'abilityName', 'target'].includes(k)),
  // The player's: "all cards in your hand count as having {IW}", "you can ink cards from your discard"
  'grant-hand-inkability': (e) => Object.keys(e).length === 1,
  'grant-discard-inkability': (e) => Object.keys(e).length === 1,
  // "While this character is exerted, you may play characters from your discard. They enter play exerted."
  'play-from-discard': (e) =>
    (e.cardType == null || CARD_TYPES.includes(e.cardType)) && Object.keys(e).every((k) => ['type', 'cardType', 'entersExerted', 'whileSourceExerted'].includes(k)),
  // "Each opponent plays with the top card of their deck faceup": the pilots look at no hidden card anyway
  'reveal-top-card': (e) => okPlayers(e.target) && Object.keys(e).every((k) => ['type', 'target'].includes(k)),
  // cannotGain: "all characters lose Rush and can't gain Rush" (a lost keyword stays lost anyway)
  'lose-keyword': (e) => KEYWORDS.includes(e.keyword) && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'keyword', 'target', 'cannotGain'].includes(k)),
  // The player's: "opponents need 25 lore to win the game", "each player pays 2 {I} more to play actions or items",
  // "you may put an additional card from your hand into your inkwell"
  'win-condition-modification': (e) => typeof e.loreRequired === 'number' && okPlayers(e.target) && Object.keys(e).every((k) => ['type', 'loreRequired', 'target'].includes(k)),
  'cost-increase': (e) =>
    typeof e.amount === 'number' &&
    (e.cardType == null || [].concat(e.cardType).every((t) => ['character', 'action', 'item', 'location', 'song'].includes(t))) &&
    Object.keys(e).every((k) => ['type', 'amount', 'cardType'].includes(k)),
  'additional-inkwell': (e) => (e.amount == null || typeof e.amount === 'number') && Object.keys(e).every((k) => ['type', 'amount'].includes(k)),
  // "Can't go below its printed strength"
  'stat-floor': (e) =>
    ['strength', 'willpower', 'lore'].includes(e.stat) && e.minimum === 'printed' && staticTarget(e.target) && Object.keys(e).every((k) => ['type', 'stat', 'minimum', 'target'].includes(k)),
  // The player's cards cost less; target SELF with playMethod 'shift': shifting onto this character costs less
  // An amount counted while it applies ("for each character you have here"), under a condition of its own
  'cost-reduction': (e) =>
    okAmount(e.amount) &&
    (e.target == null || e.target === 'CONTROLLER' || (e.target === 'SELF' && e.playMethod === 'shift')) &&
    (e.playMethod == null || e.playMethod === 'standard' || e.playMethod === 'shift') &&
    (e.cardType == null || [].concat(e.cardType).every((t) => ['character', 'action', 'item', 'location', 'song'].includes(t))) &&
    (e.condition == null || okCondition(e.condition)) &&
    Object.keys(e).every((k) => ['type', 'amount', 'cardType', 'classification', 'cardName', 'target', 'playMethod', 'condition'].includes(k)),
  // On this card, or on the cards a target names ("opposing characters with Singer enter play with 1 damage")
  'enters-with-damage': (e) => typeof e.amount === 'number' && (e.target == null || staticTarget(e.target)) && Object.keys(e).every((k) => ['type', 'amount', 'target'].includes(k)),
  // "Gains Detective", "counts as having +1 cost to sing songs"; a name for Shift and a base for any
  // Shift are read by the deck profile (deckProfile.js) when the deck is prepared
  'property-modification': (e) =>
    ((e.operation === 'add' &&
      ((e.property === 'classification' && typeof e.value === 'string') || (e.property === 'singer-threshold' && Number.isFinite(Number(e.value))))) ||
      (e.property === 'name' && e.operation === 'add-alias' && typeof e.value === 'string') ||
      (e.property === 'shift-base' && e.operation === 'any')) &&
    (e.target == null ? e.property === 'shift-base' : staticTarget(e.target)) &&
    Object.keys(e).every((k) => ['type', 'property', 'operation', 'value', 'target'].includes(k)),
  // "This character can challenge ready characters", "takes no damage from challenges", a whole triggered or activated ability
  'grant-ability': (e) =>
    ((GRANTS.has(e.ability) && !GRANTED_ABILITIES[e.ability]) ||
      (e.ability?.type === 'can-challenge-ready' && Object.keys(e.ability).every((k) => ['type', 'classification', 'onlyDamaged'].includes(k))) ||
      ((e.ability?.type === 'triggered' || e.ability?.type === 'activated') && isSupported(e.ability))) &&
    staticTarget(e.target) &&
    Object.keys(e).every((k) => ['type', 'ability', 'target', 'duration'].includes(k)),
  // Activated abilities a location gives the characters at it
  'grant-abilities-while-here': (e) =>
    staticTarget(e.target) &&
    Array.isArray(e.abilities) &&
    e.abilities.every((a) => a.type === 'activated' && isSupported(a)) &&
    Object.keys(e).every((k) => ['type', 'target', 'abilities'].includes(k)),
  // "This character moves for 1 less", "characters move here for free"; neither: "you pay 1 {I} less to
  // move your characters to a location"
  'move-cost-reduction': (e) =>
    (typeof e.reduction === 'number' || e.reduction === 'free') &&
    (e.target === 'SELF' || e.location === 'here' || (e.target == null && e.location == null)) &&
    filtersOf(e).every(okFilter) &&
    Object.keys(e).every((k) => ['type', 'reduction', 'target', 'location', 'filter', 'filters'].includes(k)),
};

/** Ink a character saves moving to a location: its own abilities, the location's. */
export const moveReduction = (game, loc, char) => {
  let saved = applyingStatics(game, { owner: char.owner, player: true }, 'move-cost-reduction')
    .filter(({ effect }) => effect.target == null && effect.location == null)
    .reduce((s, { effect }) => s + (effect.reduction === 'free' ? Infinity : effect.reduction), 0);
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

// A static effect reaches the cards it names for as long as it applies: no choosing. The attacker:
// "while this character is being challenged, the challenging character gets -1 {S}"
const staticTarget = (t) => {
  const n = normalizeTarget(t);
  return !!n && (n.self || n.ref === 'attacker' || (n.spec && n.spec.selector === 'all'));
};

export const okStaticEffect = (e) => !!e && !!STATIC_EFFECTS[e.type]?.(e);

/**
 * A static ability of a card in hand: "you pay less to play this character" under a condition
 * (amount 'full': for free; playMethod 'standard': not when shifted), or "you can't play this
 * action unless..." (self-play-condition).
 */
export const okHandStatic = (e) =>
  (e?.type === 'cost-reduction' &&
    (okAmount(e.amount) || e.amount === 'full') &&
    (e.cardType == null || ['character', 'action', 'item', 'location', 'song'].includes(e.cardType)) &&
    (e.playMethod == null || e.playMethod === 'standard') &&
    Object.keys(e).every((k) => ['type', 'amount', 'cardType', 'playMethod'].includes(k))) ||
  (e?.type === 'self-play-condition' && Object.keys(e).length === 1);

const handRef = (p, card) => ({ id: -1, idx: -1, owner: p, card, zone: 'hand', damage: 0, exerted: false, mods: [], under: [] });

/** Ink a card in hand saves itself, its conditions met; shift: played with Shift. */
export const handReduction = (game, p, card, shift = false) => {
  const abilities = card.abilities?.handStatics;
  if (!abilities?.length) return 0;
  const ctx = { p, source: handRef(p, card) };
  let saved = 0;
  for (const a of abilities) {
    if (a.effect.type !== 'cost-reduction' || (shift && a.effect.playMethod === 'standard')) continue;
    if (a.condition && !holds(game, ctx, a.condition)) continue;
    saved += a.effect.amount === 'full' ? Infinity : amountOf(game, ctx, a.effect.amount);
  }
  return saved;
};

/** Whether a card's own conditions let it be played ("you can't play this action unless..."). */
export const playAllowed = (game, p, card) => {
  const abilities = card.abilities?.handStatics;
  if (!abilities?.length) return true;
  const ctx = { p, source: handRef(p, card) };
  return abilities.every((a) => a.effect.type !== 'self-play-condition' || holds(game, ctx, a.condition));
};

// ---------- Alternative costs ----------

// What an alternative cost asks: the effect paid ("put a Toy character card from your discard on the bottom of your deck")
const altCostOf = (alt) => (alt.effect.type === 'optional' ? alt.effect.effect : alt.effect);

/** Whether an alternative cost is a choice of cards the engine can pay: { ability, shift }. */
export const okAlternative = (a) => {
  const cost = altCostOf(a);
  const t = normalizeTarget(cost.target);
  return okEffect(a.effect) && !!t?.spec && t.spec.selector === 'chosen' && typeof t.spec.count === 'number';
};

/** Whether a player can pay a card's alternative cost: enough cards to choose. */
export const canPayAlternative = (game, p, card, alt) => {
  const cost = altCostOf(alt);
  const { spec } = normalizeTarget(cost.target);
  return candidatesOf(game, { p, source: handRef(p, card) }, spec).length >= spec.count;
};

/** Pays a card's alternative cost. */
export const payAlternative = (game, p, card, alt) => {
  const ctx = { p, source: handRef(p, card), ability: alt, targets: [], count: 0, did: false };
  say(game, p, `${card.name} : coût alternatif`, 'effect');
  runEffect(game, ctx, altCostOf(alt));
  settle(game, ctx);
};

// Static effects on a player, or on the card itself only, reach no card in play
const PLAYER_STATICS = new Set([
  'cost-reduction',
  'cost-increase',
  'enters-with-damage',
  'move-cost-reduction',
  'grant-hand-inkability',
  'grant-discard-inkability',
  'play-from-discard',
  'reveal-top-card',
  'win-condition-modification',
  'additional-inkwell',
]);

/** Whether a static ability reaches a card in play, or a player ({ owner, player: true }). */
const staticReaches = (game, src, effect, inst) => {
  const ctx = { p: src.owner, source: src };
  // "You pay 1 {I} less to shift a character on top of this character": that card only
  if (effect.type === 'cost-reduction' && effect.target === 'SELF') return !inst.player && inst === src;
  // On the cards entering play it names
  if (effect.type === 'enters-with-damage') return !inst.player && !!effect.target && inst.probe && cardReached(game, ctx, src, effect, inst);
  if (inst.player) {
    if (effect.type === 'cost-reduction') return inst.owner === src.owner;
    // "Each player pays 2 {I} more"
    if (effect.type === 'cost-increase') return true;
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
  if (PLAYER_STATICS.has(effect.type) || (effect.type === 'property-modification' && effect.property === 'shift-base')) return false;
  if (effect.type === 'restriction' && PLAYER_RESTRICTIONS.has(effect.restriction)) return false;
  return cardReached(game, ctx, src, effect, inst);
};

// The card in play a static ability's target names
const cardReached = (game, ctx, src, effect, inst) => {
  const t = normalizeTarget(effect.target);
  if (t.self) return inst === src;
  if (t.ref === 'attacker') return inst === game.challenging?.attacker;
  const { spec } = t;
  if (!spec.cardTypes.includes(inst.card.kind)) return false;
  if (spec.excludeSelf && inst === src) return false;
  if (spec.owner === 'you' && inst.owner !== src.owner) return false;
  if (spec.owner === 'opponent' && inst.owner === src.owner) return false;
  return spec.filters.every((f) => passes(game, ctx, inst, f));
};

/** The names of a card's abilities a static ability takes away ("your Gargoyle characters lose the Stone by Day ability"). */
export const suppressedOf = (game, inst) =>
  inst.zone === 'play' && listenersOf(game).statics['suppress-ability'] ? applyingStatics(game, inst, 'suppress-ability').map(({ effect }) => effect.abilityName.toUpperCase()) : NONE;

/**
 * The static abilities in play that reach a card (or a player) for one kind of effect, with
 * their amount and their card: { effect, amount, src }. Their own conditions and targets read
 * printed values: no static loops.
 */
export const applyingStatics = (game, inst, type, sources = null) => {
  if (game.staticDepth) return NONE;
  // Called for every stat a pilot reads: only the cards with this kind of static effect
  const { statics: byType } = listenersOf(game);
  const list = sources ?? byType[type];
  if (!list?.length) return NONE;
  const suppressing = type !== 'suppress-ability' && !!byType['suppress-ability'];
  let out = NONE;
  for (const src of list) {
    const statics = src.card.abilities?.statics;
    if (!statics?.length) continue;
    const lost = suppressing ? suppressedOf(game, src) : NONE;
    for (const ability of statics) {
      const { effect } = ability;
      if (effect.type !== type || (lost.length && lost.includes(ability.name?.toUpperCase()))) continue;
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
                ? amountOf(game, ctx, effect.amount)
                : 0;
        if (out === NONE) out = [];
        out.push({ effect, amount, src });
      } finally {
        game.staticDepth--;
      }
    }
  }
  return out;
};

const NONE = [];

// ---------- Replacement abilities ----------

/**
 * "If this would happen, that happens instead", by what it replaces: whether it is one the
 * engine knows, and whether it reaches what is about to happen (a card, or a player { owner,
 * player: true }).
 */
const REPLACEMENTS = {
  // "During each opponent's turn, the first time this character would take damage, she takes no damage instead"
  'damage-to-self': {
    check: (r) =>
      r?.type === 'prevent-damage' &&
      r.appliesTo === 'self' &&
      [undefined, 'opponents-turn'].includes(r.during) &&
      [undefined, 'opponent-turn', 'each-turn'].includes(r.firstTimeEachTurn) &&
      Object.keys(r).every((k) => ['type', 'appliesTo', 'during', 'firstTimeEachTurn'].includes(k)),
    reaches: (game, src, r, inst) =>
      inst === src && (r.during !== 'opponents-turn' || game.current !== src.owner) && (!r.firstTimeEachTurn || src.preventedTurn !== game.turn),
  },
  // "Whenever one of your other characters would be dealt damage, put that many damage counters on this character instead"
  'damage-to-character': {
    check: (r) => r?.type === 'redirect-damage' && r.appliesTo === 'your-other-characters' && r.redirectTo === 'self',
    reaches: (game, src, r, inst) => inst !== src && inst.owner === src.owner && inst.card.kind === 'character',
  },
  // "If this character would be banished, put them into your inkwell facedown and exerted instead"
  'banish-self': {
    check: (r) => r?.type === 'zone-destination' && r.targetRef === 'source' && r.replacementZone === 'inkwell',
    reaches: (game, src, r, inst) => inst === src,
  },
  // "You can't lose lore", "if an effect would cause you to discard, you don't discard"
  'lose-lore': { check: (r) => r === 'prevent', reaches: (game, src, r, inst) => inst.owner === src.owner },
  // "If you would get an ink drop, you may put the top card of your deck into your inkwell facedown and exerted instead"
  'gain-ink-drop': { check: (r) => r === 'inkwell-top-card', reaches: (game, src, r, inst) => inst.owner === src.owner },
  discard: { check: (r) => r === 'prevent', reaches: (game, src, r, inst) => inst.owner === src.owner },
  // "Damage counters can't be removed"
  'remove-damage': { check: (r) => r?.type === 'prevent-remove-damage' && r.appliesTo === 'all', reaches: () => true },
};

export const okReplacement = (a) =>
  !!REPLACEMENTS[a.replaces]?.check(a.replacement) &&
  (a.condition == null || okCondition(a.condition)) &&
  Object.keys(a).every((k) => ['type', 'name', 'replaces', 'replacement', 'condition'].includes(k));

/**
 * The replacement ability in play that changes what is about to happen to a card or a player:
 * { src, ability }, or null. A "first time each turn" one is used up, unless peek.
 */
export const replacementFor = (game, replaces, inst, peek = false) => {
  const sources = listenersOf(game).replacements[replaces];
  if (!sources) return null;
  for (const src of sources) {
    for (const ability of src.card.abilities.replacements) {
      if (ability.replaces !== replaces) continue;
      if (ability.condition && !holds(game, { p: src.owner, source: src }, ability.condition)) continue;
      if (inst && !REPLACEMENTS[replaces].reaches(game, src, ability.replacement, inst)) continue;
      if (ability.replacement?.firstTimeEachTurn && !peek) src.preventedTurn = game.turn;
      return { src, ability };
    }
  }
  return null;
};

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
  // A card readied, a character chosen for Support, dealing or taking damage, chosen for an effect
  'ready',
  'support',
  'deal-damage',
  'damage',
  'be-chosen',
  // A card discarded from a hand, cards put from a deck into the discard, a card leaving a discard, an ink drop removed to pay
  'discard',
  'mill',
  // A card in play returned to its player's hand
  'return-to-hand',
  'leave-discard',
  'ink-drop-removed',
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
  YOUR_ACTIONS: (inst, s) => s.card.kind === 'action' && s.owner === inst.owner,
  YOUR_ITEMS: (inst, s) => s.card.kind === 'item' && s.owner === inst.owner,
  YOUR_CHARACTERS_OR_LOCATIONS_WITH_CARD_UNDER: (inst, s) => (s.card.kind === 'character' || s.card.kind === 'location') && s.owner === inst.owner && s.under?.length > 0,
};
const ON_KEYS = new Set(['cardType', 'controller', 'classification', 'filters', 'shiftedOntoSelf', 'hasKeyword', 'excludeSelf', 'name', 'excludeSong']);
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
      ['in-challenge', 'once-per-turn', 'first-time-each-turn', 'defender-is-character', 'from-location', 'to-hand', 'once-per-song', 'from-deck'].includes(r.type) ||
      (r.type === 'during-turn' && ['your', 'opponent'].includes(r.whose)) ||
      (r.type === 'n-times-per-turn' && typeof r.count === 'number')
  );
  const okDefender = trigger.defender == null || (Object.keys(trigger.defender).every((k) => DEFENDER_KEYS.has(k)) && (trigger.defender.filters ?? []).every(okFilter));
  // Who challenges ("whenever a damaged character challenges")
  const okAttacker = trigger.attacker == null || (Object.keys(trigger.attacker).every((k) => k === 'filters') && (trigger.attacker.filters ?? []).every(okFilter));
  const okContext = trigger.challengeContext == null || ['attacker', 'defender'].includes(trigger.challengeContext.role);
  const okWhen = trigger.condition == null || okCondition(trigger.condition);
  // Whose effect it was ("whenever you remove damage"), from what kind of card ("whenever one of your actions deals damage")
  const sf = trigger.sourceFilter;
  const okSource =
    sf == null ||
    (Object.keys(sf).every((k) => ['sourceController', 'cardType'].includes(k)) &&
      [undefined, 'you', 'opponent'].includes(sf.sourceController) &&
      (sf.cardType == null || [].concat(sf.cardType).every((t) => CARD_TYPES.includes(t))));
  return (
    okOn &&
    okRestrictions &&
    okDefender &&
    okAttacker &&
    okContext &&
    okWhen &&
    okSource &&
    Object.keys(trigger).every((k) => ['event', 'events', 'on', 'timing', 'restrictions', 'defender', 'attacker', 'challengeContext', 'condition', 'sourceFilter'].includes(k))
  );
};

/** Whether an event sets off a triggered ability of a card. */
export const triggerMatches = (game, inst, ability, payload, floating = false) => {
  const { trigger } = ability;
  const { on } = trigger;
  const sf = trigger.sourceFilter;
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
      (!on.name || subject.card.title === on.name) &&
      (!on.excludeSong || !subject.card.song) &&
      (!on.hasKeyword || (subject.zone === 'play' ? keywordOf(game, subject, on.hasKeyword) : (subject.card.keywords[on.hasKeyword] ?? 0)) > 0) &&
      (on.filters ?? []).every((f) => passes(game, { p: inst.owner, source: inst }, subject, f));
  }
  if (!hit) return false;
  // A card entering play sees its own entry only through "when you play this character"
  if (payload.event === 'play' && on !== 'SELF' && subject === inst) return false;
  // Only the card in play listens, except a card leaving play for its own "when banished" and an ability
  // that works from the discard; an ability that works from the discard only does not while the card is in play
  const zones = ability.sourceZones;
  if (!floating && inst.zone !== 'play' && !(on === 'SELF' && subject === inst) && !(inst.zone === 'discard' && zones?.includes('discard'))) return false;
  if (inst.zone === 'play' && zones && !zones.includes('play')) return false;
  const { defender, challengeContext } = trigger;
  if (defender) {
    const d = payload.defender;
    if (!d) return false;
    if (defender.controller && (defender.controller === 'opponent') === (d.owner === inst.owner)) return false;
    if (!(defender.filters ?? []).every((f) => passes(game, { p: inst.owner, source: inst }, d, f))) return false;
  }
  if (challengeContext && payload.role !== challengeContext.role) return false;
  if (trigger.attacker && !(trigger.attacker.filters ?? []).every((f) => passes(game, { p: inst.owner, source: inst }, subject, f))) return false;
  // A discard from the hand, unless the ability asks for cards put into the discard from the deck
  if (payload.event === 'discard' && !!payload.fromDeck !== !!trigger.restrictions?.some((r) => r.type === 'from-deck')) return false;
  if (trigger.condition && !holds(game, { p: inst.owner, source: inst, trigger: payload }, trigger.condition)) return false;
  if (sf?.sourceController && (payload.by === inst.owner) !== (sf.sourceController === 'you')) return false;
  if (sf?.cardType && !(payload.source?.card && [].concat(sf.cardType).includes(payload.source.card.kind))) return false;
  for (const r of trigger.restrictions ?? []) {
    if (r.type === 'defender-is-character' && payload.defender?.card.kind !== 'character') return false;
    if (r.type === 'in-challenge' && !payload.inChallenge) return false;
    if (r.type === 'during-turn' && (game.current === inst.owner) !== (r.whose === 'your')) return false;
    // "When you move a character here from another location", "whenever you return a card from your discard to your hand"
    if (r.type === 'from-location' && !payload.from) return false;
    if (r.type === 'to-hand' && payload.to !== 'hand') return false;
    // "Whenever one or more of your characters sings a song": once for the song
    if (r.type === 'once-per-song') {
      if (inst.songFired === payload.song?.id) return false;
      inst.songFired = payload.song?.id;
    }
  }
  return true;
};
