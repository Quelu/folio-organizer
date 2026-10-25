import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import Modal from '../ui/Modal';
import CardThumb from '../ui/CardThumb';
import { useCatalog } from '../../hooks/catalogContext';
import { useStore } from '../../hooks/storeContext';
import { useCollection } from '../../hooks/useCollection';
import { matchesQuery, getInk, baseNumber } from '../../utils/catalog';
import { getLocation } from '../../utils/calculations';

const MAX_RESULTS = 40;

const LocationButton = ({ binder, cardNumber, label, onLocate }) => {
  const loc = getLocation(baseNumber(cardNumber), binder);
  return (
    <button
      onClick={() => onLocate(binder.id, baseNumber(cardNumber))}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-300 bg-white/[0.04] ring-1 ring-inset ring-white/10 hover:bg-indigo-500/15 hover:ring-indigo-400/50 hover:text-white transition-colors"
      title="Ouvrir la farde sur cette carte"
    >
      <MapPin size={12} className="text-indigo-300" />
      <span className="font-medium">{binder.name}</span>
      <span className="text-slate-500">
        p.{loc.page} · R{loc.row} C{loc.col}
      </span>
      {label && <span className="text-slate-400">{label}</span>}
    </button>
  );
};

/** Finds a card in the whole catalog and shows where its copies are in the binders. */
const SearchBody = ({ onLocate }) => {
  const { index, status, loaded, total } = useCatalog();
  const { binders } = useStore();
  const collection = useCollection();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!index || query.trim().length < 2) return [];
    const matches = index.all.filter((c) => matchesQuery(c, query));
    // Owned printings first, then by set and number
    const owned = (c) => collection.entries.get(c.key)?.copies.some((copy) => copy.card.id === c.id) ?? false;
    return matches.sort((a, b) => owned(b) - owned(a)).slice(0, MAX_RESULTS);
  }, [index, query, collection]);

  return (
    <div className="px-6 pb-6 pt-2">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom, version, classe, capacité… (ex. elsa, floodborn, 12-42)"
          className="field pl-9"
        />
      </div>

      {!index && (
        <p className="flex items-center gap-2 text-sm text-slate-400 mt-5">
          <Loader2 size={15} className="animate-spin" />
          Chargement du catalogue Lorcana ({loaded}/{total} chapitres)…
        </p>
      )}
      {index && status === 'loading' && loaded < total && (
        <p className="text-xs text-slate-500 mt-2">
          Catalogue en cours de mise à jour ({loaded}/{total} chapitres).
        </p>
      )}

      <div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin -mx-2 px-2">
        {results.map((card) => {
          const entry = collection.entries.get(card.key);
          const copies = entry?.copies.filter((c) => c.card.id === card.id) ?? [];
          const otherPrintings = (entry?.total ?? 0) - copies.reduce((s, c) => s + c.normal + c.foil, 0);
          const setBinder = binders.find((b) => b.gameType === 'lorcana' && b.setCode === card.set);
          return (
            <div key={card.id} className="flex gap-3 p-2 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5">
              <CardThumb card={card} className="w-14 flex-shrink-0" dimmed={!entry} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{card.fullName}</div>
                <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                  {card.inks.map((ink) => (
                    <span key={ink} className="w-2 h-2 rounded-full" style={{ background: getInk(ink).color }} />
                  ))}
                  <span>
                    Coût {card.cost}
                    {card.inkwell ? ' · encrable' : ''} · Chapitre {card.set} n° {card.number} · {card.rarity}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {copies.map((copy) => (
                    <LocationButton
                      key={copy.binder.id}
                      binder={copy.binder}
                      cardNumber={copy.cardNumber}
                      label={`×${copy.normal + copy.foil}${copy.foil ? ` (${copy.foil} foil)` : ''}`}
                      onLocate={onLocate}
                    />
                  ))}
                  {copies.length === 0 && setBinder && (
                    <LocationButton binder={setBinder} cardNumber={card.number} label="emplacement vide" onLocate={onLocate} />
                  )}
                  {copies.length === 0 && !setBinder && (
                    <span className="text-xs text-slate-600">Pas dans ta collection</span>
                  )}
                  {otherPrintings > 0 && (
                    <span className="text-xs text-slate-500 self-center">
                      + {otherPrintings} dans un autre chapitre
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {index && query.trim().length >= 2 && results.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-6">Aucune carte trouvée.</p>
        )}
      </div>
    </div>
  );
};

const CardSearchModal = ({ isOpen, onClose, onLocate }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Où est ma carte ?" size="lg">
    <SearchBody onLocate={onLocate} />
  </Modal>
);

export default CardSearchModal;
