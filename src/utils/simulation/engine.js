import { LORE_TO_WIN, OPENING_HAND } from '../handStats.js';
import { triggerEvents } from './abilities.js';
import { chooseFromHand, valueOf } from './decisions.js';
import {
  applyingStatics,
  canPayAlternative,
  handReduction,
  matchesFilter,
  modHolds,
  moveReduction,
  payAlternative,
  playAllowed,
  replacementFor,
  resolveAbility,
  suppressedOf,
  triggerMatches,
} from './effects.js';

/**
 * Lorcana game engine for the simulations: two players, the steps of a turn, inking, Shift,
 * songs, drying, questing, challenges, the keywords and the card abilities the engine knows
 * (effects.js): triggered, activated, static and the effects of actions. The decisions belong to
 * the pilots (pilots.js, decisions.js). Pure functions (no browser APIs), so the MCP server can
 * share them.
 *
 * A card in play: { id, idx, owner, card, zone: 'play', damage, exerted, playedTurn, bonus,
 * shifted, mods, under, at } (idx: its index in deck.cards, bonus: Support strength this turn,
 * mods: the effects on it that last, { kind: 'stat'|'keyword'|'lose-keyword'|'restriction'|'grant',
 * ..., until }, under: the cards under it (Boost, the card it shifted onto), at: the location a
 * character is at).
 * A card leaving play keeps its object, zone 'discard' or 'hand': "that character" still finds it.
 * until: the turn at whose end an effect wears off (Infinity: while in play).
 */

export { LORE_TO_WIN };

// Turns of both players: a deck runs out of cards well before
const MAX_TURNS = 120;
// Triggers set off by triggers: a loop stops there
const MAX_CHAIN = 40;

export const KEYWORDS = ['Evasive', 'Bodyguard', 'Rush', 'Ward', 'Reckless', 'Support', 'Alert', 'Resist', 'Challenger', 'Vanish', 'Singer', 'Boost'];

/** Seeded random numbers (mulberry32): a game is replayed from its seed. The state is a plain object, copied by a lookahead. */
export const createRandom = (seed) => ({ a: seed >>> 0 });

