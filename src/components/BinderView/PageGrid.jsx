import { AnimatePresence, motion } from 'motion/react';
import { getCardsOnPage } from '../../utils/calculations';
import GridPocket from './GridPocket';

/**
 * Displays the 3×3 (or n×m) grid for the current binder page.
 * Animates between pages with a horizontal slide based on direction.
 * @param {number} direction - positive = going forward, negative = going back
 */
const PageGrid = ({ binder, page, lastAddedCard, direction }) => {
  const { gridRows, gridCols, cards, gameType } = binder;
  const pockets = gridRows * gridCols;
  const cardNumbers = getCardsOnPage(page, pockets);
  const slideX = direction >= 0 ? 70 : -70;

  return (
    <div className="relative overflow-hidden rounded-xl">
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={page}
          custom={direction}
          initial={{ x: slideX, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -slideX, opacity: 0 }}
          transition={{ duration: 0.28, ease: 'easeInOut' }}
          className="grid gap-3 w-full"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {cardNumbers.map((num) => (
            <GridPocket
              key={num}
              cardNumber={num}
              cardData={cards[String(num)]}
              isHighlighted={num === lastAddedCard}
              isNewlyAdded={num === lastAddedCard}
              gameType={gameType}
            />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default PageGrid;
