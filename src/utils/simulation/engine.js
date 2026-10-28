import { LORE_TO_WIN, OPENING_HAND } from '../handStats.js';
import { triggerEvents } from './abilities.js';
import { chooseFromHand, valueOf } from './decisions.js';
import { applyingStatics, handReduction, moveReduction, resolveAbility, triggerMatches } from './effects.js';

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

export const say = (game, p, text) => {
  if (game.log) game.log.push({ round: Math.ceil(game.turn / 2), player: p, text });
};

const end = (game, winner, reason) => {
  if (game.over) return;
  game.over = true;
  game.winner = winner;
  game.reason = reason;
  say(game, winner, reason === 'lore' ? `atteint ${LORE_TO_WIN} lore et gagne` : "gagne : l'adversaire n'a plus de cartes à piocher");
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
  for (const mod of inst.mods) if (mod.kind === 'stat' && mod.stat === stat) value += mod.amount;
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
    if (mod.kind === 'keyword' && mod.keyword === keyword) value += mod.value ?? 1;
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

/** Whether an effect stops a card in play: 'cant-quest', 'cant-challenge', 'cant-ready', 'cant-be-challenged'. */
export const isRestricted = (game, inst, restriction) => {
  const names = COVERS[restriction] ?? [restriction];
  if (inst.mods.some((m) => m.kind === 'restriction' && names.includes(m.restriction))) return true;
  return applyingStatics(game, inst, 'restriction').some(({ effect }) => names.includes(effect.restriction));
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
    typeof effect.ability === 'string' ? { ability: effect.ability } : { ability: effect.ability.type, classification: effect.ability.classification }
  ),
];

export const hasGrant = (game, inst, ability) => grantsOf(game, inst).some((g) => g.ability === ability);

/** The triggered abilities of a card for an event: printed, and granted by an effect. */
export const triggeredOf = (inst, event) => {
  const printed = inst.card.abilities?.triggered[event] ?? [];
  if (!inst.mods.some((m) => m.kind === 'ability')) return printed;
  return [...printed, ...inst.mods.filter((m) => m.kind === 'ability' && m.ability.type === 'triggered' && triggerEvents(m.ability.trigger).includes(event)).map((m) => m.ability)];
};

/** The activated abilities a card in play can use: printed, granted by an effect or by the location it is at. */
export const activatedOf = (game, inst) => {
  const printed = inst.card.abilities?.activated ?? [];
  const granted = inst.mods.filter((m) => m.kind === 'ability' && m.ability.type === 'activated').map((m) => m.ability);
  const here = applyingStatics(game, inst, 'grant-abilities-while-here').flatMap(({ effect }) => effect.abilities);
  return granted.length || here.length ? [...printed, ...granted, ...here] : printed;
};

/** Dry since the start of the turn: played on an earlier turn. */
const isDry = (game, inst) => inst.playedTurn < game.turn;

export const canQuest = (game, inst) =>
  inst.card.kind === 'character' &&
  !inst.exerted &&
  (isDry(game, inst) || isRestricted(game, inst, 'can-quest-turn-played')) &&
  !keywordOf(game, inst, 'Reckless') &&
  !isRestricted(game, inst, 'cant-quest');

export const canChallenge = (game, inst) =>
  inst.card.kind === 'character' &&
  !inst.exerted &&
  (isDry(game, inst) || keywordOf(game, inst, 'Rush') > 0) &&
  !isRestricted(game, inst, 'cant-challenge') &&
  challengesLeft(game, inst.owner) > 0;

/** Strength a character deals, Challenger counted while it challenges. */
export const strengthOf = (game, inst, challenging = false) =>
  statOf(game, inst, 'strength') + (challenging ? keywordOf(game, inst, 'Challenger') : 0);

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
      (c.exerted || readyToo.some((m) => !m.classification || c.card.classifications.includes(m.classification))) &&
      (reaches || !keywordOf(game, c, 'Evasive')) &&
      !isRestricted(game, c, 'cant-be-challenged')
  );
  const bodyguards = reachable.filter((c) => keywordOf(game, c, 'Bodyguard') > 0);
  return [...(bodyguards.length ? bodyguards : reachable), ...opp.locations.filter((l) => !isRestricted(game, l, 'cant-be-challenged'))];
};

