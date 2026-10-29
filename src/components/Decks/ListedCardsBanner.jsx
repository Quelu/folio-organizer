import { Tag, X } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useSurplus } from '../../hooks/useSurplus';

/**
 * Cards of a deck the user put on sale: the deck may now need them, so they can be taken off
 * sale from here (and from Cardmarket).
 */
const ListedCardsBanner = ({ deck }) => {
  const { unlistForSale } = useStore();
  const cardLang = useCardLang();
  const { listed } = useSurplus();
  const keys = new Set(deck.cards.map((c) => c.key));
  const items = listed.filter((l) => l.card && l.qty > l.sold && keys.has(l.key));
  if (items.length === 0) return null;
  const needed = items.filter((l) => l.needed > 0);

  return (
    <section className="mb-5 rounded-2xl ring-1 ring-inset ring-sky-400/20 bg-sky-500/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-sky-400/15 text-sky-300">
            <Tag size={17} />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              {items.length} carte{items.length > 1 ? 's' : ''} de ce deck {items.length > 1 ? 'sont' : 'est'} en vente
            </p>
            <p className="text-xs text-slate-400 leading-snug">
              {needed.length
                ? 'Le deck en a besoin : retire-les de la vente, Claude les retirera aussi de Cardmarket à la prochaine synchro.'
                : 'Ce sont des copies en trop : le deck a déjà les siennes.'}
            </p>
          </div>
        </div>
        <button onClick={() => unlistForSale(items.map((l) => l.id))} className="btn-secondary px-3 py-1.5 text-xs">
          <X size={14} /> Tout retirer de la vente
        </button>
      </div>
      <ul data-preview-group className="mt-3 space-y-1.5">
        {items.map((l) => (
          <li key={l.id} className="flex items-center gap-2.5">
            <CardThumb card={l.card} foil={l.foil} className="w-8 flex-shrink-0" />
            <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
              <b className="tabular-nums">{l.qty - l.sold}×</b> {cardLang.fullName(l.card)}
              {l.foil && <span className="foil-text font-semibold"> foil</span>}
              {l.needed > 0 && <span className="text-[11px] text-amber-300"> · {l.needed} utilisée{l.needed > 1 ? 's' : ''} par tes decks</span>}
            </span>
            <button onClick={() => unlistForSale([l.id])} className="text-[11px] text-slate-400 hover:text-white">
              Retirer de la vente
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default ListedCardsBanner;
