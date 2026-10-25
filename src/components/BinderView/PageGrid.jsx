import { motion, AnimatePresence } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { getCardsOnPage, getSheet } from '../../utils/calculations';
import { getGame } from '../../data/games';
import Confetti from '../ui/Confetti';
import GridPocket from './GridPocket';

const getPageInfo = (binder, page) => {
  const pockets = binder.gridRows * binder.gridCols;
  const cardNumbers = getCardsOnPage(page, pockets);
  const filled = cardNumbers.filter((n) => binder.cards[String(n)]).length;
  return { pockets, cardNumbers, filled, complete: filled === pockets };
};

/** "Page N" label row shown above a page panel. */
export const PageHeader = ({ binder, page }) => {
  const { pockets, filled, complete } = getPageInfo(binder, page);
  return (
    <div className="flex items-baseline justify-between mb-2.5 px-1">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Page</span>
        <span className="text-2xl font-black text-white tabular-nums leading-none">{page}</span>
        <AnimatePresence>
          {complete && (
            <motion.span
              initial={{ opacity: 0, scale: 0.5, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className="self-center flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-400/15 text-emerald-300 text-[10px] font-bold uppercase tracking-wider"
            >
              <Sparkles size={10} /> Complète
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <span className="text-[11px] text-slate-500 tabular-nums">
        Feuille {getSheet(page)} · {page % 2 ? 'recto' : 'verso'} · {filled}/{pockets}
      </span>
    </div>
  );
};

/** The sleeve sheet itself: the pocket grid of one page. This is the part that turns. */
export const PagePanel = ({
  binder,
  page,
  highlight,
  celebrate,
  lastAddedCard,
  pulledByPocket = {},
  onOpenCard,
  onStepCard,
  compact,
}) => {
  const { gridCols, cards, gameType, setSize } = binder;
  const { cardNumbers, complete } = getPageInfo(binder, page);
  const pocketStyle = getGame(gameType).pocket;
  const isCelebrating = celebrate?.page === page;

  return (
    <div className="relative h-full">
      <div
        className={`binder-page h-full rounded-2xl p-2.5 sm:p-3 transition-shadow duration-700 ${
          complete ? 'shadow-[0_0_0_1px_rgba(52,211,153,0.25),0_0_40px_-10px_rgba(52,211,153,0.35)]' : ''
        }`}
      >
        <div
          className={`grid ${compact ? 'gap-2' : 'gap-2.5 sm:gap-3'}`}
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {cardNumbers.map((num) => (
            <GridPocket
              key={num}
              cardNumber={num}
              cardData={cards[String(num)]}
              isHighlighted={highlight?.cardNumber === num}
              isLastAdded={lastAddedCard === num}
              pulled={pulledByPocket[String(num)]}
              pulse={highlight?.cardNumber === num ? highlight : null}
              pocketStyle={pocketStyle}
              outOfSet={Boolean(setSize && num > setSize)}
              onOpen={onOpenCard}
              onStep={onStepCard}
              compact={compact}
            />
          ))}
        </div>
      </div>

      {isCelebrating && (
        <div key={celebrate.token} className="pointer-events-none absolute inset-0">
          <motion.div
            className="absolute inset-0 rounded-2xl ring-2 ring-emerald-300"
            initial={{ opacity: 1, scale: 1 }}
            animate={{ opacity: 0, scale: 1.06 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
          <Confetti seed={celebrate.token} spread={compact ? 200 : 260} />
        </div>
      )}
    </div>
  );
};

/** Inside of the front cover, shown left of page 1 when the binder is open. */
export const CoverPanel = () => (
  <div className="h-full rounded-2xl border border-dashed border-white/5 bg-[#0d1019] flex items-center justify-center text-xs text-slate-600">
    Intérieur de couverture
  </div>
);