// ---------- Moving cards ----------

export const gainLore = (game, p, lore) => {
  if (lore <= 0 || game.over) return;
  game.players[p].lore += lore;
  if (game.players[p].lore >= LORE_TO_WIN) end(game, p, 'lore');
};

export const loseLore = (game, p, lore) => {
  game.players[p].lore = Math.max(0, game.players[p].lore - lore);
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

/** A card of the hand (by position) to the discard. */
export const discardFromHand = (game, p, pos) => {
  const me = game.players[p];
  const [idx] = me.hand.splice(pos, 1);
  me.discard.push(idx);
  me.turnStats.discarded++;
  return idx;
};

const removeFromPlay = (game, inst) => {
  const board = boardOf(game, inst);
  const i = board.indexOf(inst);
  if (i < 0) return false;
  board.splice(i, 1);
  game.boardVersion++;
  // The cards under it go to the discard; a location leaving play lets its characters go
  const owner = game.players[inst.owner];
  inst.underBefore = inst.under?.length ?? 0;
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

/** Takes a card out of play or out of its owner's discard (a banished "that character"). */
const takeCard = (game, inst) => {
  if (inst.zone === 'play') {
    if (!removeFromPlay(game, inst)) return false;
    inst.left = true;
    return true;
  }
  if (inst.zone === 'discard') {
    const discard = game.players[inst.owner].discard;
    const i = discard.lastIndexOf(inst.idx);
    if (i < 0) return false;
    discard.splice(i, 1);
    return true;
  }
  return false;
};

/** A card in play is banished: to its owner's discard, then the abilities it sets off. */
export const banish = (game, inst, { inChallenge = false, by = null } = {}) => {
  if (inst.zone !== 'play' || !removeFromPlay(game, inst)) return false;
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
  if (!takeCard(game, inst)) return false;
  inst.zone = 'hand';
  game.players[inst.owner].hand.push(inst.idx);
  leftPlay(game, inst);
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

/** A card in play to its owner's inkwell, ready (adds ink this turn) or exerted. */
export const putIntoInkwell = (game, inst, { exerted = true } = {}) => {
  if (!takeCard(game, inst)) return false;
  inst.zone = 'inkwell';
  const owner = game.players[inst.owner];
  owner.inkwell++;
  if (!exerted) owner.ink++;
  leftPlay(game, inst);
  return true;
};

/**
 * Damage on a card in play: dealt (Resist lowers it) or put (counters, Resist does not apply).
 * Banishes it at its willpower. Returns the damage that landed.
 */
export const damageCard = (game, inst, amount, { put = false, inChallenge = false, by = null, ignoreResist = false } = {}) => {
  if (inst.zone !== 'play' || amount <= 0) return 0;
  const landed = put || ignoreResist ? amount : Math.max(0, amount - keywordOf(game, inst, 'Resist'));
  if (!landed || (!put && isRestricted(game, inst, 'cant-be-dealt-damage'))) return 0;
  inst.damage += landed;
  if (inst.card.kind !== 'item' && inst.damage >= statOf(game, inst, 'willpower')) banish(game, inst, { inChallenge, by });
  return landed;
};

/** Adds a lasting effect on a card in play. */
export const addMod = (inst, mod) => {
  if (inst.zone === 'play') inst.mods.push(mod);
};

// ---------- Abilities ----------

/**
 * The cards in play with abilities, by kind of static effect and by event: { statics: { type:
 * [card] }, triggers: { event: [card] } }. Rebuilt only when a card enters or leaves play.
 */
export const listenersOf = (game) => {
  if (game.listeners?.version === game.boardVersion) return game.listeners;
  const statics = {};
  const triggers = {};
  for (const pl of game.players) {
    for (const list of [pl.characters, pl.items, pl.locations]) {
      for (const src of list) {
        const abilities = src.card.abilities;
        for (const m of src.mods) {
          if (m.kind === 'ability' && m.ability.type === 'triggered') for (const event of triggerEvents(m.ability.trigger)) if (!triggers[event]?.includes(src)) (triggers[event] ??= []).push(src);
        }
        if (!abilities) continue;
        for (const a of abilities.statics) if (!statics[a.effect.type]?.includes(src)) (statics[a.effect.type] ??= []).push(src);
        for (const event of Object.keys(abilities.triggered)) if (!triggers[event]?.includes(src)) (triggers[event] ??= []).push(src);
      }
    }
  }
  game.listeners = { version: game.boardVersion, statics, triggers };
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
  const leaving = payload.subject?.zone && payload.subject.zone !== 'play' && payload.subject.card?.abilities && triggeredOf(payload.subject, event).length;
  const floating = game.players.flatMap((pl) => pl.effects.filter((e) => e.kind === 'trigger' && triggerEvents(e.ability.trigger).includes(event)));
  if (!listening && !leaving && !floating.length) return;
  // The active player's abilities first; a card leaving play still sets off its own "when this character is banished"
  const sources = (listening ?? []).filter((s) => s.owner === game.current).concat((listening ?? []).filter((s) => s.owner !== game.current));
  if (leaving) sources.push(payload.subject);
  const fired = [];
  for (const inst of sources) {
    for (const ability of triggeredOf(inst, event)) {
      if (!triggerMatches(game, inst, ability, payload)) continue;
      // "Once during your turn", "the first time each turn": the abilities fired this turn are kept on the card
      if (ability.trigger.restrictions?.some((r) => r.type === 'once-per-turn' || r.type === 'first-time-each-turn')) {
        if (inst.fired?.turn !== game.turn) inst.fired = { turn: game.turn, list: [] };
        if (inst.fired.list.includes(ability)) continue;
        inst.fired.list.push(ability);
      }
      fired.push({ inst, ability });
    }
  }
  // Abilities an effect created for the turn, still there once their card has left
  for (const f of floating) if (triggerMatches(game, f.source, f.ability, payload, true)) fired.push({ inst: f.source, ability: f.ability });
  if (!fired.length) return;
  game.chain++;
  for (const { inst, ability } of fired) {
    if (game.over) break;
    resolveAbility(game, { p: inst.owner, source: inst, ability, trigger: payload });
  }
  game.chain--;
};

let nextId = 1;

/** A card enters play (paid or not): its board, "enters exerted" effects, its play triggers. */
export const enterPlay = (game, p, idx, { exerted = false, base = null, cost = null, afterPlay = null } = {}) => {
  const me = game.players[p];
  const card = cardOf(game, p, idx);
  if (card.kind === 'action') {
    me.discard.push(idx);
    me.turnStats.discarded++;
    const ref = { id: nextId++, idx, owner: p, card, zone: 'discard', damage: 0, exerted: false, mods: [] };
    me.turnStats.played.push(ref);
    say(game, p, `joue ${card.name}${cost != null ? ` (${cost})` : ''}`);
    if (card.abilities?.action) resolveAbility(game, { p, source: ref, ability: card.abilities.action });
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
    inst = { ...base, idx, card, shifted: true, mods: base.mods.slice(), under: [...base.under, base.idx] };
    me.characters.splice(me.characters.indexOf(base), 1, inst);
    game.boardVersion++;
    base.zone = 'under';
    say(game, p, `joue ${card.name} avec Alter sur ${base.card.name}${cost != null ? ` (${cost})` : ''}`);
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
    };
    inst.damage = enteringDamage(game, inst);
    boardOf(game, inst).push(inst);
    game.boardVersion++;
    const kind = card.kind === 'location' ? 'le lieu ' : card.kind === 'item' ? "l'objet " : '';
    say(game, p, `joue ${kind}${card.name}${cost != null ? ` (${cost})` : ''}${entersExerted ? ', épuisé' : ''}`);
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

const enteringDamage = (game, inst) =>
  (inst.card.abilities?.statics ?? []).filter((a) => a.effect.type === 'enters-with-damage').reduce((s, a) => s + a.effect.amount, 0);

/** Ink a card costs to play: printed (or its Shift cost), less the reductions in effect. */
export const costOf = (game, p, card, { shift = false } = {}) => {
  let cost = (shift ? card.shift.cost : card.cost) - handReduction(game, p, card);
  for (const e of game.players[p].effects) if (e.kind === 'cost-reduction' && reductionApplies(e, card)) cost -= e.amount;
  for (const { effect, amount } of applyingStatics(game, { owner: p, player: true }, 'cost-reduction')) {
    if (reductionApplies(effect, card)) cost -= amount;
  }
  return Math.max(0, cost);
};

const reductionApplies = (e, card) =>
  (!e.cardType || [].concat(e.cardType).some((t) => t === card.kind || (t === 'song' && card.song))) &&
  (!e.classification || [].concat(e.classification).some((c) => card.classifications.includes(c))) &&
  (!e.cardName || e.cardName === card.title);

/** The "next card you play this turn costs less" effects a card just used up. */
const spendReductions = (game, p, card) => {
  const me = game.players[p];
  me.effects = me.effects.filter((e) => !(e.kind === 'cost-reduction' && e.once && reductionApplies(e, card)));
};

/** Whether the player may play this card at all (restrictions, not ink). */
export const mayPlay = (game, p, card) =>
  !(card.kind === 'action' && playerRestricted(game, p, 'cant-play-actions', card)) && !(card.kind === 'item' && playerRestricted(game, p, 'cant-play-items', card));

// ---------- The player's actions ----------

/** Puts the card at position pos of the hand into the inkwell: once a turn, inkable cards only. */
export const inkCard = (game, p, pos) => {
  const me = game.players[p];
  const card = cardOf(game, p, me.hand[pos]);
  if (me.inkedThisTurn || !card.inkwell) return false;
  me.hand.splice(pos, 1);
  me.inkwell++;
  me.ink++;
  me.inkedThisTurn = true;
  say(game, p, `encre ${card.name}`);
  emit(game, 'ink', { p, subject: null });
  return true;
};

/**
 * Plays the card at position pos of the hand. base: a character in play to Shift onto (the new
 * one keeps its damage, readiness and dryness); exerted: a Bodyguard entering exerted; singers:
 * the characters exerted to sing a song instead of paying.
 */
export const playCard = (game, p, pos, { base = null, exerted = false, singers = null } = {}) => {
  const me = game.players[p];
  const idx = me.hand[pos];
  const card = cardOf(game, p, idx);
  if (!mayPlay(game, p, card)) return false;
  if (card.kind === 'action' && !card.abilities?.action) return false;
  let cost = 0;
  if (singers) {
    if (!card.song || !canSing(game, card, singers)) return false;
  } else {
    cost = costOf(game, p, card, { shift: !!base });
    if (cost > me.ink) return false;
  }
  me.ink -= cost;
  me.hand.splice(pos, 1);
  spendReductions(game, p, card);
  if (singers) {
    for (const s of singers) s.exerted = true;
    me.turnStats.songs++;
    say(game, p, `${singers.map((s) => s.card.name).join(' et ')} ${singers.length > 1 ? 'chantent' : 'chante'} ${card.name}`);
  }
  if (card.kind === 'action') me.turnStats.actions++;
  const inst = enterPlay(game, p, idx, { exerted, base, cost: singers ? null : cost });
  for (const s of singers ?? []) {
    emit(game, 'sing', { p, subject: s, song: inst });
    emit(game, 'exert', { p, subject: s });
  }
  return true;
};

/** Cost a character counts for when it sings (Singer N replaces its cost). */
export const singValue = (game, inst) => {
  const raised = applyingStatics(game, inst, 'property-modification').reduce((s, { effect }) => s + (effect.property === 'singer-threshold' ? Number(effect.value) : 0), 0);
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
  const lore = statOf(game, inst, 'lore');
  me.turnStats.quested++;
  if (support && keywordOf(game, inst, 'Support')) {
    const strength = strengthOf(game, inst);
    support.bonus += strength;
    say(game, p, `part en quête avec ${inst.card.name} (+${lore}) et donne ${strength} de force à ${support.card.name}`);
  } else {
    say(game, p, `part en quête avec ${inst.card.name} (+${lore} → ${me.lore + lore})`);
  }
  gainLore(game, p, lore);
  emit(game, 'quest', { p, subject: inst });
  emit(game, 'exert', { p, subject: inst });
};

/** Outcome of a challenge before it happens: damage dealt each way and who is banished. */
export const challengeOutcome = (game, attacker, target) => {
  const shielded = (inst) =>
    hasGrant(game, inst, 'takes-no-damage-from-challenges') || inst.mods.some((m) => m.kind === 'shield') || isRestricted(game, inst, 'cant-be-dealt-damage');
  const dealt = shielded(target) ? 0 : Math.max(0, strengthOf(game, attacker, true) - keywordOf(game, target, 'Resist'));
  const taken = target.card.kind === 'location' || shielded(attacker) ? 0 : Math.max(0, strengthOf(game, target) - keywordOf(game, attacker, 'Resist'));
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
  me.turnStats.challenges++;
  emit(game, 'challenge', { p, subject: attacker, defender: target });
  emit(game, 'exert', { p, subject: attacker });
  emit(game, 'challenged', { p: 1 - p, subject: target, attacker, defender: target });
  if (game.over || attacker.zone !== 'play' || target.zone !== 'play') return;
  game.challenging = { attacker, defender: target };
  const { dealt, taken } = challengeOutcome(game, attacker, target);
  game.challenging = null;
  const landedOnTarget = damageAt(game, target, dealt);
  const landedOnAttacker = damageAt(game, attacker, taken);
  const banishes = target.card.kind !== 'item' && target.damage >= statOf(game, target, 'willpower');
  const banished = attacker.damage >= statOf(game, attacker, 'willpower');
  const outcome = [banishes ? `${target.card.name} est banni` : null, banished ? `${attacker.card.name} est banni` : null].filter(Boolean);
  say(
    game,
    p,
    `défie ${target.card.name} avec ${attacker.card.name} (${landedOnTarget} dégât${landedOnTarget > 1 ? 's' : ''} infligé${landedOnTarget > 1 ? 's' : ''}, ${landedOnAttacker} subi${landedOnAttacker > 1 ? 's' : ''})${outcome.length ? ` : ${outcome.join(', ')}` : ''}`
  );
  if (banishes) {
    banish(game, target, { inChallenge: true, by: attacker });
    if (target.card.kind === 'character') {
      emit(game, 'banish-in-challenge', { p, subject: attacker, banished: target, defender: target, role: 'attacker' });
      emit(game, 'challenged-and-banished', { p: 1 - p, subject: target, attacker });
    }
  }
  if (banished) {
    banish(game, attacker, { inChallenge: true, by: target });
    emit(game, 'banish-in-challenge', { p: 1 - p, subject: target, banished: attacker, defender: target, role: 'defender' });
  }
};

// Challenge damage lands on both sides before anyone is banished
const damageAt = (game, inst, amount) => {
  if (amount <= 0 || isRestricted(game, inst, 'cant-be-dealt-damage') || hasGrant(game, inst, 'takes-no-damage-from-challenges')) return 0;
  // "Prevent the next challenge damage": used up
  const shield = inst.mods.findIndex((m) => m.kind === 'shield');
  if (shield >= 0) {
    inst.mods.splice(shield, 1);
    return 0;
  }
  inst.damage += amount;
  return amount;
};

/** Uses an activated ability of a card in play: pays its cost (exert, ink, banishing it), then the effect. */
export const activate = (game, p, inst, ability) => {
  const me = game.players[p];
  const { cost } = ability;
  if (!canActivate(game, p, inst, ability)) return false;
  me.ink -= cost.ink ?? 0;
  if (cost.exert) inst.exerted = true;
  if (cost.discardCards) {
    const picked = chooseFromHand(game, p, p, me.hand.map((_, pos) => pos), cost.discardCards, 'discard');
    for (const pos of picked.sort((a, b) => b - a)) discardFromHand(game, p, pos);
  }
  if (cost.banishCharacter) {
    const others = me.characters.filter((c) => c !== inst).sort((a, b) => valueOf(game, a) - valueOf(game, b));
    banish(game, others[0]);
  }
  if (inst.used?.turn !== game.turn) inst.used = { turn: game.turn, list: [] };
  inst.used.list.push(ability);
  say(game, p, `utilise ${ability.name ? `${ability.name} (${inst.card.name})` : inst.card.name}`);
  if (cost.banishSelf) banish(game, inst);
  resolveAbility(game, { p, source: inst, ability, activated: true });
  if (cost.exert && inst.zone === 'play') emit(game, 'exert', { p, subject: inst });
  return true;
};

export const canActivate = (game, p, inst, ability) => {
  const { cost } = ability;
  if (inst.zone !== 'play' || (cost.ink ?? 0) > game.players[p].ink) return false;
  if ((cost.discardCards ?? 0) > game.players[p].hand.length) return false;
  if (cost.banishCharacter && !game.players[p].characters.some((c) => c !== inst)) return false;
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
  if (!free) game.players[p].ink -= moveCostOf(game, loc, char);
  char.at = loc;
  say(game, p, `déplace ${char.card.name} vers ${loc.card.name}`);
  emit(game, 'move', { p, subject: char, location: loc });
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
  me.ink -= inst.card.keywords.Boost;
  inst.boostTurn = game.turn;
  say(game, p, `Boost ${inst.card.name} : une carte sous lui`);
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
  ink: 0,
  inkedThisTurn: false,
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
  discarded: 0,
  drawn: 0,
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
    say(game, p, `remet ${returned.length} carte${returned.length > 1 ? 's' : ''} (mulligan)`);
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
  // A character's location is the copy's location; an ability created for the turn, the copy's card
  for (const pl of players) {
    for (const c of pl.characters) if (c.at) c.at = map.get(c.at) ?? null;
    if (pl.effects.some((e) => e.source)) pl.effects = pl.effects.map((e) => (e.source ? { ...e, source: map.get(e.source) ?? e.source } : e));
  }
  return { ...game, rng: { ...game.rng }, log: null, depth: game.depth + 1, players, map, listeners: null };
};

/**
 * Plays one game between two prepared decks (deck.js).
 * @param {object[]} decks the two decks
 * @param {{ seed: number, first?: 0|1, pilots: object[], log?: object[] }} options first: the
 *   player who starts (and skips their first draw); log: filled with { round, player, text }
 * @returns {{ winner: 0|1|null, reason: 'lore'|'deckout'|'timeout', turns: number, first: number,
 *   lore: number[][], seen: Uint8Array[], mulligans: number[] }} lore[p]: lore at the end of each
 *   of p's turns
 */
export const playGame = (decks, { seed, first = 0, pilots, log = null }) => {
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

  let p = first;
  while (!game.over && game.turn < MAX_TURNS) {
    game.turn++;
    game.current = p;
    const me = game.players[p];
    for (const pl of game.players) pl.turnStats = newTurnStats();
    for (const inst of [...me.characters, ...me.items, ...me.locations]) {
      if (!isRestricted(game, inst, 'cant-ready') && !isRestricted(game, inst, 'cant-ready-at-start-of-turn')) inst.exerted = false;
    }
    me.ink = me.inkwell;
    me.inkedThisTurn = false;
    for (const l of me.locations) gainLore(game, p, statOf(game, l, 'lore'));
    if (!game.over) emit(game, 'start-turn', { p, subject: null });
    if (!game.over && game.turn > 1) {
      if (me.library.length) drawCards(game, p, 1);
      else end(game, 1 - p, 'deckout');
    }
    if (!game.over) pilots[p].takeTurn(game, p);
    if (!game.over) emit(game, 'end-turn', { p, subject: null });
    // Support lasts for the turn
    for (const c of me.characters) c.bonus = 0;
    expire(game, game.turn);
    me.loreByTurn.push(me.lore);
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
