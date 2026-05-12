import { motion, AnimatePresence } from 'motion/react';

const PageIndicator = ({ page }) => {
  return (
    <div className="fixed top-6 right-6 z-50 pointer-events-none select-none">
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          initial={{ opacity: 0, scale: 0.6, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex flex-col items-center"
        >
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
            Page
          </span>
          <span
            className="text-7xl font-black text-white leading-none"
            style={{ textShadow: '0 0 48px rgba(99,102,241,0.45)' }}
          >
            {page}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default PageIndicator;
