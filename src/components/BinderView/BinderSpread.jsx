import { AnimatePresence, motion } from 'motion/react';
import { getSpread, getSpreadPages } from '../../utils/calculations';
import PageGrid from './PageGrid';

// Page turn: slides and swings around the vertical axis like a real sheet
const turnVariants = {
  enter: (dir) => ({ opacity: 0, x: dir >= 0 ? 80 : -80, rotateY: dir >= 0 ? -24 : 24, scale: 0.97 }),
  center: { opacity: 1, x: 0, rotateY: 0, scale: 1 },
  exit: (dir) => ({ opacity: 0, x: dir >= 0 ? -80 : 80, rotateY: dir >= 0 ? 24 : -24, scale: 0.97 }),
};

/**
 * Shows either a single page or the open-binder spread (verso on the left, recto on the right).
 */
const BinderSpread = ({ binder, page, spreadMode, direction, ...gridProps }) => {
  const spread = getSpread(page);
  const [left, right] = getSpreadPages(spread);

  return (
    <div className="relative" style={{ perspective: 1600 }}>
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={spreadMode ? `s${spread}` : `p${page}`}
          custom={direction}
          variants={turnVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'spring', stiffness: 260, damping: 30, opacity: { duration: 0.18 } }}
          style={{ transformStyle: 'preserve-3d' }}
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
                    className="w-5 h-2.5 rounded-full bg-gradient-to-b from-slate-300 via-slate-500 to-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.5)]"
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
