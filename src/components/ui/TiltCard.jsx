import { motion, useMotionValue, useSpring, useTransform, useMotionTemplate } from 'motion/react';
import FoilLayers from './FoilLayers';

const SPRING = { stiffness: 260, damping: 26, mass: 0.6 };

/**
 * Card surface that tilts toward the pointer with a holographic glare, like a foil TCG card.
 * Touch input is ignored so scrolling on phones stays smooth.
 * foil: adds the foil finish, lit through foilMask when the picture has one, following the pointer.
 */
const TiltCard = ({ children, className = '', max = 12, disabled = false, foil = false, foilMask = null, style, ...rest }) => {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const hover = useMotionValue(0);
  const sx = useSpring(px, SPRING);
  const sy = useSpring(py, SPRING);
  const glow = useSpring(hover, { stiffness: 200, damping: 30 });

  const rotateY = useTransform(sx, [0, 1], [-max, max]);
  const rotateX = useTransform(sy, [0, 1], [max, -max]);
  const gx = useTransform(sx, (v) => v * 100);
  const gy = useTransform(sy, (v) => v * 100);
  const foilX = useTransform(sx, (v) => 20 + v * 60);
  const glare = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%)`;
  const foilPos = useMotionTemplate`${foilX}% 50%`;
  const foilOpacity = useTransform(glow, (v) => v * 0.55);
  const realFoilPos = useMotionTemplate`${gx}% ${gy}%`;
  const realFoilOpacity = useTransform(glow, (v) => 0.45 + v * 0.35);

  const reset = () => {
    px.set(0.5);
    py.set(0.5);
    hover.set(0);
  };

  const handleMove = (e) => {
    if (disabled || e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
    hover.set(1);
  };

  return (
    <motion.div
      {...rest}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={{ ...style, rotateX, rotateY, transformPerspective: 800 }}
      className={`relative ${className}`}
    >
      {children}
      {foil && <FoilLayers mask={foilMask} position={realFoilPos} intensity={realFoilOpacity} />}
      {!disabled && (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[6] mix-blend-overlay"
            style={{ background: glare, opacity: glow }}
          />
          <motion.div
            aria-hidden
            className="holo-foil pointer-events-none absolute inset-0 z-[6] mix-blend-color-dodge"
            style={{ backgroundPosition: foilPos, opacity: foilOpacity }}
          />
        </>
      )}
    </motion.div>
  );
};

export default TiltCard;
