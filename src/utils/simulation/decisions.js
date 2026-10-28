import { canQuest, cardOf, cloneGame, isRestricted, keywordOf, statOf } from './engine.js';
import { previewTargets, runEffectFor } from './effects.js';

/**
 * How a pilot weighs the game and the choices card effects ask for: which character to target,
 * whether to use a "you may", which option, which card to discard. Every value is in lore. In
 * the real game, a "you may" or a choice is played ahead in a copy of the game; in a copy,
 * quick rules decide (no lookahead inside a lookahead).
 */

// Quests a character is still expected to make, turns a location keeps giving its lore
export const FUTURE_QUESTS = 2;
const LOCATION_TURNS = 3;
// A card in hand, a card in the inkwell
export const HAND_CARD = 0.4;
const INK_CARD = 0.25;

const KEYWORD_WORTH = { Evasive: 1, Bodyguard: 0.5, Ward: 0.4, Resist: 0.3, Challenger: 0.15, Support: 0.3, Rush: 0.3, Alert: 0.3, Reckless: -1, Vanish: 0.2, Singer: 0.1 };

/** What a card in play is worth: the lore it should still bring, its stats, keywords and abilities. */
export const valueOf = (game, inst) => {
  const { card } = inst;
  if (card.kind === 'location') return statOf(game, inst, 'lore') * LOCATION_TURNS + 1 + card.worth;
  if (card.kind === 'item') return 0.5 + card.worth;
  const reckless = keywordOf(game, inst, 'Reckless') > 0;
  const lore = reckless ? 0 : statOf(game, inst, 'lore');
  // A character that cannot quest next time loses that quest
  const quests = isRestricted(game, inst, 'cant-quest') ? FUTURE_QUESTS - 1 : FUTURE_QUESTS;
  let value = lore * quests + (statOf(game, inst, 'strength') + statOf(game, inst, 'willpower') - inst.damage) * 0.3 + card.worth;
  // What its location does for the characters at it, the cards under it some abilities count
  if (inst.at) value += inst.at.card.hereWorth;
  value += 0.1 * (inst.under?.length ?? 0);
  for (const k of ['Evasive', 'Bodyguard', 'Ward', 'Resist', 'Challenger']) {
    const n = keywordOf(game, inst, k);
    if (n) value += KEYWORD_WORTH[k] * n;
  }
  return value;
};

const boardOf = (pl) => [...pl.characters, ...pl.items, ...pl.locations];

/**
 * The game from player p's side: lore, the board, cards in hand and ink, and the lore p's
 * ready characters can still quest for this turn.
 */
export const evaluate = (game, p) => {
  if (game.over) return game.winner === p ? 1000 : game.winner == null ? 0 : -1000;
  const me = game.players[p];
  const opp = game.players[1 - p];
  let v = me.lore - opp.lore;
  for (const inst of boardOf(me)) v += valueOf(game, inst);
  for (const inst of boardOf(opp)) v -= valueOf(game, inst);
  v += HAND_CARD * (me.hand.length - opp.hand.length) + INK_CARD * (me.inkwell - opp.inkwell);
  if (game.current === p) for (const c of me.characters) if (canQuest(game, c)) v += statOf(game, c, 'lore');
  return v;
};

// ---------- Playing ahead ----------

const remap = (clone, x) => clone.map.get(x) ?? x;

const remapCtx = (clone, ctx) => ({
  ...ctx,
  source: remap(clone, ctx.source),
  targets: (ctx.targets ?? []).map((t) => remap(clone, t)),
  trigger: ctx.trigger && {
    ...ctx.trigger,
    subject: ctx.trigger.subject && remap(clone, ctx.trigger.subject),
    attacker: ctx.trigger.attacker && remap(clone, ctx.trigger.attacker),
    defender: ctx.trigger.defender && remap(clone, ctx.trigger.defender),
  },
});

/** The game for player p after an effect, played in a copy. */
const effectOutcome = (game, p, ctx, effect) => {
  const clone = cloneGame(game);
  runEffectFor(clone, remapCtx(clone, ctx), effect);
  return evaluate(clone, p);
};

/** The game for player p after fn(copy), with copy.map to find the cards again. */
export const lookahead = (game, p, fn) => {
  const clone = cloneGame(game);
  fn(clone);
  return evaluate(clone, p);
};

