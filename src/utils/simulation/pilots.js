import {
  LORE_TO_WIN,
  activate,
  activatedOf,
  boost,
  canActivate,
  canBoost,
  canMove,
  canChallenge,
  canQuest,
  canSing,
  cardOf,
  challenge,
  challengeOutcome,
  challengeTargets,
  costOf,
  inkCard,
  isRestricted,
  keywordOf,
  mayPlay,
  moveCharacter,
  playCard,
  quest,
  singValue,
  statOf,
  strengthOf,
} from './engine.js';
import { evaluate, lookahead, valueOf } from './decisions.js';

/**
 * The players of the simulations: simple rules weighted by the deck's style. Every value is in
 * lore: a quest is worth its lore, a character in play the lore it should still bring and a bit
 * for its stats. Cards with abilities are played ahead in a copy of the game before being played.
 * Pure functions, so the MCP server can share them.
 */

export const STYLES = [
  { key: 'aggro', label: 'Aggro' },
  { key: 'midrange', label: 'Midrange' },
  { key: 'control', label: 'Contrôle' },
];

export const styleLabel = (key) => STYLES.find((s) => s.key === key)?.label ?? key;

/**
 * mulliganAbove: cards costing more go back from the opening hand; inkUntil: inks every turn
 * up to that much ink; questBias: weight of the lore a quest brings; exposure: share of a
 * character's value it fears to lose by questing in reach of an opposing character;
 * challengeMin: score a challenge needs.
 */
const PARAMS = {
  aggro: { mulliganAbove: 3, inkUntil: 5, questBias: 1.5, exposure: 0, challengeMin: 0.5 },
  midrange: { mulliganAbove: 4, inkUntil: 7, questBias: 1, exposure: 0.3, challengeMin: 0 },
  control: { mulliganAbove: 5, inkUntil: 9, questBias: 0.8, exposure: 0.5, challengeMin: -0.5 },
};

// Plays and abilities a turn tries at most, and the gain one needs (lore)
const MAX_STEPS = 30;
const MIN_GAIN = 0.05;

// A card the engine plays for more than its stats: kept rather than inked
const isPlayable = (card) => !card.uncovered || card.uncovered === 'partial' || card.uncovered === 'ability';

/** Lore the opponent can reach on their next turn: their characters all ready by then. */
const opponentReach = (game, p) => {
  const opp = game.players[1 - p];
  return (
    opp.lore +
    opp.characters.reduce((s, c) => s + (keywordOf(game, c, 'Reckless') || isRestricted(game, c, 'cant-quest') ? 0 : statOf(game, c, 'lore')), 0) +
    opp.locations.reduce((s, l) => s + statOf(game, l, 'lore'), 0)
  );
};

/** Cards going back from the opening hand: the expensive ones, and the uninkable ones when ink is short. */
const mulligan = (params) => (game, p) => {
  const me = game.players[p];
  const cards = me.hand.map((idx) => cardOf(game, p, idx));
  const back = cards.map((_, pos) => pos).filter((pos) => cards[pos].cost > params.mulliganAbove);
  const kept = cards.map((_, pos) => pos).filter((pos) => !back.includes(pos));
  if (kept.filter((pos) => cards[pos].inkwell).length < 2) back.push(...kept.filter((pos) => !cards[pos].inkwell));
  return back;
};

/** How much the pilot wants to keep a card rather than ink it. */
const keepScore = (style, game, p, card) => {
  // Cards the engine cannot play are ink
  if (!isPlayable(card)) return -100;
  const me = game.players[p];
  const shiftReady = card.shift && me.characters.some((c) => card.shift.bases.includes(c.card.key)) ? 4 : 0;
  // Aggro keeps its cheap cards, the others the ones they can play in the next turns
  if (style === 'aggro') return shiftReady - card.cost;
  return shiftReady - Math.abs(card.cost - (me.inkwell + 2));
};

const inkTurn = (style, params, game, p) => {
  const me = game.players[p];
  const inkable = me.hand.map((idx, pos) => ({ pos, card: cardOf(game, p, idx) })).filter((x) => x.card.inkwell);
  if (!inkable.length) return;
  const wants =
    me.inkwell < params.inkUntil ||
    inkable.some((x) => !isPlayable(x.card)) ||
    me.hand.some((idx) => isPlayable(cardOf(game, p, idx)) && cardOf(game, p, idx).cost > me.inkwell);
  if (!wants) return;
  const pick = inkable.reduce((a, b) => (keepScore(style, game, p, b.card) < keepScore(style, game, p, a.card) ? b : a));
  inkCard(game, p, pick.pos);
};

/**
 * Ready, dry characters to sing a song: the one with the least lore to give up that can sing it
 * alone, or the fewest together (Sing Together).
 */
