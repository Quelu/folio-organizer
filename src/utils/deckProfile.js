import { normalizeName } from './catalog.js';

/**
 * Lorcana mechanics of a deck, read from the English rules texts (Lorcast): Shift characters and
 * the characters they can go on, songs and the characters able to sing them, classifications and
 * the ones the deck's texts ask for, keywords, lore and stats. Pure functions, shared with the MCP
 * server.
 */

/** Keyword names printed on the French cards. */
export const KEYWORD_LABELS = {
  Alert: 'Agilité',
  Bodyguard: 'Rempart',
  Boost: 'Boost',
  Challenger: 'Offensif',
  Evasive: 'Insaisissable',
  Reckless: 'Combattant',
  Resist: 'Résistance',
  Rush: 'Charge',
  Shift: 'Alter',
  Singer: 'Mélomane',
  'Sing Together': "À l'unisson",
  Support: 'Soutien',
  Vanish: 'Dissipation',
  Ward: "Hors d'atteinte",
};

export const keywordLabel = (key, lang) => (lang === 'fr' ? (KEYWORD_LABELS[key] ?? key) : key);

// Lorcast writes some keywords in lowercase ("bodyguard")
const KEYWORDS_BY_LOWERCASE = new Map(Object.keys(KEYWORD_LABELS).map((key) => [key.toLowerCase(), key]));
const keywordKey = (raw) => KEYWORDS_BY_LOWERCASE.get(raw.toLowerCase()) ?? raw.replace(/\b\w/g, (c) => c.toUpperCase());

// Classifications telling where a character comes from rather than what it is
const ORIGINS = ['Storyborn', 'Dreamborn', 'Floodborn'];

const nameKey = (s) => normalizeName(s).replace(/\.$/, '');

/** Names a card answers to: "Flotsam & Jetsam" is named Flotsam and named Jetsam. */
const namesOf = (card) => card.name.split(' & ').map(nameKey);

const isCharacter = (card) => card.types.includes('Character');

/**
 * Shift ability of a card, or null.
 * kind: 'name' (on a character named one of names), 'duo' (on one character of each name),
 * 'class' (on a character of the classification), 'item' (on an item named one of names) or
 * 'universal' (on any character). cost: ink paid, null when it costs a discard instead.
 */
export const getShift = (card) => {
  for (const line of (card?.text ?? '').split('\n')) {
    const m = line.match(/^((?:[A-Z][\w-]* )*)Shift(?::| (\d+))/);
    if (!m) continue;
    // "Temporary Shift" returns to the hand at the end of the turn: same targets
    const prefix = m[1].trim().replace(/^Temporary\s*/, '');
    const cost = m[2] != null ? parseInt(m[2], 10) : null;
    if (prefix === 'Universal') return { kind: 'universal', cost };
    if (prefix === '' || prefix === 'Combo') return { kind: 'name', cost, names: namesOf(card) };
    if (prefix === 'Duo') return { kind: 'duo', cost, names: namesOf(card) };
    if (/items named/.test(line)) return { kind: 'item', cost, names: [nameKey(prefix)] };
    return { kind: 'class', cost, classification: prefix };
  }
  return null;
};

/** Names a card answers to for Shift, and whether any Shift character may go on it (Mimicry). */
const getShiftBase = (card) => {
  const text = card.text ?? '';
  const also = [...text.matchAll(/also counts as being named (.+?) for Shift/g)].map((m) => nameKey(m[1]));
  return { names: [...namesOf(card), ...also], any: /any character with Shift on this character/i.test(text) };
};

/** Whether a Shift card can go on top of this card for one of its names. */
const canShiftOnto = (shift, card, name = null) => {
  const base = getShiftBase(card);
  switch (shift.kind) {
    case 'universal':
      return isCharacter(card);
    case 'class':
      return isCharacter(card) && card.classifications.includes(shift.classification);
    case 'item':
      return card.types.includes('Item') && base.names.some((n) => shift.names.includes(n));
    default:
      return isCharacter(card) && (base.any || base.names.some((n) => (name ? n === name : shift.names.includes(n))));
  }
};

