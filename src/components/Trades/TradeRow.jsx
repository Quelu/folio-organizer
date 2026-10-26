import { Minus, Plus } from 'lucide-react';
import { getLorcanaSetName } from '../../data/games';
import CardThumb from '../ui/CardThumb';
import { useCardLang } from '../../hooks/useCardLang';

/**
 * One card of a trade list, with a checkbox and a copy stepper when there are several.
 * detail: what follows the chapter and number on the second line.
 */
const TradeRow = ({ item, selected, onChange, format, detail }) => {
  const cardLang = useCardLang();
  const { card, foil, qty, price } = item;
  return (
    <li
      className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${
        selected ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/30' : 'hover:bg-white/[0.03]'
      }`}
    >
      <input
        type="checkbox"
        checked={selected > 0}
        onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        className="w-4 h-4 accent-indigo-500 flex-shrink-0"
        aria-label={`Sélectionner ${cardLang.fullName(card)}`}
      />
      <CardThumb card={card} foil={foil} className="w-8 flex-shrink-0" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm text-slate-200 truncate">
          {cardLang.fullName(card)}
          {foil && <span className="foil-text font-semibold text-xs"> foil</span>}
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          {getLorcanaSetName(card.set) ?? `Set ${card.set}`} · n° {card.number}
          {qty > 1 && <> · {qty} dispo</>}
          {detail}
        </div>
      </div>
      {qty > 1 && selected > 0 && (
        <div className="flex items-center rounded-md ring-1 ring-inset ring-white/10 flex-shrink-0">
          <button onClick={() => onChange(selected - 1)} className="btn-icon p-1" aria-label="Un de moins">
            <Minus size={12} />
          </button>
          <span className="w-5 text-center text-xs font-semibold text-white tabular-nums">{selected}</span>
          <button
            onClick={() => onChange(Math.min(qty, selected + 1))}
            disabled={selected >= qty}
            className="btn-icon p-1"
            aria-label="Un de plus"
          >
            <Plus size={12} />
          </button>
        </div>
      )}
      <span className={`w-16 text-right text-xs tabular-nums flex-shrink-0 ${price == null ? 'text-slate-600' : 'text-slate-300'}`}>
        {format(price)}
      </span>
    </li>
  );
};

export default TradeRow;
