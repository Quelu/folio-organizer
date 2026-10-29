/** Cardmarket accepts at most 150 entries per wants list. */
export const CARDMARKET_MAX_ENTRIES = 150;

const SPECIAL_RARITIES = ['Epic', 'Enchanted', 'Iconic'];

/**
 * Filter key of the few cards with a regular rarity numbered after the Epic / Enchanted / Iconic
 * ones (Yen Sid 223, Mulan 224… in Ursula's Return), so they can be left out like the specials.
 */
export const BONUS_RARITY = 'Bonus';

const baseNumber = (number) => parseInt(number, 10);

/** "Elsa - Spirit of Winter", or the name alone for cards without a version (songs, items…). */
const getCardmarketName = (card) => (card.version ? `${card.name} - ${card.version}` : card.name);

const byCollectorNumber = (a, b) => baseNumber(a.number) - baseNumber(b.number) || a.number.localeCompare(b.number);

/**
 * Builds the Cardmarket deck list of the cards missing from a Lorcana binder, one copy each.
 * Covers the whole set even past the binder size, so Epic, Enchanted and Iconic cards can be bought too.
 *
 * Inside an expansion Cardmarket tells apart cards sharing a name with a version: (V.1) for the
 * regular card, (V.2), (V.3)… for its Enchanted / Epic / Iconic printings, in collector number
 * order. Without it a want matches any of them, so a missing common could come as its Enchanted.
 *
 * @param {object} binder
 * @param {{ setName: string|null, cards: { number: string, name: string, version: string|null, rarity: string|null }[] }} set
 * @param {boolean} [withExpansion] restricts each want to the binder's set (reprints excluded)
 * @returns {{ lines: { cardNumber: number, text: string, version: number|null, rarity: string|null }[], unknown: number[], lastNumber: number }}
 *   rarity is BONUS_RARITY for bonus cards; unknown lists the missing numbers Lorcast has no card for
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

  const lastNumber = Math.max(binder.setSize ?? 0, ...byNumber.keys());
  const firstSpecial = Math.min(
    ...set.cards.filter((c) => SPECIAL_RARITIES.includes(c.rarity)).map((c) => baseNumber(c.number))
  );
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
      rarity: n > firstSpecial && !SPECIAL_RARITIES.includes(card.rarity) ? BONUS_RARITY : (card.rarity ?? null),
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

/**
 * One Cardmarket deck list line for a printing: "2 Elsa - Spirit of Winter (V.1) (The First Chapter)".
 * Same (V.n) rule as getCardmarketWants within the printing's chapter.
 * @param {object} card catalog printing
 * @param {number} qty
 * @param {object} index catalog index (src/utils/catalog.js)
 * @param {boolean} [withExpansion] restricts the line to that chapter
 */
const getCardmarketLine = (card, qty, index, withExpansion = true) => {
  const setCards = [...(index.bySet.get(card.set) ?? [])].sort(byCollectorNumber);
  const group = setCards.filter((c) => getCardmarketName(c).toLowerCase() === getCardmarketName(card).toLowerCase());
  const anyVariant = group.every((c) => baseNumber(c.number) === baseNumber(card.number));
  const version = group.length > 1 && !anyVariant ? group.indexOf(card) + 1 : null;
  const expansion = withExpansion && card.setName ? ` (${card.setName})` : '';
  return `${qty} ${getCardmarketName(card)}${version ? ` (V.${version})` : ''}${expansion}`;
};

/**
 * Cardmarket deck list of cards to buy for a deck: { key, qty } entries, bought as their regular
 * printing from the newest chapter.
 * @param {{ key: string, qty: number }[]} wants
 * @param {object} index catalog index (src/utils/catalog.js)
 * @param {(index: object, key: string) => object|null} getPrinting
 * @param {boolean} [withExpansion] restricts each want to that chapter
 * @returns {string[]} lines, unknown cards skipped
 */
export const getDeckWantsLines = (wants, index, getPrinting, withExpansion = true) =>
  wants
    .map(({ key, qty }) => {
      const card = getPrinting(index, key);
      return card ? getCardmarketLine(card, qty, index, withExpansion) : null;
    })
    .filter(Boolean);

/**
 * Cards to put on sale, in Cardmarket deck list format: one line per printing and variant,
 * chapter then collector number order, foils marked "*Foil*" (to set when listing them).
 * @param {{ card: object, foil: boolean, qty: number }[]} items from getTradeableSurplus
 * @param {object} index catalog index
 * @returns {string[]}
 */
export const getSaleLines = (items, index) =>
  [...items].sort(bySetAndNumber).map((i) => `${getCardmarketLine(i.card, i.qty, index)}${i.foil ? ' *Foil*' : ''}`);

const csvCell = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/**
 * CSV of the cards to put on sale, for a spreadsheet or another marketplace.
 * @param {{ card: object, foil: boolean, qty: number, price: number|null }[]} items
 * @returns {string}
 */
export const generateSaleCsv = (items) => {
  const lines = ['Set Number,Set Name,Card Number,Name,Rarity,Foil,Count,Unit Price'];
  for (const i of [...items].sort(bySetAndNumber)) {
    lines.push(
      [
        i.card.set,
        i.card.setName ?? '',
        i.card.number,
        i.card.fullName,
        i.card.rarity ?? '',
        i.foil ? 'foil' : 'normal',
        i.qty,
        i.price?.toFixed(2) ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
};

const bySetAndNumber = (a, b) =>
  String(a.card.set).localeCompare(String(b.card.set), undefined, {
    numeric: true,
  }) ||
  byCollectorNumber(a.card, b.card) ||
  Number(a.foil) - Number(b.foil);
