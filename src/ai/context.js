import { formatCardLine, getInk } from '../utils/catalog';
import { formatDeckList } from '../utils/deckRules';
import { getCopyAllocation } from '../utils/collection';

const INSTRUCTIONS = `Tu es l'assistant de Folio, une application pour ranger sa collection de cartes Disney Lorcana dans des fardes (classeurs) et construire des decks.

Ton rôle : analyser les cartes de sa collection, aider l'utilisateur à construire et améliorer des decks avec ce qu'il possède, repérer les synergies, dire quoi acheter ou échanger en priorité, et répondre à ses questions sur les cartes et les règles.

Règles de construction Lorcana :
- 60 cartes minimum, pas de maximum (60 est presque toujours le bon choix).
- 4 exemplaires maximum d'une carte au même nom complet (nom + version), toutes éditions confondues, sauf si le texte de la carte autorise plus.
- 1 ou 2 encres. Une carte bicolore (deux encres) n'est jouable que si le deck a ces deux encres.
- Formats : Core (chapitres récents, rotation) et Infinity (toutes les cartes). La légalité est donnée par les outils.
Rappels de jeu : main de 7, un mulligan (on remet les cartes choisies sous le deck et on repioche). Une fois par tour, on peut mettre une carte encrable (⬡) dans l'encrier. On gagne à 20 lore (◊). Les personnages quêtent pour gagner du lore et défient les personnages épuisés ; les chansons peuvent être chantées en épuisant un personnage de coût suffisant (Singer) ; Shift permet de poser une version sur une autre du même nom.

Principes de construction :
- Viser au moins 2/3 de cartes encrables, une courbe centrée sur les coûts 1 à 4, et des exemplaires en 4 pour les cartes clés (régularité).
- Équilibrer gain de lore, contrôle (retrait, défis), pioche et finishers. Identifier le plan de jeu (agressif, contrôle, combo) avant de choisir les cartes.
- S'inspirer des decks de référence fournis (decks qui gagnent) : reprendre leurs ratios, leurs paires d'encres et leurs moteurs, puis adapter à la collection.

Données : la collection sélectionnée et les decks de référence sont plus bas. Chaque carte a un identifiant [chapitre-numéro]. Les quantités « ×N » sont les exemplaires possédés (toutes fardes et éditions confondues).
Un deck verrouillé (un deck préconstruit gardé tel quel, par exemple) garde ses exemplaires pour lui : ne les compte pas pour construire ou améliorer un autre deck, et ne les propose jamais en échange.
Outils : search_cards pour chercher dans tout le catalogue (y compris les cartes non possédées), get_cards pour le détail (emplacements dans les fardes, prix, légalité), get_deck pour lire un deck de l'utilisateur, suggest_trades pour des échanges à valeur égale, propose_deck pour proposer un deck complet.

Consignes de réponse :
- Réponds en français, de façon concise et structurée (titres courts, listes).
- Cite chaque carte avec son identifiant entre doubles crochets, par exemple [[12-42]] : l'application l'affiche avec son image. N'invente jamais d'identifiant : utilise ceux des données ou des outils.
- Pour proposer un deck complet ou une version modifiée d'un deck, appelle toujours propose_deck (l'application vérifie les règles et te renvoie les erreurs à corriger) au lieu d'écrire la liste dans ta réponse. Si propose_deck renvoie des erreurs, corrige et rappelle-le.
- Par défaut, construis avec les cartes possédées ; si des cartes manquent, dis lesquelles et pourquoi elles valent l'achat ou l'échange.
- Sois honnête sur les limites : si la collection ne permet pas un deck compétitif, dis-le et propose la meilleure option.`;

/** Owned cards, one compact line each, grouped by ink then cost, with the copies locked in a deck. */
const formatCollection = (collection, decks) => {
  const { unlockedFor } = getCopyAllocation(decks, collection);
  const entries = [...collection.entries.values()].sort(
    (a, b) =>
      a.card.inks.join().localeCompare(b.card.inks.join()) || a.card.cost - b.card.cost || a.card.fullName.localeCompare(b.card.fullName)
  );
  return entries
    .map((e) => {
      const locked = e.total - unlockedFor(null, e.key);
      return `${formatCardLine(e.card)} | ×${e.total}${e.foil ? ` (${e.foil} foil)` : ''}${locked ? `, dont ${locked} verrouillée(s)` : ''}`;
    })
    .join('\n');
};

const formatReferenceDeck = (deck, index) =>
  [`### ${deck.name} (${deck.format === 'core' ? 'Core' : 'Infinity'})`, deck.notes?.trim(), formatDeckList(deck, index)]
    .filter(Boolean)
    .join('\n');

/**
 * System prompt of a new conversation: fixed instructions, then the data chosen for it.
 * Frozen with the conversation, so later turns reuse the cached prefix.
 * @returns {{ type: 'text', text: string }[]}
 */
const CARD_NAMES = {
  fr: "Noms de cartes : l'utilisateur joue avec des cartes en français. Dans ton texte, utilise le nom français donné après « FR : » (le nom anglais sinon) ; les cartes citées avec [[id]] s'affichent d'elles-mêmes en français. Les outils acceptent les deux langues.",
  en: "Noms de cartes : l'utilisateur affiche les cartes en anglais. Dans ton texte, utilise les noms anglais ; les cartes citées avec [[id]] s'affichent d'elles-mêmes.",
};

export const buildSystemPrompt = ({ binders, collection, decks, index, includeReferences, lang = 'fr', today = new Date() }) => {
  const references = includeReferences ? decks.filter((d) => d.kind === 'reference' && d.cards.length) : [];
  const myDecks = decks.filter((d) => d.kind !== 'reference');
  const inkTotals = {};
  for (const e of collection.entries.values()) {
    for (const ink of e.card.inks) inkTotals[ink] = (inkTotals[ink] ?? 0) + e.total;
  }

  const data = [
    `Date : ${today.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    `## Fardes sélectionnées\n${binders.map((b) => `- ${b.name} (chapitre ${b.setCode})`).join('\n') || '- aucune'}`,
    `## Collection (${collection.entries.size} cartes différentes)\nPar encre : ${
      Object.entries(inkTotals)
        .map(([ink, n]) => `${getInk(ink).label} ${n}`)
        .join(', ') || '—'
    }\n${formatCollection(collection, myDecks)}`,
    `## Decks de l'utilisateur\n${
      myDecks
        .map((d) => `- id ${d.id} : ${d.name} (${d.cards.reduce((s, c) => s + c.qty, 0)} cartes, ${d.format}${d.locked ? ', verrouillé' : ''})`)
        .join('\n') ||
      '- aucun'
    }`,
    references.length
      ? `## Decks de référence (decks qui gagnent, ajoutés par l'utilisateur)\n${references.map((d) => formatReferenceDeck(d, index)).join('\n\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { type: 'text', text: `${INSTRUCTIONS}\n\n${CARD_NAMES[lang] ?? CARD_NAMES.fr}` },
    { type: 'text', text: data },
  ];
};

/** Everything as one text, to paste into Claude.ai without an API key. */
export const buildClipboardPrompt = (system, question) =>
  `${system.map((b) => b.text).join('\n\n')}\n\n---\n\nMa question : ${question || '(écris ta question ici)'}`;
