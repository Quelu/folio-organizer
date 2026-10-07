import { motion } from 'motion/react';

/** Gradient progress bar with a spring fill and a soft shimmer. */
const ProgressBar = ({ value, className = 'h-1.5' }) => (
  <div className={`relative rounded-full bg-white/5 overflow-hidden ${className}`}>
    <motion.div
      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500 via-violet-400 to-fuchsia-400 shimmer"
      initial={false}
      animate={{ width: `${Math.max(value, 0) * 100}%` }}
      transition={{ type: 'spring', stiffness: 90, damping: 20 }}
    />
  </div>
);

export default ProgressBar;
