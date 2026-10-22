/** Cardmarket accepts at most 150 entries per wants list. */
export const CARDMARKET_MAX_ENTRIES = 150;

const baseNumber = (number) => parseInt(number, 10);

/** "Elsa - Spirit of Winter", or the name alone for cards without a version (songs, items…). */
const getCardmarketName = (card) => (card.version ? `${card.name} - ${card.version}` : card.name);

const byCollectorNumber = (a, b) => baseNumber(a.number) - baseNumber(b.number) || a.number.localeCompare(b.number);

/**
 * Builds the Cardmarket deck list of the cards missing from a Lorcana binder, one copy each.
 *
 * Inside an expansion Cardmarket tells apart cards sharing a name with a version: (V.1) for the
 * regular card, (V.2), (V.3)… for its Enchanted / Epic / Iconic printings, in collector number
 * order. Without it a want matches any of them, so a missing common could come as its Enchanted.
 *
 * @param {object} binder
 * @param {{ setName: string|null, cards: { number: string, name: string, version: string|null }[] }} set
 * @param {boolean} [withExpansion] restricts each want to the binder's set (reprints excluded)
 * @returns {{ lines: { cardNumber: number, text: string, version: number|null }[], unknown: number[], lastNumber: number }}
 *   unknown lists the missing numbers Lorcast has no card for
 */
export const getCardmarketWants = (binder, set, withExpansion = true) => {
  const groups = new Map();
  const byNumber = new Map();
  for (const card of [...set.cards].sort(byCollectorNumber)) {
    const key = getCardmarketName(card).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), card]);
    const n = baseNumber(card.number);
    byNumber.set(n, [...(byNumber.get(n) ?? []), card]);
  }

  const lastNumber = binder.setSize ?? Math.max(0, ...byNumber.keys());
  const expansion = withExpansion && set.setName ? ` (${set.setName})` : '';
  const lines = [];
  const unknown = [];

  for (let n = 1; n <= lastNumber; n++) {
    if (binder.cards[String(n)]) continue;
    const printings = byNumber.get(n);
    if (!printings) {
      unknown.push(n);
      continue;
    }
    const exact = printings.find((c) => c.number === String(n));
    const card = exact ?? printings[0];
    const group = groups.get(getCardmarketName(card).toLowerCase());
    // Art variants sharing the number (the five Dalmatian puppies 4a–4e) fill the same pocket: any will do
    const anyVariant = !exact && group.every((c) => baseNumber(c.number) === n);
    const version = group.length > 1 && !anyVariant ? group.indexOf(card) + 1 : null;
    lines.push({
      cardNumber: n,
      version,
      text: `1 ${getCardmarketName(card)}${version ? ` (V.${version})` : ''}${expansion}`,
    });
  }

  return { lines, unknown, lastNumber };
};

/** Splits deck list lines into lists Cardmarket accepts. */
export const splitWantsLists = (lines) =>
  Array.from({ length: Math.ceil(lines.length / CARDMARKET_MAX_ENTRIES) }, (_, i) =>
    lines.slice(i * CARDMARKET_MAX_ENTRIES, (i + 1) * CARDMARKET_MAX_ENTRIES)
  );
