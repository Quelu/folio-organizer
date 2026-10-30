import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from './catalogContext';
import { idbGet, idbSet } from '../utils/db';
import { pickPrice } from '../utils/catalog';
import { CARDMARKET_PRICES_URL, CARDMARKET_PRODUCTS_URL, matchCardmarketPrices } from '../utils/cardmarketPrices';
import { guideDay, localDay, recordGuide } from '../utils/priceHistory';

const CACHE_KEY = 'cardmarket-prices';
// Cardmarket publishes a new file each night: until it is out, ask again at most once an hour
const RETRY = 60 * 60 * 1000;

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
};

/** Whether a newer Cardmarket file may be out: the one we have is from before today. */
const isOutdated = (data) => guideDay(data) < localDay();

/**
 * Cardmarket files trimmed to what the matching needs, kept until a newer day is out. Matching
 * runs again on each catalog update, so chapters loaded later get their prices too.
 * Resolves to { products, guides, at, createdAt } or null when Cardmarket cannot be reached.
 */
const loadCardmarket = async () => {
  const cached = await idbGet('kv', CACHE_KEY);
  if (cached && (!isOutdated(cached) || Date.now() - cached.at < RETRY)) return cached;
  try {
    const [productList, priceGuide] = await Promise.all([
      fetchJson(CARDMARKET_PRODUCTS_URL),
      fetchJson(CARDMARKET_PRICES_URL),
    ]);
    const data = {
      at: Date.now(),
      createdAt: priceGuide.createdAt ?? null,
      products: productList.products.map(({ idProduct, idExpansion, name }) => ({ idProduct, idExpansion, name })),
      guides: priceGuide.priceGuides.map((g) => ({
        idProduct: g.idProduct,
        trend: g.trend,
        avg30: g.avg30,
        'trend-foil': g['trend-foil'],
        'avg30-foil': g['avg30-foil'],
      })),
    };
    await idbSet('kv', CACHE_KEY, data);
    return data;
  } catch {
    // Static deploy without the proxy, or offline: an outdated price list beats none
    return cached ?? null;
  }
};

// One download shared by every component, and one match per catalog index
let cardmarketPromise = null;
let cardmarket; // undefined while loading, null when unavailable
let lastLoad = 0;
let matched = { data: null, index: null, prices: null };
const subscribers = new Set();

/**
 * Loads the Cardmarket prices, again when a newer day may be out (a tab left open overnight),
 * and records each day in the price history. Safe to call often: it asks Cardmarket at most
 * once an hour.
 */
export const ensureCardmarket = () => {
  const due = !cardmarketPromise || (Date.now() - lastLoad > RETRY && (!cardmarket || isOutdated(cardmarket)));
  if (!due) return cardmarketPromise;
  lastLoad = Date.now();
  cardmarketPromise = loadCardmarket().then((result) => {
    if (result) recordGuide(result);
    if (result !== cardmarket) {
      cardmarket = result;
      subscribers.forEach((fn) => fn(result));
    }
    return result;
  });
  return cardmarketPromise;
};

const getMatched = (data, index) => {
  if (matched.data !== data || matched.index !== index) {
    matched = { data, index, prices: matchCardmarketPrices(data.products, data.guides, index) };
  }
  return matched.prices;
};

/**
 * Card prices: Cardmarket trend in euros, or the Lorcast (TCGplayer) dollar prices of the
 * catalog when Cardmarket is unavailable.
 * @returns {{ status: 'loading'|'ready', currency: 'EUR'|'USD', source: string, updatedAt: number|null,
 *   getPrice: (card: object, foil?: boolean) => number|null, getProductId: (card: object) => number|null,
 *   format: (value: number|null) => string }} getProductId: the card's Cardmarket product, which
 *   finds it in the price history (null in dollars)
 */
export const usePrices = () => {
  const { index } = useCatalog();
  const [data, setData] = useState(cardmarket);

  useEffect(() => {
    let cancelled = false;
    subscribers.add(setData);
    ensureCardmarket().then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
      subscribers.delete(setData);
    };
  }, []);

  return useMemo(() => {
    const eur = Boolean(data);
    const currency = eur ? 'EUR' : 'USD';
    const prices = eur && index ? getMatched(data, index) : null;
    const formatter = new Intl.NumberFormat('fr-BE', { style: 'currency', currency });

    const getPrice = (card, foil = false) => {
      if (!card) return null;
      if (eur) {
        const p = prices?.get(card.id);
        return p ? pickPrice(card, foil, p.eur, p.eurFoil) : null;
      }
      return pickPrice(card, foil, card.usd, card.usdFoil);
    };

    return {
      status: data === undefined || !index ? 'loading' : 'ready',
      currency,
      source: eur ? 'Cardmarket' : 'Lorcast (TCGplayer)',
      updatedAt: eur ? data.at : null,
      getPrice,
      getProductId: (card) => prices?.get(card?.id)?.idProduct ?? null,
      format: (value) => (value == null ? '—' : formatter.format(value)),
    };
  }, [data, index]);
};
