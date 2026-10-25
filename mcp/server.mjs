#!/usr/bin/env node
/**
 * Folio MCP server: lets Claude Desktop query a Folio backup (binders, decks, pulled cards) with
 * the Lorcast card catalog, reusing the app's own collection and deck rules.
 *
 * stdout carries the JSON-RPC stream: log to stderr only.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  INKS,
  CARD_TYPES,
  FORMATS,
  SPECIAL_RARITIES,
  baseNumber,
  normalizeName,
  slimLorcastCard,
  buildCatalogIndex,
  formatCardLine,
  matchesQuery,
  getMainPrinting,
  getLegality,
  getCoreSets,
  getMainType,
  getInk,
  localizeCard,
} from '../src/utils/catalog.js';
import { buildLocalizedCards } from '../src/utils/lorcanaJson.js';
import { buildCollection, getPullList, getSharedCopyConflicts, getDeckUsage, getPulledCount } from '../src/utils/collection.js';
import { analyzeDeck, parseDeckList, formatDeckList } from '../src/utils/deckRules.js';
import { getBinderStats, getLocation } from '../src/utils/calculations.js';
import { getGame, getLorcanaSetName, setKnownLorcanaSets, withFrenchNames, LORCANA_RARITIES } from '../src/data/games.js';

const LORCAST = 'https://api.lorcast.com/v0';
// French names and texts, from the official app data (see src/utils/lorcanaJson.js)
const LORCANAJSON_FR = 'https://lorcanajson.org/files/current/fr/allCards.json';
const CACHE_FILE = path.join(os.homedir(), '.cache', 'folio-mcp', 'catalog.json');
// Prices and legalities change: refetch the catalog after two days, like the app
const CATALOG_MAX_AGE = 2 * 24 * 60 * 60 * 1000;
const BACKUP_PATTERN = /^folio-sauvegarde-.*\.json$/;

const log = (...args) => console.error('[folio-mcp]', ...args);

const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const backupTarget = () => path.resolve(expandHome(process.env.FOLIO_BACKUP || path.join(os.homedir(), 'Downloads')));

// ---------------------------------------------------------------------------
// Backup

let backupCache = { file: null, mtimeMs: 0, data: null };

/** The backup file to read: FOLIO_BACKUP itself, or the newest folio-sauvegarde-*.json in that folder. */
const resolveBackupFile = async () => {
  const target = backupTarget();
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new Error(`Sauvegarde introuvable : ${target} n'existe pas (variable FOLIO_BACKUP).`);
  }
  if (stat.isFile()) return { file: target, mtimeMs: stat.mtimeMs };

  const candidates = await Promise.all(
    (await fs.readdir(target))
      .filter((name) => BACKUP_PATTERN.test(name))
      .map(async (name) => {
        const file = path.join(target, name);
        return { file, mtimeMs: (await fs.stat(file)).mtimeMs };
      })
  );
  if (!candidates.length) {
    throw new Error(
      `Aucune sauvegarde folio-sauvegarde-*.json dans ${target}. Dans Folio, clique « Sauvegarder » en bas de la barre latérale.`
    );
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
};

/** Reads the backup again only when a newer file (or a newer save of the same file) shows up. */
const loadBackup = async () => {
  const { file, mtimeMs } = await resolveBackupFile();
  if (backupCache.file === file && backupCache.mtimeMs === mtimeMs) return backupCache;
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!Array.isArray(data?.binders)) throw new Error(`${file} n'est pas une sauvegarde Folio.`);
  backupCache = {
    file,
    mtimeMs,
    data: {
      // Same defaults as the app's migration, for backups saved by older versions
      binders: data.binders.map((b) => ({ setSize: getGame(b.gameType).defaultSetSize, gridRows: 3, gridCols: 3, cards: {}, ...b })),
      decks: data.decks ?? [],
      pulls: data.pulls ?? [],
      prefs: data.prefs ?? {},
      exportedAt: data.exportedAt ?? null,
    },
  };
  log(`sauvegarde chargée : ${file}`);
  return backupCache;
};

// ---------------------------------------------------------------------------
// Catalog

