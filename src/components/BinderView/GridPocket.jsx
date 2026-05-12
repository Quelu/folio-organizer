import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';

const PLACEHOLDER_STYLES = {
  pokemon: 'from-yellow-900/70 to-yellow-800/40 border-yellow-700/50 text-yellow-300',
  magic: 'from-purple-900/70 to-purple-800/40 border-purple-700/50 text-purple-300',
  lorcana: 'from-blue-900/70 to-blue-800/40 border-blue-700/50 text-blue-300',
  other: 'from-gray-800/70 to-gray-700/40 border-gray-600/50 text-gray-400',
};

const GridPocket = ({ cardNumber, cardData, isHighlighted, isNewlyAdded, gameType }) => {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [animKey, setAnimKey] = useState(0);

  const quantity = cardData?.quantity ?? 0;
  const exportedQuantity = cardData?.exportedQuantity ?? 0;
  const imageUrl = cardData?.imageUrl ?? null;
  const hasCard = quantity > 0;
  const fullyExported = hasCard && exportedQuantity >= quantity;
  const partiallyExported = hasCard && exportedQuantity > 0 && exportedQuantity < quantity;

  // Reset image load state when URL changes
  useEffect(() => {
    setImgLoaded(false);
  }, [imageUrl]);

  // Trigger pop animation each time the card is newly added
  useEffect(() => {
    if (isNewlyAdded) {
      setAnimKey((k) => k + 1);
    }
  }, [isNewlyAdded]);

  const placeholder = PLACEHOLDER_STYLES[gameType] ?? PLACEHOLDER_STYLES.other;

  return (
    <motion.div
      key={animKey}
      animate={
        isNewlyAdded && animKey > 0
          ? {
              scale: [1, 1.13, 1],
              boxShadow: [
                '0 0 0px rgba(139,92,246,0)',
                '0 0 22px rgba(139,92,246,0.85)',
                '0 0 0px rgba(139,92,246,0)',
              ],
            }
          : {}
      }
      transition={{ duration: 0.38, ease: 'easeOut' }}
      className={`relative aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 transition-all duration-200 ${
        isHighlighted
          ? 'border-indigo-400 ring-2 ring-indigo-500/40 shadow-lg shadow-indigo-500/20'
          : hasCard
          ? 'border-gray-600'
          : 'border-gray-700/50 border-dashed'
      } ${
        !imageUrl
          ? `bg-gradient-to-br ${placeholder}`
          : 'bg-gray-900'
      }`}
    >
      {/* Lorcana card image */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`Carte ${cardNumber}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setImgLoaded(true)}
        />
      )}

      {/* Placeholder content (shown when no image or while loading) */}
      {(!imageUrl || !imgLoaded) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span
            className={`font-black text-xl leading-none ${
              isHighlighted ? 'text-indigo-300' : hasCard ? 'text-gray-200' : 'text-gray-600'
            }`}
          >
            {cardNumber}
          </span>
          {hasCard && (
            <span className="text-xs opacity-50">#{cardNumber}</span>
          )}
        </div>
      )}

      {/* Quantity badge */}
      {quantity > 1 && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="absolute top-1 right-1 bg-violet-600 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center leading-none z-10"
        >
          ×{quantity > 99 ? '99+' : quantity}
        </motion.div>
      )}

      {/* Exported badge */}
      {fullyExported && (
        <div className="absolute bottom-1 left-1 bg-emerald-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center z-10">
          <Check size={11} strokeWidth={3} />
        </div>
      )}
      {partiallyExported && (
        <div className="absolute bottom-1 left-1 bg-amber-600/90 text-white text-[9px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center z-10 leading-none">
          {exportedQuantity}/{quantity}
        </div>
      )}

      {/* Active highlight overlay */}
      {isHighlighted && (
        <div className="absolute inset-0 bg-indigo-500/10 pointer-events-none" />
      )}
    </motion.div>
  );
};

export default GridPocket;
