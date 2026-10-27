/**
 * Lorcana card catalog helpers. Pure functions (no browser APIs) so the MCP server can share them.
 *
 * A catalog card is one printing: { id: "12-42", set: "12", number: "42", name, version, fullName,
 * key, cost, inkwell, inks, types, classifications, text, keywords, moveCost, strength, willpower,
 * lore, rarity, legal: { core, infinity }, usd, usdFoil, image, imageLarge }.
 * key is the normalized full name: deck rules count copies by full name across reprints.
 */

export const INKS = [
  { key: 'Amber', label: 'Ambre', color: '#f59e0b' },
  { key: 'Amethyst', label: 'Améthyste', color: '#a855f7' },
  { key: 'Emerald', label: 'Émeraude', color: '#10b981' },
  { key: 'Ruby', label: 'Rubis', color: '#ef4444' },
  { key: 'Sapphire', label: 'Saphir', color: '#3b82f6' },
  { key: 'Steel', label: 'Acier', color: '#94a3b8' },
];

export const getInk = (key) => INKS.find((i) => i.key === key) ?? { key, label: key, color: '#64748b' };

export const CARD_TYPES = [
  { key: 'Character', label: 'Personnage' },
  { key: 'Action', label: 'Action' },
  { key: 'Song', label: 'Chanson' },
  { key: 'Item', label: 'Objet' },
  { key: 'Location', label: 'Lieu' },
];

/** Rarities printed outside the regular set list (alternate arts). */
export const SPECIAL_RARITIES = ['Epic', 'Enchanted', 'Iconic'];

export const FORMATS = [
  { key: 'core', label: 'Core' },
  { key: 'infinity', label: 'Infinity' },
];

export const baseNumber = (number) => parseInt(number, 10);

/** Lowercase, no accents, straight apostrophes, single spaces, plain dashes. */
export const normalizeName = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const getFullName = (name, version) => (version ? `${name} - ${version}` : name);

