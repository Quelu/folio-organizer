import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from './catalogContext';
import { idbGet, idbSet } from '../utils/db';
import { SPECIAL_RARITIES } from '../utils/catalog';
import { CARDMARKET_PRICES_URL, CARDMARKET_PRODUCTS_URL, matchCardmarketPrices } from '../utils/cardmarketPrices';

const CACHE_KEY = 'cardmarket-prices';
const MAX_AGE = 24 * 60 * 60 * 1000;

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
};

/**
 * Cardmarket files trimmed to what the matching needs, kept for a day. Matching runs again on
 * each catalog update, so chapters loaded later get their prices too.
 * Resolves to { products, guides, at } or null when Cardmarket cannot be reached.
 */
const loadCardmarket = async () => {
  const cached = await idbGet('kv', CACHE_KEY);
  if (cached && Date.now() - cached.at < MAX_AGE) return cached;
  try {
    const [productList, priceGuide] = await Promise.all([
      fetchJson(CARDMARKET_PRODUCTS_URL),
      fetchJson(CARDMARKET_PRICES_URL),
    ]);
    const data = {
      at: Date.now(),
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
let matched = { data: null, index: null, prices: null };

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
 *   getPrice: (card: object, foil?: boolean) => number|null, format: (value: number|null) => string }}
 */
export const usePrices = () => {
  const { index } = useCatalog();
  const [data, setData] = useState(cardmarket);

  useEffect(() => {
    if (data !== undefined) return;
    let cancelled = false;
    cardmarketPromise ??= loadCardmarket().then((result) => {
      cardmarket = result;
      return result;
    });
    cardmarketPromise.then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  return useMemo(() => {
    const eur = Boolean(data);
    const currency = eur ? 'EUR' : 'USD';
    const prices = eur && index ? getMatched(data, index) : null;
    const formatter = new Intl.NumberFormat('fr-BE', { style: 'currency', currency });

    /**
     * Enchanted, Epic and Iconic cards only exist as foils: their regular price is the one to use.
     * A missing foil price stays unknown rather than borrowing the normal one.
     */
    const getPrice = (card, foil = false) => {
      if (!card) return null;
      const special = SPECIAL_RARITIES.includes(card.rarity);
      if (eur) {
        const p = prices?.get(card.id);
        if (!p) return null;
        return special ? (p.eur ?? p.eurFoil) : foil ? p.eurFoil : p.eur;
      }
      return special ? (card.usd ?? card.usdFoil) : foil ? card.usdFoil : card.usd;
    };

    return {
      status: data === undefined || !index ? 'loading' : 'ready',
      currency,
      source: eur ? 'Cardmarket' : 'Lorcast (TCGplayer)',
      updatedAt: eur ? data.at : null,
      getPrice,
      format: (value) => (value == null ? '—' : formatter.format(value)),
    };
  }, [data, index]);
};