/**
 * Cost a song asks of a single singer, and the total cost of Sing Together when it has it.
 * @returns {{ cost: number, together: number|null }}
 */
export const getSongCost = (card) => {
  const text = card.text ?? '';
  const single = text.match(/character with cost (\d+) or more can/);
  const together = text.match(/Sing Together (\d+)/);
  return {
    cost: single ? parseInt(single[1], 10) : together ? parseInt(together[1], 10) : card.cost,
    together: together ? parseInt(together[1], 10) : null,
  };
};

/** Cost a character counts as to sing: its own, or its Singer value (not a conditional one). */
export const getSingingCost = (card) => {
  const singer = (card.text ?? '').match(/(?:^|\)\s*)Singer (\d+)/m);
  return Math.max(card.cost, singer ? parseInt(singer[1], 10) : 0);
};

// French names of the classifications and their text patterns, built once per catalog
const catalogCache = new WeakMap();

const getCatalogClassifications = (index) => {
  if (catalogCache.has(index)) return catalogCache.get(index);
  // French name of each classification by vote: LorcanaJSON lists them in the same order in every
  // language, Lorcast mostly in the French order (the MCP server only loads the French data)
  const votes = new Map();
  for (const card of index.all) {
    const fr = card.l10n?.fr?.classifications ?? [];
    const en = card.l10n?.en?.classifications;
    const [keys, weight] = en?.length === fr.length ? [en, 100] : [card.classifications, 1];
    if (keys.length === fr.length) {
      keys.forEach((key, i) => {
        const row = votes.get(key) ?? new Map();
        votes.set(key, row.set(fr[i], (row.get(fr[i]) ?? 0) + weight));
      });
    }
    for (const key of card.classifications) if (!votes.has(key)) votes.set(key, new Map());
  }
  const labels = new Map(
    [...votes].map(([key, row]) => [key, [...row].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null])
  );
  // "your Pirate characters", "a Princess or Queen character", "Villain character cards"
  const patterns = [...labels.keys()]
    .filter((key) => !ORIGINS.includes(key))
    .map((key) => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { key, pattern: new RegExp(`\\b${escaped}(?= (?:characters?|cards?)\\b| or [A-Z][\\w-]*(?: [A-Z][\\w-]*)* (?:characters?|cards?)\\b)`) };
    });
  const result = { labels, patterns };
  catalogCache.set(index, result);
  return result;
};

const sumQty = (entries) => entries.reduce((s, e) => s + e.qty, 0);

const average = (entries, field) => {
  const withValue = entries.filter((e) => e.card[field] != null);
  const copies = sumQty(withValue);
  return copies ? withValue.reduce((s, e) => s + e.card[field] * e.qty, 0) / copies : null;
};

/**
 * The deck's Lorcana profile.
 * @param {{ key, qty, card }[]} entries deck entries with their catalog card (analyzeDeck)
 * @param {object} index catalog index
 * @param {'fr'|'en'} [lang] language of the classification and keyword labels
 * @returns {{
 *   shifts: { entry, shift, bases: object[], baseCopies: number }[],
 *   songs: { entry, cost, together, singers: object[], singerCopies: number }[],
 *   classifications: { key, label, copies, citedBy: object[] }[],
 *   keywords: { key, label, copies }[],
 *   characters: { copies, lore, strength, willpower },
 * }}
 */
