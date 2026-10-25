import { useState } from 'react';
import { motion } from 'motion/react';

/**
 * Foil finish over a card picture.
 *
 * With the official foil mask (white where the print is foil), a rainbow lights only the foil
 * parts of the card, like the real print: the rainbow is multiplied by the mask inside an
 * isolated group, then the group is color-dodged onto the card. No CORS is needed, unlike a CSS
 * mask-image, since the mask is a plain <img>.
 * The full-card sweep then plays when the card appears and every few seconds, so a still foil
 * stays easy to spot, even small. Without a mask, the sweep runs continuously as before.
 *
 * @param {string|null} mask foil mask URL (src/utils/catalog.js getFoilMask)
 * @param {object} [position] motion value ("x% y%") moving the rainbow with the pointer
 * @param {number|object} [intensity] opacity of the masked rainbow, or a motion value
 */
const FoilLayers = ({ mask, position, intensity = 0.5 }) => {
  // Until the mask is loaded the rainbow would cover the whole card: keep it hidden
  const [loadedMask, setLoadedMask] = useState(null);
  return (
    <>
      {mask && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[4] mix-blend-color-dodge"
          style={{ isolation: 'isolate', opacity: loadedMask === mask ? intensity : 0 }}
        >
          <motion.div
            className={`holo-real absolute inset-0 ${position ? '' : 'holo-drift'}`}
            style={position ? { backgroundPosition: position } : undefined}
          />
          <img
            src={mask}
            alt=""
            loading="lazy"
            draggable={false}
            onLoad={() => setLoadedMask(mask)}
            className="absolute inset-0 w-full h-full object-cover mix-blend-multiply"
          />
        </motion.div>
      )}
      <div
        aria-hidden
        className={`foil-sheen ${mask ? 'foil-glint' : ''} pointer-events-none absolute inset-0 z-[5] mix-blend-color-dodge`}
      />
    </>
  );
};

export default FoilLayers;
