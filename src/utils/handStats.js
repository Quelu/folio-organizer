/** Opening hand helpers: shuffling and exact draw probabilities (hypergeometric). */

export const OPENING_HAND = 7;

/** Fisher-Yates shuffle, returns a shuffled copy. */
export const shuffle = (array) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Binomial coefficient as a float (exact enough for decks of a few hundred cards). */
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - i + 1)) / i;
  return result;
};

/** Probability of drawing exactly k of the successes in draws cards. */
export const probExactly = (k, successes, deckSize, draws) => {
  const n = Math.min(draws, deckSize);
  const total = choose(deckSize, n);
  return total ? (choose(successes, k) * choose(deckSize - successes, n - k)) / total : 0;
};

/** Probability of drawing at least k of the successes in draws cards. */
export const probAtLeast = (k, successes, deckSize, draws) => {
  if (k <= 0) return 1;
  let below = 0;
  for (let x = 0; x < k; x++) below += probExactly(x, successes, deckSize, draws);
  return Math.min(1, Math.max(0, 1 - below));
};

/** One library card per copy: { uid, key, name, card }. */
export const buildLibrary = (entries) =>
  entries.flatMap((e) => Array.from({ length: e.qty }, (_, i) => ({ uid: `${e.key}#${i}`, key: e.key, name: e.name, card: e.card })));

/** Cards seen by turn 3: the opening hand plus 2 draws on the play, 3 on the draw. */
export const CARDS_BY_TURN_3 = { play: OPENING_HAND + 2, draw: OPENING_HAND + 3 };

export const formatPercent = (p) => `${Math.round(p * 100)} %`;

/** Cards seen in turn t's main phase: the opening hand plus a draw a turn, none on turn 1 when going first. */
export const cardsSeenByTurn = (turn, onThePlay) => OPENING_HAND + turn - (onThePlay ? 1 : 0);

/**
 * Exact probability of putting a card in the inkwell on each of turns 1…turns and, with copies,
 * of also holding a copy of a card by turn max(turns, 1): the odds of playing a card of cost
 * `turns` on curve. A copy kept to be played is not inked; the mulligan is not counted.
 * Draws one card at a time, tracking the copies and the other inkable cards seen.
 * @param {{ deckSize: number, inkable: number, turns: number, onThePlay: boolean, copies?: number,
 *   copiesInkable?: boolean }} p inkable counts every inkable card, the copies included
 */
export const probOnCurve = ({ deckSize, inkable, turns, onThePlay, copies = 0, copiesInkable = false }) => {
  const others = inkable - (copiesInkable ? copies : 0);
  const rest = deckSize - copies - others;
  // Ink needed once n cards are seen
  const needed = new Map();
  for (let t = 1; t <= turns; t++) needed.set(Math.min(deckSize, cardsSeenByTurn(t, onThePlay)), t);
  const end = Math.min(deckSize, cardsSeenByTurn(Math.max(turns, 1), onThePlay));
  // dist[x][k]: probability of having seen x copies and k other inkable cards
  let dist = Array.from({ length: copies + 1 }, () => new Float64Array(others + 1));
  dist[0][0] = 1;
  for (let n = 0; n < end; n++) {
    const next = Array.from({ length: copies + 1 }, () => new Float64Array(others + 1));
    const remaining = deckSize - n;
    for (let x = 0; x <= copies; x++) {
      for (let k = 0; k <= others; k++) {
        const p = dist[x][k];
        if (!p) continue;
        if (x < copies) next[x + 1][k] += (p * (copies - x)) / remaining;
        if (k < others) next[x][k + 1] += (p * (others - k)) / remaining;
        const restLeft = rest - (n - x - k);
        if (restLeft > 0) next[x][k] += (p * restLeft) / remaining;
      }
    }
    const ink = needed.get(n + 1);
    if (ink) {
      for (let x = 0; x <= copies; x++) {
        for (let k = 0; k <= others; k++) {
          const usable = k + (copiesInkable ? Math.max(0, x - 1) : 0);
          if (usable < ink) next[x][k] = 0;
        }
      }
    }
    dist = next;
  }
  let total = 0;
  for (let x = copies ? 1 : 0; x <= copies; x++) for (const p of dist[x]) total += p;
  return Math.min(1, total);
};