export const getDeckProfile = (entries, index, lang = 'en') => {
  const known = entries.filter((e) => e.card);
  const characters = known.filter((e) => isCharacter(e.card));

  const shifts = known
    .map((entry) => ({ entry, shift: isCharacter(entry.card) ? getShift(entry.card) : null }))
    .filter((s) => s.shift)
    .map(({ entry, shift }) => {
      const others = known.filter((e) => e.key !== entry.key);
      const bases = others.filter((e) => canShiftOnto(shift, e.card));
      // Duo Shift goes on two characters: one of each name must be there
      const complete = shift.kind !== 'duo' || shift.names.every((n) => others.some((e) => canShiftOnto(shift, e.card, n)));
      return { entry, shift, bases: complete ? bases : [], baseCopies: complete ? sumQty(bases) : 0 };
    })
    .sort((a, b) => a.entry.card.cost - b.entry.card.cost);

  const songs = known
    .filter((e) => e.card.types.includes('Song'))
    .map((entry) => {
      const { cost, together } = getSongCost(entry.card);
      const singers = characters.filter((e) => getSingingCost(e.card) >= cost);
      return { entry, cost, together, singers, singerCopies: sumQty(singers) };
    })
    .sort((a, b) => a.cost - b.cost);

  const { labels, patterns } = index ? getCatalogClassifications(index) : { labels: new Map(), patterns: [] };
  const label = (key) => (lang === 'fr' ? (labels.get(key) ?? key) : key);
  const classes = new Map();
  const classRow = (key) => {
    if (!classes.has(key)) classes.set(key, { key, label: label(key), copies: 0, citedBy: [] });
    return classes.get(key);
  };
  for (const e of characters) {
    for (const key of e.card.classifications) classRow(key).copies += e.qty;
  }
  for (const e of known) {
    for (const { key, pattern } of patterns) {
      if (pattern.test(e.card.text ?? '')) classRow(key).citedBy.push(e);
    }
  }
  const classifications = [...classes.values()]
    .filter((c) => !ORIGINS.includes(c.key) || c.citedBy.length)
    .sort((a, b) => b.copies - a.copies || b.citedBy.length - a.citedBy.length || a.label.localeCompare(b.label));

  const keywordCopies = new Map();
  for (const e of known) {
    for (const key of new Set(e.card.keywords.map(keywordKey))) keywordCopies.set(key, (keywordCopies.get(key) ?? 0) + e.qty);
  }
  const keywords = [...keywordCopies.entries()]
    .map(([key, copies]) => ({ key, label: keywordLabel(key, lang), copies }))
    .sort((a, b) => b.copies - a.copies || a.label.localeCompare(b.label));

  return {
    shifts,
    songs,
    classifications,
    keywords,
    characters: {
      copies: sumQty(characters),
      lore: average(characters, 'lore'),
      strength: average(characters, 'strength'),
      willpower: average(characters, 'willpower'),
    },
  };
};

const formatAverage = (n) => (n == null ? '—' : n.toFixed(1));

/**
 * The profile as text lines, for the AI assistant and the MCP server.
 * @param {Function} [nameOf] entry => name to cite
 */
export const formatDeckProfile = (profile, nameOf = (e) => e.card?.fullName ?? e.name, lang = 'en') => {
  if (!profile) return [];
  const { characters, keywords, classifications, shifts, songs } = profile;
  const copiesOf = (entries) => entries.map((e) => `${e.qty} ${nameOf(e)}`).join(', ');
  return [
    `Personnages : ${characters.copies} copies · lore moyen ${formatAverage(characters.lore)} · force ${formatAverage(characters.strength)} · volonté ${formatAverage(characters.willpower)}`,
    keywords.length ? `Mots-clés : ${keywords.map((k) => `${k.label} ${k.copies}`).join(', ')}` : null,
    classifications.length
      ? `Classifications : ${classifications
          .map((c) => `${c.label} ${c.copies}${c.citedBy.length ? ` (demandée par ${c.citedBy.map(nameOf).join(', ')})` : ''}`)
          .join(', ')}`
      : null,
    ...shifts.map(
      (s) => `${keywordLabel('Shift', lang)} : ${nameOf(s.entry)} — ${s.baseCopies ? `bases : ${copiesOf(s.bases)}` : 'aucune base dans le deck'}`
    ),
    ...songs.map(
      (s) =>
        `Chanson : ${nameOf(s.entry)} (coût ${s.cost}${s.together ? `, ${keywordLabel('Sing Together', lang)} ${s.together}` : ''}) — ${s.singerCopies} chanteur(s)`
    ),
  ].filter(Boolean);
};