/** Lorcast sends prices as strings ("0.19"). */
const toPrice = (value) => {
  const n = value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Keeps the fields Folio uses from a raw Lorcast card. */
export const slimLorcastCard = (c) => {
  const set = c.set?.code ?? '';
  const fullName = getFullName(c.name, c.version);
  return {
    id: `${set}-${c.collector_number}`,
    set,
    setName: c.set?.name ?? null,
    number: c.collector_number,
    name: c.name,
    version: c.version ?? null,
    fullName,
    key: normalizeName(fullName),
    cost: c.cost ?? 0,
    inkwell: Boolean(c.inkwell),
    // Dual-ink cards have no single ink but list both in inks
    inks: (c.inks?.length ? c.inks : [c.ink]).filter(Boolean),
    types: c.type ?? [],
    classifications: c.classifications ?? [],
    text: c.text ?? '',
    keywords: c.keywords ?? [],
    moveCost: c.move_cost ?? null,
    strength: c.strength ?? null,
    willpower: c.willpower ?? null,
    lore: c.lore ?? null,
    rarity: c.rarity ?? null,
    legal: { core: c.legalities?.core ?? null, infinity: c.legalities?.infinity ?? null },
    usd: toPrice(c.prices?.usd),
    usdFoil: toPrice(c.prices?.usd_foil),
    image: c.image_uris?.digital?.normal ?? null,
    imageSmall: c.image_uris?.digital?.small ?? null,
  };
};

const byNumber = (a, b) => baseNumber(a.number) - baseNumber(b.number) || a.number.localeCompare(b.number);

/** Localized data of a printing; art variants missing from LorcanaJSON (8-1f) use the base card. */
const findLocalized = (cards, card) => cards?.[card.id] ?? cards?.[`${card.set}-${baseNumber(card.number)}`] ?? null;

/**
 * Core rotation from LorcanaJSON's chapters: the Core-legal ones by rotation group, oldest group
 * first. next: the chapters leaving Core together at the next rotation, with its date when known.
 * @returns {{ groups: { group: number, sets: string[] }[], next: { sets: string[], date: string|null } } | null}
 */
const buildRotation = (chapters) => {
  const legal = Object.values(chapters ?? {}).filter((c) => c.core && c.rotationGroup != null);
  if (legal.length === 0) return null;
  const groups = [...new Set(legal.map((c) => c.rotationGroup))]
    .sort((a, b) => a - b)
    .map((group) => ({
      group,
      sets: legal
        .filter((c) => c.rotationGroup === group)
        .map((c) => c.code)
        .sort((a, b) => Number(a) - Number(b)),
    }));
  const nextSets = groups[0].sets;
  const date = legal.find((c) => nextSets.includes(c.code) && c.coreUntil)?.coreUntil ?? null;
  return { groups, next: { sets: nextSets, date } };
};

/**
 * Indexes the cards of several sets.
 * @param {{ [setCode: string]: object[] }} cardsBySet slim cards per set
 * @param {{ fr?: object, en?: object }} [localized] LorcanaJSON data by language, as built by
 *   buildLocalizedCards (src/utils/lorcanaJson.js): names, texts, official pictures, foil masks,
 *   up-to-date legalities and the chapters' rotation groups
 */
export const buildCatalogIndex = (cardsBySet, localized = {}) => {
  const frCards = localized.fr?.cards;
  const enCards = localized.en?.cards;
  const chapters = localized.fr?.sets ?? localized.en?.sets ?? null;
  const byId = new Map();
  const byKey = new Map();
  const byFrenchKey = new Map();
  const bySet = new Map();
  const all = [];
  const sets = Object.keys(cardsBySet).sort((a, b) => Number(a) - Number(b));
  for (const set of sets) {
    const cards = [...cardsBySet[set]].sort(byNumber).map((base) => {
      const fr = findLocalized(frCards, base);
      const en = findLocalized(enCards, base);
      return {
        ...base,
        // The official app knows a new chapter is legal from its release, Lorcast catches up later
        legal: fr?.legal ?? en?.legal ?? base.legal,
        l10n: { fr, en },
        cardmarketId: fr?.cardmarketId ?? en?.cardmarketId ?? null,
        // Searched in both languages, so French and English names, classes and texts all match
        search: normalizeName(
          [base.fullName, fr?.fullName, ...base.classifications, ...(fr?.classifications ?? []), ...base.keywords, base.text, fr?.text, base.id]
            .filter(Boolean)
            .join(' ')
        ),
      };
    });
    bySet.set(set, cards);
    for (const card of cards) {
      all.push(card);
      byId.set(card.id, card);
      byKey.set(card.key, [...(byKey.get(card.key) ?? []), card]);
      if (card.l10n.fr) byFrenchKey.set(normalizeName(card.l10n.fr.fullName), card.key);
    }
  }
  return { byId, byKey, byFrenchKey, bySet, all, sets, chapters, rotation: buildRotation(chapters) };
};

/**
 * Card texts in the chosen language ('fr' or 'en'), English when no translation is known.
 * @returns {{ name, version, fullName, text, flavor, classifications }}
 */
export const localizeCard = (card, lang) => {
  const fr = lang === 'fr' ? card?.l10n?.fr : null;
  return {
    name: fr?.name ?? card?.name,
    version: fr ? fr.version : card?.version,
    fullName: fr?.fullName ?? card?.fullName,
    text: fr?.text ?? card?.text,
    flavor: fr?.flavor ?? card?.l10n?.en?.flavor ?? null,
    classifications: fr?.classifications ?? card?.classifications ?? [],
  };
};

/**
 * Picture of the card in the chosen language: the official one from LorcanaJSON, else Lorcast's.
 * size: 'small' (thumbnails, binder pockets), 'normal' (a card shown alone) or 'large' (sharp screens).
 */
export const getCardImage = (card, lang, size = 'small') => {
  const official = card?.l10n?.[lang];
  if (official?.thumb) return size === 'large' ? official.image : official.thumb;
  if (size === 'small') return card?.imageSmall ?? card?.image ?? null;
  return size === 'large' ? (card?.image?.replace('/digital/normal/', '/digital/large/') ?? null) : (card?.image ?? null);
};

/** Foil mask matching getCardImage's picture (only official pictures have one). */
export const getFoilMask = (card, lang) => (card?.l10n?.[lang]?.thumb ? card.l10n[lang].foilMask : null);

/** Printing filling a binder pocket: exact number first, else the first art variant (4 → 4a). */
export const findPocketCard = (index, setCode, number) => {
  const cards = index.bySet.get(String(setCode));
  if (!cards) return null;
  const num = String(number);
  return cards.find((c) => c.number === num) ?? cards.find((c) => baseNumber(c.number) === baseNumber(num)) ?? null;
};

/**
 * Binder sections of a chapter: where each ink starts in its numbering (Amber 1, Amethyst 35…),
 * then the cards numbered past the set (Enchanted, Epic…). Each starts a new binder page.
 * @returns {{ from: number, ink?: string, label?: string }[]} empty when the chapter is unknown
 */
export const getInkSections = (index, setCode, setSize) => {
  const cards = index.bySet.get(String(setCode)) ?? [];
  const sections = [];
  for (const card of cards) {
    const n = baseNumber(card.number);
    if (n < 1 || (setSize && n > setSize)) continue;
    const ink = card.inks.join('/');
    if (sections.at(-1)?.ink !== ink && sections.at(-1)?.from !== n) sections.push({ from: n, ink });
  }
  if (sections.length === 0) return [];
  sections[0].from = 1;
  if (setSize && cards.some((c) => baseNumber(c.number) > setSize)) sections.push({ from: setSize + 1, label: 'Hors set' });
  return sections;
};

/** Name of a binder section: "Ambre", "Ambre / Améthyste", "Hors set". */
export const getSectionLabel = (section) =>
  section.label ?? (section.ink ?? '').split('/').map((ink) => getInk(ink).label).join(' / ');

/** The regular (non alternate-art) printing of a card, newest set first, for images and buying. */
export const getMainPrinting = (index, key) => {
  const printings = index.byKey.get(key) ?? [];
  const regular = printings.filter((c) => !SPECIAL_RARITIES.includes(c.rarity));
  return (regular.length ? regular : printings).at(-1) ?? null;
};

/** Legality of a card in a format, across all its printings (a reprint makes it legal again). */
export const getLegality = (index, key, format) => {
  const values = (index.byKey.get(key) ?? []).map((c) => c.legal[format]);
  if (values.includes('banned')) return 'banned';
  if (values.includes('legal')) return 'legal';
  return values.length ? 'not_legal' : null;
};

/** Sets in Core rotation (most of their cards legal: a lone reprint does not count), oldest first. */
export const getCoreSets = (index) =>
  index.sets.filter((s) => {
    const cards = index.bySet.get(s);
    return cards.filter((c) => c.legal.core === 'legal').length > cards.length / 2;
  });

/** Card types shown to the user: songs are actions, listed as songs. */
export const getMainType = (card) => (card.types.includes('Song') ? 'Song' : (card.types[0] ?? 'Character'));

/**
 * One line per card, compact enough to give a whole collection to an AI model.
 * "[12-42] Elsa - Spirit of Winter | Amethyst 8⬡ | Character (Floodborn, Hero, Queen, Sorcerer) | 4/6 ◊3 | Shift 6 … | Legendary"
 */
export const formatCardLine = (card) => {
  const stats =
    card.strength != null || card.willpower != null
      ? ` | ${card.strength ?? '-'}/${card.willpower ?? '-'} ◊${card.lore ?? 0}${card.moveCost != null ? ` move ${card.moveCost}` : ''}`
      : card.lore
        ? ` | ◊${card.lore}`
        : '';
  const classes = card.classifications.length ? ` (${card.classifications.join(', ')})` : '';
  const text = card.text ? ` | ${card.text.replace(/\s+/g, ' ')}` : '';
  const french = card.l10n?.fr && card.l10n.fr.fullName !== card.fullName ? ` (FR : ${card.l10n.fr.fullName})` : '';
  return `[${card.id}] ${card.fullName}${french} | ${card.inks.join('/')} ${card.cost}${card.inkwell ? '⬡' : ''} | ${card.types.join('/')}${classes}${stats}${text} | ${card.rarity ?? '?'}`;
};

/** Loose text search on names, versions, classifications and rules texts, in French and English. */
export const matchesQuery = (card, query) => {
  if (!query) return true;
  const haystack =
    card.search ??
    normalizeName(`${card.fullName} ${card.classifications.join(' ')} ${card.keywords.join(' ')} ${card.text} ${card.id}`);
  return normalizeName(query)
    .split(' ')
    .every((word) => haystack.includes(word));
};
