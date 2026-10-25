import { useState } from 'react';
import { getInk } from '../../utils/catalog';

/** Card picture from the catalog, with the card name on a tinted background until it loads. */
const CardThumb = ({ card, size = 'small', className = '', dimmed = false }) => {
  const [loaded, setLoaded] = useState(false);
  const src = size === 'small' ? (card?.imageSmall ?? card?.image) : card?.image;
  const tint = getInk(card?.inks?.[0]).color;

  return (
    <div
      className={`relative aspect-[5/7] rounded-lg overflow-hidden ring-1 ring-white/10 bg-slate-900 ${
        dimmed ? 'opacity-50 grayscale' : ''
      } ${className}`}
      style={{ backgroundImage: `linear-gradient(160deg, ${tint}33, transparent 70%)` }}
    >
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center p-1.5 text-center text-[10px] leading-tight text-slate-400">
          {card?.fullName ?? '?'}
        </span>
      )}
      {src && (
        <img
          src={src}
          alt={card.fullName}
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
};

export default CardThumb;
