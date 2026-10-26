import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { INKS, matchesQuery, getMainPrinting } from '../../utils/catalog';
import { useCardLang } from '../../hooks/useCardLang';

const MAX_RESULTS = 50;

const Toggle = ({ checked, onChange, children }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    aria-pressed={checked}
    className={`px-2.5 py-1 rounded-md text-xs ring-1 ring-inset transition-colors ${
      checked ? 'bg-indigo-500/15 ring-indigo-400/60 text-white' : 'ring-white/10 text-slate-400 hover:text-white'
    }`}
  >
    {children}
  </button>
);

/** Search the catalog (owned cards first) and add cards to a deck. */
const DeckCardPicker = ({ deck, deckInks, onAdd }) => {
  const { index } = useCatalog();
  const collection = useCollection();
  const cardLang = useCardLang();
  const [query, setQuery] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(true);
  const [inks, setInks] = useState([]);

  const results = useMemo(() => {
    if (!index) return [];
    const inkFilter = inks.length ? inks : null;
    const seen = new Set();
    const out = [];
    // One result per card name, shown with its regular printing
    for (const card of index.all) {
      if (seen.has(card.key)) continue;
      if (ownedOnly && !collection.entries.has(card.key)) continue;
      if (inkFilter && !card.inks.every((i) => inkFilter.includes(i))) continue;
      if (!matchesQuery(card, query)) continue;
      seen.add(card.key);
      out.push(getMainPrinting(index, card.key));
    }
    return out
      .sort((a, b) => a.cost - b.cost || cardLang.fullName(a).localeCompare(cardLang.fullName(b)))
      .slice(0, MAX_RESULTS);
  }, [index, collection, query, ownedOnly, inks, cardLang]);

  const inDeck = (key) => deck.cards.find((c) => c.key === key)?.qty ?? 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ajouter une carte : nom FR ou EN, classe, capacité…"
          className="field pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Toggle checked={ownedOnly} onChange={setOwnedOnly}>
          Dans ma collection
        </Toggle>
        {INKS.map((ink) => (
          <Toggle
            key={ink.key}
            checked={inks.includes(ink.key)}
            onChange={(on) => setInks((prev) => (on ? [...prev, ink.key] : prev.filter((k) => k !== ink.key)))}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: ink.color }} />
            {ink.label}
          </Toggle>
        ))}
        {deckInks.length > 0 && inks.join() !== deckInks.join() && (
          <button type="button" onClick={() => setInks(deckInks)} className="text-xs text-indigo-300 hover:text-white px-1">
            Encres du deck
          </button>
        )}
      </div>

      <div data-preview-group className="space-y-1 max-h-[420px] overflow-y-auto scrollbar-thin -mx-1 px-1">
        {results.map((card) => {
          const owned = collection.entries.get(card.key)?.total ?? 0;
          const qty = inDeck(card.key);
          return (
            <div key={card.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
              <CardThumb card={card} className="w-9 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 truncate">{cardLang.fullName(card)}</div>
                <div className="text-[11px] text-slate-500">
                  {card.inks.join('/')} · {card.cost}
                  {card.inkwell ? ' ⬡' : ''} · {owned ? `${owned} possédée${owned > 1 ? 's' : ''}` : 'non possédée'}
                  {qty > 0 && <span className="text-indigo-300"> · {qty} dans le deck</span>}
                </div>
              </div>
              <button onClick={() => onAdd(card)} className="btn-icon" aria-label={`Ajouter ${cardLang.fullName(card)}`} title="Ajouter un exemplaire">
                <Plus size={16} />
              </button>
            </div>
          );
        })}
        {index && results.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Aucune carte.</p>}
      </div>
    </div>
  );
};

export default DeckCardPicker;
