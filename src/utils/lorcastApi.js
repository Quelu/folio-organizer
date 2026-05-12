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
