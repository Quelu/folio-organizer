import { useEffect, useMemo, useState } from 'react';
import { usePrices } from './usePrices';
import { buildHistory, loadMonths, onHistoryChange, periodPoints, priceSeries, valueSeries } from '../utils/priceHistory';

// Read once for every component, again once days are recorded or imported
let historyPromise = null;
let history; // undefined while loading
let reloadTimer = null;
const subscribers = new Set();

const load = () => {
  historyPromise ??= loadMonths().then((months) => {
    history = buildHistory(months);
    subscribers.forEach((fn) => fn(history));
    return history;
  });
  return historyPromise;
};

// An import adds several months in a row: read them back once
onHistoryChange(() => {
  historyPromise = null;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => subscribers.size && load(), 200);
});

/**
 * Price history bound to the current prices (see utils/priceHistory.js).
 * @returns {{ status: 'loading'|'ready'|'unavailable', days: object[],
 *   points: (period: number) => number[],
 *   priceSeries: (card: object, foil: boolean, points: number[]) => number[]|null,
 *   valueSeries: (items: object[], points: number[]) => number[] }}
 *   unavailable: prices in dollars, Cardmarket out of reach, so nothing to compare with
 */
export const usePriceHistory = () => {
  const prices = usePrices();
  const [days, setDays] = useState(history);

  useEffect(() => {
    let cancelled = false;
    subscribers.add(setDays);
    load().then((result) => {
      if (!cancelled) setDays(result);
    });
    return () => {
      cancelled = true;
      subscribers.delete(setDays);
    };
  }, []);

  return useMemo(() => {
    const list = days ?? [];
    return {
      status: prices.status === 'loading' || days === undefined ? 'loading' : prices.currency === 'EUR' ? 'ready' : 'unavailable',
      days: list,
      points: (period) => periodPoints(list, period),
      priceSeries: (card, foil, points) => priceSeries(list, points, prices.getProductId(card), card, foil),
      valueSeries: (items, points) => valueSeries(list, points, items, prices.getProductId),
    };
  }, [prices, days]);
};