const singersFor = (game, p, song) => {
  const ready = game.players[p].characters
    .filter((c) => !c.exerted && c.playedTurn < game.turn)
    .sort((a, b) => statOf(game, a, 'lore') - statOf(game, b, 'lore'));
  const alone = ready.find((c) => canSing(game, song, [c]));
  if (alone) return [alone];
  if (!song.singTogether) return null;
  const group = [];
  for (const c of ready.sort((a, b) => singValue(game, b) - singValue(game, a))) {
    group.push(c);
    if (canSing(game, song, group)) return group;
  }
  return null;
};

/** What the pilot can do in its main phase: play a card from hand (paid, shifted or sung), use an ability, Boost, move to a location. */
const options = (game, p) => {
  const me = game.players[p];
  const out = [];
  const seen = new Set();
  me.hand.forEach((idx, pos) => {
    if (seen.has(idx)) return;
    seen.add(idx);
    const card = cardOf(game, p, idx);
    if (!mayPlay(game, p, card) || (card.kind === 'action' && !card.abilities?.action)) return;
    if (costOf(game, p, card) <= me.ink) out.push({ kind: 'play', pos, card });
    if (card.shift && costOf(game, p, card, { shift: true }) <= me.ink) {
      const bases = me.characters.filter((c) => card.shift.bases.includes(c.card.key));
      // A ready, dry base passes it on: the new character acts at once
      const base = bases.find((c) => !c.exerted && c.playedTurn < game.turn) ?? bases[0];
      if (base) out.push({ kind: 'play', pos, card, base });
    }
    if (card.song) {
      const singers = singersFor(game, p, card);
      if (singers) out.push({ kind: 'play', pos, card, singers });
    }
  });
  for (const inst of [...me.characters, ...me.items, ...me.locations]) {
    for (const ability of activatedOf(game, inst)) {
      if (canActivate(game, p, inst, ability)) out.push({ kind: 'activate', inst, ability });
    }
    if (canBoost(game, p, inst)) out.push({ kind: 'boost', inst });
  }
  // Moves to the locations whose abilities do something for the characters there
  for (const loc of me.locations) {
    if (!loc.card.hereWorth && !loc.card.abilities?.statics.length) continue;
    for (const c of me.characters) if (canMove(game, p, c, loc)) out.push({ kind: 'move', inst: c, loc });
  }
  return out;
};

// A Bodyguard enters exerted to protect the others: it could not act this turn anyway
const entersExerted = (game, p, card, base) => card.keywords.Bodyguard > 0 && !card.keywords.Rush && !base && game.players[p].characters.length > 0;

const perform = (game, p, o) => {
  if (o.kind === 'activate') return activate(game, p, o.inst, o.ability);
  if (o.kind === 'boost') return boost(game, p, o.inst);
  if (o.kind === 'move') return moveCharacter(game, p, o.inst, o.loc);
  return playCard(game, p, o.pos, { base: o.base ?? null, exerted: entersExerted(game, p, o.card, o.base), singers: o.singers ?? null });
};

/** The same option in a copy of the game, its cards found again in the copy. */
const inCopy = (clone, o) => ({
  ...o,
  base: o.base && clone.map.get(o.base),
  singers: o.singers?.map((s) => clone.map.get(s)),
  inst: o.inst && clone.map.get(o.inst),
  loc: o.loc && clone.map.get(o.loc),
});

/**
 * Plays the best option while one still gains something: each is played ahead in a copy of the
 * game and the outcome weighed. Between two even options the dearer goes first: a big
 * character before a small one the ink left may still pay for.
 */
const mainPhase = (game, p) => {
  for (let step = 0; step < MAX_STEPS && !game.over; step++) {
    const list = options(game, p);
    if (!list.length) return;
    const now = evaluate(game, p);
    let best = null;
    for (const o of list) {
      const gain = lookahead(game, p, (clone) => perform(clone, p, inCopy(clone, o))) - now;
      const score = gain + (o.kind === 'play' && !o.singers ? 0.05 * o.card.cost : 0);
      if (!best || score > best.score) best = { o, score, gain };
    }
    if (best.gain <= MIN_GAIN) return;
    perform(game, p, best.o);
  }
};

/** Score of a challenge: the value it removes, minus the value it loses and the lore not quested. */
const challengeScore = (game, params, attacker, target, danger) => {
  const { dealt, taken, banishes, banished } = challengeOutcome(game, attacker, target);
  const targetValue = valueOf(game, target) * (danger && target.card.kind === 'character' ? 2 : 1);
  const left = statOf(game, target, 'willpower') - target.damage;
  const gain = banishes ? targetValue : dealt ? (targetValue * dealt * 0.3) / Math.max(1, left) : 0;
  const attackerValue = valueOf(game, attacker);
  const own = statOf(game, attacker, 'willpower') - attacker.damage;
  const loss = banished ? attackerValue : taken ? (attackerValue * taken * 0.3) / Math.max(1, own) : 0;
  const forgone = canQuest(game, attacker) ? statOf(game, attacker, 'lore') * params.questBias : 0;
  return gain - loss - forgone;
};