// ---------- Targets ----------

const numberOf = (a) => (typeof a === 'number' ? a : typeof a?.value === 'number' ? a.value : 1);

/** What an effect does to a card, for the card's owner: negative when it hurts. */
const effectOnCard = (game, effect, inst) => {
  // A card in a discard: worth taking back, or putting into the inkwell
  if (inst.zone !== 'play') {
    if (effect.type === 'return-to-hand') return HAND_CARD + 0.1 * cardWorth(inst.card);
    return effect.type === 'put-into-inkwell' ? INK_CARD : 0;
  }
  const v = valueOf(game, inst);
  const lore = statOf(game, inst, 'lore');
  switch (effect.type) {
    case 'banish':
    case 'put-on-bottom':
    case 'put-on-top':
    case 'shuffle-into-deck':
      return -v;
    case 'put-into-inkwell':
      return -v + INK_CARD;
    case 'return-to-hand':
      return -v + HAND_CARD;
    case 'deal-damage':
    case 'put-damage': {
      const n = numberOf(effect.amount);
      const landed = effect.type === 'put-damage' || effect.ignoreResist ? n : Math.max(0, n - keywordOf(game, inst, 'Resist'));
      const left = statOf(game, inst, 'willpower') - inst.damage;
      if (inst.card.kind === 'item' || !landed) return 0;
      return landed >= left ? -v : -0.3 * landed;
    }
    case 'remove-damage':
      return 0.3 * Math.min(numberOf(effect.amount), inst.damage);
    case 'exert':
      return inst.exerted ? 0 : -(canQuest(game, inst) ? lore : 0) - 0.3;
    case 'ready':
      return inst.exerted ? (inst.playedTurn < game.turn ? lore : 0) + 0.3 : 0;
    case 'modify-stat': {
      const n = numberOf(effect.modifier);
      if (effect.stat === 'lore') return n * (effect.duration === 'this-turn' ? (canQuest(game, inst) ? 1 : 0) : FUTURE_QUESTS);
      return n * 0.3;
    }
    case 'gain-keyword':
      return (KEYWORD_WORTH[effect.keyword] ?? 0.2) * (effect.value == null ? 1 : numberOf(effect.value));
    case 'gain-keywords':
      return effect.keywords.reduce((s, k) => s + (KEYWORD_WORTH[k.keyword] ?? 0.2) * (k.value ?? 1), 0);
    case 'lose-keyword':
      return -(KEYWORD_WORTH[effect.keyword] ?? 0.2);
    case 'restriction':
      switch (effect.restriction) {
        case 'cant-quest':
          return -lore;
        case 'cant-challenge':
          return -0.3;
        case 'cant-quest-or-challenge':
          return -lore - 0.3;
        case 'cant-ready':
          return inst.exerted ? -lore - 0.3 : -0.2;
        case 'cant-be-challenged':
        case 'cant-be-dealt-damage':
          return 0.5;
        default:
          return 0;
      }
    default:
      return 0;
  }
};

/** How much the chooser likes an effect landing on a card. */
const utility = (game, chooser, effect, inst) => (inst.owner === chooser ? 1 : -1) * effectOnCard(game, effect, inst);

/** The cards a player chooses for an effect: between min and max, the ones they like best (a "may" skips the ones they dislike). */
export const chooseCards = (game, chooser, ctx, effect, candidates, min, max) => {
  const scored = candidates.map((inst) => ({ inst, score: utility(game, chooser, effect, inst) })).sort((a, b) => b.score - a.score);
  const picked = [];
  for (const { inst, score } of scored) {
    if (picked.length >= max) break;
    if (picked.length >= min && score <= 0) break;
    picked.push(inst);
  }
  return picked;
};

/** The player an effect naming "chosen player" goes to: the opponent for what hurts. */
export const choosePlayer = (game, ctx, effect) => (['discard', 'lose-lore', 'mill', 'reveal-hand'].includes(effect.type) ? 1 - ctx.p : ctx.p);

// ---------- "You may" and choices ----------

