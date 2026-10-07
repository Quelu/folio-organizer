import { useState, useEffect } from 'react';
import { motion, useAnimate } from 'motion/react';
import { Check, Plus, Minus } from 'lucide-react';

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
      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
        loaded ? 'opacity-100' : 'opacity-0'
      }`}
    />
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

  // Pop animation each time the card is added or located
  useEffect(() => {
    if (pulse && scope.current) {
      animate(scope.current, { scale: [1, 1.1, 1] }, { duration: 0.4, ease: 'easeOut' });
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
      className={`group relative aspect-[5/7] rounded-lg overflow-hidden cursor-pointer transition-all duration-200 ${
        isHighlighted
          ? 'ring-2 ring-indigo-400 shadow-[0_0_24px_rgba(129,140,248,0.55)] z-10'
          : hasCard
            ? 'ring-1 ring-white/10 hover:ring-white/30 shadow-md shadow-black/40 hover:-translate-y-0.5'
            : 'ring-1 ring-inset ring-white/[0.06] hover:ring-white/20'
      } ${
        hasCard
          ? imageUrl
            ? 'bg-slate-900 pocket-shine'
            : `bg-gradient-to-br ${pocketStyle} pocket-shine`
          : 'bg-black/25'
      }`}
    >
      {imageUrl && <CardImage key={imageUrl} src={imageUrl} alt={`Carte ${cardNumber}`} />}

      {(!imageUrl || !hasCard) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-black leading-none tabular-nums ${compact ? 'text-base' : 'text-xl'} ${
              isHighlighted ? 'text-indigo-200' : hasCard ? 'text-white/90' : outOfSet ? 'text-slate-800' : 'text-slate-700'
            }`}
          >
            {cardNumber}
          </span>
        </div>
      )}

      {/* Card number tag on images */}
      {imageUrl && hasCard && (
        <span className="absolute bottom-1 right-1 px-1 rounded bg-black/60 text-[10px] font-semibold text-white/80 tabular-nums z-10">
          {cardNumber}
        </span>
      )}

      {quantity > 1 && (
        <motion.div
          key={quantity}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="absolute top-1 right-1 bg-indigo-500 text-white text-[11px] font-bold rounded-full min-w-[22px] h-[22px] px-1 flex items-center justify-center leading-none z-10 shadow-lg shadow-black/40 tabular-nums"
        >
          ×{quantity > 99 ? '99+' : quantity}
        </motion.div>
      )}

      {fullyExported && (
        <div
          className="absolute bottom-1 left-1 bg-emerald-500/90 text-white rounded-full w-[18px] h-[18px] flex items-center justify-center z-10"
          title="Exporté vers Dreamborn"
        >
          <Check size={11} strokeWidth={3} />
        </div>
      )}
      {partiallyExported && (
        <div
          className="absolute bottom-1 left-1 bg-amber-500/90 text-white text-[9px] font-bold rounded-full min-w-[20px] h-[18px] px-1 flex items-center justify-center z-10 leading-none"
          title={`${exportedQuantity} sur ${quantity} exporté(s)`}
        >
          {exportedQuantity}/{quantity}
        </div>
      )}

      {/* Quick +/- on hover (desktop) */}
      <div className="absolute inset-x-1 bottom-1 hidden [@media(hover:hover)]:group-hover:flex justify-center gap-1 z-20">
        {hasCard && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStep(cardNumber, -1);
            }}
            className="w-7 h-7 rounded-md bg-slate-950/85 text-slate-200 hover:bg-rose-500 hover:text-white flex items-center justify-center backdrop-blur transition-colors"
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
          className="w-7 h-7 rounded-md bg-slate-950/85 text-slate-200 hover:bg-indigo-500 hover:text-white flex items-center justify-center backdrop-blur transition-colors"
          aria-label={`Ajouter un exemplaire de la carte ${cardNumber}`}
          title="Ajouter un exemplaire"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
};

export default GridPocket;
