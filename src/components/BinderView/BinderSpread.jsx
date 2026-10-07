import { AnimatePresence, motion } from 'motion/react';
import { getSpread, getSpreadPages } from '../../utils/calculations';
import PageGrid from './PageGrid';

/**
 * Shows either a single page or the open-binder spread (verso on the left, recto on the right).
 * Animates between pages with a horizontal slide based on direction.
 */
const BinderSpread = ({ binder, page, spreadMode, direction, ...gridProps }) => {
  const slideX = direction >= 0 ? 60 : -60;
  const spread = getSpread(page);
  const [left, right] = getSpreadPages(spread);

  return (
    <div className="relative">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={spreadMode ? `s${spread}` : `p${page}`}
          initial={{ x: slideX, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -slideX, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeInOut' }}
        >
          {spreadMode ? (
            <div className="flex gap-0 items-stretch">
              {left ? (
                <PageGrid binder={binder} page={left} compact {...gridProps} />
              ) : (
                <div className="flex-1 flex flex-col">
                  <div className="h-[34px]" />
                  <div className="flex-1 rounded-2xl border border-dashed border-white/5 flex items-center justify-center text-xs text-slate-600">
                    Intérieur de couverture
                  </div>
                </div>
              )}
              {/* Binder rings */}
              <div className="w-8 flex-shrink-0 flex flex-col justify-center items-center gap-10 pt-8">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-5 h-2.5 rounded-full bg-gradient-to-b from-slate-400 to-slate-600 shadow-inner shadow-black/50 ring-1 ring-black/40"
                  />
                ))}
              </div>
              <PageGrid binder={binder} page={right} compact {...gridProps} />
            </div>
          ) : (
            <PageGrid binder={binder} page={page} {...gridProps} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default BinderSpread;