let catalogPromise = null;
let catalogAt = 0;

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const indexFromCache = (cached) => {
  if (cached.sets?.length) setKnownLorcanaSets(withFrenchNames(cached.sets));
  catalogAt = cached.at;
  return buildCatalogIndex(cached.cardsBySet, { fr: cached.fr ?? undefined });
};

/** French cards, or null when LorcanaJSON cannot be reached (the server then answers in English). */
const fetchFrench = async () => {
  try {
    return buildLocalizedCards(await fetchJson(LORCANAJSON_FR));
  } catch (error) {
    log(`textes français indisponibles (${error.message})`);
    return null;
  }
};

const readCatalogCache = async () => {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
};

/** Every numbered Lorcana chapter from Lorcast, fetched one set at a time and cached on disk. */
const fetchCatalog = async () => {
  const cached = await readCatalogCache();
  // Caches from before the French texts (no fr field) are refreshed once
  if (cached && Date.now() - cached.at < CATALOG_MAX_AGE && cached.fr !== undefined) return indexFromCache(cached);
  try {
    const sets = ((await fetchJson(`${LORCAST}/sets`)).results ?? [])
      .filter((s) => /^\d+$/.test(s.code))
      .map((s) => ({ code: s.code, name: s.name }))
      .sort((a, b) => Number(a.code) - Number(b.code));
    const cardsBySet = {};
    for (const { code } of sets) {
      const cards = await fetchJson(`${LORCAST}/sets/${code}/cards`);
      if (cards.length) cardsBySet[code] = cards.map(slimLorcastCard);
      await wait(100);
    }
    const fresh = { at: Date.now(), sets, cardsBySet, fr: await fetchFrench() };
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(fresh));
    log(`catalogue téléchargé : ${Object.keys(cardsBySet).length} chapitres`);
    return indexFromCache(fresh);
  } catch (error) {
    // Offline: a stale catalog is better than none
    if (cached) {
      log(`catalogue périmé utilisé (${error.message})`);
      return indexFromCache(cached);
    }
    throw error;
  }
};

const loadCatalog = () => {
  if (catalogPromise && catalogAt && Date.now() - catalogAt > CATALOG_MAX_AGE) catalogPromise = null;
  catalogPromise ??= fetchCatalog().catch((error) => {
    catalogPromise = null;
    throw new Error(`Catalogue Lorcast indisponible : ${error.message}`);
  });
  return catalogPromise;
};

/** Backup + catalog + owned cards, rebuilt on each call (cheap, and always matches the newest save). */
const getContext = async () => {
  const [backup, index] = await Promise.all([loadBackup(), loadCatalog()]);
  const { binders, pulls } = backup.data;
  return { ...backup.data, file: backup.file, index, collection: buildCollection(binders, index, pulls) };
};

// ---------------------------------------------------------------------------
// Formatting

/** "[1-42] Elsa - Esprit de l'hiver (Elsa - Spirit of Winter)": French first, English for lists found online. */
const cite = (card) => {
  const french = localizeCard(card, 'fr').fullName;
  return `[${card.id}] ${french}${french !== card.fullName ? ` (${card.fullName})` : ''}`;
};
const inkLabel = (key) => getInk(key).label;
const rarityLabel = (key) => LORCANA_RARITIES.find((r) => r.key === key)?.label ?? key ?? '?';
const typeLabel = (key) => CARD_TYPES.find((t) => t.key === key)?.label ?? key;
const pct = (ratio) => `${Math.round(ratio * 100)} %`;
const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;
const setLabel = (code) => `chapitre ${code}${getLorcanaSetName(code) ? ` (${getLorcanaSetName(code)})` : ''}`;

const formatLocation = (binder, cardNumber) => {
  const loc = getLocation(parseInt(cardNumber, 10), binder);
  return `« ${binder.name} » page ${loc.page} rangée ${loc.row} col. ${loc.col} (feuille ${loc.sheet}, ${loc.side})`;
};

const formatCopies = (normal, foil) => `×${normal + foil}${foil ? ` dont ${foil} foil` : ''}`;

