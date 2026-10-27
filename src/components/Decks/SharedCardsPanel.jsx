import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Split, ChevronDown, Minus, Plus, Crown, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useCopyAllocation } from '../../hooks/useCopyAllocation';
import { useDeckColor } from '../../hooks/useDeckColor';
import { getMainPrinting } from '../../utils/catalog';


/** Owned copies as a bar: one segment per deck holding copies, the shared rest striped. */
const SplitBar = ({ item, colorOf }) => (
  <div className="flex h-2 rounded-full overflow-hidden bg-white/5" aria-hidden>
    {item.decks
      .filter((d) => d.assigned > 0)
      .map((d) => (
        <motion.div
          key={d.deck.id}
          layout
          className="h-full"
          style={{ width: `${(d.assigned / item.owned) * 100}%`, background: colorOf(d.deck.id) }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      ))}
    {item.free > 0 && (
      <motion.div
        layout
        className="h-full bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.55)_0_4px,rgba(148,163,184,0.2)_4px_8px)]"
        style={{ width: `${(item.free / item.owned) * 100}%` }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />
    )}
  </div>
);

/** One shared card: how its copies are split, and controls to assign them deck by deck. */
const SharedCard = ({ item, deckId, colorOf, onOpenDeck }) => {
  const { setAllocation } = useStore();
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const card = index ? getMainPrinting(index, item.key) : null;
  const anyAssigned = item.decks.some((d) => d.assigned > 0);

  /** All the copies it plays go to this deck, the others keep what is left. */
  const prioritize = (target) => {
    let left = item.owned;
    const split = {};
    for (const d of [target, ...item.decks.filter((x) => x.deck.id !== target.deck.id)]) {
      const copies = d === target ? Math.min(d.qty, left) : Math.min(d.assigned, left);
      split[d.deck.id] = copies;
      left -= copies;
    }
    setAllocation(item.key, split);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-3 ring-1 ring-inset ${
        item.contested ? 'bg-amber-500/[0.05] ring-amber-400/20' : 'bg-white/[0.02] ring-white/[0.06]'
      }`}
    >
      <div className="flex items-start gap-3">
        {card && <CardThumb card={card} className="w-10 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{cardLang.keyName(item.key, item.name)}</div>
              <div className="text-[11px] text-slate-500">
                {item.owned} exemplaire{item.owned > 1 ? 's' : ''} pour {item.needed} demandés
                {item.free > 0 && anyAssigned && <> · {item.free} partagé{item.free > 1 ? 's' : ''}</>}
              </div>
            </div>
            {item.contested ? (
              <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30">
                <AlertTriangle size={10} /> À répartir
              </span>
            ) : (
              <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
                <Check size={10} /> Réparti
              </span>
            )}
          </div>
          <div className="mt-2">
            <SplitBar item={item} colorOf={colorOf} />
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {item.decks.map((d) => {
          const isCurrent = d.deck.id === deckId;
          return (
            <div
              key={d.deck.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isCurrent ? 'bg-white/[0.05] ring-1 ring-inset ring-white/10' : ''}`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorOf(d.deck.id) }} />
              <button
                onClick={() => !isCurrent && onOpenDeck?.(d.deck.id)}
                className={`flex-1 min-w-0 text-left text-xs truncate ${isCurrent ? 'text-white font-semibold cursor-default' : 'text-slate-300 hover:text-white'}`}
                title={isCurrent ? 'Ce deck' : 'Ouvrir ce deck'}
              >
                {d.deck.name}
                <span className="text-slate-500 font-normal"> · en joue {d.qty}</span>
              </button>
              <div className="flex items-center rounded-md ring-1 ring-inset ring-white/10 bg-slate-950/50" title="Exemplaires réservés pour ce deck">
                <button
                  onClick={() => setAllocation(item.key, { [d.deck.id]: d.assigned - 1 })}
                  disabled={d.assigned === 0}
                  className="btn-icon p-1"
                  aria-label={`Une réservation de moins pour ${d.deck.name}`}
                >
                  <Minus size={12} />
                </button>
                <span className="w-5 text-center text-xs font-bold text-white tabular-nums">{d.assigned}</span>
                <button
                  onClick={() => setAllocation(item.key, { [d.deck.id]: d.assigned + 1 })}
                  disabled={d.assigned >= d.qty || item.free === 0}
                  className="btn-icon p-1"
                  aria-label={`Réserver un exemplaire de plus pour ${d.deck.name}`}
                >
                  <Plus size={12} />
                </button>
              </div>
              <button
                onClick={() => prioritize(d)}
                className="btn-icon p-1.5 text-amber-300/70 hover:text-amber-200"
                title="Priorité : lui réserver tous les exemplaires dont il a besoin"
                aria-label={`Priorité à ${d.deck.name}`}
              >
                <Crown size={13} />
              </button>
              <span
                className={`w-[4.5rem] text-right text-[11px] font-semibold tabular-nums ${d.missing ? 'text-rose-300' : 'text-emerald-300'}`}
              >
                {d.missing ? `manque ${d.missing}` : 'complet'}
              </span>
            </div>
          );
        })}
      </div>

      {anyAssigned && (
        <button
          onClick={() => setAllocation(item.key, Object.fromEntries(item.decks.map((d) => [d.deck.id, 0])))}
          className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          <RotateCcw size={11} /> Tout remettre en commun
        </button>
      )}
    </motion.div>
  );
};

