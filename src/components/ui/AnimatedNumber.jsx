import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';

/** Number that rolls smoothly to its new value. */
const AnimatedNumber = ({ value, className, format = (v) => Math.round(v) }) => {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  const display = useTransform(spring, format);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={`tabular-nums ${className ?? ''}`}>{display}</motion.span>;
};

export default AnimatedNumber;
