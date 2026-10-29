import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useCardLang } from '../../hooks/useCardLang';
import { useCardPreview } from './cardPreviewContext';

const HOVER_WIDTH = 192;
const HOVER_HEIGHT = (HOVER_WIDTH * 7) / 5;
const GAP = 10;

/** Where the hovered picture goes: above the name when it fits, else below, kept on screen. */
const placeHover = (rect) => {
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - HOVER_WIDTH - 8);
  const above = rect.top - HOVER_HEIGHT - GAP;
  const below = above < 8;
  const top = below ? Math.min(rect.bottom + GAP, window.innerHeight - HOVER_HEIGHT - 8) : above;
  return { left, top, below };
};

/**
 * Card named in a text: its picture on hover, the full card view on click. The picture is drawn
 * in <body> at a fixed position: a table's or a list's scroll box would cut it.
 */
const CardHover = ({ card, className = '', children }) => {
  const cardLang = useCardLang();
  const cardPreview = useCardPreview();
  const [hover, setHover] = useState(null); // { left, top, below }
  const image = cardLang.image(card, 'normal');

  // A fixed picture would stay behind when the page scrolls
  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hover]);

  const show = (e) => {
    if (image) setHover(placeHover(e.currentTarget.getBoundingClientRect()));
  };

  return (
    <>
      <button
        type="button"
        data-preview-id={card.id}
        onMouseEnter={show}
        onMouseLeave={() => setHover(null)}
        onFocus={show}
        onBlur={() => setHover(null)}
        onClick={(e) => {
          setHover(null);
          cardPreview?.open(card, { origin: e.currentTarget });
        }}
        className={`cursor-zoom-in ${className}`}
      >
        {children}
      </button>
      {createPortal(
        <AnimatePresence>
          {hover && (
            <motion.img
              key={card.id}
              src={image}
              alt=""
              initial={{ opacity: 0, y: hover.below ? -6 : 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="pointer-events-none fixed z-[80] rounded-xl shadow-2xl shadow-black/70 ring-1 ring-white/20"
              style={{ left: hover.left, top: hover.top, width: HOVER_WIDTH }}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default CardHover;
