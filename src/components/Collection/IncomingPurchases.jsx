import { useCallback, useState } from 'react';
import { Truck, PackageCheck, X, MapPin, ChevronDown, Pencil, Check, Library } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { PocketHint } from '../Trades/PocketMap';
import ResaleWizard from './ResaleWizard';
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

const NEW_ORDER = '__new__';
const NO_ORDER = '__none__';

/**
 * An order's cards by the binder they go into, binders in sidebar order and cards in page order,
 * so a parcel holding several chapters is put away one binder at a time.
 * @returns {{ binder: object|null, items: object[] }[]} binder null: no binder for that chapter
 */
const byBinder = (items, binders) => {
  const order = new Map(binders.map((b, i) => [b.id, i]));
  const map = new Map();
  for (const item of items) {
    const binder = item.destination?.binder ?? null;
    const key = binder?.id ?? null;
    map.set(key, { binder, items: [...(map.get(key)?.items ?? []), item] });
  }
  return [...map.values()]
    .sort((a, b) => (a.binder ? order.get(a.binder.id) : Infinity) - (b.binder ? order.get(b.binder.id) : Infinity))
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => Number(a.destination?.cardNumber ?? 0) - Number(b.destination?.cardNumber ?? 0)),
    }));
};

/** An order's name: the Cardmarket order number, or the name the user gave. */
const orderLabel = (group) =>
  group.orderId == null ? 'Sans commande' : group.cardmarket ? `Commande Cardmarket ${group.orderId}` : group.orderId;

/** A small form to name an order: a new one for a purchase, or a manual order renamed. */
const OrderNameForm = ({ initial = '', onSubmit, onCancel }) => {
  const [name, setName] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="Boutique, n° de commande…"
        className="field py-1 px-2 text-xs w-44"
        aria-label="Nom de la commande"
      />
      <button type="submit" className="btn-icon p-1.5" aria-label="Valider le nom">
        <Check size={14} />
      </button>
      <button type="button" onClick={onCancel} className="btn-icon p-1.5" aria-label="Annuler">
        <X size={14} />
      </button>
    </form>
  );
};

/** Moves a purchase to another order, or to a new one named on the spot. */
const OrderPicker = ({ item, orders, onMove }) => {
  const [naming, setNaming] = useState(false);
  if (naming) return <OrderNameForm onSubmit={(name) => (onMove(name), setNaming(false))} onCancel={() => setNaming(false)} />;
  return (
    <select
      value={item.orderId ?? NO_ORDER}
      onChange={(e) => {
        const value = e.target.value;
        if (value === NEW_ORDER) setNaming(true);
        else onMove(value === NO_ORDER ? null : value);
      }}
      className="field py-0.5 px-1.5 text-[11px] w-auto max-w-[11rem]"
      aria-label="Commande de cet achat"
      title="Changer de commande"
    >
      <option value={NO_ORDER}>Sans commande</option>
      {orders.map((o) => (
        <option key={o.orderId} value={o.orderId}>
          {orderLabel(o)}
        </option>
      ))}
      <option value={NEW_ORDER}>Nouvelle commande…</option>
    </select>
  );
};

/**
 * Copies bought and not received yet (see utils/cardmarketSync.js): the want list no longer asks
 * for them. They are grouped by order, so a parcel that arrives goes into its pockets on its own.
 * The MCP server files Cardmarket purchases by order; the user can move a purchase to another order
 * or name one here. Folded by default, unfolded on demand.
 */
