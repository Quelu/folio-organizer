import {
  normalizeName,
  getMainPrinting,
  getLegality,
  getCoreSets,
  getMainType,
  localizeCard,
  FORMATS,
} from './catalog.js';
import { getOwned } from './collection.js';

/**
 * A deck is { id, name, kind: 'mine'|'reference', format: 'core'|'infinity', cards, notes, source,
 * sourceUrl, createdAt, updatedAt, versions }.
 * cards: [{ key, id, name, qty }] — key is the normalized full name, id the printing shown
 * (and fetched first in the binders), name the full name for display.
 * versions: [{ id, at, label, cards }] snapshots, newest last.
 */

export const MIN_DECK_SIZE = 60;
export const MAX_COPIES = 4;
export const MAX_INKS = 2;
export const MAX_VERSIONS = 15;

export const getDeckSize = (deck) => deck.cards.reduce((s, c) => s + c.qty, 0);

/** Most copies allowed: 4, unless the card says otherwise ("You may have up to 99 copies…"). */
export const getMaxCopies = (card) => {
  const match = card?.text?.match(/up to (\d+) copies/i);
  return match ? parseInt(match[1], 10) : MAX_COPIES;
};

/** Printing shown for a deck entry: the one chosen if known, else the regular one. */
export const getEntryCard = (index, entry) => (index ? (index.byId.get(entry.id) ?? getMainPrinting(index, entry.key)) : null);

/**
 * Checks a deck against the construction rules and computes its stats.
 * @param {object} deck
 * @param {object|null} index catalog index (rules needing card data are skipped without it)
 * @param {object|null} collection from buildCollection, for owned / missing counts
 * @param {'fr'|'en'} [lang] language of the card names in the messages
 */
export const analyzeDeck = (deck, index, collection = null, lang = 'en') => {
  const nameOf = (e) => (e.card ? localizeCard(e.card, lang).fullName : e.name);
  const entries = deck.cards.map((entry) => {
    const card = getEntryCard(index, entry);
    const owned = collection ? getOwned(collection, entry.key) : 0;
    return { ...entry, card, owned, missing: Math.max(0, entry.qty - owned) };
  });
  const total = entries.reduce((s, e) => s + e.qty, 0);
  const errors = [];
  const warnings = [];

  const inks = [...new Set(entries.flatMap((e) => e.card?.inks ?? []))];
  const curve = Array.from({ length: 8 }, () => 0); // 0…6, 7+
  const types = {};
  let inkable = 0;
  let costSum = 0;
  for (const { card, qty } of entries) {
    if (!card) continue;
    curve[Math.min(card.cost, 7)] += qty;
    const type = getMainType(card);
    types[type] = (types[type] ?? 0) + qty;
    if (card.inkwell) inkable += qty;
    costSum += card.cost * qty;
  }

  if (total < MIN_DECK_SIZE) {
    errors.push({ code: 'size', message: `${total} cartes : il en faut au moins ${MIN_DECK_SIZE}.` });
  }
  for (const e of entries) {
    const max = getMaxCopies(e.card);
    if (e.qty > max) errors.push({ code: 'copies', key: e.key, message: `${nameOf(e)} : ${e.qty} copies (max ${max}).` });
  }
  if (inks.length > MAX_INKS) {
    errors.push({ code: 'inks', message: `${inks.length} encres (${inks.join(', ')}) : ${MAX_INKS} maximum.` });
  }

  // Legality in each format, and Core cards only kept legal by the oldest Core chapter
  const legality = {};
  const coreSets = index ? getCoreSets(index) : [];
  const rotating = [];
  if (index) {
    for (const { key: format } of FORMATS) {
      legality[format] = entries
        .map((e) => ({ entry: e, status: getLegality(index, e.key, format) }))
        .filter((x) => x.status && x.status !== 'legal');
    }
    if (coreSets.length > 1) {
      const oldest = coreSets[0];
      for (const e of entries) {
        const legalSets = (index.byKey.get(e.key) ?? []).filter((c) => c.legal.core === 'legal').map((c) => c.set);
        if (legalSets.length && legalSets.every((s) => s === oldest)) rotating.push(e);
      }
    }
    const illegal = legality[deck.format] ?? [];
    for (const { entry, status } of illegal) {
      errors.push({
        code: 'legality',
        key: entry.key,
        message: `${nameOf(entry)} : ${status === 'banned' ? 'bannie' : 'non légale'} en ${deck.format === 'core' ? 'Core' : 'Infinity'}.`,
      });
    }
    if (deck.format === 'core' && rotating.length) {
      warnings.push({
        code: 'rotation',
        message: `${rotating.length} carte${rotating.length > 1 ? 's' : ''} légale${rotating.length > 1 ? 's' : ''} en Core uniquement via le chapitre ${coreSets[0]}, le premier concerné à la prochaine rotation.`,
        keys: rotating.map((e) => e.key),
      });
    }
    const unknown = entries.filter((e) => !e.card);
    if (unknown.length) {
      warnings.push({ code: 'unknown', message: `${unknown.length} carte(s) introuvable(s) dans le catalogue.` });
    }
    if (total >= 20 && inkable / total < 0.6) {
      warnings.push({
        code: 'inkable',
        message: `Seulement ${inkable} cartes encrables sur ${total} (${Math.round((inkable / total) * 100)} %) : vise au moins 2/3.`,
      });
    }
  }

  const owned = entries.reduce((s, e) => s + Math.min(e.qty, e.owned), 0);
  const missing = entries.filter((e) => e.missing > 0);

  return {
    entries,
    total,
    inks,
    curve,
    types,
    inkable,
    averageCost: total ? costSum / total : 0,
    errors,
    warnings,
    legality,
    rotating,
    coreSets,
    owned,
    ownedRatio: total ? owned / total : 0,
    missing,
    valid: errors.length === 0,
  };
};

