import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Trash2, Check, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchLorcastCard } from '../../utils/lorcastApi';
import { getLocation } from '../../utils/calculations';
import { getGame } from '../../data/games';
import TiltCard from '../ui/TiltCard';
import { getCounts } from '../../utils/cards';

/** Image for the detail view: owned cards already have one, others are previewed from Lorcast. */
const useCardImage = (binder, cardNumber) => {
  const stored = binder.cards[String(cardNumber)]?.imageUrl ?? null;
  const [fetched, setFetched] = useState({ key: null, url: null });
  const key = `${binder.setCode}-${cardNumber}`;

  useEffect(() => {
    if (stored || binder.gameType !== 'lorcana' || !binder.setCode) return;
    let cancelled = false;
    fetchLorcastCard(binder.setCode, cardNumber).then((url) => {
      if (!cancelled) setFetched({ key, url });
    });
    return () => {
      cancelled = true;
    };
  }, [stored, binder.gameType, binder.setCode, cardNumber, key]);

  return stored ?? (fetched.key === key ? fetched.url : null);
};

const slideVariants = {
  enter: (dir) => ({ opacity: 0, x: dir * 70, rotateY: dir * 35 }),
  center: { opacity: 1, x: 0, rotateY: 0 },
  exit: (dir) => ({ opacity: 0, x: dir * -70, rotateY: dir * -35 }),
};