const IncomingPurchases = ({ index }) => {
  const { binders, purchases, receivePurchases, undoReceive, cancelPurchases, restorePurchases, setPurchaseOrder } = useStore();
  const cardLang = useCardLang();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [putAway, setPutAway] = useState(null); // { title, items }
  const items = Object.entries(purchases).map(([id, p]) => {
    const card = index?.byId.get(p.cardId) ?? null;
    return {
      id,
      ...p,
      card,
      destination: card ? getTradeDestination(card, binders) : null,
    };
  });
  if (items.length === 0) return null;

  // Arrived orders first, then the oldest; purchases without an order last
  const groups = [...items.reduce((map, i) => map.set(i.orderId ?? null, [...(map.get(i.orderId ?? null) ?? []), i]), new Map())]
    .map(([orderId, list]) => ({
      orderId,
      items: list.sort((a, b) => a.at - b.at),
      cardmarket: list.some((i) => i.source === 'cardmarket'),
      arrived: list.some((i) => i.status === 'arrived'),
      copies: list.reduce((s, i) => s + i.qty, 0),
      at: Math.min(...list.map((i) => i.at)),
    }))
    .sort((a, b) => (a.orderId == null) - (b.orderId == null) || b.arrived - a.arrived || a.at - b.at);
  const orders = groups.filter((g) => g.orderId != null);

  const copies = items.reduce((s, i) => s + i.qty, 0);
  const arrived = items.filter((i) => i.status === 'arrived').reduce((s, i) => s + i.qty, 0);
  /** Opens the page-by-page wizard on purchases that arrived: their pockets, binder by binder. */
  const openPutAway = (title, list) => setPutAway({ title, items: list });
  const receive = (list) => {
    const snapshot = receivePurchases(
      list.map((i) => ({
        id: i.id,
        binderId: i.destination?.binder.id ?? null,
        cardNumber: i.destination?.cardNumber,
        qty: i.qty,
      })),
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
    notify({
      message: 'Achat oublié',
      action: { label: 'Annuler', onClick: () => restorePurchases(removed) },
      duration: 7000,
    });
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
              {copies} copie{copies > 1 ? 's' : ''} achetée
              {copies > 1 ? 's' : ''}
              {orders.length > 0 && ` · ${orders.length} commande${orders.length > 1 ? 's' : ''}`} : la want list ne les demande plus
              {arrived > 0 && (
                <span className="text-emerald-300">
                  {' '}
                  · {arrived} arrivée{arrived > 1 ? 's' : ''}, à ranger
                </span>
              )}
            </span>
          </span>
          <ChevronDown size={16} className={`flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={() => openPutAway('Tout est arrivé · ranger', items)} className="btn-secondary px-3 py-1.5 text-xs">
          <PackageCheck size={14} /> Tout est arrivé : ranger
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {groups.map((group) => {
            const key = group.orderId ?? NO_ORDER;
            return (
              <div key={key} className="rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 pb-1">
                  {renaming === key ? (
                    <OrderNameForm
                      initial={group.orderId ?? ''}
                      onSubmit={(name) => {
                        setPurchaseOrder(
                          group.items.map((i) => i.id),
                          name,
                        );
                        setRenaming(null);
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      {orderLabel(group)}
                      {!group.cardmarket && (
                        <button
                          onClick={() => setRenaming(key)}
                          className="btn-icon p-1"
                          title={group.orderId == null ? 'Regrouper ces achats dans une commande' : 'Renommer la commande'}
                          aria-label={group.orderId == null ? 'Nommer une commande pour ces achats' : 'Renommer la commande'}
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500">
                    {group.copies} copie{group.copies > 1 ? 's' : ''} · achetée
                    {group.copies > 1 ? 's' : ''} le {formatDay(group.at)}
                  </span>
                  {group.arrived && <span className="text-[11px] font-semibold text-emerald-300">arrivée : à ranger</span>}
                  {byBinder(group.items, binders).length > 1 && (
                    <span className="text-[11px] text-amber-200/90">à ranger dans {byBinder(group.items, binders).length} fardes</span>
                  )}
                  <button
                    onClick={() => openPutAway(`${orderLabel(group)} · ranger`, group.items)}
                    className="btn-secondary ml-auto px-2.5 py-1 text-xs"
                  >
                    <PackageCheck size={13} /> {group.orderId == null ? 'Tout ranger' : 'Commande reçue : ranger'}
                  </button>
                </div>
                {byBinder(group.items, binders).map(({ binder, items: binderItems }) => (
                  <div key={binder?.id ?? 'none'} className="pt-1">
                    <div className="flex items-center gap-1.5 pt-1.5 text-[11px] font-semibold text-violet-300">
                      <Library size={12} />
                      {binder ? binder.name : 'Sans farde pour ce chapitre : à garder à part'}
                      <span className="font-normal text-slate-500">
                        · {binderItems.reduce((n, i) => n + i.qty, 0)} carte
                        {binderItems.reduce((n, i) => n + i.qty, 0) > 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul className="divide-y divide-white/5">
                      {binderItems.map((i) => (
                        <li key={i.id} className="flex items-center gap-3 py-2">
                          {i.card ? <CardThumb card={i.card} className="w-10 flex-shrink-0" /> : <div className="w-10 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white truncate">
                              <b className="tabular-nums">{i.qty}×</b> {i.card ? cardLang.fullName(i.card) : i.cardId}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px]">
                              {i.card && <Destination destination={i.destination} card={i.card} />}
                              <OrderPicker item={i} orders={orders} onMove={(orderId) => setPurchaseOrder([i.id], orderId)} />
                            </div>
                          </div>
                          <button
                            onClick={() => receive([i])}
                            className="btn-secondary px-2.5 py-1 text-xs"
                            title="Ranger dans sa pochette"
                          >
                            <PackageCheck size={13} /> Reçue
                          </button>
                          <button
                            onClick={() => cancel(i)}
                            className="btn-icon p-1.5"
                            title="Oublier cet achat"
                            aria-label="Oublier cet achat"
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <ResaleWizard
        isOpen={Boolean(putAway)}
        onClose={() => setPutAway(null)}
        title={putAway?.title}
        mode="in"
        verb="Range dans ta farde"
        binders={binders}
        copies={(putAway?.items ?? [])
          .filter((i) => i.destination && i.card)
          .map((i) => ({
            id: i.id,
            binder: i.destination.binder,
            cardNumber: i.destination.cardNumber,
            location: i.destination.location,
            card: i.card,
            foil: false,
            qty: i.qty,
          }))}
        aside={(putAway?.items ?? []).filter((i) => !i.destination || !i.card)}
        onComplete={(taken) => {
          const ids = new Set(taken.map((c) => c.id));
          receive(putAway.items.filter((i) => ids.has(i.id) || !i.destination || !i.card));
          setPutAway(null);
        }}
      />
    </section>
  );
};

export default IncomingPurchases;
