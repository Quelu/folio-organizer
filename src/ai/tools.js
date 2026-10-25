import { formatCardLine, matchesQuery, getMainPrinting, getLegality, normalizeName, FORMATS } from '../utils/catalog';
import { analyzeDeck } from '../utils/deckRules';
import { getCopyAllocation } from '../utils/collection';
import { getTradeableSurplus, suggestTrades } from '../utils/trades';

/** Client-side tools: the browser runs them on the local catalog and collection. */
export const TOOLS = [
  {
    name: 'search_cards',
    description:
      "Cherche dans tout le catalogue Lorcana (cartes possédées ou non). Renvoie une ligne par carte avec son identifiant, ses caractéristiques, son texte, les exemplaires possédés et le prix. À utiliser pour trouver des cartes par encre, coût, type, classe ou capacité, ou des cartes à acheter.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Mots à trouver dans le nom, la version, les classes, mots-clés ou le texte, en français ou en anglais.' },
        inks: { type: 'array', items: { type: 'string', enum: ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel'] } },
        types: { type: 'array', items: { type: 'string', enum: ['Character', 'Action', 'Song', 'Item', 'Location'] } },
        cost_min: { type: 'integer' },
        cost_max: { type: 'integer' },
        inkable: { type: 'boolean' },
        owned_only: { type: 'boolean', description: 'Uniquement les cartes possédées.' },
        format: { type: 'string', enum: ['core', 'infinity'], description: 'Uniquement les cartes légales dans ce format.' },
        limit: { type: 'integer', description: '25 par défaut, 60 maximum.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_cards',
    description:
      'Détail de cartes par identifiant [chapitre-numéro] : texte complet, exemplaires possédés et leurs emplacements dans les fardes (page, rangée, colonne), prix, légalité Core/Infinity.',
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Ex. ["12-42", "9-43"]' } },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_deck',
    description: "Lit un deck de l'utilisateur : liste, exemplaires possédés et manquants, statistiques, erreurs de construction.",
    input_schema: {
      type: 'object',
      properties: { deck_id: { type: 'string' } },
      required: ['deck_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_trades',
    description:
      "Propose des échanges à valeur égale pour obtenir une carte manquante, avec les doubles de l'utilisateur (prix Cardmarket ou TCGplayer).",
    input_schema: {
      type: 'object',
      properties: { card_id: { type: 'string' }, foil: { type: 'boolean' } },
      required: ['card_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_deck',
    description:
      "Propose un deck complet à l'utilisateur. L'application vérifie les règles (60 cartes min, 4 copies max, 2 encres max, légalité du format) et renvoie les erreurs à corriger ; l'utilisateur peut ensuite l'enregistrer ou l'appliquer au deck existant (replaces_deck_id).",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        format: { type: 'string', enum: ['core', 'infinity'] },
        summary: { type: 'string', description: 'Plan de jeu et choix principaux, en français, 2 à 4 phrases.' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Identifiant [chapitre-numéro]' }, qty: { type: 'integer' } },
            required: ['id', 'qty'],
            additionalProperties: false,
          },
        },
        replaces_deck_id: { type: 'string', description: "Id du deck de l'utilisateur que cette liste remplace, s'il s'agit d'une amélioration." },
      },
      required: ['name', 'format', 'summary', 'cards'],
      additionalProperties: false,
    },
  },
];

/** Anthropic-hosted web search, when the user turns it on (latest meta, tournament results). */
export const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };

const MAX_LIMIT = 60;

/**
 * Turns the cards of a propose_deck input into deck cards, merging printings of the same card.
 * @returns {{ cards: { key, id, name, qty }[], unknown: string[] }}
 */
export const resolveProposedCards = (input, index) => {
  const merged = new Map();
  const unknown = [];
  for (const { id, qty } of Array.isArray(input?.cards) ? input.cards : []) {
    const card = index.byId.get(String(id)) ?? getMainPrinting(index, normalizeName(id));
    if (!card || !Number.isInteger(qty) || qty < 1) {
      unknown.push(String(id));
      continue;
    }
    const existing = merged.get(card.key);
    merged.set(card.key, { key: card.key, id: existing?.id ?? card.id, name: card.fullName, qty: (existing?.qty ?? 0) + qty });
  }
  return { cards: [...merged.values()], unknown };
};

/**
 * Builds the function that runs a tool call against the user's data.
 * @returns {(name: string, input: object) => string} text result; throws on invalid input
 */
export const createToolRunner = ({ index, collection, decks, allocations = {}, prices, tradeKeep }) => {
  // Copies the user split between decks: each deck only counts its own and the shared ones
  const { availableFor, shared } = getCopyAllocation(decks, collection, allocations);
  const owned = (card) => {
    const entry = collection.entries.get(card.key);
    return entry ? ` | possédée ×${entry.total}${entry.foil ? ` (${entry.foil} foil)` : ''}` : ' | non possédée';
  };
  const price = (card) => {
    const value = prices.getPrice(card);
    return value != null ? ` | ${prices.format(value)}` : '';
  };

  const runners = {
    search_cards: (input) => {
      const limit = Math.min(Math.max(1, input.limit ?? 25), MAX_LIMIT);
      const seen = new Set();
      const results = [];
      for (const card of index.all) {
        if (seen.has(card.key)) continue;
        if (input.owned_only && !collection.entries.has(card.key)) continue;
        if (input.inks?.length && !card.inks.every((i) => input.inks.includes(i))) continue;
        if (input.types?.length && !input.types.some((t) => card.types.includes(t))) continue;
        if (input.cost_min != null && card.cost < input.cost_min) continue;
        if (input.cost_max != null && card.cost > input.cost_max) continue;
        if (input.inkable != null && card.inkwell !== input.inkable) continue;
        if (input.format && getLegality(index, card.key, input.format) !== 'legal') continue;
        if (!matchesQuery(card, input.query)) continue;
        seen.add(card.key);
        results.push(collection.entries.get(card.key)?.card ?? getMainPrinting(index, card.key));
      }
      // Owned cards first: the user builds with them
      results.sort((a, b) => collection.entries.has(b.key) - collection.entries.has(a.key) || a.cost - b.cost);
      if (results.length === 0) return 'Aucune carte trouvée.';
      return `${results.length} carte(s)${results.length > limit ? `, ${limit} premières` : ''} :\n${results
        .slice(0, limit)
        .map((c) => `${formatCardLine(c)}${owned(c)}${price(c)}`)
        .join('\n')}`;
    },

    get_cards: (input) => {
      if (!Array.isArray(input.ids)) throw new Error('ids doit être une liste');
      return input.ids
        .slice(0, 30)
        .map((id) => {
          const card = index.byId.get(String(id));
          if (!card) return `[${id}] introuvable`;
          const entry = collection.entries.get(card.key);
          const places = entry?.copies
            .map((c) => `${c.binder.name} n° ${c.cardNumber} (page ${c.location.page}, rangée ${c.location.row}, col. ${c.location.col}) ×${c.normal + c.foil}`)
            .join(' ; ');
          const legal = FORMATS.map((f) => `${f.label} ${getLegality(index, card.key, f.key)}`).join(', ');
          return `${formatCardLine(card)}${owned(card)}${price(card)} | ${legal}${places ? ` | emplacements : ${places}` : ''}`;
        })
        .join('\n');
    },

    get_deck: (input) => {
      const deck = decks.find((d) => d.id === input.deck_id);
      if (!deck) return `Deck ${input.deck_id} introuvable.`;
      const a = analyzeDeck(deck, index, collection, 'en', availableFor);
      const lines = a.entries.map(
        (e) =>
          `${e.qty} ${e.name} [${e.card?.id ?? '?'}]${e.missing ? ` — manque ${e.missing}` : ''}${
            e.reserved ? ` (${e.reserved} réservée(s) pour un autre deck)` : ''
          }`
      );
      const disputed = shared.filter((s) => s.contested && s.decks.some((d) => d.deck.id === deck.id));
      return [
        `${deck.name} (${deck.format}, ${a.total} cartes, encres ${a.inks.join('/') || '—'})`,
        deck.notes ? `Notes : ${deck.notes}` : null,
        `Courbe (0…7+) : ${a.curve.join(' ')} · encrables ${a.inkable}/${a.total} · coût moyen ${a.averageCost.toFixed(2)}`,
        ...a.errors.map((e) => `ERREUR : ${e.message}`),
        ...a.warnings.map((w) => `Attention : ${w.message}`),
        `Possédé : ${a.owned}/${a.total}`,
        disputed.length
          ? `Partagées avec d'autres decks, pas encore réparties : ${disputed
              .map((s) => `${s.name} (${s.owned} pour ${s.decks.map((d) => `${d.qty} dans ${d.deck.name}`).join(', ')})`)
              .join(' ; ')}`
          : null,
        ...lines,
      ]
        .filter(Boolean)
        .join('\n');
    },

    suggest_trades: (input) => {
      const card = index.byId.get(String(input.card_id));
      if (!card) return `Carte ${input.card_id} introuvable.`;
      const target = prices.getPrice(card, Boolean(input.foil));
      if (target == null) return `Pas de prix connu pour ${card.fullName}.`;
      const haves = getTradeableSurplus(collection, decks, tradeKeep, prices.getPrice);
      const combos = suggestTrades(target, haves);
      if (combos.length === 0) return `${card.fullName} vaut ${prices.format(target)} : aucun échange équilibré avec les doubles actuels.`;
      return [
        `${card.fullName} vaut ${prices.format(target)} (${prices.source}). Échanges possibles avec les doubles :`,
        ...combos.map(
          (c, i) =>
            `${i + 1}. ${c.items.map(({ have, qty }) => `${qty}× [${have.card.id}] ${have.card.fullName}${have.foil ? ' foil' : ''}`).join(' + ')} = ${prices.format(c.total)}`
        ),
      ].join('\n');
    },

    propose_deck: (input) => {
      if (typeof input.name !== 'string' || !Array.isArray(input.cards)) throw new Error('name et cards sont obligatoires');
      const { cards, unknown } = resolveProposedCards(input, index);
      const a = analyzeDeck({ cards, format: input.format === 'infinity' ? 'infinity' : 'core' }, index, collection);
      const replaced = input.replaces_deck_id ? decks.find((d) => d.id === input.replaces_deck_id) : null;
      return [
        a.valid && unknown.length === 0
          ? 'Deck valide, présenté à l\'utilisateur qui peut l\'enregistrer.'
          : 'Deck présenté mais NON valide : corrige et rappelle propose_deck.',
        unknown.length ? `Identifiants inconnus : ${unknown.join(', ')}` : null,
        ...a.errors.map((e) => `ERREUR : ${e.message}`),
        ...a.warnings.map((w) => `Attention : ${w.message}`),
        `${a.total} cartes, encres ${a.inks.join('/')}, encrables ${a.inkable}, possédé ${a.owned}/${a.total}`,
        a.missing.length ? `Manquantes : ${a.missing.map((e) => `${e.missing} ${e.name}`).join(', ')}` : 'Toutes les cartes sont possédées.',
        input.replaces_deck_id && !replaced ? `Le deck ${input.replaces_deck_id} n'existe pas : proposé comme nouveau deck.` : null,
      ]
        .filter(Boolean)
        .join('\n');
    },
  };

  return (name, input) => {
    const run = runners[name];
    if (!run) throw new Error(`Outil inconnu : ${name}`);
    if (!input || typeof input !== 'object') throw new Error('Entrée invalide');
    return run(input);
  };
};

/** Short label of a tool call for the chat. */
export const describeToolCall = (block) => {
  const input = block.input ?? {};
  switch (block.name) {
    case 'search_cards':
      return `Recherche de cartes${input.query ? ` « ${input.query} »` : ''}${input.inks?.length ? ` · ${input.inks.join('/')}` : ''}`;
    case 'get_cards':
      return `Détail de ${input.ids?.length ?? 0} carte(s)`;
    case 'get_deck':
      return 'Lecture du deck';
    case 'suggest_trades':
      return 'Recherche d’échanges';
    case 'web_search':
      return `Recherche web${input.query ? ` « ${input.query} »` : ''}`;
    default:
      return block.name;
  }
};