export const LORE_TO_WIN = 20;
const GOLDFISH_MAX_TURNS = 25;

const isPermanent = (card) => card.types.includes('Character') || card.types.includes('Location');

/**
 * One game alone ("goldfish"), card effects ignored: each turn one card is inked (an action or an
 * item first, they bring no lore here, else the most expensive one), then the most expensive
 * characters and locations affordable are played, Shift going on a base in play; dry characters
 * quest and locations give their lore at the start of the turn.
 * @param {{ card }[]} library one item per copy (buildLibrary)
 * @param {Map<string, { cost: number, bases: Set<string> }>} shifts Shift cards by key
 * @returns {number|null} turn the 20th lore is reached, null past GOLDFISH_MAX_TURNS
 */
const playGoldfish = (library, onThePlay, shifts) => {
  const deck = shuffle(library.filter((c) => c.card));
  const hand = deck.splice(0, OPENING_HAND);
  const inPlay = []; // { key, card, dry }
  let inkwell = 0;
  let lore = 0;
  for (let turn = 1; turn <= GOLDFISH_MAX_TURNS; turn++) {
    for (const p of inPlay) {
      p.dry = true;
      if (p.card.types.includes('Location')) lore += p.card.lore ?? 0;
    }
    if (lore >= LORE_TO_WIN) return turn;
    if ((turn > 1 || !onThePlay) && deck.length) hand.push(deck.shift());

    const inkable = hand.filter((c) => c.card.inkwell);
    if (inkable.length) {
      const pick = inkable.find((c) => !isPermanent(c.card)) ?? inkable.reduce((a, b) => (b.card.cost > a.card.cost ? b : a));
      hand.splice(hand.indexOf(pick), 1);
      inkwell++;
    }

    let ink = inkwell;
    for (;;) {
      const plays = [];
      for (const c of hand) {
        const shift = shifts.get(c.key);
        const base = shift && shift.cost <= ink ? inPlay.find((p) => shift.bases.has(p.key)) : null;
        if (base) plays.push({ c, cost: shift.cost, base });
        else if (isPermanent(c.card) && c.card.cost <= ink) plays.push({ c, cost: c.card.cost, base: null });
      }
      if (!plays.length) break;
      // A shifted character keeps its base's readiness: it may quest at once
      const best = plays.reduce((a, b) => (b.cost > a.cost || (b.cost === a.cost && b.base?.dry && !a.base?.dry) ? b : a));
      hand.splice(hand.indexOf(best.c), 1);
      ink -= best.cost;
      if (best.base) inPlay.splice(inPlay.indexOf(best.base), 1, { key: best.c.key, card: best.c.card, dry: best.base.dry });
      else inPlay.push({ key: best.c.key, card: best.c.card, dry: false });
    }

    for (const p of inPlay) {
      if (p.dry && p.card.types.includes('Character')) lore += p.card.lore ?? 0;
    }
    if (lore >= LORE_TO_WIN) return turn;
  }
  return null;
};

/**
 * Turns a deck takes to reach 20 lore alone, over many games (see playGoldfish).
 * @returns {{ byTurn: number[], average: number|null, median: number|null, never: number }}
 *   byTurn[t]: share of the games won on turn t; never: share still under 20 lore on turn 25
 */
export const simulateGoldfish = (library, { onThePlay, shifts = new Map(), games = 2000 }) => {
  const byTurn = Array.from({ length: GOLDFISH_MAX_TURNS + 1 }, () => 0);
  const turns = [];
  for (let i = 0; i < games; i++) {
    const turn = playGoldfish(library, onThePlay, shifts);
    if (turn) {
      byTurn[turn]++;
      turns.push(turn);
    }
  }
  turns.sort((a, b) => a - b);
  return {
    byTurn: byTurn.map((n) => n / games),
    average: turns.length ? turns.reduce((s, t) => s + t, 0) / turns.length : null,
    median: turns.length ? turns[Math.floor(turns.length / 2)] : null,
    never: (games - turns.length) / games,
  };
};
