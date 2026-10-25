import { useMemo } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCollection } from '../../hooks/useCollection';
import { usePrices } from '../../hooks/usePrices';
import { getTradeableSurplus, suggestTrades, buildTradeText, BULK_PRICE } from '../../utils/trades';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';

/** Equal-value trades to get one missing card, from the user's surplus copies. */
const TradeSuggestions = ({ card, foil = false }) => {
  const { decks, prefs } = useStore();
  const collection = useCollection();
  const { status, getPrice, format, source } = usePrices();
  const keep = prefs.tradeKeep ?? 1;

  const haves = useMemo(
    () => (status === 'ready' ? getTradeableSurplus(collection, decks, keep, getPrice) : []),
    [status, collection, decks, keep, getPrice]
  );
  const price = card ? getPrice(card, foil) : null;
  const combos = useMemo(() => (price ? suggestTrades(price, haves) : []), [price, haves]);

  if (!card) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="label mb-0 flex items-center gap-1.5">
          <ArrowLeftRight size={12} /> Échanger contre
        </span>
        {status === 'ready' && (
          <span className="text-xs text-slate-400">
            Valeur <b className="text-white tabular-nums">{format(price)}</b>
            {foil && <span className="foil-text font-semibold"> foil</span>}
          </span>
        )}
      </div>

      {status === 'loading' ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" /> Chargement des prix…
        </p>
      ) : price == null ? (
        <p className="text-xs text-slate-500">Pas de prix connu pour cette carte.</p>
      ) : price < BULK_PRICE ? (
        <p className="text-xs text-slate-500">Moins de {format(BULK_PRICE)} : une carte en vrac, pas besoin d'échange.</p>
      ) : combos.length === 0 ? (
        <p className="text-xs text-slate-500 leading-relaxed">
          Aucune combinaison de tes doubles n'atteint cette valeur (à 15 % près).
          {haves.length === 0 && ' Tu n’as pas de doubles à échanger pour l’instant.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {combos.map((combo) => (
            <li
              key={combo.items.map((i) => `${i.have.id}x${i.qty}`).join(',')}
              className="flex items-center gap-3 rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/5 p-2"
            >
              <div className="flex -space-x-3 flex-shrink-0">
                {combo.items.map(({ have, qty }) => (
                  <div key={have.id} className="relative w-9">
                    <CardThumb card={have.card} className="shadow-md shadow-black/50" />
                    {qty > 1 && (
                      <span className="absolute -top-1 -right-1 bg-indigo-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 leading-4 text-center tabular-nums">
                        ×{qty}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-0 text-xs leading-snug">
                {combo.items.map(({ have, qty }) => (
                  <div key={have.id} className="truncate text-slate-300">
                    {qty > 1 && <span className="text-slate-500">{qty}× </span>}
                    {have.card.fullName}
                    {have.foil && <span className="foil-text font-semibold"> foil</span>}
                  </div>
                ))}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-semibold text-white tabular-nums">{format(combo.total)}</div>
                <div
                  className={`text-[10px] tabular-nums ${
                    Math.abs(combo.diff) <= price * 0.05 ? 'text-emerald-300' : 'text-amber-300/90'
                  }`}
                >
                  {combo.diff >= 0 ? '+' : '−'}
                  {format(Math.abs(combo.diff))}
                </div>
              </div>
              <CopyButton
                text={buildTradeText(
                  [{ card, foil, qty: 1, price }],
                  combo.items.map(({ have, qty }) => ({ card: have.card, foil: have.foil, qty, price: have.price })),
                  format
                )}
                label=""
                toast="Proposition d'échange copiée"
                className="btn-icon"
              />
            </li>
          ))}
        </ul>
      )}

      {status === 'ready' && (
        <p className="text-[10px] text-slate-600 mt-2">
          Prix {source === 'Cardmarket' ? 'Cardmarket (tendance)' : source} · doubles au-delà de {keep} exemplaire
          {keep > 1 ? 's' : ''} par carte, cartes de tes decks exclues
        </p>
      )}
    </div>
  );
};

export default TradeSuggestions;
