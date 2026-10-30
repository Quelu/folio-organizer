import { idbGet, idbGetAll, idbSet } from './db.js';
import { pickPrice } from './catalog.js';
import { guidePrices } from './cardmarketPrices.js';

/**
 * Cardmarket price history: what every Lorcana single cost on each day Folio loaded Cardmarket's
 * price guide. Cardmarket only publishes today's prices, so the history only exists because Folio
 * keeps it: by month in IndexedDB, copied to monthly files of the auto backup folder.
 *
 * A month is { month: 'AAAA-MM', ids: number[], days: { 'AAAA-MM-JJ': { at, eur: number[], foil: number[] } } }.
 * ids are Cardmarket idProducts, only ever appended to; each day's prices follow their order
 * (shorter when a product showed up later), in euros, 0 when unknown.
 * Months only ever gain days: a recorded day is never replaced nor removed.
 */

export const PRICE_HISTORY_KIND = 'folio-price-history';
const STORE = 'priceHistory';
const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Monthly files of the backup folder (the MCP server only reads folio-sauvegarde-*.json). */
export const historyFileName = (month) => `folio-prix-${month}.json`;
export const HISTORY_FILE = /^folio-prix-(\d{4}-\d{2})\.json$/;

const pad = (n) => String(n).padStart(2, '0');

/** 'AAAA-MM-JJ' in local time. */
export const localDay = (time = Date.now()) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The day a price guide is from: its Cardmarket date, else the day it was downloaded. */
export const guideDay = ({ createdAt, at }) => (DAY.test(createdAt?.slice(0, 10) ?? '') ? createdAt.slice(0, 10) : localDay(at));

/** Whole days from one 'AAAA-MM-JJ' to another. */
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/**
 * A month completed with the days of another it lacks, re-aligned on its products.
 * Returns base itself when the other brings nothing new.
 */
export const mergeMonth = (base, extra) => {
  if (!extra) return base;
  if (!base) return extra;
  const missing = Object.keys(extra.days).filter((day) => !base.days[day]);
  if (!missing.length) return base;
  const ids = [...base.ids];
  const position = new Map(ids.map((id, i) => [id, i]));
  for (const id of extra.ids) {
    if (position.has(id)) continue;
    position.set(id, ids.length);
    ids.push(id);
  }
  const days = { ...base.days };
  for (const day of missing) {
    const { at, eur, foil } = extra.days[day];
    const aligned = { at, eur: new Array(ids.length).fill(0), foil: new Array(ids.length).fill(0) };
    extra.ids.forEach((id, i) => {
      const j = position.get(id);
      aligned.eur[j] = eur[i] ?? 0;
      aligned.foil[j] = foil[i] ?? 0;
    });
    days[day] = aligned;
  }
  return { month: base.month, ids, days };
};

/** Whether a month already holds every day of another. */
export const hasDays = (month, other) => Boolean(month) && Object.keys(other.days).every((day) => month.days[day]);

const listeners = new Set();

/** Calls fn(month) each time days are added to a month; returns the unsubscribe function. */
export const onHistoryChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Read, merge, write: one at a time, so two writers never drop each other's days
let queue = Promise.resolve();
const serial = (task) => {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
};

export const loadMonth = (month) => idbGet(STORE, month);

/** Every stored month, oldest first. */
export const loadMonths = async () => (await idbGetAll(STORE)).sort((a, b) => a.month.localeCompare(b.month));

/** Adds months (or days of them) to the stored history; resolves to the number of days added. */
export const addMonths = (months) =>
  serial(async () => {
    let added = 0;
    for (const month of months) {
      const stored = await idbGet(STORE, month.month);
      const merged = mergeMonth(stored, month);
      // Nothing new, or IndexedDB unavailable: the next price load records the day again
      if (merged === stored || (await idbSet(STORE, month.month, merged)) == null) continue;
      added += Object.keys(merged.days).length - Object.keys(stored?.days ?? {}).length;
      listeners.forEach((fn) => fn(month.month));
    }
    return added;
  });

