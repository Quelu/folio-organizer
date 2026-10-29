// Deck A and deck B in every chart: a blue and an orange told apart with any color vision
export const SERIES = ['#3987e5', '#d95926'];
// Panel surface, for the gaps and rings that separate marks
export const SURFACE = '#0b1020';
export const STATUS = { good: '#0ca30c', critical: '#d03b3b' };

export const formatNumber = (n, digits = 0) => n.toLocaleString('fr-BE', { maximumFractionDigits: digits });

/** A share as percentage points, singular under 2 as in French: "1,5 pt", "2 pts". */
export const formatPoints = (x) => {
  const n = Math.round(Math.abs(x) * 1000) / 10;
  return `${formatNumber(n, 1)} pt${n >= 2 ? 's' : ''}`;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The cards of both decks by name, and a pattern finding those names in the log's sentences:
 * longest first, so a name never cuts a longer one short.
 */
export const logCards = (decks) => {
  const byName = new Map(decks.flatMap((d) => d.cards.map((card) => [card.name, card])));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = names.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${names.join('|')})(?![\\p{L}\\p{N}])`, 'u') : null;
  return { byName, pattern };
};
