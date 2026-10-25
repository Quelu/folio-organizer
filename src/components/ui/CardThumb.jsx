import { useState } from 'react';
import { getInk } from '../../utils/catalog';
import { useCardPreview } from '../CardPreview/cardPreviewContext';
import { useCardLang } from '../../hooks/useCardLang';
import FoilLayers from './FoilLayers';

/**
 * Card picture from the catalog, with the card name on a tinted background until it loads.
 * Clicking it opens the full card view (preview={false} where the click already does something).
 */
const CardThumb = ({ card, size = 'small', className = '', dimmed = false, foil = false, preview = true }) => {
  const [loaded, setLoaded] = useState(false);
  const cardPreview = useCardPreview();
  const cardLang = useCardLang();
  const src = cardLang.image(card, size === 'small' ? 'small' : 'large');
  const name = cardLang.fullName(card, card?.fullName ?? '?');
  const tint = getInk(card?.inks?.[0]).color;
  const canPreview = Boolean(preview && cardPreview && card?.id);

  const openPreview = (e) => {
    // Rows holding thumbnails can be labels or clickable: the thumbnail click is only a preview
    e.preventDefault();
    e.stopPropagation();
    cardPreview.open(card, { foil, origin: e.currentTarget });
  };

  return (
    <div
      {...(canPreview && {
        role: 'button',
        tabIndex: 0,
        onClick: openPreview,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') openPreview(e);
        },
        'aria-label': `Voir ${name} en grand`,
        'data-preview-id': card.id,
        'data-preview-foil': foil || undefined,
      })}
      className={`relative aspect-[5/7] rounded-lg overflow-hidden ring-1 ring-white/10 bg-slate-900 pocket-shine ${
        canPreview
          ? 'cursor-zoom-in outline-none transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.06] hover:z-10 hover:ring-white/40 hover:shadow-lg hover:shadow-black/60 focus-visible:ring-2 focus-visible:ring-indigo-400'
          : ''
      } ${dimmed ? 'opacity-50 grayscale' : ''} ${className}`}
      style={{ backgroundImage: `linear-gradient(160deg, ${tint}33, transparent 70%)` }}
    >
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center p-1.5 text-center text-[10px] leading-tight text-slate-400">
          {name}
        </span>
      )}
      {src && (
        <img
          src={src}
          alt={name}
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {foil && <FoilLayers mask={cardLang.foilMask(card)} />}
    </div>
  );
};

export default CardThumb;
