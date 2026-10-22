const BASE_URL = 'https://api.lorcast.com/v0';

// In-memory cache to avoid redundant network requests
const cache = new Map();

/**
 * Fetches the card image URL from the Lorcast API.
 * @param {string} setCode - Lorcana set code (e.g. "1", "2", "3")
 * @param {number|string} cardNumber - Collector number within the set
 * @returns {Promise<string|null>} Image URL (.avif) or null if not found
 */
export const fetchLorcastCard = async (setCode, cardNumber) => {
  const key = `${setCode}-${cardNumber}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const url = `${BASE_URL}/cards/search?q=set:${setCode}+cn:${cardNumber}`;
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data = await res.json();
    const imageUrl = data.results?.[0]?.image_uris?.digital?.normal ?? null;
    cache.set(key, imageUrl);
    return imageUrl;
  } catch {
    cache.set(key, null);
    return null;
  }
};

const setCache = new Map();

/**
 * Fetches every card of a set from the Lorcast API (Enchanted, Epic and Iconic included).
 * @param {string} setCode - Lorcana set code (e.g. "1", "2", "3")
 * @returns {Promise<{ setName: string|null, cards: { number: string, name: string, version: string|null, rarity: string|null }[] }|null>}
 *   null on failure; collector numbers stay strings since a few carry a suffix ("4a", "65f")
 */
export const fetchLorcastSet = (setCode) => {
  if (!setCache.has(setCode)) {
    const request = fetch(`${BASE_URL}/sets/${setCode}/cards`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((cards) => ({
        setName: cards[0]?.set?.name ?? null,
        cards: cards.map((c) => ({
          number: c.collector_number,
          name: c.name,
          version: c.version ?? null,
          rarity: c.rarity ?? null,
        })),
      }))
      .catch(() => {
        // Not cached so the next call retries
        setCache.delete(setCode);
        return null;
      });
    setCache.set(setCode, request);
  }
  return setCache.get(setCode);
};
