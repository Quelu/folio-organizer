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
