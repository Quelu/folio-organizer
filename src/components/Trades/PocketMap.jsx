import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useCatalog } from '../../hooks/catalogContext';
import { findPocketCard } from '../../utils/catalog';
import { getCounts } from '../../utils/cards';
import { getCardsOnPage, getLocation } from '../../utils/calculations';
import CardThumb from '../ui/CardThumb';

const MODES = {
  out: { ring: 'ring-amber-300', badge: 'bg-amber-400 text-slate-950', label: 'Sortir' },
  in: { ring: 'ring-emerald-300', badge: 'bg-emerald-400 text-slate-950', label: 'Ici' },
};

/**
 * The binder page holding a pocket, as it lies in the binder: the cards around it, the pocket
 * outlined, so the user finds it at a glance.
 * @param {'out'|'in'} mode out: a card to take out; in: where a received card goes (shown in it)
 * @param {object} [card] the card going in (mode in)
 * @param {number} cell width of a pocket, in pixels
 */
export const PocketMap = ({ binder, cardNumber, mode, card = null, cell = 40 }) => {
  const { index } = useCatalog();
  const target = parseInt(cardNumber, 10);
  const loc = getLocation(target, binder);
  const numbers = getCardsOnPage(loc.page, binder);
  const style = MODES[mode];

  return (
    <div>
      <div className="mb-1.5 leading-tight">
        <div className="text-[11px] font-semibold text-slate-200 truncate">{binder.name}</div>
        <div className="text-[11px] text-slate-400 tabular-nums">
          Page {loc.page} · feuille {loc.sheet} {loc.side}
        </div>
      </div>
      <div
        className="grid gap-1 rounded-xl bg-slate-950/60 ring-1 ring-inset ring-white/10 p-1.5"
        style={{ gridTemplateColumns: `repeat(${binder.gridCols}, ${cell}px)` }}
      >
        {numbers.map((num, i) => {
          if (num == null) return <div key={`gap-${i}`} className="aspect-[5/7] rounded-md bg-white/[0.02]" />;
          const pocketCard = index ? findPocketCard(index, binder.setCode, num) : null;
          const { normal, foil } = getCounts(binder.cards[String(num)]);
          const owned = normal + foil > 0;
          if (num === target) {
            const shown = mode === 'in' ? (card ?? pocketCard) : pocketCard;
            return (
              <div key={num} className={`relative aspect-[5/7] rounded-md ring-2 ${style.ring} shadow-[0_0_14px_rgba(255,255,255,0.25)] z-10`}>
                {shown ? (
                  <CardThumb card={shown} preview={false} className={`w-full h-full rounded-md ${mode === 'in' ? 'opacity-80' : ''}`} />
                ) : (
                  <div className="w-full h-full rounded-md bg-white/10" />
                )}
                <span
                  className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 rounded-full text-[9px] font-bold uppercase tracking-wide whitespace-nowrap ${style.badge}`}
                >
                  {style.label}
                </span>
              </div>
            );
          }
          return owned && pocketCard ? (
            <CardThumb key={num} card={pocketCard} preview={false} className="w-full opacity-35 rounded-md" />
          ) : (
            <div
              key={num}
              className="aspect-[5/7] rounded-md border border-dashed border-white/10 flex items-center justify-center text-[9px] text-slate-600 tabular-nums"
            >
              {num}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-2 tabular-nums">
        n° {target} · rangée {loc.row}, colonne {loc.col}
      </p>
    </div>
  );
};

const GAP = 8;

/**
 * The PocketMap of a pocket floating next to its trigger, so the user sees the pocket without
 * leaving the page. Closes on scroll.
 * @param {DOMRect} anchor the trigger's box
 */
export const PocketHint = ({ pocket, anchor, onClose }) => {
  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const cell = 60;
  const width = pocket.binder.gridCols * (cell + 4) + 12 + 24;
  const height = pocket.binder.gridRows * (cell * 1.4 + 4) + 90;
  const below = anchor.bottom + GAP + height <= window.innerHeight;
  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - width - GAP));
  const top = below ? anchor.bottom + GAP : Math.max(GAP, anchor.top - GAP - height);
  return createPortal(
    <div
      role="tooltip"
      className="surface fixed z-50 rounded-2xl p-3 pointer-events-none shadow-2xl shadow-black/60"
      style={{ left, top, width }}
    >
      <PocketMap {...pocket} cell={cell} />
    </div>,
    document.body
  );
};
