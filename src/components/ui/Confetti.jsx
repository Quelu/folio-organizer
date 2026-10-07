import { motion } from 'motion/react';

const COLORS = ['#818cf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#38bdf8'];

/** Deterministic pseudo-random in [0, 1) so renders stay pure. */
const rand = (seed) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** One-shot confetti burst from the center of its (relative) parent. Remount it to replay. */
const Confetti = ({ count = 28, spread = 180, seed = 1 }) => (
  <div aria-hidden className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
    {Array.from({ length: count }, (_, i) => {
      const s = seed * 100 + i;
      const angle = rand(s) * Math.PI * 2;
      const dist = spread * (0.35 + rand(s + 0.5) * 0.65);
      const round = rand(s + 0.7) > 0.6;
      return (
        <motion.span
          key={i}
          className={`absolute ${round ? 'w-2 h-2 rounded-full' : 'w-1.5 h-3 rounded-[1px]'}`}
          style={{ background: COLORS[i % COLORS.length] }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{
            x: Math.cos(angle) * dist,
            y: [0, Math.sin(angle) * dist, Math.sin(angle) * dist + 60],
            opacity: [1, 1, 0],
            scale: [0, 1.1, 0.8],
            rotate: (rand(s + 0.3) - 0.5) * 720,
          }}
          transition={{ duration: 1.1 + rand(s + 0.9) * 0.6, ease: [0.15, 0.85, 0.35, 1] }}
        />
      );
    })}
  </div>
);

export default Confetti;
