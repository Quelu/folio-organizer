import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useAnimate } from 'motion/react';
import { Check, Plus, Minus } from 'lucide-react';
import TiltCard from '../ui/TiltCard';

/** Card image with its own fade-in state (keyed by URL from the parent). */
const CardImage = ({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onLoad={() => setLoaded(true)}
      className={`absolute inset-0 w-full h-full object-cover transition-[opacity,filter] duration-500 ${
        loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'
      }`}
    />
  );
};

/** Expanding ring (and sparks on add) played once per pulse token. */
const Ripple = ({ kind }) => {
  const color = kind === 'remove' ? 'ring-rose-400' : kind === 'add' ? 'ring-emerald-300' : 'ring-indigo-300';
  return (
    <>
      <motion.span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-lg ring-2 ${color}`}
        initial={{ opacity: 0.9, scale: 1 }}
        animate={{ opacity: 0, scale: kind === 'remove' ? 1.08 : 1.3 }}
        transition={{ duration: 0.65, ease: 'easeOut', repeat: kind === 'locate' ? 1 : 0 }}
      />
      {kind === 'add' &&
        [0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          return (
            <motion.span
              key={i}
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]"
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.5 }}
              animate={{ x: Math.cos(a) * 70, y: Math.sin(a) * 90, opacity: 0, scale: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          );
        })}
    </>
  );
};

const GridPocket = ({ cardNumber, cardData, pulse, isHighlighted, pocketStyle, outOfSet, onOpen, onStep, compact }) => {
  const [scope, animate] = useAnimate();

  const quantity = cardData?.quantity ?? 0;
  const exportedQuantity = cardData?.exportedQuantity ?? 0;
  const imageUrl = cardData?.imageUrl ?? null;
  const hasCard = quantity > 0;
  const fullyExported = hasCard && exportedQuantity >= quantity;
  const partiallyExported = hasCard && exportedQuantity > 0 && exportedQuantity < quantity;

  // Physical feedback each time the card is added, removed or located
  useEffect(() => {
    if (!pulse || !scope.current) return;
    if (pulse.kind === 'remove') {
      animate(scope.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4, ease: 'easeInOut' });
    } else if (pulse.kind === 'add') {
      animate(scope.current, { scale: [1, 1.12, 0.97, 1] }, { duration: 0.5, ease: 'easeOut' });
    } else {
      animate(scope.current, { scale: [1, 1.07, 1, 1.07, 1] }, { duration: 0.9, ease: 'easeInOut' });
    }
  }, [pulse, animate, scope]);

  return (
    <div
      ref={scope}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(cardNumber)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(cardNumber);
        }
      }}
      aria-label={`Carte ${cardNumber}${hasCard ? `, ${quantity} exemplaire${quantity > 1 ? 's' : ''}` : ', vide'}`}
      className={`group relative cursor-pointer outline-none ${isHighlighted ? 'z-10' : 'hover:z-10'}`}
    >
      <TiltCard
        disabled={!hasCard}
        max={compact ? 10 : 14}
        whileTap={{ scale: 0.96 }}
        className={`aspect-[5/7] rounded-lg overflow-hidden transition-shadow duration-300 group-focus-visible:ring-2 group-focus-visible:ring-indigo-400 ${
          isHighlighted
            ? 'ring-2 ring-indigo-400 shadow-[0_0_28px_rgba(129,140,248,0.6)]'
            : hasCard
              ? 'ring-1 ring-white/10 group-hover:ring-white/30 shadow-md shadow-black/40 group-hover:shadow-xl group-hover:shadow-black/60'
              : 'ring-1 ring-inset ring-white/[0.06] group-hover:ring-white/20'
        } ${hasCard ? 'bg-slate-900' : 'bg-black/25'}`}
      >
        {/* Empty slot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`font-black leading-none tabular-nums transition-colors ${compact ? 'text-base' : 'text-xl'} ${
              outOfSet ? 'text-slate-800' : 'text-slate-700 group-hover:text-slate-500'
            }`}
          >
            {cardNumber}
          </span>
        </div>

        {/* The card slides into the sleeve when it is added, and drops out when removed */}
        <AnimatePresence initial={false}>
          {hasCard && (
            <motion.div
              key="card"
              className={`absolute inset-0 pocket-shine ${imageUrl ? 'bg-slate-900' : `bg-gradient-to-br ${pocketStyle}`}`}
              initial={{ y: '-45%', opacity: 0, scale: 1.1, rotate: -4 }}
              animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
              exit={{ y: '30%', opacity: 0, scale: 0.9, rotate: 3 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            >
              {imageUrl ? (
                <CardImage key={imageUrl} src={imageUrl} alt={`Carte ${cardNumber}`} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span
                    className={`font-black leading-none tabular-nums ${compact ? 'text-base' : 'text-xl'} ${
                      isHighlighted ? 'text-indigo-100' : 'text-white/90'
                    }`}
                  >
                    {cardNumber}
                  </span>
                </div>
              )}
              {imageUrl && (
                <span className="absolute bottom-1 right-1 px-1 rounded bg-black/60 text-[10px] font-semibold text-white/80 tabular-nums z-10">
                  {cardNumber}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {quantity > 1 && (
            <motion.div
              key="qty"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              className="absolute top-1 right-1 z-10"
            >
              <motion.span
                key={quantity}
                initial={{ scale: 1.5 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                className="block bg-indigo-500 text-white text-[11px] font-bold rounded-full min-w-[22px] h-[22px] px-1 leading-[22px] text-center shadow-lg shadow-black/40 tabular-nums"
              >
                ×{quantity > 99 ? '99+' : quantity}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {fullyExported && (
            <motion.div
              key="exported"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="absolute bottom-1 left-1 bg-emerald-500/90 text-white rounded-full w-[18px] h-[18px] flex items-center justify-center z-10"
              title="Exporté vers Dreamborn"
            >
              <Check size={11} strokeWidth={3} />
            </motion.div>
          )}
          {partiallyExported && (
            <motion.div
              key="partial"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute bottom-1 left-1 bg-amber-500/90 text-white text-[9px] font-bold rounded-full min-w-[20px] h-[18px] px-1 flex items-center justify-center z-10 leading-none"
              title={`${exportedQuantity} sur ${quantity} exporté(s)`}
            >
              {exportedQuantity}/{quantity}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick +/- on hover (desktop) */}
        <div className="absolute inset-x-1 bottom-1 hidden [@media(hover:hover)]:flex justify-center gap-1 z-20 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
          {hasCard && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStep(cardNumber, -1);
              }}
              className="w-7 h-7 rounded-md bg-slate-950/85 text-slate-200 hover:bg-rose-500 hover:text-white active:scale-90 flex items-center justify-center backdrop-blur transition-all"
              aria-label={`Retirer un exemplaire de la carte ${cardNumber}`}
              title="Retirer un exemplaire"
            >
              <Minus size={14} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStep(cardNumber, 1);
            }}
            className="w-7 h-7 rounded-md bg-slate-950/85 text-slate-200 hover:bg-indigo-500 hover:text-white active:scale-90 flex items-center justify-center backdrop-blur transition-all"
            aria-label={`Ajouter un exemplaire de la carte ${cardNumber}`}
            title="Ajouter un exemplaire"
          >
            <Plus size={14} />
          </button>
        </div>
      </TiltCard>

      {pulse && <Ripple key={pulse.token} kind={pulse.kind} />}
    </div>
  );
};

export default GridPocket;