/** Shared cards, disputed first then by name: only this deck's when deckId is set, every one otherwise. */
const useSharedItems = (deckId) => {
  const cardLang = useCardLang();
  const { shared } = useCopyAllocation();
  return shared
    .filter((s) => !deckId || s.decks.some((d) => d.deck.id === deckId))
    .sort((a, b) => b.contested - a.contested || cardLang.keyName(a.key).localeCompare(cardLang.keyName(b.key)));
};

/** The shared cards and their split controls, without the panel header (deck list alerts). */
export const SharedCardsList = ({ deckId = null, onOpenDeck, className = '' }) => {
  const colorOf = useDeckColor();
  const items = useSharedItems(deckId);
  return (
    <div data-preview-group className={`grid grid-cols-1 gap-2 xl:grid-cols-2 ${className}`}>
      {items.map((item) => (
        <SharedCard key={item.key} item={item} deckId={deckId} colorOf={colorOf} onOpenDeck={onOpenDeck} />
      ))}
    </div>
  );
};

/**
 * Cards several decks play with fewer copies owned than they need together. Assigning the copies
 * to decks tells each deck what it really lacks (its missing cards, pull list, owned share).
 * deckId: only the cards of this deck (deck page); every shared card otherwise.
 * defaultOpen: unfolded while copies are disputed unless false (the deck page lists them per card).
 */
const SharedCardsPanel = ({ deckId = null, defaultOpen = true, onOpenDeck }) => {
  const items = useSharedItems(deckId);
  const contested = items.filter((s) => s.contested).length;
  // Open while copies are disputed, until the user folds or unfolds it
  const [openChoice, setOpen] = useState(null);
  const open = openChoice ?? (defaultOpen && contested > 0);

  if (items.length === 0) return null;

  return (
    <section
      className={`rounded-2xl ring-1 ring-inset overflow-hidden ${
        contested
          ? 'bg-gradient-to-br from-amber-500/[0.09] via-amber-500/[0.03] to-transparent ring-amber-400/25'
          : 'bg-white/[0.02] ring-white/[0.07]'
      }`}
    >
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            contested ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'
          }`}
        >
          <Split size={17} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-white">
            {items.length} carte{items.length > 1 ? 's' : ''} partagée{items.length > 1 ? 's' : ''}
            {deckId ? ' avec tes autres decks' : ' entre tes decks'}
          </span>
          <span className="block text-xs text-slate-400 leading-snug">
            {contested
              ? `${contested} à répartir : réserve les exemplaires au deck qui les garde, les autres verront ce qu'il leur manque vraiment.`
              : 'Exemplaires répartis : chaque deck compte ce qui lui est réservé.'}
          </span>
        </span>
        {contested > 0 && (
          <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-amber-950 tabular-nums">{contested}</span>
        )}
        <ChevronDown size={16} className={`flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <SharedCardsList deckId={deckId} onOpenDeck={onOpenDeck} className="px-3 pb-3" />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default SharedCardsPanel;