/** Quantity stepper for one variant (normal or foil). */
const Stepper = ({ label, value, onChange, foil }) => (
  <div
    className={`flex items-center rounded-xl ring-1 ring-inset ${
      foil && value > 0 ? 'ring-fuchsia-400/40 bg-fuchsia-950/20' : 'ring-white/10 bg-slate-950/50'
    }`}
  >
    <button
      onClick={() => onChange(Math.max(0, value - 1))}
      disabled={value === 0}
      className="btn-icon p-2.5"
      aria-label={`Retirer un exemplaire ${label.toLowerCase()}`}
    >
      <Minus size={15} />
    </button>
    <div className="w-14 text-center leading-none">
      <span className="block overflow-hidden text-lg font-bold text-white tabular-nums">
        <motion.span
          key={value}
          className="inline-block"
          initial={{ y: -14, opacity: 0, scale: 1.3 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        >
          {value}
        </motion.span>
      </span>
      <span className={`text-[10px] uppercase tracking-wider ${foil ? 'foil-text font-bold' : 'text-slate-500'}`}>
        {foil && <Sparkles size={9} className="inline -mt-0.5 mr-0.5 text-fuchsia-300" />}
        {label}
      </span>
    </div>
    <button
      onClick={() => onChange(value + 1)}
      className="btn-icon p-2.5"
      aria-label={`Ajouter un exemplaire ${label.toLowerCase()}`}
    >
      <Plus size={15} />
    </button>
  </div>
);

const Stat = ({ label, value }) => (
  <div className="rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-sm font-semibold text-white tabular-nums">{value}</div>
  </div>
);

const CardDetailModal = ({ binder, cardNumber, onClose, onNavigate, onSetCounts }) => {
  const isOpen = cardNumber != null;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const { normal, foil } = getCounts(binder.cards[String(cardNumber)]);
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && cardNumber > 1) onNavigate(cardNumber - 1);
      else if (e.key === 'ArrowRight') onNavigate(cardNumber + 1);
      else if (e.key === '+' || e.key === '=') onSetCounts(cardNumber, { normal: normal + 1, foil });
      else if (e.key === '-') onSetCounts(cardNumber, { normal: Math.max(0, normal - 1), foil });
      else if (e.key === 'f' || e.key === '*') onSetCounts(cardNumber, { normal, foil: foil + 1 });
      else if (e.key === 'F') onSetCounts(cardNumber, { normal, foil: Math.max(0, foil - 1) });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, binder.cards, cardNumber, onClose, onNavigate, onSetCounts]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/85 z-40 backdrop-blur-md"
          />
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 32 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="surface pointer-events-auto w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-label={`Carte ${cardNumber}`}
            >
              <DetailBody
                binder={binder}
                cardNumber={cardNumber}
                onClose={onClose}
                onNavigate={onNavigate}
                onSetCounts={onSetCounts}
              />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

const DetailBody = ({ binder, cardNumber, onClose, onNavigate, onSetCounts }) => {
  // Direction of the last card change, to slide the visual the right way
  const [nav, setNav] = useState({ card: cardNumber, dir: 0 });
  if (nav.card !== cardNumber) setNav({ card: cardNumber, dir: cardNumber > nav.card ? 1 : -1 });
  const card = binder.cards[String(cardNumber)];
  const quantity = card?.quantity ?? 0;
  const exported = card?.exportedQuantity ?? 0;
  const { normal, foil } = getCounts(card);
  const loc = getLocation(cardNumber, binder);
  const imageUrl = useCardImage(binder, cardNumber);
  const game = getGame(binder.gameType);
  const outOfSet = binder.setSize && cardNumber > binder.setSize;

  return (
    <div className="flex flex-col sm:flex-row gap-6 p-5 sm:p-6">
      {/* Visual */}
      <div className="relative sm:w-64 flex-shrink-0 mx-auto w-48" style={{ perspective: 1200 }}>
        {/* The card flips in when the sheet opens, then slides left/right when browsing neighbours */}
        <motion.div
          initial={{ rotateY: -100, scale: 0.85 }}
          animate={{ rotateY: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.05 }}
        >
          <AnimatePresence mode="popLayout" initial={false} custom={nav.dir}>
            <motion.div
              key={cardNumber}
              custom={nav.dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <TiltCard
                max={18}
                className={`pocket-shine aspect-[5/7] rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-black/60 bg-gradient-to-br ${game.pocket} ${
                  quantity === 0 ? 'opacity-60 grayscale' : ''
                }`}
              >
                {foil > 0 && (
                  <div
                    aria-hidden
                    className="foil-sheen pointer-events-none absolute inset-0 z-[4] mix-blend-color-dodge"
                  />
                )}
                {imageUrl ? (
                  <motion.img
                    key={imageUrl}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    src={imageUrl}
                    alt={`Carte ${cardNumber}`}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-6xl font-black opacity-80">
                    {cardNumber}
                  </div>
                )}
              </TiltCard>
            </motion.div>
          </AnimatePresence>
        </motion.div>
        {quantity === 0 && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-950/80 text-slate-300">
            Pas encore possédée
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">{binder.name}</div>
            <h2 className="text-3xl font-black text-white tabular-nums">#{cardNumber}</h2>
          </div>
          <div className="flex items-center -mr-2">
            <button
              onClick={() => onNavigate(cardNumber - 1)}
              disabled={cardNumber <= 1}
              className="btn-icon"
              aria-label="Carte précédente"
              title="Carte précédente (←)"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => onNavigate(cardNumber + 1)}
              className="btn-icon"
              aria-label="Carte suivante"
              title="Carte suivante (→)"
            >
              <ChevronRight size={18} />
            </button>
            <button onClick={onClose} className="btn-icon" aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
        </div>

        {outOfSet && (
          <p className="mt-2 text-xs text-amber-300/90">
            Au-delà des {binder.setSize} cartes du set (carte spéciale / enchantée ?).
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 mt-4">
          <Stat label="Page" value={loc.page} />
          <Stat label="Emplacement" value={`Rangée ${loc.row} · Col. ${loc.col}`} />
          <Stat label="Feuille" value={`n° ${loc.sheet}`} />
          <Stat label="Face" value={loc.side === 'recto' ? 'Recto' : 'Verso'} />
        </div>

        <div className="mt-5">
          <span className="label">Exemplaires</span>
          <div className="flex items-center gap-3 flex-wrap">
            <Stepper
              label="Normal"
              value={normal}
              onChange={(v) => onSetCounts(cardNumber, { normal: v, foil })}
            />
            <Stepper
              label="Foil"
              foil
              value={foil}
              onChange={(v) => onSetCounts(cardNumber, { normal, foil: v })}
            />
            {quantity > 0 && (
              <button
                onClick={() => onSetCounts(cardNumber, { normal: 0, foil: 0 })}
                className="btn-icon text-rose-300/80 hover:text-rose-300 hover:bg-rose-500/10"
                title="Retirer toutes les copies"
                aria-label="Retirer toutes les copies"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {binder.gameType === 'lorcana' && quantity > 0 && (
            <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
              {exported >= quantity ? (
                <>
                  <Check size={13} className="text-emerald-400" /> Toutes les copies sont exportées vers
                  Dreamborn
                </>
              ) : (
                <>
                  <span className="text-amber-300 font-medium">{quantity - exported}</span> copie
                  {quantity - exported > 1 ? 's' : ''} à exporter vers Dreamborn
                </>
              )}
            </p>
          )}
        </div>

        <div className="mt-auto pt-5 hidden sm:flex gap-3 text-[11px] text-slate-500">
          <span>
            <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> Carte voisine
          </span>
          <span>
            <kbd className="kbd">+</kbd> <kbd className="kbd">−</kbd> Normal
          </span>
          <span>
            <kbd className="kbd">f</kbd> <kbd className="kbd">⇧F</kbd> Foil
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> Fermer
          </span>
        </div>
      </div>
    </div>
  );
};

export default CardDetailModal;
