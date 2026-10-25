import { useState } from 'react';
import { ArrowLeftRight, ExternalLink } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import Modal from '../ui/Modal';
import TradeSuggestions from '../Trades/TradeSuggestions';
import { useCatalog } from '../../hooks/catalogContext';
import { usePrices } from '../../hooks/usePrices';
import { getMainPrinting } from '../../utils/catalog';
import { getDeckWantsLines } from '../../utils/cardmarketExport';

const CARDMARKET_WANTS_URL = 'https://www.cardmarket.com/fr/Lorcana/Wants';

/**
 * Cards a deck needs beyond the collection: estimated price, Cardmarket wants list and
 * equal-value trade ideas for each card.
 * @param {{ entries: { key, name, missing, card }[] }} props missing entries of analyzeDeck
 */
const MissingCards = ({ entries }) => {
  const { index } = useCatalog();
  const prices = usePrices();
  const [withExpansion, setWithExpansion] = useState(true);
  const [tradeCard, setTradeCard] = useState(null);

  if (entries.length === 0) {
    return <p className="text-sm text-emerald-300">Tu as toutes les cartes de ce deck 🎉</p>;
  }

  const priced = entries.map((e) => {
    const card = index ? getMainPrinting(index, e.key) : e.card;
    const price = card ? prices.getPrice(card) : null;
    return { ...e, buyCard: card, price, subtotal: price != null ? price * e.missing : null };
  });
  const total = priced.reduce((s, e) => s + (e.subtotal ?? 0), 0);
  const unpriced = priced.filter((e) => e.subtotal == null).length;
  const copies = entries.reduce((s, e) => s + e.missing, 0);
  const wants = index
    ? getDeckWantsLines(
        entries.map((e) => ({ key: e.key, qty: e.missing })),
        index,
        getMainPrinting,
        withExpansion
      ).join('\n')
    : '';

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">
          <b className="text-white">{copies}</b> carte{copies > 1 ? 's' : ''} manquante{copies > 1 ? 's' : ''} ·{' '}
          environ <b className="text-white">{prices.format(total)}</b>
          {unpriced > 0 && <span className="text-slate-500"> (+ {unpriced} sans prix)</span>}
        </p>
        <span className="text-[11px] text-slate-500">Prix : {prices.source}</span>
      </div>

      <div data-preview-group className="space-y-1">
        {priced.map((e) => (
          <div key={e.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
            {e.buyCard && <CardThumb card={e.buyCard} className="w-8 flex-shrink-0" />}
            <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
              <b className="tabular-nums">{e.missing}×</b> {e.name}
            </span>
            <span className="text-xs tabular-nums text-slate-400">
              {e.subtotal != null ? prices.format(e.subtotal) : '—'}
            </span>
            {e.buyCard && (
              <button
                onClick={() => setTradeCard(e.buyCard)}
                className="btn-icon p-1.5"
                title="Trouver un échange à valeur égale"
                aria-label={`Échanger pour ${e.name}`}
              >
                <ArrowLeftRight size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-semibold text-white">Liste de wants Cardmarket</span>
          <CopyButton text={wants} label="Copier les wants" toast="Wants copiés" className="btn-primary px-3 py-1.5" />
        </div>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={withExpansion}
            onChange={(e) => setWithExpansion(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-indigo-500"
          />
          <span className="text-xs text-slate-400">
            Préciser le chapitre de la version normale la plus récente (évite de recevoir une Enchantée).
          </span>
        </label>
        <a
          href={CARDMARKET_WANTS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white font-semibold transition-colors w-fit"
        >
          Ouvrir mes wants Cardmarket
          <ExternalLink size={12} />
        </a>
      </div>

      <Modal isOpen={Boolean(tradeCard)} onClose={() => setTradeCard(null)} title="Échange à valeur égale" size="lg">
        <div className="px-6 pb-6 pt-2">{tradeCard && <TradeSuggestions card={tradeCard} />}</div>
      </Modal>
    </div>
  );
};

export default MissingCards;