/** A quick guess of what an effect brings the chooser, for the copies of the game. */
const estimate = (game, chooser, ctx, effect) => {
  switch (effect.type) {
    case 'sequence':
      return (effect.steps ?? effect.effects).reduce((s, x) => s + estimate(game, chooser, ctx, x), 0);
    case 'optional':
      return Math.max(0, estimate(game, chooser, ctx, effect.effect));
    case 'conditional':
      return estimate(game, chooser, ctx, effect.then ?? effect.effect ?? effect.ifTrue);
    case 'pay-cost':
      return game.players[chooser].ink >= effect.cost.ink ? estimate(game, chooser, ctx, effect.effect) - 0.5 * effect.cost.ink : -1;
    case 'draw':
      return (effect.target ?? 'CONTROLLER') === 'CONTROLLER' ? HAND_CARD * numberOf(effect.amount) : 0;
    case 'gain-lore':
      return (effect.target ?? 'CONTROLLER') === 'CONTROLLER' ? numberOf(effect.amount) : -numberOf(effect.amount);
    case 'lose-lore':
      return (effect.target ?? 'CONTROLLER') === 'CONTROLLER' ? -numberOf(effect.amount) : numberOf(effect.amount);
    case 'discard':
      return (effect.target ?? 'CONTROLLER') === 'CONTROLLER' ? -HAND_CARD * numberOf(effect.amount) : HAND_CARD;
    case 'choice':
    case 'or':
      return Math.max(...effect.options.map((o) => estimate(game, chooser, ctx, o)));
    default: {
      if (!('target' in effect) || typeof effect.target === 'string' && ['CONTROLLER', 'OPPONENT', 'EACH_OPPONENT', 'OPPONENTS', 'EACH_PLAYER', 'ALL_PLAYERS'].includes(effect.target)) return 0.1;
      const { all, cards } = previewTargets(game, ctx, effect);
      if (!cards.length) return 0;
      const scores = cards.map((inst) => utility(game, chooser, effect, inst));
      return all ? scores.reduce((s, x) => s + x, 0) : Math.max(...scores);
    }
  }
};

/** Whether the controller uses a "you may": played ahead in the real game, guessed in a copy. */
export const acceptOptional = (game, chooser, ctx, effect) => {
  if (game.depth > 0) return estimate(game, chooser, ctx, effect) > 0;
  return effectOutcome(game, chooser, ctx, effect) > evaluate(game, chooser);
};

/** The option a player picks among several effects. */
export const chooseOption = (game, chooser, ctx, options) => {
  const scores = options.map((o) => (game.depth > 0 ? estimate(game, chooser, ctx, o) : effectOutcome(game, chooser, ctx, o)));
  // A guess that cannot be made (NaN) never wins, the first option stays the default
  let best = 0;
  scores.forEach((score, i) => {
    if (score > scores[best] || Number.isNaN(scores[best])) best = i;
  });
  return best;
};

// ---------- Cards out of play ----------

/** What a card is worth to have, in hand or to play: its lore, size and abilities, then its cost. */
export const cardWorth = (card) =>
  card.kind === 'character' ? card.lore * FUTURE_QUESTS + (card.strength + card.willpower) * 0.3 + card.worth : card.cost * 0.5 + card.worth;

/**
 * Card positions a player picks in a zone (the hand by default) for a purpose: the worst ones
 * to discard their own or to ink, the best ones to play, return or take into hand. A player
 * choosing in an opponent's hand takes their best.
 */
export const chooseFromHand = (game, chooser, owner, positions, n, purpose, zone = game.players[owner].hand) => {
  const worth = (pos) => {
    const card = cardOf(game, owner, zone[pos]);
    return cardWorth(card) + (purpose === 'ink' && !card.inkwell ? 100 : 0);
  };
  const worstFirst = (purpose === 'discard' || purpose === 'ink') && chooser === owner;
  return positions
    .slice()
    .sort((a, b) => (worstFirst ? worth(a) - worth(b) : worth(b) - worth(a)))
    .slice(0, n);
};

/** Cards looked at on top of the deck, in the order a player wants them in a zone. */
export const rankForHand = (game, p, idxs, zone) => {
  const worstFirst = zone === 'discard' || zone === 'deck-bottom' || zone === 'inkwell';
  return idxs.slice().sort((a, b) => {
    const d = cardWorth(cardOf(game, p, a)) - cardWorth(cardOf(game, p, b));
    return worstFirst ? d : -d;
  });
};
