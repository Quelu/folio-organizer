import { LORE_TO_WIN } from './engine.js';

/**
 * Results of many simulated games, added up game by game, and what can be read from them:
 * win rates with their margin of error (Wilson interval at 95 %), game lengths, lore curves
 * and the impact of drawing each card. A tally holds plain arrays: workers send it as is.
 */

// Rounds of the lore curve: a round is a turn of each player
export const CURVE_ROUNDS = 20;
// Fewest games before the margin of error is trusted to stop a run
export const MIN_GAMES = 200;
const Z = 1.96;

/** An empty tally for two decks of nA and nB different cards. */
export const createTally = ([nA, nB]) => ({
  games: 0,
  wins: [0, 0],
  ties: 0,
  // Games each deck started, and its wins in them
  started: [0, 0],
  startedWins: [0, 0],
  reasons: { lore: 0, deckout: 0, timeout: 0 },
  // Games ended on each round, and the ones each deck won on it
  rounds: [],
  roundWins: [[], []],
  // Summed lore at the end of each round, a finished game keeping its last lore
  lore: [Array(CURVE_ROUNDS).fill(0), Array(CURVE_ROUNDS).fill(0)],
  mulligans: [0, 0],
  // Per card: games where it reached the hand, and the wins among them
  seen: [Array(nA).fill(0), Array(nB).fill(0)],
  seenWins: [Array(nA).fill(0), Array(nB).fill(0)],
});

/** Adds a game of playGame to the tally. */
export const addGame = (tally, result) => {
  const { winner, reason, turns, first, lore, seen, mulligans } = result;
  tally.games++;
  if (winner == null) tally.ties++;
  else tally.wins[winner]++;
  tally.started[first]++;
  if (winner === first) tally.startedWins[first]++;
  tally.reasons[reason]++;
  const round = Math.ceil(turns / 2);
  tally.rounds[round] = (tally.rounds[round] ?? 0) + 1;
  if (winner != null) tally.roundWins[winner][round] = (tally.roundWins[winner][round] ?? 0) + 1;
  for (const p of [0, 1]) {
    tally.mulligans[p] += mulligans[p];
    const curve = lore[p];
    for (let r = 0; r < CURVE_ROUNDS; r++) {
      tally.lore[p][r] += Math.min(LORE_TO_WIN, curve[Math.min(r, curve.length - 1)] ?? 0);
    }
    for (let i = 0; i < seen[p].length; i++) {
      if (!seen[p][i]) continue;
      tally.seen[p][i]++;
      if (winner === p) tally.seenWins[p][i]++;
    }
  }
  return tally;
};

const addArrays = (into, from) => {
  for (let i = 0; i < from.length; i++) into[i] = (into[i] ?? 0) + (from[i] ?? 0);
};

/** Adds tally b into tally a. */
export const mergeTallies = (a, b) => {
  a.games += b.games;
  a.ties += b.ties;
  addArrays(a.wins, b.wins);
  addArrays(a.started, b.started);
  addArrays(a.startedWins, b.startedWins);
  for (const key of Object.keys(a.reasons)) a.reasons[key] += b.reasons[key];
  addArrays(a.rounds, b.rounds);
  addArrays(a.mulligans, b.mulligans);
  for (const p of [0, 1]) {
    addArrays(a.roundWins[p], b.roundWins[p]);
    addArrays(a.lore[p], b.lore[p]);
    addArrays(a.seen[p], b.seen[p]);
    addArrays(a.seenWins[p], b.seenWins[p]);
  }
  return a;
};

/**
 * Wilson interval of a success rate at 95 %.
 * @returns {{ rate: number, low: number, high: number, margin: number } | null}
 */
export const wilson = (successes, n) => {
  if (!n) return null;
  const rate = successes / n;
  const d = 1 + (Z * Z) / n;
  const center = (rate + (Z * Z) / (2 * n)) / d;
  const margin = (Z * Math.sqrt((rate * (1 - rate)) / n + (Z * Z) / (4 * n * n))) / d;
  return { rate, low: Math.max(0, center - margin), high: Math.min(1, center + margin), margin };
};

/** Win rate of deck p, a tie counting as half a win; onThePlay: only its games going first (true) or second (false). */
export const winRate = (tally, p, onThePlay = null) => {
  if (onThePlay === true) return wilson(tally.startedWins[p], tally.started[p]);
  if (onThePlay === false) return wilson(tally.wins[p] - tally.startedWins[p], tally.started[1 - p]);
  return wilson(tally.wins[p] + tally.ties / 2, tally.games);
};

/** Whether the run can stop: the margin of error is down to target (0.02: ± 2 points). */
export const isPrecise = (tally, target) => tally.games >= MIN_GAMES && winRate(tally, 0).margin <= target;

/**
 * Average round the games end on, and per round the share of all the games each deck won on it.
 * @returns {{ average: number|null, byRound: { round: number, wins: number[] }[] }}
 */
export const gameLength = (tally) => {
  if (!tally.games) return { average: null, byRound: [] };
  const average = tally.rounds.reduce((s, n, round) => s + (n ?? 0) * round, 0) / tally.games;
  const byRound = Array.from(tally.rounds, (_, round) => ({
    round,
    wins: [0, 1].map((p) => (tally.roundWins[p][round] ?? 0) / tally.games),
  })).filter((r) => r.round > 0);
  return { average, byRound };
};

/** Average lore of deck p at the end of each of its turns. */
export const loreCurve = (tally, p) => (tally.games ? tally.lore[p].map((sum) => sum / tally.games) : []);

// Fewest games on each side (card drawn, card not drawn) before an impact is shown as reliable
export const IMPACT_MIN_GAMES = 100;

/**
 * Per card of deck p: how often it reaches the hand, the win rate when it does and when it
 * does not, and the difference. Sorted by difference, the most decisive cards first.
 * @returns {{ index, card, drawn: number, withCard: number|null, withoutCard: number|null, delta: number|null, reliable: boolean }[]}
 */
export const cardImpact = (tally, p, cards) =>
  cards
    .map((card, index) => {
      const seen = tally.seen[p][index];
      const notSeen = tally.games - seen;
      const winsWith = tally.seenWins[p][index];
      const withCard = seen ? winsWith / seen : null;
      const withoutCard = notSeen ? (tally.wins[p] - winsWith) / notSeen : null;
      return {
        index,
        card,
        drawn: tally.games ? seen / tally.games : 0,
        withCard,
        withoutCard,
        delta: withCard != null && withoutCard != null ? withCard - withoutCard : null,
        reliable: seen >= IMPACT_MIN_GAMES && notSeen >= IMPACT_MIN_GAMES,
      };
    })
    .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