const byCostThenName = (index) => (a, b) => {
  const ca = getEntryCard(index, a);
  const cb = getEntryCard(index, b);
  return (ca?.cost ?? 99) - (cb?.cost ?? 99) || a.name.localeCompare(b.name);
};

/** "4 Elsa - Spirit of Winter" lines, the format Dreamborn, Inktable and Pixelborn import. */
export const formatDeckList = (deck, index) =>
  [...deck.cards]
    .sort(byCostThenName(index))
    .map((c) => `${c.qty} ${c.name}`)
    .join('\n');

const LINE_PATTERNS = [
  /^(\d+)\s*[x×]?\s+(.+)$/i, // "4 Name", "4x Name"
  /^(.+?)\s+[x×]\s*(\d+)$/i, // "Name x4"
];

/** Finds the catalog card a pasted name refers to, written in English or in French. */
const resolveName = (index, rawName) => {
  const cleaned = rawName
    .replace(/\(V\.\d+\)/gi, '') // Cardmarket version marker
    .replace(/\s*\([^)]*\)\s*$/, '') // trailing set name or code
    .replace(/\s+#?\d+[a-z]?\s*$/i, '') // trailing collector number
    .trim();
  const french = index.byFrenchKey ?? new Map();
  for (const candidate of [rawName, cleaned]) {
    const key = normalizeName(candidate);
    if (index.byKey.has(key)) return key;
    if (french.has(key)) return french.get(key);
  }
  // Name without version, when only one card has that name
  const key = normalizeName(cleaned);
  const prefix = (k) => k === key || k.startsWith(`${key} - `);
  const matches = new Set([
    ...[...index.byKey.keys()].filter(prefix),
    ...[...french.entries()].filter(([k]) => prefix(k)).map(([, englishKey]) => englishKey),
  ]);
  return matches.size === 1 ? [...matches][0] : null;
};

/**
 * Parses a pasted deck list. Accepts "4 Name - Version", "4x Name", "Name x4", comments and
 * section headers (ignored), and merges repeated cards.
 * @returns {{ cards: { key, id, name, qty }[], unresolved: { line, name, qty }[] }}
 */
export const parseDeckList = (text, index) => {
  const merged = new Map();
  const unresolved = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(#|\/\/)/.test(line)) continue;
    let qty = null;
    let name = null;
    for (const [i, pattern] of LINE_PATTERNS.entries()) {
      const m = line.match(pattern);
      if (m) {
        [qty, name] = i === 0 ? [parseInt(m[1], 10), m[2]] : [parseInt(m[2], 10), m[1]];
        break;
      }
    }
    if (!qty || !name) continue; // section header such as "Characters (24)"
    const key = resolveName(index, name.trim());
    if (!key) {
      unresolved.push({ line, name: name.trim(), qty });
      continue;
    }
    const card = getMainPrinting(index, key);
    const existing = merged.get(key);
    merged.set(key, { key, id: card.id, name: card.fullName, qty: (existing?.qty ?? 0) + qty });
  }
  return { cards: [...merged.values()], unresolved };
};

/** Adds (qty > 0) or removes copies of a card in a deck's card list. */
export const changeDeckCard = (cards, card, qty) => {
  const existing = cards.find((c) => c.key === card.key);
  const nextQty = Math.max(0, (existing?.qty ?? 0) + qty);
  if (!existing) return nextQty ? [...cards, { key: card.key, id: card.id, name: card.fullName, qty: nextQty }] : cards;
  return nextQty ? cards.map((c) => (c.key === card.key ? { ...c, qty: nextQty } : c)) : cards.filter((c) => c.key !== card.key);
};

/**
 * Differences between two card lists, for version comparisons.
 * @returns {{ key, name, before, after }[]} changed cards only
 */
export const diffDeckCards = (before, after) => {
  const keys = new Set([...before.map((c) => c.key), ...after.map((c) => c.key)]);
  return [...keys]
    .map((key) => {
      const b = before.find((c) => c.key === key);
      const a = after.find((c) => c.key === key);
      return { key, name: (a ?? b).name, before: b?.qty ?? 0, after: a?.qty ?? 0 };
    })
    .filter((d) => d.before !== d.after)
    .sort((x, y) => y.after - y.before - (x.after - x.before));
};