/** Records the day of a Cardmarket price guide; loading the same day again changes nothing. */
export const recordGuide = ({ createdAt, at, guides }) => {
  const day = guideDay({ createdAt, at });
  const ids = [];
  const eur = [];
  const foil = [];
  for (const guide of guides) {
    const prices = guidePrices(guide);
    ids.push(guide.idProduct);
    eur.push(prices.eur ?? 0);
    foil.push(prices.eurFoil ?? 0);
  }
  return addMonths([{ month: day.slice(0, 7), ids, days: { [day]: { at: createdAt ?? new Date(at).toISOString(), eur, foil } } }]);
};

/** A history file's contents: one month (backup folder) or all of them (download). */
export const serializeHistory = (months) => JSON.stringify({ kind: PRICE_HISTORY_KIND, version: 1, months });

const isMonth = (m) =>
  MONTH.test(m?.month) &&
  Array.isArray(m.ids) &&
  m.days !== null &&
  typeof m.days === 'object' &&
  Object.entries(m.days).every(([day, d]) => DAY.test(day) && day.startsWith(m.month) && Array.isArray(d?.eur) && Array.isArray(d?.foil));

/** The months of a parsed history file, or null when it is not one. */
export const parseHistory = (data) =>
  data?.kind === PRICE_HISTORY_KIND && Array.isArray(data.months) && data.months.every(isMonth) ? data.months : null;

/**
 * The history ready for lookups: one entry per recorded day, oldest first.
 * @returns {{ day: string, position: Map<number, number>, eur: number[], foil: number[] }[]}
 */
export const buildHistory = (months) =>
  months.flatMap((m) => {
    const position = new Map(m.ids.map((id, i) => [id, i]));
    return Object.keys(m.days)
      .sort()
      .map((day) => ({ day, position, eur: m.days[day].eur, foil: m.days[day].foil }));
  });

/**
 * Indexes of the days to draw for the last `period` days: every recorded day, or the last one of
 * each week beyond three months so a year stays readable. The oldest day of the period always
 * starts the list, so a change covers the whole period (or the whole history when shorter).
 */
export const periodPoints = (days, period) => {
  const points = [];
  if (!days.length) return points;
  const last = days[days.length - 1].day;
  let bucket = -1;
  let oldest = days.length - 1;
  for (let i = days.length - 1; i >= 0; i--) {
    const age = daysBetween(days[i].day, last);
    if (age > period) break;
    oldest = i;
    const b = period > 90 ? Math.floor(age / 7) : age;
    if (b === bucket) continue;
    bucket = b;
    points.push(i);
  }
  points[points.length - 1] = oldest;
  return points.reverse();
};

/**
 * Price of a printing on each point; days without a price take the nearest known one, so a card
 * priced late does not look like a rise. Null when it has no price on any point.
 */
export const priceSeries = (days, points, productId, card, foil) => {
  if (productId == null) return null;
  const raw = points.map((i) => {
    const d = days[i];
    const j = d.position.get(productId);
    return j == null ? null : pickPrice(card, foil, d.eur[j] || null, d.foil[j] || null);
  });
  const first = raw.findIndex((v) => v != null);
  if (first < 0) return null;
  let known = raw[first];
  return raw.map((v) => (v == null ? known : (known = v)));
};

/** Value of owned copies (getOwnedPrintings items) on each point, at that day's prices. */
export const valueSeries = (days, points, items, productIdOf) => {
  const values = points.map(() => 0);
  for (const item of items) {
    for (const [foil, qty] of [
      [false, item.normal],
      [true, item.foil],
    ]) {
      if (!qty) continue;
      priceSeries(days, points, productIdOf(item.card), item.card, foil)?.forEach((v, k) => {
        values[k] += v * qty;
      });
    }
  }
  return values;
};

/** First and last value of a series; ratio is the change as a fraction, null without a start value. */
export const seriesChange = (series) => {
  if (!series || series.length < 2) return null;
  const from = series[0];
  const to = series[series.length - 1];
  return { from, to, diff: to - from, ratio: from > 0 ? (to - from) / from : null };
};