const bestChallenge = (game, p, params, attackers, danger) => {
  let best = null;
  for (const attacker of attackers) {
    for (const target of challengeTargets(game, p, attacker)) {
      const score = challengeScore(game, params, attacker, target, danger);
      if (!best || score > best.score) best = { attacker, target, score };
    }
  }
  return best;
};

/**
 * Value a character risks by questing: an opposing character could banish it in a challenge
 * next turn (they all ready by then) and survive. A trade is a fair deal, not a risk.
 */
const exposure = (game, p, char) => {
  const left = statOf(game, char, 'willpower') - char.damage;
  const evasive = keywordOf(game, char, 'Evasive') > 0;
  const threatened = game.players[1 - p].characters.some(
    (o) =>
      !isRestricted(game, o, 'cant-challenge') &&
      (!evasive || keywordOf(game, o, 'Evasive') > 0 || keywordOf(game, o, 'Alert') > 0) &&
      Math.max(0, strengthOf(game, o, true) - keywordOf(game, char, 'Resist')) >= left &&
      Math.max(0, strengthOf(game, char) - keywordOf(game, o, 'Resist')) < statOf(game, o, 'willpower') - o.damage
  );
  return threatened ? valueOf(game, char) : 0;
};

const shouldQuest = (game, p, params, char) => {
  const lore = statOf(game, char, 'lore');
  if (lore <= 0) return false;
  const me = game.players[p];
  const opp = game.players[1 - p];
  // Close to the end or behind, lore matters more than the board
  const race = Math.max(me.lore, opp.lore) >= 13 || opp.lore >= me.lore + 4 ? 0.5 : 1;
  return lore * params.questBias >= exposure(game, p, char) * params.exposure * race;
};

/**
 * A Support character quests first when its strength lets another character win a challenge
 * it could not win alone.
 */
const supportTurn = (game, p, params, danger) => {
  const me = game.players[p];
  for (const supporter of me.characters.filter((c) => keywordOf(game, c, 'Support') > 0)) {
    if (game.over || !canQuest(game, supporter) || !shouldQuest(game, p, params, supporter)) continue;
    const others = me.characters.filter((c) => c !== supporter && canChallenge(game, c));
    const strength = strengthOf(game, supporter);
    let pick = null;
    for (const other of others) {
      const before = bestChallenge(game, p, params, [other], danger)?.score ?? -Infinity;
      other.bonus += strength;
      const after = bestChallenge(game, p, params, [other], danger)?.score ?? -Infinity;
      other.bonus -= strength;
      if (after > params.challengeMin && after > before && (!pick || after - before > pick.gain)) pick = { other, gain: after - before };
    }
    if (pick) quest(game, p, supporter, pick.other);
  }
};

const takeTurn = (style, params) => (game, p) => {
  const me = game.players[p];
  inkTurn(style, params, game, p);
  mainPhase(game, p);
  if (game.over) return;

  // Enough lore within reach: quest with everyone and win
  const questers = me.characters.filter((c) => canQuest(game, c));
  if (me.lore + questers.reduce((s, c) => s + statOf(game, c, 'lore'), 0) >= LORE_TO_WIN) {
    for (const c of questers) if (!game.over && c.zone === 'play' && canQuest(game, c)) quest(game, p, c);
    return;
  }

  // The opponent wins next turn unless some of their characters go
  const danger = opponentReach(game, p) >= LORE_TO_WIN;
  supportTurn(game, p, params, danger);
  if (game.over) return;
  for (;;) {
    const attackers = me.characters.filter((c) => canChallenge(game, c));
    const best = bestChallenge(game, p, params, attackers, danger);
    if (!best || best.score <= params.challengeMin) break;
    challenge(game, p, best.attacker, best.target);
    if (game.over) return;
  }
  // Reckless characters must challenge when they can
  for (const c of me.characters.filter((x) => keywordOf(game, x, 'Reckless') > 0)) {
    if (game.over || c.zone !== 'play' || !canChallenge(game, c)) continue;
    const best = bestChallenge(game, p, params, [c], danger);
    if (best) challenge(game, p, c, best.target);
  }
  // Still losing next turn: no character is worth keeping back
  const allIn = opponentReach(game, p) >= LORE_TO_WIN;
  for (const c of [...me.characters]) {
    if (game.over) return;
    if (c.zone !== 'play' || !canQuest(game, c)) continue;
    if (isRestricted(game, c, 'must-quest') || (allIn ? statOf(game, c, 'lore') > 0 : shouldQuest(game, p, params, c))) quest(game, p, c);
  }
  // Abilities still worth using once the characters are done
  mainPhase(game, p);
};

/** A pilot for a style: { style, mulligan(game, p), takeTurn(game, p) }. */
export const createPilot = (style) => {
  const params = PARAMS[style] ?? PARAMS.midrange;
  return { style, mulligan: mulligan(params), takeTurn: takeTurn(style, params) };
};
