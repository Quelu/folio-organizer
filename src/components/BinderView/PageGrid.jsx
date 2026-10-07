import { getCardsOnPage, getSheet } from '../../utils/calculations';
import { getGame } from '../../data/games';
import GridPocket from './GridPocket';

/** One physical page of the binder (a sleeve sheet side). */
const PageGrid = ({ binder, page, highlight, onOpenCard, onStepCard, compact }) => {
  const { gridRows, gridCols, cards, gameType, setSize } = binder;
  const pockets = gridRows * gridCols;
  const cardNumbers = getCardsOnPage(page, pockets);
  const filled = cardNumbers.filter((n) => cards[String(n)]).length;
  const pocketStyle = getGame(gameType).pocket;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between mb-2.5 px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Page</span>
          <span className="text-2xl font-black text-white tabular-nums leading-none">{page}</span>
        </div>
        <span className="text-[11px] text-slate-500 tabular-nums">
          Feuille {getSheet(page)} · {page % 2 ? 'recto' : 'verso'} · {filled}/{pockets}
        </span>
      </div>
      <div className="binder-page rounded-2xl p-2.5 sm:p-3">
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
              pulse={highlight?.cardNumber === num ? highlight.token : null}
              pocketStyle={pocketStyle}
              outOfSet={Boolean(setSize && num > setSize)}
              onOpen={onOpenCard}
              onStep={onStepCard}
              compact={compact}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default PageGrid;