export const random = (game) => {
  const r = game.rng;
  r.a = (r.a + 0x6d2b79f5) >>> 0;
  let t = r.a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Seed of the game number n of a run: games are replayed one by one, in any order. */
export const gameSeed = (seed, n) => (seed + Math.imul(n + 1, 0x9e3779b1)) >>> 0;

export const shuffleInPlace = (game, array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random(game) * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

/**
 * A line of the game's log: kind tells what it is ('ink', 'play', 'quest', 'challenge', 'effect'...),
 * cards the cards in play or played it is about, kept by id so a replay finds them on its board.
 */
export const say = (game, p, text, kind = null, cards = []) => {
  if (game.log) {
    game.log.push({ turn: game.turn, round: Math.ceil(game.turn / 2), player: p, text, kind, cards: cards.filter(Boolean).map((c) => c.id) });
  }
};

const end = (game, winner, reason) => {
  if (game.over) return;
  game.over = true;
  game.winner = winner;
  game.reason = reason;
  say(game, winner, reason === 'lore' ? `atteint ${game.players[winner].lore} lore et gagne` : "gagne : l'adversaire n'a plus de cartes à piocher", 'win');
};

export const cardOf = (game, p, idx) => game.players[p].deck.cards[idx];

/** Every card in play, the active player's first. */
export const inPlay = (game, p = null) => {
  const order = p == null ? [game.current, 1 - game.current] : [p];
  return order.flatMap((q) => [...game.players[q].characters, ...game.players[q].items, ...game.players[q].locations]);
};

const boardOf = (game, inst) => {
  const pl = game.players[inst.owner];
  return inst.card.kind === 'character' ? pl.characters : inst.card.kind === 'item' ? pl.items : pl.locations;
};

// ---------- What a card in play is, with the effects on it ----------

const STAT_FLOOR = { strength: 0, willpower: 0, lore: 0 };

/** Strength, willpower or lore of a card in play: printed, plus the effects on it and the static abilities in play. */
export const statOf = (game, inst, stat) => {
  let value = inst.card[stat] ?? 0;
  if (stat === 'strength') value += inst.bonus ?? 0;
  for (const mod of inst.mods) if (mod.kind === 'stat' && mod.stat === stat && modHolds(game, inst, mod)) value += mod.amount;
  for (const { effect, amount } of applyingStatics(game, inst, 'modify-stat')) if (effect.stat === stat) value += amount;
  // "Can't go below its printed strength"
  const floor = applyingStatics(game, inst, 'stat-floor').some(({ effect }) => effect.stat === stat) ? (inst.card[stat] ?? 0) : 0;
  return Math.max(STAT_FLOOR[stat] ?? 0, floor, value);
};

/** Value of a keyword on a card in play (Resist +2: 2, Evasive: 1, missing: 0). */
export const keywordOf = (game, inst, keyword) => {
  let value = inst.card.keywords[keyword] ?? 0;
  let lost = false;
  for (const mod of inst.mods) {
    if (mod.kind === 'keyword' && mod.keyword === keyword && modHolds(game, inst, mod)) value += mod.value ?? 1;
    if (mod.kind === 'lose-keyword' && mod.keyword === keyword) lost = true;
  }
  for (const { effect, amount } of applyingStatics(game, inst, 'gain-keyword')) {
    if (effect.keyword === keyword) value += amount;
  }
  if (applyingStatics(game, inst, 'lose-keyword').some(({ effect }) => effect.keyword === keyword)) lost = true;
  return lost ? 0 : value;
};

const COVERS = {
  'cant-quest': ['cant-quest', 'cant-quest-or-challenge'],
  'cant-challenge': ['cant-challenge', 'cant-quest-or-challenge'],
  'cant-ready': ['cant-ready'],
  'cant-be-challenged': ['cant-be-challenged'],
};

// An effect "while this item is in play" ends with its card
const lasting = (m) => !m.linked || m.linked.zone === 'play';

/**
 * Whether an effect stops a card in play: 'cant-quest', 'cant-challenge', 'cant-ready',
 * 'cant-be-challenged'. attacker: the character that would challenge it ("can't be challenged by
 * characters with cost 2 or less"). A restriction lifted by paying ink is a cost (bypassCost).
 */
export const isRestricted = (game, inst, restriction, attacker = null) => {
  const names = COVERS[restriction] ?? [restriction];
  if (inst.mods.some((m) => m.kind === 'restriction' && names.includes(m.restriction) && lasting(m) && modHolds(game, inst, m))) return true;
  return applyingStatics(game, inst, 'restriction').some(
    ({ effect, src }) =>
      names.includes(effect.restriction) &&
      !effect.bypass &&
      (!effect.challengerFilter || (attacker && matchesFilter(game, { p: src.owner, source: src }, attacker, effect.challengerFilter)))
  );
};

/** Ink a character pays to quest or challenge anyway ("can't quest or challenge unless you pay 1 {I}"). */
export const bypassCost = (game, inst, restriction) => {
  if (!listenersOf(game).bypass) return 0;
  const names = COVERS[restriction] ?? [restriction];
  return applyingStatics(game, inst, 'restriction').reduce((s, { effect }) => s + (effect.bypass && names.includes(effect.restriction) ? effect.bypass.cost.ink : 0), 0);
};

/**
 * The restrictions on a player for one kind ('cant-play-actions', 'challenge-limit'...): effects
 * on them and static abilities, each { restriction, minCost?, limit? }.
 */
const playerRestrictions = (game, p, restriction) => [
  ...game.players[p].effects.filter((e) => e.kind === 'restriction' && e.restriction === restriction),
  ...applyingStatics(game, { owner: p, player: true }, 'restriction')
    .map(({ effect }) => effect)
    .filter((e) => e.restriction === restriction),
];

/** Whether a player is stopped from something this turn; card: the card they would play ("actions with cost 4 or more"). */
export const playerRestricted = (game, p, restriction, card = null) =>
  playerRestrictions(game, p, restriction).some((e) => !card || e.minCost == null || card.cost >= e.minCost);

/** Challenges a player may still make this turn ("each player can challenge once a turn"). */
const challengesLeft = (game, p) =>
  Math.min(Infinity, ...playerRestrictions(game, p, 'challenge-limit').map((e) => e.limit)) - game.players[p].turnStats.challenges;

/** Whether an effect granted a card in play an ability: 'can-challenge-ready', 'takes-no-damage-from-challenges'. */
export const grantsOf = (game, inst) => [
  ...inst.mods.filter((m) => m.kind === 'grant'),
  ...applyingStatics(game, inst, 'grant-ability').map(({ effect }) =>
    typeof effect.ability === 'string'
      ? { ability: effect.ability }
      : { ability: effect.ability.type, classification: effect.ability.classification, onlyDamaged: effect.ability.onlyDamaged }
  ),
];

export const hasGrant = (game, inst, ability) => grantsOf(game, inst).some((g) => g.ability === ability);

// Without the abilities a static ability takes away ("lose the Stone by Day ability")
const keep = (game, inst, list) => {
  const lost = suppressedOf(game, inst);
  return lost.length ? list.filter((a) => !lost.includes(a.name?.toUpperCase())) : list;
};

/** The triggered abilities of a card for an event: printed, granted by an effect or by a static ability. */
export const triggeredOf = (game, inst, event) => {
  const printed = inst.card.abilities?.triggered[event] ?? NONE;
  const granted = inst.mods.some((m) => m.kind === 'ability')
    ? inst.mods.filter((m) => m.kind === 'ability' && m.ability.type === 'triggered' && triggerEvents(m.ability.trigger).includes(event) && lasting(m)).map((m) => m.ability)
    : NONE;
  const statics =
    inst.zone === 'play' && listenersOf(game).grantsTriggers
      ? applyingStatics(game, inst, 'grant-ability')
          .map(({ effect }) => effect.ability)
          .filter((a) => a.type === 'triggered' && triggerEvents(a.trigger).includes(event))
      : NONE;
  return keep(game, inst, granted.length || statics.length ? [...printed, ...granted, ...statics] : printed);
};

/** The activated abilities a card in play can use: printed, granted by an effect, a static ability or the location it is at. */
export const activatedOf = (game, inst) => {
  const printed = inst.card.abilities?.activated ?? NONE;
  const granted = inst.mods.filter((m) => m.kind === 'ability' && m.ability.type === 'activated').map((m) => m.ability);
  const here = applyingStatics(game, inst, 'grant-abilities-while-here').flatMap(({ effect }) => effect.abilities);
  const statics = applyingStatics(game, inst, 'grant-ability')
    .map(({ effect }) => effect.ability)
    .filter((a) => a.type === 'activated');
  return keep(game, inst, granted.length || here.length || statics.length ? [...printed, ...granted, ...here, ...statics] : printed);
};

const NONE = [];

/** Dry since the start of the turn: played on an earlier turn. */
const isDry = (game, inst) => inst.playedTurn < game.turn;

export const canQuest = (game, inst) =>
  inst.card.kind === 'character' &&
  !inst.exerted &&
  (isDry(game, inst) || isRestricted(game, inst, 'can-quest-turn-played')) &&
  !keywordOf(game, inst, 'Reckless') &&
  !isRestricted(game, inst, 'cant-quest') &&
  bypassCost(game, inst, 'cant-quest') <= game.players[inst.owner].ink;

export const canChallenge = (game, inst) =>
  inst.card.kind === 'character' &&
  !inst.exerted &&
  (isDry(game, inst) || keywordOf(game, inst, 'Rush') > 0) &&
  !isRestricted(game, inst, 'cant-challenge') &&
  bypassCost(game, inst, 'cant-challenge') <= game.players[inst.owner].ink &&
  challengesLeft(game, inst.owner) > 0;

/** Strength a character deals, Challenger counted while it challenges. */
export const strengthOf = (game, inst, challenging = false) =>
  statOf(game, inst, 'strength') + (challenging ? keywordOf(game, inst, 'Challenger') : 0);

/** Damage a character deals in a challenge: its strength, or its willpower when an ability says so, Challenger counted when it attacks. */
const challengeDamageOf = (game, inst, attacking) =>
  applyingStatics(game, inst, 'damage-source-stat-override').length
    ? statOf(game, inst, 'willpower') + (attacking ? keywordOf(game, inst, 'Challenger') : 0)
    : strengthOf(game, inst, attacking);

/**
 * What an attacker may challenge: the opponent's exerted characters it can reach (Evasive asks
 * for Evasive or Alert), only the ones with Bodyguard when there are some, and their locations.
 */
export const challengeTargets = (game, p, attacker) => {
  const opp = game.players[1 - p];
  const reaches = keywordOf(game, attacker, 'Evasive') > 0 || keywordOf(game, attacker, 'Alert') > 0;
  // "Can challenge ready characters", sometimes of a classification only
  const readyToo = grantsOf(game, attacker).filter((g) => g.ability === 'can-challenge-ready');
  const reachable = opp.characters.filter(
    (c) =>
      (c.exerted || readyToo.some((m) => (!m.classification || c.card.classifications.includes(m.classification)) && (!m.onlyDamaged || c.damage > 0))) &&
      (reaches || !keywordOf(game, c, 'Evasive')) &&
      !isRestricted(game, c, 'cant-be-challenged', attacker)
  );
  const bodyguards = reachable.filter((c) => keywordOf(game, c, 'Bodyguard') > 0);
  return [...(bodyguards.length ? bodyguards : reachable), ...opp.locations.filter((l) => !isRestricted(game, l, 'cant-be-challenged', attacker))];
};

// ---------- Moving cards ----------

/** Lore a player needs to win: 20, or more when an ability says so ("opponents need 25 lore to win the game"). */
export const loreToWin = (game, p) =>
  Math.max(LORE_TO_WIN, ...applyingStatics(game, { owner: p, player: true }, 'win-condition-modification').map(({ effect }) => effect.loreRequired));

export const gainLore = (game, p, lore) => {
  if (lore <= 0 || game.over || playerRestricted(game, p, 'cant-gain-lore')) return;
  game.players[p].lore += lore;
  if (game.players[p].lore >= loreToWin(game, p)) end(game, p, 'lore');
};

/** Lore a player loses, unless an ability of theirs prevents it. Returns the lore lost. */
export const loseLore = (game, p, lore) => {
  const me = game.players[p];
  if (lore <= 0 || replacementFor(game, 'lose-lore', { owner: p, player: true })) return 0;
  const lost = Math.min(lore, me.lore);
  me.lore -= lost;
  return lost;
};

/**
 * Pays ink: the ready ink first, then the ink drops ("each ink drop may be removed to pay 1 {I}").
 * me.ink counts both; me.drops the drops not removed yet.
 */
export const payInk = (game, p, n) => {
  const me = game.players[p];
  if (n <= 0) return;
  me.ink -= n;
  if (me.ink < me.drops) {
    const removed = me.drops - Math.max(0, me.ink);
    me.drops -= removed;
    emit(game, 'ink-drop-removed', { p, subject: null, amount: removed });
  }
};

/** A player gets ink drops: ink they may spend once, this turn or later. */
export const gainInkDrops = (game, p, n) => {
  const me = game.players[p];
  me.turnStats.dropsGained += n;
  // An inkwell card is ink for good: taken instead while the deck has cards to spare
  if (replacementFor(game, 'gain-ink-drop', { owner: p, player: true }) && me.library.length > n + 5) {
    for (let i = 0; i < n; i++) addToInkwell(game, p, me.library.shift());
    return;
  }
  me.drops += n;
  me.ink += n;
};

/** Draws n cards; a player who must draw from an empty deck loses at their next draw step only. */
export const drawCards = (game, p, n = 1, { bottom = false } = {}) => {
  const me = game.players[p];
  let drawn = 0;
  for (let i = 0; i < n && me.library.length; i++, drawn++) {
    const idx = bottom ? me.library.pop() : me.library.shift();
    me.hand.push(idx);
    if (me.seen) me.seen[idx] = 1;
  }
  me.turnStats.drawn += drawn;
  if (drawn) emit(game, 'draw', { p, subject: null, amount: drawn });
  return drawn;
};

/** A card of a discard as a card object: what a "when you discard this card" or "play that character" reads. */
export const discardRef = (game, p, idx) => ({ id: nextId++, idx, owner: p, card: cardOf(game, p, idx), zone: 'discard', damage: 0, exerted: false, mods: [], under: [] });

/** A card of the hand (by position) to the discard, then what discarding it sets off. */
export const discardFromHand = (game, p, pos) => {
  const me = game.players[p];
  const [idx] = me.hand.splice(pos, 1);
  me.discard.push(idx);
  me.turnStats.discarded++;
  me.turnStats.discardedFromHand++;
  emit(game, 'discard', { p, subject: discardRef(game, p, idx) });
  return idx;
};

/** Takes the card at a position of a player's discard; to: where it goes ('hand', 'play', 'inkwell', 'deck', 'under'). */
export const takeFromDiscard = (game, p, pos, to = null) => {
  const me = game.players[p];
  const [idx] = me.discard.splice(pos, 1);
  me.turnStats.leftDiscard++;
  emit(game, 'leave-discard', { p, subject: { ...discardRef(game, p, idx), zone: to ?? 'gone' }, to });
  return idx;
};

const removeFromPlay = (game, inst) => {
  const board = boardOf(game, inst);
  const i = board.indexOf(inst);
  if (i < 0) return false;
  // What it was in play, for "the {S} he had in play"
  inst.last = { strength: statOf(game, inst, 'strength'), willpower: statOf(game, inst, 'willpower'), lore: statOf(game, inst, 'lore') };
  board.splice(i, 1);
  game.boardVersion++;
  // The cards under it go to the discard; a location leaving play lets its characters go
  const owner = game.players[inst.owner];
  inst.underBefore = inst.under?.length ?? 0;
  inst.underCards = inst.under?.slice() ?? [];
  if (inst.under?.length) {
    owner.discard.push(...inst.under);
    inst.under = [];
  }
  inst.at = null;
  if (inst.card.kind === 'location') for (const c of owner.characters) if (c.at === inst) c.at = null;
  return true;
};

/** Puts a card under a card in play (Boost, an effect), then what it sets off. */
export const putUnder = (game, inst, idx) => {
  inst.under.push(idx);
  inst.underTurn = game.turn;
  game.players[inst.owner].turnStats.putUnder++;
  emit(game, 'put-card-under', { p: inst.owner, subject: inst });
};

/** Takes a card out of play, out of its owner's discard (a banished "that character") or inkwell. to: where it goes. */
const takeCard = (game, inst, to = null) => {
  if (inst.zone === 'play') {
    if (!removeFromPlay(game, inst)) return false;
    inst.left = true;
    return true;
  }
  if (inst.zone === 'discard') {
    const i = game.players[inst.owner].discard.lastIndexOf(inst.idx);
    if (i < 0) return false;
    takeFromDiscard(game, inst.owner, i, to);
    return true;
  }
  if (inst.zone === 'inkwell') return takeFromInkwell(game, inst.owner, game.players[inst.owner].inkCards.indexOf(inst.idx)) != null;
  return false;
};

/**
 * A card in play is banished: to its owner's discard, then the abilities it sets off. An ability
 * may send it elsewhere instead ("put them into your inkwell instead"): it is not banished then.
 */
export const banish = (game, inst, { inChallenge = false, by = null } = {}) => {
  if (inst.zone !== 'play') return false;
  if (replacementFor(game, 'banish-self', inst)) {
    say(game, inst.owner, `${inst.card.name} va dans l'encrier au lieu d'être banni`, 'effect', [inst]);
    putIntoInkwell(game, inst, { exerted: true });
    return false;
  }
  if (!removeFromPlay(game, inst)) return false;
  inst.zone = 'discard';
  const owner = game.players[inst.owner];
  owner.discard.push(inst.idx);
  owner.turnStats.discarded++;
  if (inChallenge) owner.turnStats.banishedInChallenge++;
  if (inst.card.kind === 'character') owner.turnStats.banished.push(inst.card);
  emit(game, 'banish', { p: inst.owner, subject: inst, inChallenge, by });
  emit(game, 'leave-play', { p: inst.owner, subject: inst });
  return true;
};

/** A card that just left play other than banished sets off its "when this leaves play". */
const leftPlay = (game, inst) => {
  if (!inst.left) return;
  inst.left = false;
  emit(game, 'leave-play', { p: inst.owner, subject: inst });
};

/** A card in play or in the discard goes back to its owner's hand. */
export const returnToHand = (game, inst) => {
  const fromPlay = inst.zone === 'play';
  if (!takeCard(game, inst, 'hand')) return false;
  inst.zone = 'hand';
  game.players[inst.owner].hand.push(inst.idx);
  leftPlay(game, inst);
  if (fromPlay) emit(game, 'return-to-hand', { p: inst.owner, subject: inst });
  return true;
};

/** A card in play to the top or the bottom of its owner's deck, or shuffled into it. */
export const putIntoDeck = (game, inst, where) => {
  if (!takeCard(game, inst)) return false;
  inst.zone = 'deck';
  const library = game.players[inst.owner].library;
  if (where === 'top') library.unshift(inst.idx);
  else library.push(inst.idx);
  if (where === 'shuffle') shuffleInPlace(game, library);
  leftPlay(game, inst);
  return true;
};

/** A card in play goes under another card in play ("put this character facedown under one of your characters"). */
export const moveUnder = (game, inst, onto) => {
  if (inst.zone !== 'play' || !takeCard(game, inst)) return false;
  inst.zone = 'under';
  leftPlay(game, inst);
  putUnder(game, onto, inst.idx);
  return true;
};

/** A card goes into a player's inkwell, ready (adds ink this turn) or exerted, then what that sets off. */
export const addToInkwell = (game, p, idx, { exerted = true } = {}) => {
  const me = game.players[p];
  me.inkwell++;
  me.inkCards.push(idx);
  if (!exerted) me.ink++;
  me.turnStats.inked++;
  emit(game, 'ink', { p, subject: null });
};

/** Takes the card at a position of a player's inkwell (to the hand, into play): one ink less. */
export const takeFromInkwell = (game, p, pos) => {
  const me = game.players[p];
  if (pos < 0 || pos >= me.inkCards.length) return null;
  const [idx] = me.inkCards.splice(pos, 1);
  me.inkwell--;
  me.ink = Math.min(me.ink, me.inkwell + me.drops);
  return idx;
};

/** A card in play to its owner's inkwell, ready (adds ink this turn) or exerted. */
export const putIntoInkwell = (game, inst, { exerted = true } = {}) => {
  if (!takeCard(game, inst)) return false;
  inst.zone = 'inkwell';
  leftPlay(game, inst);
  addToInkwell(game, inst.owner, inst.idx, { exerted });
  return true;
};

/**
 * Damage dealt to a card is prevented: by a shield on it (used up; challenge damage only unless
 * all), or by an ability ("the first time she would take damage, she takes no damage instead").
 * peek: only tells, uses nothing up.
 */
const prevented = (game, inst, inChallenge, peek = false) => {
  const shield = inst.mods.findIndex((m) => m.kind === 'shield' && (inChallenge || m.all));
  if (shield >= 0) {
    if (!peek) inst.mods.splice(shield, 1);
    return true;
  }
  return !!replacementFor(game, 'damage-to-self', inst, peek);
};

/** Banishes a character or location whose damage reached its willpower. */
export const checkBanish = (game, inst, opts = {}) => {
  if (inst.zone === 'play' && inst.card.kind !== 'item' && inst.damage >= statOf(game, inst, 'willpower')) banish(game, inst, opts);
};

/** Tells who dealt damage and who took it: "whenever this character deals damage", "whenever an opposing character is damaged". */
const damageDealt = (game, inst, amount, source, inChallenge, defender = null) => {
  if (source) emit(game, 'deal-damage', { p: source.owner, subject: source, target: inst, defender, amount, inChallenge });
  emit(game, 'damage', { p: inst.owner, subject: inst, amount, source, by: source?.owner ?? null, inChallenge });
};

/**
 * Damage on a card in play: dealt (Resist lowers it) or put (counters, Resist does not apply).
 * Banishes it at its willpower, unless deferred (the effect checks once it is done). by: the card
 * dealing it. Returns the damage that landed.
 */
export const damageCard = (game, inst, amount, { put = false, inChallenge = false, by = null, ignoreResist = false, defer = false } = {}) => {
  if (inst.zone !== 'play' || amount <= 0) return 0;
  const landed = put || ignoreResist ? amount : Math.max(0, amount - keywordOf(game, inst, 'Resist'));
  if (!landed || (!put && (isRestricted(game, inst, 'cant-be-dealt-damage') || prevented(game, inst, false)))) return 0;
  // "Whenever one of your other characters would be dealt damage, put that many damage counters on this character instead"
  const redirect = put ? null : replacementFor(game, 'damage-to-character', inst);
  if (redirect) {
    damageCard(game, redirect.src, landed, { put: true });
    return 0;
  }
  inst.damage += landed;
  game.players[inst.owner].turnStats.damaged++;
  if (!defer) checkBanish(game, inst, { inChallenge, by });
  if (!put) damageDealt(game, inst, landed, by, inChallenge);
  return landed;
};

/** Adds a lasting effect on a card in play. */
export const addMod = (inst, mod) => {
  if (inst.zone === 'play') inst.mods.push(mod);
};

// ---------- Abilities ----------

/**
 * The cards in play with abilities, by kind of static effect, by event and by kind of replacement:
 * { statics: { type: [card] }, triggers: { event: [card] }, replacements: { replaces: [card] },
 * grantsTriggers, bypass }. A static ability granting a triggered ability ("gains 'Whenever...'") makes
 * every card in play listen to its event. Rebuilt only when a card enters or leaves play.
 */
export const listenersOf = (game) => {
  if (game.listeners?.version === game.boardVersion) return game.listeners;
  const statics = {};
  const triggers = {};
  const replacements = {};
  const add = (map, key, src) => {
    if (!map[key]?.includes(src)) (map[key] ??= []).push(src);
  };
  const granted = new Set();
  // A restriction lifted by paying ink is in play
  let bypass = false;
  for (const pl of game.players) {
    for (const list of [pl.characters, pl.items, pl.locations]) {
      for (const src of list) {
        const abilities = src.card.abilities;
        for (const m of src.mods) {
          if (m.kind === 'ability' && m.ability.type === 'triggered') for (const event of triggerEvents(m.ability.trigger)) add(triggers, event, src);
        }
        if (!abilities) continue;
        for (const a of abilities.statics) {
          add(statics, a.effect.type, src);
          if (a.effect.bypass) bypass = true;
          if (a.effect.type === 'grant-ability' && a.effect.ability?.type === 'triggered') for (const event of triggerEvents(a.effect.ability.trigger)) granted.add(event);
        }
        for (const event of Object.keys(abilities.triggered)) add(triggers, event, src);
        for (const a of abilities.replacements ?? NONE) add(replacements, a.replaces, src);
      }
    }
  }
  for (const event of granted) for (const src of inPlay(game)) add(triggers, event, src);
  game.listeners = { version: game.boardVersion, statics, triggers, replacements, grantsTriggers: granted.size > 0, bypass };
  return game.listeners;
};

/**
 * Sets off the triggered abilities listening to an event, the active player's first, each
 * resolved at once (no bag). payload: { p: the player it happens to, subject: the card, ... }.
 */
export const emit = (game, event, payload) => {
  if (game.over || game.chain > MAX_CHAIN) return;
  payload.event = event;
  const listening = listenersOf(game).triggers[event];
  const leaving = payload.subject?.zone && payload.subject.zone !== 'play' && payload.subject.card?.abilities && triggeredOf(game, payload.subject, event).length;
  const floating = game.players.flatMap((pl) => pl.effects.filter((e) => e.kind === 'trigger' && triggerEvents(e.ability.trigger).includes(event)));
  // A card in a discard with an ability that works from there ("at the start of your turn, if this card is in your discard")
  const discarded =
    game.players[0].deck.fromDiscard?.[event] || game.players[1].deck.fromDiscard?.[event]
      ? [game.current, 1 - game.current].flatMap((q) => {
          const listed = game.players[q].deck.fromDiscard?.[event];
          return listed
            ? [...new Set(game.players[q].discard)]
                .filter((idx) => listed.includes(idx) && !(leaving && payload.subject.idx === idx && payload.subject.owner === q))
                .map((idx) => discardRef(game, q, idx))
            : NONE;
        })
      : NONE;
  if (!listening && !leaving && !floating.length && !discarded.length) return;
  // The active player's abilities first; a card leaving play still sets off its own "when this character is banished"
  const sources = (listening ?? []).filter((s) => s.owner === game.current).concat((listening ?? []).filter((s) => s.owner !== game.current));
  if (leaving) sources.push(payload.subject);
  sources.push(...discarded);
  const fired = [];
  for (const inst of sources) {
    for (const ability of triggeredOf(game, inst, event)) {
      if (!triggerMatches(game, inst, ability, payload)) continue;
      // "Once during your turn", "twice during your turn": the abilities fired this turn are kept on the card
      const times = ability.trigger.restrictions?.reduce(
        (n, r) => (r.type === 'once-per-turn' || r.type === 'first-time-each-turn' ? 1 : r.type === 'n-times-per-turn' ? r.count : n),
        Infinity
      );
      if (times < Infinity) {
        if (inst.fired?.turn !== game.turn) inst.fired = { turn: game.turn, list: [] };
        if (inst.fired.list.filter((a) => a === ability).length >= times) continue;
        inst.fired.list.push(ability);
      }
      fired.push({ inst, ability });
    }
  }
  // Abilities an effect created for the turn, still there once their card has left
  for (const f of floating) if (triggerMatches(game, f.source, f.ability, payload, true)) fired.push({ inst: f.source, ability: f.ability, carried: f.targets });
  if (!fired.length) return;
  game.chain++;
  for (const { inst, ability, carried } of fired) {
    if (game.over) break;
    // "The next time they challenge this turn": an ability granted for once
    const once = inst.mods?.findIndex((m) => m.kind === 'ability' && m.ability === ability && m.once) ?? -1;
    if (once >= 0) {
      inst.mods.splice(once, 1);
      game.boardVersion++;
    }
    resolveAbility(game, { p: inst.owner, source: inst, ability, trigger: payload, carried });
  }
  game.chain--;
};

let nextId = 1;

/**
 * A card enters play (paid or not): its board, "enters exerted" effects, its play triggers.
 * singers: the characters who sang a song ("if 2 or more characters sang this song"); paidWithDrop:
 * an ink drop was removed to pay for it.
 */
export const enterPlay = (game, p, idx, { exerted = false, base = null, cost = null, afterPlay = null, singers = null, paidWithDrop = false } = {}) => {
  const me = game.players[p];
  const card = cardOf(game, p, idx);
  if (card.kind === 'action') {
    me.discard.push(idx);
    me.turnStats.discarded++;
    me.turnStats.actions++;
    const ref = { id: nextId++, idx, owner: p, card, zone: 'discard', damage: 0, exerted: false, mods: [], under: [], paidWithDrop };
    me.turnStats.played.push(ref);
    say(game, p, `joue ${card.name}${cost != null ? ` (${cost})` : ''}`, 'play', [ref]);
    if (card.abilities?.action) resolveAbility(game, { p, source: ref, ability: card.abilities.action, singers: singers ?? [] });
    if (afterPlay === 'bottom-of-deck' && me.discard.lastIndexOf(idx) >= 0) {
      me.discard.splice(me.discard.lastIndexOf(idx), 1);
      me.library.push(idx);
    }
    emit(game, 'play', { p, subject: ref });
    return ref;
  }
  let inst;
  if (base) {
    // Shift: the new card keeps the base's damage, readiness, dryness and the effects on it
    inst = { ...base, idx, card, shifted: true, mods: base.mods.slice(), under: [...base.under, base.idx], paidWithDrop };
    me.characters.splice(me.characters.indexOf(base), 1, inst);
    game.boardVersion++;
    base.zone = 'under';
    say(game, p, `joue ${card.name} avec Alter sur ${base.card.name}${cost != null ? ` (${cost})` : ''}`, 'play', [inst]);
  } else {
    const entersExerted = exerted || isEnteringExerted(game, p, card);
    inst = {
      id: nextId++,
      idx,
      owner: p,
      card,
      zone: 'play',
      damage: 0,
      exerted: entersExerted,
      playedTurn: game.turn,
      bonus: 0,
      shifted: false,
      mods: [],
      under: [],
      at: null,
      paidWithDrop,
    };
    inst.damage = enteringDamage(game, inst);
    boardOf(game, inst).push(inst);
    game.boardVersion++;
    const kind = card.kind === 'location' ? 'le lieu ' : card.kind === 'item' ? "l'objet " : '';
    say(game, p, `joue ${kind}${card.name}${cost != null ? ` (${cost})` : ''}${entersExerted ? ', épuisé' : ''}`, 'play', [inst]);
  }
  me.turnStats.played.push(inst);
  emit(game, 'play', { p, subject: inst, shifted: !!base });
  return inst;
};

const isEnteringExerted = (game, p, card) =>
  inPlay(game).some((src) =>
    (src.card.abilities?.statics ?? []).some(
      (a) => a.effect.type === 'restriction' && a.effect.restriction === 'enters-play-exerted' && staticTargetsCard(game, src, a, p, card)
    )
  );

const staticTargetsCard = (game, src, ability, p, card) => {
  const probe = { id: -1, owner: p, card, zone: 'play', damage: 0, exerted: false, mods: [], probe: true };
  return applyingStatics(game, probe, 'restriction', [src]).some(({ effect }) => effect === ability.effect);
};

// Its own "enters play with damage", and the abilities in play that put some on it ("opposing characters with Singer enter play with 1 damage")
const enteringDamage = (game, inst) =>
  (inst.card.abilities?.statics ?? []).filter((a) => a.effect.type === 'enters-with-damage' && !a.effect.target).reduce((s, a) => s + a.effect.amount, 0) +
  applyingStatics(game, { ...inst, probe: true }, 'enters-with-damage').reduce((s, { effect }) => s + effect.amount, 0);

/**
 * Ink a card costs to play: printed (or its Shift cost), less the reductions in effect. base: the
 * character it shifts onto ("you pay 1 {I} less to shift a character on top of this character").
 */
export const costOf = (game, p, card, { shift = false, base = null } = {}) => {
  let cost = (shift ? card.shift.cost : card.cost) - handReduction(game, p, card, shift);
  if (shift && (card.shift.discard || card.shift.drops)) return 0;
  for (const e of game.players[p].effects) if (e.kind === 'cost-reduction' && reductionApplies(e, card, shift)) cost -= e.amount;
  for (const { effect, amount } of applyingStatics(game, { owner: p, player: true }, 'cost-reduction')) {
    if (reductionApplies(effect, card, shift)) cost -= amount;
  }
  if (base) for (const { effect, amount } of applyingStatics(game, base, 'cost-reduction', [base])) if (reductionApplies(effect, card, shift)) cost -= amount;
  // "Each player pays 2 {I} more to play actions or items"
  for (const { effect } of applyingStatics(game, { owner: p, player: true }, 'cost-increase')) if (reductionApplies(effect, card, shift)) cost += effect.amount;
  return Math.max(0, cost);
};

const reductionApplies = (e, card, shift = false) =>
  (!e.cardType || [].concat(e.cardType).some((t) => t === card.kind || (t === 'song' && card.song))) &&
  (!e.classification || [].concat(e.classification).some((c) => card.classifications.includes(c))) &&
  (!e.cardName || e.cardName === card.title) &&
  (!e.playMethod || (e.playMethod === 'shift') === shift);

/** The "next card you play this turn costs less" effects a card just used up. */
const spendReductions = (game, p, card, shift) => {
  const me = game.players[p];
  me.effects = me.effects.filter((e) => !(e.kind === 'cost-reduction' && e.once && reductionApplies(e, card, shift)));
};

/** Whether the player may play this card at all (restrictions, "you can't play this unless...", not ink). */
export const mayPlay = (game, p, card) =>
  !(card.kind === 'action' && playerRestricted(game, p, 'cant-play-actions', card)) &&
  !(card.kind === 'item' && playerRestricted(game, p, 'cant-play-items', card)) &&
  playAllowed(game, p, card);

/**
 * Cards a player may play from elsewhere than the hand: from the discard ("you may play
 * characters from your discard", "you may play it from your discard"), from under a card ("you
 * may play characters from under this item"). Each { zone, pos, card, exerted }: zone is the
 * array holding it.
 */
export const playableElsewhere = (game, p) => {
  const me = game.players[p];
  const out = [];
  const from = (zone, fits, exerted = false) => {
    zone.forEach((idx, pos) => {
      const card = cardOf(game, p, idx);
      if (fits(card, idx) && !out.some((o) => o.zone === zone && zone[o.pos] === idx)) out.push({ zone, pos, card, exerted });
    });
  };
  for (const e of me.effects) {
    // One card ("you may play it from your discard"), or a type ("you may play characters from your discard"), names not played yet this turn
    if (e.kind === 'play-from-discard') {
      from(
        me.discard,
        (card, idx) =>
          e.idx != null
            ? idx === e.idx
            : (!e.cardType || card.kind === e.cardType) && !(e.uniqueByName && me.turnStats.played.some((x) => x.card.title === card.title)),
        !!e.exerted
      );
    }
    if (e.kind === 'play-from-under' && e.source.zone === 'play') from(e.source.under, (card) => !e.cardType || card.kind === e.cardType);
  }
  for (const { effect, src } of applyingStatics(game, { owner: p, player: true }, 'play-from-discard')) {
    if (!effect.whileSourceExerted || src.exerted) from(me.discard, (card) => !effect.cardType || card.kind === effect.cardType, !!effect.entersExerted);
  }
  return out;
};

// ---------- The player's actions ----------

// A card of a type a Shift asks to discard ("Shift: Discard a song card")
const ofType = (card, type) => !type || (type === 'song' ? card.song : card.kind === type);

/** Whether a player can pay what a Shift asks besides ink: cards to discard (the one played aside), ink drops to remove. */
export const canPayShift = (game, p, card, pos = -1) => {
  const me = game.players[p];
  const { discard, drops } = card.shift;
  if (drops && me.drops < drops) return false;
  return !discard || me.hand.filter((idx, i) => i !== pos && ofType(cardOf(game, p, idx), discard.type)).length >= discard.count;
};

const payShift = (game, p, card) => {
  const me = game.players[p];
  const { discard, drops } = card.shift;
  if (drops) {
    me.drops -= drops;
    me.ink -= drops;
    emit(game, 'ink-drop-removed', { p, subject: null, amount: drops });
  }
  if (discard) {
    const positions = me.hand.map((_, pos) => pos).filter((pos) => ofType(cardOf(game, p, me.hand[pos]), discard.type));
    for (const pos of chooseFromHand(game, p, p, positions, discard.count, 'discard').sort((a, b) => b - a)) discardFromHand(game, p, pos);
  }
};

/** Whether a card can go into its player's inkwell: printed, or "all cards in your hand count as having {IW}". */
export const isInkable = (game, p, card, fromHand = true) =>
  card.inkwell || (fromHand && applyingStatics(game, { owner: p, player: true }, 'grant-hand-inkability').length > 0);

/** Whether a player may ink cards from their discard ("you can ink cards from your discard"). */
export const inksFromDiscard = (game, p) => applyingStatics(game, { owner: p, player: true }, 'grant-discard-inkability').length > 0;

/** Cards a player may still ink this turn: one, more with "you may put an additional card into your inkwell". */
export const inksLeft = (game, p) => {
  const me = game.players[p];
  const more =
    applyingStatics(game, { owner: p, player: true }, 'additional-inkwell').reduce((s, { effect }) => s + (effect.amount ?? 1), 0) +
    me.effects.reduce((s, e) => s + (e.kind === 'additional-inkwell' ? e.amount : 0), 0);
  return 1 + more - me.inkedThisTurn;
};

/** Puts the card at position pos of the hand (or of the discard) into the inkwell: once a turn, inkable cards only. */
export const inkCard = (game, p, pos, { discard = false } = {}) => {
  const me = game.players[p];
  const zone = discard ? me.discard : me.hand;
  const card = cardOf(game, p, zone[pos]);
  if (inksLeft(game, p) <= 0 || !isInkable(game, p, card, !discard) || (discard && !inksFromDiscard(game, p))) return false;
  const idx = discard ? takeFromDiscard(game, p, pos, 'inkwell') : me.hand.splice(pos, 1)[0];
  me.inkedThisTurn++;
  say(game, p, `encre ${card.name}${discard ? ' depuis la défausse' : ''}`, 'ink');
  addToInkwell(game, p, idx, { exerted: false });
  return true;
};

/**
 * Plays the card at position pos of the hand. base: a character in play to Shift onto (the new
 * one keeps its damage, readiness and dryness); exerted: a Bodyguard entering exerted; singers:
 * the characters exerted to sing a song instead of paying; zone: where the card is, when not in
 * the hand (playableElsewhere); alt: an alternative cost paid instead of ink ("put a Toy character
 * card from your discard on the bottom of your deck to play this character for free").
 */
export const playCard = (game, p, pos, { base = null, exerted = false, singers = null, zone = null, alt = null } = {}) => {
  const me = game.players[p];
  const from = zone ?? me.hand;
  const idx = from[pos];
  const card = cardOf(game, p, idx);
  if (idx == null || !mayPlay(game, p, card)) return false;
  if (card.kind === 'action' && !card.abilities?.action) return false;
  let cost = 0;
  if (base && !canPayShift(game, p, card, from === me.hand ? pos : -1)) return false;
  if (singers) {
    if (!card.song || !canSing(game, card, singers)) return false;
  } else if (alt) {
    if (!canPayAlternative(game, p, card, alt)) return false;
  } else {
    cost = costOf(game, p, card, { shift: !!base, base });
    if (cost > me.ink) return false;
  }
  const drops = me.drops;
  payInk(game, p, cost);
  if (from === me.discard) takeFromDiscard(game, p, pos);
  else from.splice(pos, 1);
  spendReductions(game, p, card, !!base);
  if (base) payShift(game, p, card);
  if (alt) payAlternative(game, p, card, alt);
  if (singers) {
    for (const s of singers) s.exerted = true;
    me.turnStats.songs++;
    say(game, p, `${singers.map((s) => s.card.name).join(' et ')} ${singers.length > 1 ? 'chantent' : 'chante'} ${card.name}`, 'sing', singers);
  }
  const inst = enterPlay(game, p, idx, { exerted, base, cost: singers || alt ? null : cost, singers, paidWithDrop: me.drops < drops });
  for (const s of singers ?? []) {
    emit(game, 'sing', { p, subject: s, song: inst });
    emit(game, 'exert', { p, subject: s });
  }
  return true;
};

/** Cost a character counts for when it sings (Singer N replaces its cost). */
export const singValue = (game, inst) => {
  const raised =
    applyingStatics(game, inst, 'property-modification').reduce((s, { effect }) => s + (effect.property === 'singer-threshold' ? Number(effect.value) : 0), 0) +
    inst.mods.reduce((s, m) => s + (m.kind === 'stat' && m.stat === 'singer-threshold' ? m.amount : 0), 0);
  return Math.max(inst.card.cost, keywordOf(game, inst, 'Singer')) + raised;
};

/** Whether these ready, dry characters can sing the song: one with the cost, or together (Sing Together). */
export const canSing = (game, song, singers) => {
  if (!singers.length || singers.some((s) => s.exerted || !isDry(game, s) || s.card.kind !== 'character' || isRestricted(game, s, 'cant-sing'))) return false;
  // A character that sings only with Sing Together
  if (!song.singTogether && singers.some((s) => isRestricted(game, s, 'cant-sing-without-sing-together'))) return false;
  if (singers.length === 1) return singValue(game, singers[0]) >= song.cost || (song.singTogether > 0 && singValue(game, singers[0]) >= song.singTogether);
  return song.singTogether > 0 && singers.reduce((s, c) => s + singValue(game, c), 0) >= song.singTogether;
};

/** Quests with a character; support: the character a Support character gives its strength to. */
export const quest = (game, p, inst, support = null) => {
  const me = game.players[p];
  inst.exerted = true;
  payInk(game, p, bypassCost(game, inst, 'cant-quest'));
  const lore = statOf(game, inst, 'lore');
  me.turnStats.quested++;
  if (support && keywordOf(game, inst, 'Support')) {
    const strength = strengthOf(game, inst);
    support.bonus += strength;
    say(game, p, `part en quête avec ${inst.card.name} (+${lore}) et donne ${strength} de force à ${support.card.name}`, 'quest', [inst, support]);
  } else {
    say(game, p, `part en quête avec ${inst.card.name} (+${lore} → ${me.lore + lore})`, 'quest', [inst]);
  }
  gainLore(game, p, lore);
  emit(game, 'quest', { p, subject: inst });
  emit(game, 'exert', { p, subject: inst });
  if (support && keywordOf(game, inst, 'Support')) emit(game, 'support', { p, subject: support, supporter: inst });
};

/** Outcome of a challenge before it happens: damage dealt each way and who is banished. */
export const challengeOutcome = (game, attacker, target) => {
  // The abilities that apply "while challenging" or "while being challenged"
  const outer = game.challenging;
  game.challenging = { attacker, defender: target };
  try {
    return outcomeOf(game, attacker, target);
  } finally {
    game.challenging = outer;
  }
};

const outcomeOf = (game, attacker, target) => {
  const shielded = (inst) =>
    hasGrant(game, inst, 'takes-no-damage-from-challenges') || prevented(game, inst, true, true) || isRestricted(game, inst, 'cant-be-dealt-damage');
  const dealt = shielded(target) ? 0 : Math.max(0, challengeDamageOf(game, attacker, true) - keywordOf(game, target, 'Resist'));
  const taken =
    target.card.kind === 'location' || shielded(attacker) || hasGrant(game, attacker, 'takes-no-damage-while-challenging')
      ? 0
      : Math.max(0, challengeDamageOf(game, target, false) - keywordOf(game, attacker, 'Resist'));
  return {
    dealt,
    taken,
    banishes: dealt > 0 && target.damage + dealt >= statOf(game, target, 'willpower'),
    banished: taken > 0 && attacker.damage + taken >= statOf(game, attacker, 'willpower'),
  };
};

/** Challenges a target of challengeTargets: the abilities it sets off, then both deal their damage at once. */
export const challenge = (game, p, attacker, target) => {
  const me = game.players[p];
  attacker.exerted = true;
  target.challengedTurn = game.turn;
  payInk(game, p, bypassCost(game, attacker, 'cant-challenge'));
  me.turnStats.challenges++;
  emit(game, 'challenge', { p, subject: attacker, defender: target });
  emit(game, 'exert', { p, subject: attacker });
  emit(game, 'challenged', { p: 1 - p, subject: target, attacker, defender: target });
  if (game.over || attacker.zone !== 'play' || target.zone !== 'play') return;
  const { dealt, taken } = challengeOutcome(game, attacker, target);
  const landedOnTarget = damageAt(game, target, dealt);
  const landedOnAttacker = damageAt(game, attacker, taken);
  const banishes = target.card.kind !== 'item' && target.damage >= statOf(game, target, 'willpower');
  const banished = attacker.damage >= statOf(game, attacker, 'willpower');
  const outcome = [banishes ? `${target.card.name} est banni` : null, banished ? `${attacker.card.name} est banni` : null].filter(Boolean);
  say(
    game,
    p,
    `défie ${target.card.name} avec ${attacker.card.name} (${landedOnTarget} dégât${landedOnTarget > 1 ? 's' : ''} infligé${landedOnTarget > 1 ? 's' : ''}, ${landedOnAttacker} subi${landedOnAttacker > 1 ? 's' : ''})${outcome.length ? ` : ${outcome.join(', ')}` : ''}`,
    'challenge',
    [attacker, target]
  );
  if (banishes && banish(game, target, { inChallenge: true, by: attacker }) && target.card.kind === 'character') {
    emit(game, 'banish-in-challenge', { p, subject: attacker, banished: target, defender: target, role: 'attacker' });
    emit(game, 'challenged-and-banished', { p: 1 - p, subject: target, attacker });
  }
  if (banished && banish(game, attacker, { inChallenge: true, by: target })) {
    emit(game, 'banish-in-challenge', { p: 1 - p, subject: target, banished: attacker, defender: target, role: 'defender' });
  }
  if (landedOnTarget) damageDealt(game, target, landedOnTarget, attacker, true, target);
  if (landedOnAttacker) damageDealt(game, attacker, landedOnAttacker, target, true, target);
};

// Challenge damage lands on both sides before anyone is banished
const damageAt = (game, inst, amount) => {
  if (amount <= 0 || isRestricted(game, inst, 'cant-be-dealt-damage') || hasGrant(game, inst, 'takes-no-damage-from-challenges')) return 0;
  // "Prevent the next challenge damage": used up
  if (prevented(game, inst, true)) return 0;
  const redirect = replacementFor(game, 'damage-to-character', inst);
  if (redirect) {
    damageCard(game, redirect.src, amount, { put: true });
    return 0;
  }
  inst.damage += amount;
  game.players[inst.owner].turnStats.damaged++;
  return amount;
};

/** Uses an activated ability of a card in play: pays its cost (exert, ink, banishing it), then the effect. */
/**
 * What an activated ability's cost takes besides ink and its own card, the least worth first:
 * cards of the hand to discard (positions), items to banish, characters and items to exert, the
 * character to banish, and a name two cards of the hand share ("reveal 2 cards with the same name").
 */
const costCards = (game, p, inst, cost) => {
  const me = game.players[p];
  // Only what the cost asks for: weighing cards is what a pilot does most
  const cheapest = (list, n) => (n ? list.filter((c) => c !== inst).sort((a, b) => valueOf(game, a) - valueOf(game, b)).slice(0, n) : NONE);
  const discardable = cost.discardCards ? me.hand.map((_, pos) => pos).filter((pos) => !cost.discardCardType || cardOf(game, p, me.hand[pos]).kind === cost.discardCardType) : NONE;
  const counts = new Map();
  if (cost.revealSameName) for (const idx of me.hand) counts.set(cardOf(game, p, idx).title, (counts.get(cardOf(game, p, idx).title) ?? 0) + 1);
  const items = +(cost.banishItem ?? 0);
  return {
    discard: chooseFromHand(game, p, p, discardable, cost.discardCards ?? 0, 'discard'),
    items: [...cheapest(me.items, items), ...(cost.banishItemTarget === 'another' || inst.card.kind !== 'item' ? NONE : [inst])].slice(0, items),
    exertCharacters: cheapest(
      me.characters.filter((c) => !c.exerted && (!cost.exertCharactersClassification || c.card.classifications.includes(cost.exertCharactersClassification))),
      cost.exertCharacters ?? 0
    ),
    exertItems: cheapest(
      me.items.filter((c) => !c.exerted),
      cost.exertItems ?? 0
    ),
    character: cost.banishCharacter ? (cheapest(me.characters, 1)[0] ?? null) : null,
    named: cost.revealSameName ? ([...counts].filter(([, n]) => n >= (cost.revealCards ?? 2)).sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[0] ?? null) : null,
  };
};

export const activate = (game, p, inst, ability) => {
  const { cost } = ability;
  if (!canActivate(game, p, inst, ability)) return false;
  const take = costCards(game, p, inst, cost);
  payInk(game, p, cost.ink ?? 0);
  if (cost.exert) inst.exerted = true;
  for (const c of [...take.exertCharacters, ...take.exertItems]) c.exerted = true;
  // The cards the cost took: "the discarded character's {L}", "the same name as the banished character"
  const paid = [];
  if (cost.discardCards) for (const pos of take.discard.sort((a, b) => b - a)) paid.push(discardRef(game, p, discardFromHand(game, p, pos)));
  for (const item of take.items) banish(game, item);
  if (cost.banishCharacter) {
    paid.push(take.character);
    banish(game, take.character);
  }
  if (inst.used?.turn !== game.turn) inst.used = { turn: game.turn, list: [] };
  inst.used.list.push(ability);
  say(game, p, `utilise ${ability.name ? `${ability.name} (${inst.card.name})` : inst.card.name}`, 'activate', [inst]);
  if (cost.banishSelf) banish(game, inst);
  resolveAbility(game, { p, source: inst, ability, activated: true, paid, named: take.named });
  if (cost.exert && inst.zone === 'play') emit(game, 'exert', { p, subject: inst });
  for (const c of [...take.exertCharacters, ...take.exertItems]) emit(game, 'exert', { p, subject: c });
  return true;
};

export const canActivate = (game, p, inst, ability) => {
  const { cost } = ability;
  if (inst.zone !== 'play' || (cost.ink ?? 0) > game.players[p].ink) return false;
  if ((cost.discardCards ?? 0) > game.players[p].hand.length) return false;
  if (cost.banishCharacter && !game.players[p].characters.some((c) => c !== inst)) return false;
  if (cost.banishItem || cost.exertCharacters || cost.exertItems || cost.discardCardType || cost.revealSameName) {
    const take = costCards(game, p, inst, cost);
    if (take.items.length < +(cost.banishItem ?? 0) || take.exertCharacters.length < (cost.exertCharacters ?? 0) || take.exertItems.length < (cost.exertItems ?? 0)) return false;
    if (take.discard.length < (cost.discardCards ?? 0) || (cost.revealSameName && !take.named)) return false;
  }
  // Once a turn: the abilities used this turn are kept on the card
  if ((ability.restrictions?.length || ability.usesPerTurn) && inst.used?.turn === game.turn && inst.used.list.includes(ability)) return false;
  // A character exerts only once dry; items and locations at once
  if (cost.exert && (inst.exerted || (inst.card.kind === 'character' && !isDry(game, inst)))) return false;
  return true;
};

// ---------- Locations and Boost ----------

/** Ink it costs to move a character to a location, lowered by abilities (free: 0). */
export const moveCostOf = (game, loc, char) => Math.max(0, (loc.card.moveCost ?? 0) - moveReduction(game, loc, char));

export const canMove = (game, p, char, loc, { free = false } = {}) =>
  char.zone === 'play' &&
  loc.zone === 'play' &&
  char.owner === p &&
  loc.owner === p &&
  char.at !== loc &&
  !isRestricted(game, char, 'cant-move') &&
  (free || moveCostOf(game, loc, char) <= game.players[p].ink);

/** Moves a character to one of its player's locations, paying the move cost unless free. */
export const moveCharacter = (game, p, char, loc, { free = false } = {}) => {
  if (!canMove(game, p, char, loc, { free })) return false;
  if (!free) payInk(game, p, moveCostOf(game, loc, char));
  const from = char.at;
  char.at = loc;
  say(game, p, `déplace ${char.card.name} vers ${loc.card.name}`, 'move', [char, loc]);
  emit(game, 'move', { p, subject: char, location: loc, from });
  return true;
};

/** Boost: once during its player's turn, pay its cost to put the top card of the deck under this card. */
export const canBoost = (game, p, inst) =>
  inst.zone === 'play' &&
  inst.owner === p &&
  inst.card.keywords.Boost > 0 &&
  inst.boostTurn !== game.turn &&
  game.players[p].library.length > 0 &&
  inst.card.keywords.Boost <= game.players[p].ink;

export const boost = (game, p, inst) => {
  if (!canBoost(game, p, inst)) return false;
  const me = game.players[p];
  payInk(game, p, inst.card.keywords.Boost);
  inst.boostTurn = game.turn;
  say(game, p, `Boost ${inst.card.name} : une carte sous lui`, 'boost', [inst]);
  putUnder(game, inst, me.library.shift());
  emit(game, 'boost', { p, subject: inst });
  return true;
};

// ---------- The game ----------

const createPlayer = (game, deck) => ({
  deck,
  library: shuffleInPlace(game, [...deck.copies]),
  hand: [],
  discard: [],
  inkwell: 0,
  // The cards of the inkwell, facedown
  inkCards: [],
  // Ready ink and ink drops; the drops alone
  ink: 0,
  drops: 0,
  // Cards inked this turn
  inkedThisTurn: 0,
  lore: 0,
  characters: [],
  items: [],
  locations: [],
  // Lasting effects on the player: cost reductions, restrictions
  effects: [],
  turnStats: newTurnStats(),
  // Cards that reached the hand (kept opening hand and draws), by card index
  seen: new Uint8Array(deck.cards.length),
  loreByTurn: [],
  mulligan: 0,
});

// What happened this turn, for each player: some abilities ask
const newTurnStats = () => ({
  played: [],
  songs: 0,
  actions: 0,
  quested: 0,
  challenges: 0,
  banishedInChallenge: 0,
  banished: [],
  // Cards put into the discard, discarded from the hand, taken out of the discard
  discarded: 0,
  discardedFromHand: 0,
  leftDiscard: 0,
  drawn: 0,
  // Cards put into the inkwell, ink drops gotten
  inked: 0,
  dropsGained: 0,
  // Times a player's cards took damage
  damaged: 0,
  damageRemoved: 0,
  putUnder: 0,
});

/** Opening hand, then the cards the pilot puts on the bottom, drawn again before a shuffle. */
const openHand = (game, p, pilot) => {
  const me = game.players[p];
  me.hand = me.library.splice(0, OPENING_HAND);
  const back = [...new Set(pilot.mulligan(game, p))].sort((a, b) => b - a);
  if (back.length) {
    const returned = back.map((pos) => me.hand.splice(pos, 1)[0]);
    me.library.push(...returned);
    me.hand.push(...me.library.splice(0, returned.length));
    shuffleInPlace(game, me.library);
    me.mulligan = returned.length;
    say(game, p, `remet ${returned.length} carte${returned.length > 1 ? 's' : ''} (mulligan)`, 'mulligan');
  }
  for (const idx of me.hand) me.seen[idx] = 1;
};

/** Effects that wear off at the end of turn T. */
const expire = (game, turn) => {
  for (const pl of game.players) {
    pl.effects = pl.effects.filter((e) => e.until > turn);
    for (const inst of [...pl.characters, ...pl.items, ...pl.locations]) {
      if (!inst.mods.length) continue;
      const kept = inst.mods.filter((m) => m.until > turn);
      if (kept.length < inst.mods.length && inst.mods.some((m) => m.kind === 'ability' && m.until <= turn)) game.boardVersion++;
      inst.mods = kept;
    }
  }
};

/**
 * The board at the end of a turn, for a replay: per player their lore, ink, hand, deck and
 * discard, the cards in play with what they are now, the cards played this turn and the ones that
 * left play since the last snapshot (zone: where they went). A card keeps its id from turn to
 * turn, through Shift too. previous: the cards in play at the last snapshot.
 */
const snapshotOf = (game, previous) => {
  const now = new Set(inPlay(game).map((inst) => inst.id));
  // The latest object of each card: Shift replaces it, a card can come and go within the turn
  const known = new Map(previous.map((inst) => [inst.id, inst]));
  for (const pl of game.players) for (const inst of pl.turnStats.played) if (inst.card.kind !== 'action') known.set(inst.id, inst);
  const left = [...known.values()].filter((inst) => !now.has(inst.id));
  return {
    turn: game.turn,
    current: game.current,
    players: game.players.map((pl, p) => ({
      lore: pl.lore,
      inkwell: pl.inkwell,
      ink: pl.ink,
      hand: pl.hand.slice(),
      library: pl.library.length,
      discard: pl.discard.length,
      played: pl.turnStats.played.map((inst) => ({ id: inst.id, idx: inst.idx })),
      cards: [...pl.locations, ...pl.characters, ...pl.items].map((inst) => ({
        id: inst.id,
        idx: inst.idx,
        damage: inst.damage,
        exerted: inst.exerted,
        strength: statOf(game, inst, 'strength'),
        willpower: statOf(game, inst, 'willpower'),
        lore: statOf(game, inst, 'lore'),
        at: inst.at?.id ?? null,
        under: inst.under.length,
      })),
      left: left.filter((inst) => inst.owner === p).map((inst) => ({ id: inst.id, idx: inst.idx, zone: inst.zone })),
    })),
  };
};

/** A copy of the game a pilot can play ahead in: no log, no card statistics, its own random numbers. */
export const cloneGame = (game) => {
  const map = new Map();
  const copy = (inst) => {
    const c = {
      ...inst,
      mods: inst.mods.slice(),
      under: inst.under.slice(),
      used: inst.used && { turn: inst.used.turn, list: inst.used.list.slice() },
      fired: inst.fired && { turn: inst.fired.turn, list: inst.fired.list.slice() },
    };
    map.set(inst, c);
    return c;
  };
  const players = game.players.map((pl) => ({
    ...pl,
    library: pl.library.slice(),
    inkCards: pl.inkCards.slice(),
    hand: pl.hand.slice(),
    discard: pl.discard.slice(),
    characters: pl.characters.map(copy),
    items: pl.items.map(copy),
    locations: pl.locations.map(copy),
    effects: pl.effects.slice(),
    turnStats: { ...pl.turnStats, played: pl.turnStats.played.slice(), banished: pl.turnStats.banished.slice() },
    seen: null,
    loreByTurn: [],
  }));
  // A character's location is the copy's location; an ability created for the turn, an effect
  // on a card or lasting while a card is in play, the copy's card
  const mapped = (x) => map.get(x) ?? x;
  for (const pl of players) {
    for (const c of pl.characters) if (c.at) c.at = map.get(c.at) ?? null;
    for (const inst of [...pl.characters, ...pl.items, ...pl.locations]) {
      if (inst.mods.some((m) => m.linked)) inst.mods = inst.mods.map((m) => (m.linked ? { ...m, linked: mapped(m.linked) } : m));
    }
    if (pl.effects.some((e) => e.source || e.target)) {
      pl.effects = pl.effects.map((e) =>
        e.source || e.target ? { ...e, source: e.source && mapped(e.source), target: e.target && mapped(e.target), targets: e.targets?.map(mapped) } : e
      );
    }
  }
  return { ...game, rng: { ...game.rng }, log: null, depth: game.depth + 1, players, map, listeners: null };
};

/**
 * Plays one game between two prepared decks (deck.js).
 * @param {object[]} decks the two decks
 * @param {{ seed: number, first?: 0|1, pilots: object[], log?: object[], snapshots?: object[] }}
 *   options first: the player who starts (and skips their first draw); log: filled with { turn,
 *   round, player, text, kind, cards } (see say); snapshots: filled with the board once the hands
 *   are kept, then at the end of each turn (see snapshotOf)
 * @returns {{ winner: 0|1|null, reason: 'lore'|'deckout'|'timeout', turns: number, first: number,
 *   lore: number[][], seen: Uint8Array[], mulligans: number[] }} lore[p]: lore at the end of each
 *   of p's turns
 */
export const playGame = (decks, { seed, first = 0, pilots, log = null, snapshots = null }) => {
  const game = {
    turn: 0,
    first,
    current: first,
    players: [],
    rng: createRandom(seed),
    pilots,
    log,
    // 0: the real game, 1+: a pilot looking ahead
    depth: 0,
    chain: 0,
    staticDepth: 0,
    // Cards in play with static and triggered abilities, rebuilt when the board changes
    boardVersion: 0,
    listeners: null,
    over: false,
    winner: null,
    reason: null,
  };
  game.players = decks.map((deck) => createPlayer(game, deck));
  openHand(game, first, pilots[first]);
  openHand(game, 1 - first, pilots[1 - first]);
  let board = [];
  const snapshot = () => {
    snapshots.push(snapshotOf(game, board));
    board = inPlay(game);
  };
  if (snapshots) snapshot();

  let p = first;
  while (!game.over && game.turn < MAX_TURNS) {
    game.turn++;
    game.current = p;
    const me = game.players[p];
    for (const pl of game.players) pl.turnStats = newTurnStats();
    // "Can't ready more than 1 of their characters": the one worth most
    let readyLeft = playerRestricted(game, p, 'ready-only-one-character') ? 1 : Infinity;
    const readied = [];
    const characters = readyLeft < Infinity ? me.characters.slice().sort((a, b) => valueOf(game, b) - valueOf(game, a)) : me.characters;
    for (const inst of [...characters, ...me.items, ...me.locations]) {
      if (!inst.exerted || isRestricted(game, inst, 'cant-ready') || isRestricted(game, inst, 'cant-ready-at-start-of-turn')) continue;
      if (inst.card.kind === 'character' && readyLeft-- <= 0) continue;
      inst.exerted = false;
      readied.push(inst);
    }
    me.ink = me.inkwell + me.drops;
    me.inkedThisTurn = 0;
    for (const l of me.locations) gainLore(game, p, statOf(game, l, 'lore'));
    for (const inst of readied) if (!game.over) emit(game, 'ready', { p, subject: inst });
    if (!game.over) emit(game, 'start-turn', { p, subject: null });
    if (!game.over && game.turn > 1 && !playerRestricted(game, p, 'skip-draw-step')) {
      if (me.library.length) drawCards(game, p, 1);
      else end(game, 1 - p, 'deckout');
    }
    if (!game.over) pilots[p].takeTurn(game, p);
    if (!game.over) emit(game, 'end-turn', { p, subject: null });
    // "At the end of your turn, banish them"
    for (const e of me.effects) if (e.kind === 'banish-at-end' && !game.over && e.target.zone === 'play') banish(game, e.target);
    // Support lasts for the turn
    for (const c of me.characters) c.bonus = 0;
    expire(game, game.turn);
    me.loreByTurn.push(me.lore);
    if (snapshots) snapshot();
    p = 1 - p;
  }
  if (!game.over) game.reason = 'timeout';

  return {
    winner: game.winner,
    reason: game.reason,
    turns: game.turn,
    first,
    lore: game.players.map((pl) => pl.loreByTurn),
    seen: game.players.map((pl) => pl.seen),
    mulligans: game.players.map((pl) => pl.mulligan),
  };
};
