import { gameSeed, playGame } from '../utils/simulation/engine';
import { createPilot } from '../utils/simulation/pilots';
import { addGame, createTally } from '../utils/simulation/stats';

/**
 * Plays the simulated games away from the interface (see useSimulation): { type: 'setup',
 * decks, styles, seed }, then { type: 'batch', from, count } answered with { from, tally }.
 * Game n has its own seed and alternates the starting deck: any game can be replayed.
 */
let setup = null;

self.onmessage = ({ data }) => {
  if (data.type === 'setup') {
    setup = { decks: data.decks, seed: data.seed, pilots: data.styles.map(createPilot) };
    return;
  }
  const { decks, seed, pilots } = setup;
  const tally = createTally(decks.map((d) => d.cards.length));
  for (let n = data.from; n < data.from + data.count; n++) {
    addGame(tally, playGame(decks, { seed: gameSeed(seed, n), first: n % 2, pilots }));
  }
  self.postMessage({ from: data.from, tally });
};
