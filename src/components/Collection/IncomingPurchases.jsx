import { useCallback, useState } from 'react';
import { Truck, PackageCheck, X, MapPin, ChevronDown } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { PocketHint } from '../Trades/PocketMap';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useToast } from '../ui/toastContext';
import { getTradeDestination } from '../../utils/trades';

const formatDay = (at) => new Date(at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' });

/** Where a received card goes: its pocket, the binder page around it on hover. */
const Destination = ({ destination, card }) => {
  const [anchor, setAnchor] = useState(null);
  const hide = useCallback(() => setAnchor(null), []);
  const show = (e) => setAnchor(e.currentTarget.getBoundingClientRect());
  if (!destination) return <span className="text-amber-300/80">pas de farde pour ce chapitre</span>;
  const { binder, cardNumber, location } = destination;
  return (
    <>
      <button
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center gap-0.5 text-slate-400 hover:text-white tabular-nums"
        aria-label={`Pochette n° ${cardNumber} de ${binder.name}`}
      >
        <MapPin size={11} />
        {binder.name} · n° {cardNumber} · p. {location.page}
      </button>
      {anchor && <PocketHint pocket={{ binder, cardNumber, mode: 'in', card }} anchor={anchor} onClose={hide} />}
    </>
  );
};

/**
 * Copies bought and not received yet (see utils/cardmarketSync.js): the want list no longer asks
 * for them. Once the parcel is there, each goes into its pocket in one click. Folded by default,
 * unfolded on demand.
 */
const IncomingPurchases = ({ index }) => {
  const { binders, purchases, receivePurchases, undoReceive, cancelPurchases, restorePurchases } = useStore();
  const cardLang = useCardLang();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const items = Object.entries(purchases)
    .map(([id, p]) => {
      const card = index?.byId.get(p.cardId) ?? null;
      return { id, ...p, card, destination: card ? getTradeDestination(card, binders) : null };
    })
    .sort((a, b) => (b.status === 'arrived') - (a.status === 'arrived') || a.at - b.at);
  if (items.length === 0) return null;

  const copies = items.reduce((s, i) => s + i.qty, 0);
  const arrived = items.filter((i) => i.status === 'arrived').reduce((s, i) => s + i.qty, 0);
  const receive = (list) => {
    const snapshot = receivePurchases(
      list.map((i) => ({ id: i.id, binderId: i.destination?.binder.id ?? null, cardNumber: i.destination?.cardNumber, qty: i.qty }))
    );
    const aside = list.filter((i) => !i.destination).length;
    const n = list.reduce((s, i) => s + i.qty, 0);
    notify({
      tone: 'success',
      message: `${n} carte${n > 1 ? 's' : ''} rangée${n > 1 ? 's' : ''}${aside ? ` (${aside} sans farde, à garder à part)` : ''}`,
      action: { label: 'Annuler', onClick: () => undoReceive(snapshot) },
      duration: 8000,
    });
  };
  const cancel = (item) => {
    const removed = cancelPurchases([item.id]);
    notify({ message: 'Achat oublié', action: { label: 'Annuler', onClick: () => restorePurchases(removed) }, duration: 7000 });
  };

  return (
    <section data-preview-group className="rounded-2xl ring-1 ring-inset p-4 sm:p-5 bg-emerald-500/[0.04] ring-emerald-400/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-400/15 text-emerald-300">
            <Truck size={16} />
          </span>
          <span className="min-w-0 text-sm font-semibold text-white">
            En attente de réception
            <span className="block text-xs font-normal text-slate-400">
              {copies} copie{copies > 1 ? 's' : ''} achetée{copies > 1 ? 's' : ''} : la want list ne les demande plus
              {arrived > 0 && <span className="text-emerald-300"> · {arrived} arrivée{arrived > 1 ? 's' : ''}, à ranger</span>}
            </span>
          </span>
          <ChevronDown size={16} className={`flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={() => receive(items)} className="btn-secondary px-3 py-1.5 text-xs">
          <PackageCheck size={14} /> Tout est arrivé : ranger
        </button>
      </div>
      {open && (
        <ul className="divide-y divide-white/5 mt-3">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2">
              {i.card ? <CardThumb card={i.card} className="w-10 flex-shrink-0" /> : <div className="w-10 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">
                  <b className="tabular-nums">{i.qty}×</b> {i.card ? cardLang.fullName(i.card) : i.cardId}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px]">
                  {i.status === 'arrived' ? (
                    <span className="font-semibold text-emerald-300">arrivée : à ranger</span>
                  ) : (
                    <span className="text-slate-500">achetée le {formatDay(i.at)}</span>
                  )}
                  {i.orderId && <span className="text-slate-500">commande Cardmarket {i.orderId}</span>}
                  {i.card && <Destination destination={i.destination} card={i.card} />}
                </div>
              </div>
              <button onClick={() => receive([i])} className="btn-secondary px-2.5 py-1 text-xs" title="Ranger dans sa pochette">
                <PackageCheck size={13} /> Reçue
              </button>
              <button onClick={() => cancel(i)} className="btn-icon p-1.5" title="Oublier cet achat" aria-label="Oublier cet achat">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default IncomingPurchases;
