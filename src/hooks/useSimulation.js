import { useCallback, useEffect, useRef, useState } from 'react';
import { gameSeed, playGame } from '../utils/simulation/engine';
import { createPilot } from '../utils/simulation/pilots';
import { createTally, isPrecise, mergeTallies } from '../utils/simulation/stats';

// Games a worker plays between two progress updates
const BATCH = 200;
export const MAX_GAMES = 20000;
// Fewest milliseconds between two renders of a running simulation
const RENDER_EVERY = 120;

// The last run, kept while the app is open: the view finds it again after a detour
let lastRun = null;

/** Ends the worker of the view; a run still going ends with that status. */
const halt = (workerRef, status) => {
  workerRef.current?.terminate();
  workerRef.current = null;
  if (lastRun?.status === 'running') lastRun = { ...lastRun, status };
  return lastRun;
};

/**
 * Simulated games between two prepared decks (utils/simulation/deck.js) in a worker, by
 * batches, until the margin of error on the win rate is down to the target or MAX_GAMES.
 * Batches are added in order: a run is replayed exactly from its seed.
 * run: { decks, styles, labels, target, seed, status: 'running'|'done'|'stopped'|'error', tally, elapsed, error }
 */
export const useSimulation = () => {
  const [run, setRun] = useState(lastRun);
  const workerRef = useRef(null);

  // Leaving the view stops the run, its games so far stay
  useEffect(() => () => void halt(workerRef, 'stopped'), []);

  const stop = useCallback(() => setRun(halt(workerRef, 'stopped')), []);

  /** @param {{ decks: object[], styles: string[], labels: string[], target: number }} params */
  const start = useCallback((params) => {
    halt(workerRef, 'stopped');
    const worker = new Worker(new URL('../workers/simulation.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const seed = Math.floor(Math.random() * 2 ** 32);
    const startedAt = Date.now();
    let tally = createTally(params.decks.map((d) => d.cards.length));
    let next = 0;
    let renderedAt = 0;

    const publish = (status, extra = {}) => {
      lastRun = { ...params, seed, status, tally, elapsed: Date.now() - startedAt, ...extra };
      if (status !== 'running' || Date.now() - renderedAt >= RENDER_EVERY) {
        renderedAt = Date.now();
        setRun(lastRun);
      }
    };
    const send = () => {
      worker.postMessage({ type: 'batch', from: next, count: BATCH });
      next += BATCH;
    };

    worker.onmessage = ({ data }) => {
      if (workerRef.current !== worker) return;
      // The worker's tally is a fresh copy: a new object for React at every batch
      tally = mergeTallies(data.tally, tally);
      if (isPrecise(tally, params.target) || tally.games >= MAX_GAMES) {
        halt(workerRef, 'done');
        publish('done');
      } else {
        send();
        publish('running');
      }
    };
    worker.onerror = (e) => {
      if (workerRef.current !== worker) return;
      e.preventDefault();
      halt(workerRef, 'error');
      publish('error', { error: e.message || 'La simulation a échoué' });
    };

    worker.postMessage({ type: 'setup', decks: params.decks, styles: params.styles, seed });
    send();
    publish('running');
  }, []);

  return { run, start, stop };
};

/** Game n of a run played again, with its log: { result, log } (see playGame). */
export const replayGame = (run, n) => {
  const log = [];
  const result = playGame(run.decks, { seed: gameSeed(run.seed, n), first: n % 2, pilots: run.styles.map(createPilot), log });
  return { result, log };
};