/** "possédée ×3 dont 1 foil : « Ch1 » page 5 … ×3 (1 sortie pour un deck)" */
const formatOwned = (entry) => {
  if (!entry) return 'non possédée';
  const places = entry.copies
    .map((c) => `${formatLocation(c.binder, c.cardNumber)} ${formatCopies(c.normal, c.foil)}${c.pulled ? ` (${c.pulled} sortie${c.pulled > 1 ? 's' : ''} pour un deck)` : ''}`)
    .join(' ; ');
  return `possédée ${formatCopies(entry.normal, entry.foil)} : ${places}`;
};

const findBinder = (binders, query) => {
  const q = normalizeName(query);
  const found =
    binders.find((b) => b.id === query) ??
    binders.find((b) => normalizeName(b.name) === q) ??
    binders.filter((b) => normalizeName(b.name).includes(q));
  if (Array.isArray(found)) {
    if (found.length === 1) return found[0];
    throw new Error(
      found.length
        ? `Plusieurs fardes correspondent à « ${query} » : ${found.map((b) => `« ${b.name} »`).join(', ')}.`
        : `Aucune farde « ${query} ». Fardes : ${binders.map((b) => `« ${b.name} »`).join(', ')}.`
    );
  }
  return found;
};

const findDeck = (decks, query) => {
  const q = normalizeName(query);
  const found =
    decks.find((d) => d.id === query) ??
    decks.find((d) => normalizeName(d.name) === q) ??
    decks.filter((d) => normalizeName(d.name).includes(q));
  if (Array.isArray(found)) {
    if (found.length === 1) return found[0];
    throw new Error(
      found.length
        ? `Plusieurs decks correspondent à « ${query} » : ${found.map((d) => `« ${d.name} »`).join(', ')}.`
        : decks.length
          ? `Aucun deck « ${query} ». Decks : ${decks.map((d) => `« ${d.name} »`).join(', ')}.`
          : 'Aucun deck dans la sauvegarde.'
    );
  }
  return found;
};

/** Every word of the query appears in the card's full name, French or English. */
const matchesName = (card, query) => {
  if (!query) return false;
  const name = normalizeName(`${card.fullName} ${card.l10n?.fr?.fullName ?? ''}`);
  return normalizeName(query)
    .split(' ')
    .every((word) => name.includes(word));
};

const formatCurve = (curve) => curve.map((n, cost) => `${cost === 7 ? '7+' : cost}:${n}`).join(' ');

const formatAnalysisHeader = (analysis) => {
  const types = Object.entries(analysis.types)
    .map(([type, n]) => `${typeLabel(type)} ${n}`)
    .join(', ');
  return [
    `${analysis.total} cartes · encres : ${analysis.inks.map(inkLabel).join(' / ') || '—'} · encrables : ${analysis.inkable} (${analysis.total ? pct(analysis.inkable / analysis.total) : '—'}) · coût moyen ${analysis.averageCost.toFixed(2)}`,
    `Courbe (coût:copies) : ${formatCurve(analysis.curve)}`,
    `Types : ${types || '—'}`,
    analysis.errors.length ? `Erreurs :\n${analysis.errors.map((e) => `  ✗ ${e.message}`).join('\n')}` : 'Aucune erreur de construction.',
    ...(analysis.warnings.length ? [`Avertissements :\n${analysis.warnings.map((w) => `  ! ${w.message}`).join('\n')}`] : []),
  ].join('\n');
};

const byCost = (a, b) => (a.card?.cost ?? 99) - (b.card?.cost ?? 99) || a.name.localeCompare(b.name);

// ---------------------------------------------------------------------------
// Server

const server = new McpServer(
  { name: 'folio', version: '0.1.0' },
  {
    instructions:
      "Collection de cartes Disney Lorcana de l'utilisateur, rangée dans des fardes (classeurs) Folio, et ses decks. " +
      'Les cartes sont citées [chapitre-numéro] Nom - Version. Un deck : 60 cartes minimum, 4 copies max par nom complet, 2 encres max. ' +
      "Les données viennent de la dernière sauvegarde Folio (bouton « Sauvegarder ») : si elles semblent dépassées, propose à l'utilisateur d'en refaire une.",
  }
);

