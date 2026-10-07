import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getCardsOnPage, getSpread } from '../../utils/calculations';

/**
 * Prev/next buttons plus a clickable mini-map of every page, showing how full each one is.
 */
const PageNavigator = ({ binder, page, totalPages, spreadMode, onNavigate, onStep, canPrev, canNext }) => {
  const pockets = binder.gridRows * binder.gridCols;
  const activeSpread = getSpread(page);

  const pages = Array.from({ length: totalPages }, (_, i) => {
    const p = i + 1;
    const nums = getCardsOnPage(p, pockets);
    const filled = nums.filter((n) => binder.cards[String(n)]).length;
    const active = spreadMode ? getSpread(p) === activeSpread : p === page;
    // Visual gap at the start of each spread (2-3, 4-5…) or each sheet (1-2, 3-4…)
    const groupStart = p > 1 && (spreadMode ? p % 2 === 0 : p % 2 === 1);
    return { p, ratio: filled / pockets, active, groupStart };
  });

  // A single cursor, stretched over both pages of the open spread
  const firstActive = pages.find((x) => x.active)?.p;
  const cursorSpan = pages.filter((x) => x.active).length;

  return (
    <div className="flex items-center gap-3 mt-6">
      <button onClick={() => onStep(-1)} disabled={!canPrev} className="btn-secondary px-2.5" aria-label="Page précédente">
        <ChevronLeft size={18} />
      </button>

      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin py-1">
        <div className="flex items-end gap-[3px] justify-center min-w-max mx-auto px-1">
          {pages.map(({ p, ratio, active, groupStart }) => (
            <button
              key={p}
              onClick={() => onNavigate(p)}
              title={`Page ${p} — ${Math.round(ratio * 100)} % remplie`}
              aria-label={`Aller à la page ${p}`}
              aria-current={active ? 'page' : undefined}
              className={`group relative w-3.5 h-7 transition-transform hover:-translate-y-0.5 ${groupStart ? 'ml-1' : ''}`}
            >
              <span className="absolute inset-0 rounded-[3px] overflow-hidden bg-white/[0.06] group-hover:bg-white/10 transition-colors">
                <motion.span
                  className={`absolute inset-x-0 bottom-0 ${ratio === 1 ? 'bg-emerald-400/80' : 'bg-indigo-400/70'}`}
                  initial={false}
                  animate={{ height: `${ratio * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                />
              </span>
              {/* Cursor glides between pages */}
              {p === firstActive && (
                <motion.span
                  layoutId="page-cursor"
                  className={`absolute -inset-[3px] rounded-[5px] ring-2 ring-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.6)] ${
                    cursorSpan > 1 ? '-right-5' : ''
                  }`}
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => onStep(1)} disabled={!canNext} className="btn-secondary px-2.5" aria-label="Page suivante">
        <ChevronRight size={18} />
      </button>
    </div>
  );
};

export default PageNavigator;