/** Registers a tool whose handler returns text; errors come back as tool errors, not crashes. */
const tool = (name, config, handler) =>
  server.registerTool(name, { inputSchema: {}, ...config }, async (args) => {
    try {
      return { content: [{ type: 'text', text: await handler(args ?? {}) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erreur : ${error.message}` }], isError: true };
    }
  });

const inkEnum = z.enum(INKS.map((i) => i.key));
const typeEnum = z.enum(CARD_TYPES.map((t) => t.key));
const formatEnum = z.enum(FORMATS.map((f) => f.key));

tool(
  'list_binders',
  {
    title: 'Lister les fardes',
    description: 'Liste les fardes (classeurs) de la sauvegarde Folio : jeu, chapitre, grille, nombre de cartes et complétion.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { binders, decks, file, exportedAt } = await getContext();
    const lines = binders.map((b) => {
      const stats = getBinderStats(b);
      const set = b.gameType === 'lorcana' && b.setCode ? ` · ${setLabel(b.setCode)}` : '';
      const progress = stats.progress !== null ? ` · complétion ${stats.owned}/${b.setSize} (${pct(stats.progress)})` : '';
      return `- « ${b.name} » (id ${b.id}) · ${getGame(b.gameType).fullLabel}${set} · grille ${b.gridCols}×${b.gridRows} · ${plural(stats.unique, 'carte unique', 'cartes uniques')}, ${plural(stats.copies, 'exemplaire')}${stats.foils ? `, ${plural(stats.foils, 'foil')}` : ''}${progress}`;
    });
    return [
      `Sauvegarde : ${file}${exportedAt ? ` (du ${exportedAt.slice(0, 10)})` : ''}`,
      `${binders.length} farde(s), ${decks.length} deck(s).`,
      ...lines,
    ].join('\n');
  }
);

tool(
  'search_cards',
  {
    title: 'Chercher des cartes',
    description:
      'Cherche des cartes Lorcana dans tout le catalogue ou seulement dans la collection (owned_only), avec les exemplaires possédés et leur emplacement dans les fardes (page, rangée, colonne). ' +
      'query cherche dans le nom, la version, les classifications, les mots-clés et le texte de règles.',
    inputSchema: {
      query: z.string().optional().describe('Mots à chercher, ex. "elsa", "princess", "Shift", "draw a card"'),
      inks: z.array(inkEnum).optional().describe('Encres acceptées'),
      types: z.array(typeEnum).optional().describe('Types acceptés'),
      cost_min: z.number().int().min(0).optional(),
      cost_max: z.number().int().min(0).optional(),
      inkable: z.boolean().optional().describe('true : seulement les encrables, false : seulement les non encrables'),
      owned_only: z.boolean().optional().describe('Seulement les cartes possédées'),
      set: z.string().optional().describe('Code de chapitre, ex. "12"'),
      format: formatEnum.optional().describe('Seulement les cartes légales dans ce format'),
      limit: z.number().int().min(1).max(100).optional().describe('Nombre max de résultats (30 par défaut)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, inks, types, cost_min, cost_max, inkable, owned_only, set, format, limit = 30 }) => {
    const { index, collection } = await getContext();
    const seen = new Set();
    const results = [];
    for (const card of index.all) {
      if (seen.has(card.key)) continue;
      if (set && card.set !== set) continue;
      if (owned_only && !collection.entries.has(card.key)) continue;
      if (inks?.length && !card.inks.some((i) => inks.includes(i))) continue;
      if (types?.length && !card.types.some((t) => types.includes(t))) continue;
      if (cost_min != null && card.cost < cost_min) continue;
      if (cost_max != null && card.cost > cost_max) continue;
      if (inkable != null && card.inkwell !== inkable) continue;
      if (!matchesQuery(card, query)) continue;
      if (format && getLegality(index, card.key, format) !== 'legal') continue;
      seen.add(card.key);
      // Show the owned printing when there is one, else the regular printing
      results.push(collection.entries.get(card.key)?.card ?? (set ? card : getMainPrinting(index, card.key)));
    }
    // Cards named after the query first (« elsa » finds Elsa before the cards that mention her)
    const named = (card) => matchesName(card, query);
    results.sort((a, b) => named(b) - named(a) || a.cost - b.cost || a.fullName.localeCompare(b.fullName));
    if (!results.length) return 'Aucune carte ne correspond.';
    const shown = results.slice(0, limit);
    return [
      `${results.length} carte(s)${results.length > shown.length ? `, ${shown.length} affichées (augmente limit pour en voir plus)` : ''} :`,
      ...shown.map((card) => {
        const others = (index.byKey.get(card.key) ?? []).filter((c) => c.id !== card.id);
        const reprints = others.length ? `\n    autres impressions : ${others.map((c) => `${c.id} (${rarityLabel(c.rarity)})`).join(', ')}` : '';
        return `${formatCardLine(card)}\n    → ${formatOwned(collection.entries.get(card.key))}${reprints}`;
      }),
    ].join('\n');
  }
);

tool(
  'get_card',
  {
    title: 'Détail d’une carte',
    description: 'Détail complet d’une carte : texte, statistiques, légalité, prix indicatifs (USD, TCGplayer), impressions, exemplaires possédés avec emplacements, decks qui l’utilisent.',
    inputSchema: {
      id: z.string().optional().describe('Identifiant chapitre-numéro, ex. "12-42"'),
      name: z.string().optional().describe('Nom complet ou partiel, ex. "Elsa - Spirit of Winter"'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ id, name }) => {
    const { index, collection, decks } = await getContext();
    let card = id ? index.byId.get(id.trim()) : null;
    if (!card && name) {
      const key = normalizeName(name);
      if (index.byKey.has(key)) card = getMainPrinting(index, key);
      else {
        // Names first; rules text only when no name matches
        const byName = [...index.byKey.keys()].filter((k) => matchesName(getMainPrinting(index, k), name));
        const keys = byName.length ? byName : [...index.byKey.keys()].filter((k) => matchesQuery(getMainPrinting(index, k), name));
        if (keys.length === 1) card = getMainPrinting(index, keys[0]);
        else if (keys.length > 1) {
          return `Plusieurs cartes correspondent à « ${name} » :\n${keys
            .slice(0, 15)
            .map((k) => `- ${cite(getMainPrinting(index, k))}`)
            .join('\n')}${keys.length > 15 ? `\n… et ${keys.length - 15} autres` : ''}`;
        }
      }
    }
    if (!card) throw new Error(`Carte introuvable (${id ?? name ?? 'aucun identifiant'}).`);

    const printings = index.byKey.get(card.key) ?? [card];
    const usage = (getDeckUsage(decks).get(card.key) ?? []).map((u) => `« ${u.deck.name} » ×${u.qty}`);
    return [
      formatCardLine(card),
      `Encre${card.inks.length > 1 ? 's' : ''} : ${card.inks.map(inkLabel).join(' / ')} · ${card.inkwell ? 'encrable' : 'non encrable'} · rareté ${rarityLabel(card.rarity)}`,
      `Légalité : Core ${getLegality(index, card.key, 'core') ?? '?'}, Infinity ${getLegality(index, card.key, 'infinity') ?? '?'}`,
      `Prix indicatif (USD, TCGplayer) : ${card.usd ?? '?'} $${card.usdFoil ? ` · foil ${card.usdFoil} $` : ''}`,
      `Impressions : ${printings.map((c) => `${c.id} ${rarityLabel(c.rarity)} (${setLabel(c.set)})`).join(' ; ')}`,
      `Collection : ${formatOwned(collection.entries.get(card.key))}`,
      `Decks : ${usage.length ? usage.join(', ') : 'aucun'}`,
    ].join('\n');
  }
);

tool(
  'collection_summary',
  {
    title: 'Résumé de la collection',
    description: 'Vue d’ensemble de la collection Lorcana : cartes par encre, type et rareté, complétion par chapitre, chapitres Core, conflits entre decks.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { index, collection, decks, binders } = await getContext();
    const entries = [...collection.entries.values()];
    const count = (keyOf) => {
      const map = new Map();
      for (const e of entries) {
        for (const k of [keyOf(e.card)].flat()) {
          const v = map.get(k) ?? { unique: 0, copies: 0 };
          map.set(k, { unique: v.unique + 1, copies: v.copies + e.total });
        }
      }
      return map;
    };
    const fmt = (map, label) =>
      [...map.entries()]
        .sort((a, b) => b[1].copies - a[1].copies)
        .map(([k, v]) => `${label(k)} ${v.unique} (${v.copies} ex.)`)
        .join(', ');

    // Completion per chapter, over the cards owned in any binder
    const ownedIds = new Set(entries.flatMap((e) => e.copies.map((c) => c.card.id)));
    const chapters = index.sets
      .map((set) => {
        const cards = index.bySet.get(set);
        const regular = cards.filter((c) => !SPECIAL_RARITIES.includes(c.rarity));
        const owned = cards.filter((c) => ownedIds.has(c.id));
        if (!owned.length) return null;
        const ownedRegular = regular.filter((c) => ownedIds.has(c.id)).length;
        return `- ${setLabel(set)} : ${ownedRegular}/${regular.length} cartes régulières (${pct(ownedRegular / regular.length)}), ${owned.length - ownedRegular} spéciales (Epic/Enchanted/Iconic) sur ${cards.length - regular.length}`;
      })
      .filter(Boolean);

    const conflicts = getSharedCopyConflicts(decks, collection);
    const lorcanaBinders = binders.filter((b) => b.gameType === 'lorcana');
    return [
      `${plural(entries.length, 'carte unique', 'cartes uniques')}, ${plural(entries.reduce((s, e) => s + e.total, 0), 'exemplaire')} (${plural(entries.reduce((s, e) => s + e.foil, 0), 'foil')}) dans ${lorcanaBinders.length} farde(s) Lorcana.`,
      `Par encre : ${fmt(count((c) => c.inks), inkLabel)}`,
      `Par type : ${fmt(count((c) => getMainType(c)), typeLabel)}`,
      `Par rareté : ${fmt(count((c) => c.rarity), rarityLabel)}`,
      `Encrables : ${entries.filter((e) => e.card.inkwell).length} cartes uniques sur ${entries.length}`,
      `Chapitres en rotation Core : ${getCoreSets(index).join(', ') || '?'}`,
      'Complétion par chapitre :',
      ...(chapters.length ? chapters : ['- aucune carte reconnue']),
      ...(collection.unknown.length ? [`${collection.unknown.length} emplacement(s) sans carte correspondante dans le catalogue.`] : []),
      ...(conflicts.length
        ? [
            'Cartes partagées par plusieurs decks avec trop peu d’exemplaires :',
            ...conflicts.map((c) => `- ${c.name} : ${c.owned} possédée(s), ${c.needed} utilisées (${c.decks.map((u) => `« ${u.deck.name} » ×${u.qty}`).join(', ')})`),
          ]
        : []),
    ].join('\n');
  }
);

tool(
  'missing_cards',
  {
    title: 'Cartes manquantes d’une farde',
    description: 'Cartes du chapitre d’une farde Lorcana qui ne sont pas encore dans la farde, avec l’emplacement prévu. Couvre tout le chapitre, versions spéciales comprises.',
    inputSchema: {
      binder: z.string().describe('Nom ou id de la farde'),
      rarities: z
        .array(z.string())
        .optional()
        .describe('Raretés Lorcast à garder : Common, Uncommon, Rare, Super_rare, Legendary, Epic, Enchanted, Iconic'),
      limit: z.number().int().min(1).max(300).optional().describe('Nombre max de lignes (200 par défaut)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ binder: query, rarities, limit = 200 }) => {
    const { index, binders } = await getContext();
    const binder = findBinder(binders, query);
    if (binder.gameType !== 'lorcana' || !binder.setCode) throw new Error(`« ${binder.name} » n'est pas une farde Lorcana liée à un chapitre.`);
    const cards = index.bySet.get(String(binder.setCode));
    if (!cards) throw new Error(`Chapitre ${binder.setCode} absent du catalogue.`);

    // Art variants sharing a number (4a–4e) fill the same pocket: one line per pocket
    const byPocket = new Map();
    for (const card of cards) {
      const n = baseNumber(card.number);
      if (!byPocket.has(n) || card.number === String(n)) byPocket.set(n, card);
    }
    const missing = [...byPocket.entries()]
      .filter(([n]) => !binder.cards[String(n)])
      .filter(([, card]) => !rarities?.length || rarities.includes(card.rarity))
      .sort((a, b) => a[0] - b[0]);
    if (!missing.length) return `Rien ne manque dans « ${binder.name} »${rarities?.length ? ' pour ces raretés' : ''}.`;
    const shown = missing.slice(0, limit);
    return [
      `« ${binder.name} » (${setLabel(binder.setCode)}) : ${missing.length} carte(s) manquante(s)${missing.length > shown.length ? `, ${shown.length} affichées` : ''}.`,
      ...shown.map(([n, card]) => {
        const loc = getLocation(n, binder);
        return `#${n} ${cite(card)} — ${rarityLabel(card.rarity)} — page ${loc.page} rangée ${loc.row} col. ${loc.col}`;
      }),
    ].join('\n');
  }
);

tool(
  'list_decks',
  {
    title: 'Lister les decks',
    description: 'Liste les decks de la sauvegarde (les miens et ceux de référence) : format, taille, encres, validité et part des cartes possédées.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { decks, index, collection } = await getContext();
    if (!decks.length) return 'Aucun deck dans la sauvegarde.';
    return decks
      .map((deck) => {
        const a = analyzeDeck(deck, index, collection);
        return `- « ${deck.name} » (id ${deck.id}) · ${deck.kind === 'reference' ? 'référence' : 'mon deck'} · ${deck.format === 'infinity' ? 'Infinity' : 'Core'} · ${a.total} cartes · ${a.inks.map(inkLabel).join(' / ') || '—'} · ${a.valid ? 'valide' : `${a.errors.length} erreur(s)`} · possédé ${pct(a.ownedRatio)}`;
      })
      .join('\n');
  }
);

tool(
  'get_deck',
  {
    title: 'Analyser un deck',
    description: 'Analyse complète d’un deck : courbe, encres, types, erreurs de construction, légalité, et pour chaque carte les exemplaires possédés ou manquants.',
    inputSchema: { deck: z.string().describe('Nom ou id du deck') },
    annotations: { readOnlyHint: true },
  },
  async ({ deck: query }) => {
    const { decks, index, collection, pulls } = await getContext();
    const deck = findDeck(decks, query);
    const a = analyzeDeck(deck, index, collection);
    const pulledFor = (key) =>
      (collection.entries.get(key)?.copies ?? []).reduce((s, c) => s + getPulledCount(pulls, c.binder.id, c.cardNumber, deck.id), 0);
    const conflicts = getSharedCopyConflicts(decks, collection).filter((c) => c.decks.some((u) => u.deck.id === deck.id));
    return [
      `« ${deck.name} » · ${deck.kind === 'reference' ? 'deck de référence' : 'mon deck'} · format ${deck.format === 'infinity' ? 'Infinity' : 'Core'}${deck.sourceUrl ? ` · source ${deck.sourceUrl}` : ''}`,
      formatAnalysisHeader(a),
      `Possédé : ${a.owned}/${a.total} exemplaires (${pct(a.ownedRatio)})`,
      'Cartes :',
      ...[...a.entries].sort(byCost).map((e) => {
        const card = e.card;
        const info = card ? ` (${card.cost}${card.inkwell ? '⬡' : ''} ${card.inks.map(inkLabel).join('/')})` : ' (hors catalogue)';
        const pulled = pulledFor(e.key);
        return `  ${e.qty} × ${card ? cite(card) : e.name}${info} — possédées ${e.owned}${e.missing ? `, manquantes ${e.missing}` : ''}${pulled ? `, ${pulled} sortie(s) pour ce deck` : ''}`;
      }),
      ...(conflicts.length
        ? ['Partagées avec d’autres decks sans assez d’exemplaires :', ...conflicts.map((c) => `  - ${c.name} : ${c.owned} possédée(s) pour ${c.needed} utilisées`)]
        : []),
      ...(deck.notes ? [`Notes : ${deck.notes}`] : []),
      'Liste à importer :',
      formatDeckList(deck, index),
    ].join('\n');
  }
);

tool(
  'check_deck_list',
  {
    title: 'Puis-je monter ce deck ?',
    description:
      'Compare une liste de deck collée (format « 4 Nom - Version », un par ligne, comme sur Dreamborn ou inkdecks) à la collection : part possédée, cartes manquantes, coût indicatif des manquantes, erreurs de construction.',
    inputSchema: {
      list: z.string().describe('La liste de deck, une carte par ligne'),
      format: formatEnum.optional().describe('Format pour la légalité (core par défaut)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ list, format = 'core' }) => {
    const { index, collection } = await getContext();
    const { cards, unresolved } = parseDeckList(list, index);
    if (!cards.length) throw new Error('Aucune carte reconnue dans la liste.');
    const a = analyzeDeck({ id: 'pasted', name: 'Liste collée', kind: 'reference', format, cards }, index, collection);
    let cost = 0;
    let unpriced = 0;
    const missing = a.missing.sort(byCost).map((e) => {
      const card = getMainPrinting(index, e.key) ?? e.card;
      if (card?.usd != null) cost += card.usd * e.missing;
      else unpriced++;
      return `  ${e.missing} × ${card ? cite(card) : e.name}${card?.usd != null ? ` (~${card.usd} $ pièce)` : ''}`;
    });
    return [
      `Possédé : ${a.owned}/${a.total} exemplaires (${pct(a.ownedRatio)}).`,
      formatAnalysisHeader(a),
      ...(missing.length
        ? [
            `Manquantes (${a.missing.reduce((s, e) => s + e.missing, 0)} exemplaires, ~${cost.toFixed(2)} $ indicatifs TCGplayer${unpriced ? `, ${unpriced} sans prix` : ''}) :`,
            ...missing,
          ]
        : ['Tu as toutes les cartes de ce deck.']),
      ...(unresolved.length ? ['Lignes non reconnues :', ...unresolved.map((u) => `  ${u.line}`)] : []),
    ].join('\n');
  }
);

tool(
  'pull_list',
  {
    title: 'Liste de collecte',
    description: 'Où aller chercher chaque carte d’un deck dans les fardes, dans l’ordre des fardes et des pages, pour ne parcourir chaque farde qu’une fois. Ignore les copies déjà sorties pour ce deck.',
    inputSchema: { deck: z.string().describe('Nom ou id du deck') },
    annotations: { readOnlyHint: true },
  },
  async ({ deck: query }) => {
    const { decks, collection, pulls, binders } = await getContext();
    const deck = findDeck(decks, query);
    const { rows, short } = getPullList(deck, collection, pulls, binders);
    const lines = [];
    let currentBinder = null;
    for (const row of rows) {
      if (row.binder.id !== currentBinder) {
        currentBinder = row.binder.id;
        lines.push(`Farde « ${row.binder.name} » :`);
      }
      const loc = row.location;
      lines.push(`  feuille ${loc.sheet} ${loc.side}, page ${loc.page}, rangée ${loc.row} col. ${loc.col} — #${row.cardNumber} ${cite(row.card)} ×${row.take}`);
    }
    return [
      `Collecte pour « ${deck.name} » : ${rows.reduce((s, r) => s + r.take, 0)} carte(s) à sortir.`,
      ...(lines.length ? lines : ['Rien à sortir : tout est déjà sorti ou manquant.']),
      ...(short.length ? ['Pas assez d’exemplaires disponibles :', ...short.map((s) => `  ${s.name} : ${s.missing} manquante(s)`)] : []),
    ].join('\n');
  }
);

await server.connect(new StdioServerTransport());
log(`prêt · sauvegarde lue depuis ${backupTarget()}`);
// Warm the catalog so the first question is fast; errors surface on the first tool call instead
loadCatalog().catch((error) => log(error.message));
