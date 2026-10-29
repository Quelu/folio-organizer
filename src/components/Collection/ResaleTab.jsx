import { useCallback, useMemo, useState } from 'react';
import { Coins, Store, Package, PackageOpen, Tag, X, MapPin, Download, CalendarClock, AlertTriangle, ChevronDown, Repeat } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { CardGrid, Segmented } from './CollectionParts';
import { PocketHint } from '../Trades/PocketMap';
import ResaleWizard from './ResaleWizard';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useSurplus } from '../../hooks/useSurplus';
import { useToast } from '../ui/toastContext';
import { matchesCard } from '../../utils/collectionFilters';
import { getNextRotation } from '../../utils/deckRules';
import { getLocation } from '../../utils/calculations';
import { getPocketId } from '../../utils/trades';
import { getSaleLines, generateSaleCsv } from '../../utils/cardmarketExport';
import { downloadCsv } from '../../utils/csvExport';
import { getWantList, getWantCost } from '../../utils/wantList';
import { LORCANA_RARITIES } from '../../data/games';

const PLAYSET = 4;
const RARITY_RANK = new Map(LORCANA_RARITIES.map((r, i) => [r.key, i]));
/** Rarity groups of the bulk: what shops and lot buyers count. */
const BULK_GROUPS = [
  { key: 'common', label: 'Communes', of: (r) => r === 'Common' },
  { key: 'uncommon', label: 'Peu communes', of: (r) => r === 'Uncommon' },
  { key: 'rare', label: 'Rares et plus', of: (r) => r !== 'Common' && r !== 'Uncommon' },
];
const LOT_SIZES = [100, 200, 500, 0];
const LANGUAGES = { fr: 'français', en: 'anglais' };

const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;
const qtyOf = (list) => list.reduce((s, c) => s + c.qty, 0);
const bySetNumber = (a, b) =>
  Number(a.card.set) - Number(b.card.set) || Number(a.cardNumber) - Number(b.cardNumber) || Number(a.foil) - Number(b.foil);

/** Where a pocket is: its number, the binder page around it on hover. */
const PocketLink = ({ copy }) => {
  const [anchor, setAnchor] = useState(null);
  const hide = useCallback(() => setAnchor(null), []);
  const show = (e) => setAnchor(e.currentTarget.getBoundingClientRect());
  return (
    <>
      <button
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center gap-0.5 text-slate-400 hover:text-white tabular-nums"
        aria-label={`Emplacement du n° ${copy.cardNumber} dans ${copy.binder.name}`}
      >
        <MapPin size={11} />
        {copy.binder.setCode} · n° {copy.cardNumber} · p. {copy.location.page}
      </button>
      {anchor && <PocketHint pocket={{ binder: copy.binder, cardNumber: copy.cardNumber, mode: 'out' }} anchor={anchor} onClose={hide} />}
    </>
  );
};

/** Where a listed copy stands on Cardmarket, from the last sync (see utils/cardmarketSync.js). */
const CardmarketStatus = ({ listing, prices }) => {
  const toSell = Math.max(0, listing.qty - listing.sold);
  return (
    <p className="flex flex-wrap gap-x-2 text-[11px] mt-1">
      {listing.sold > 0 && <span className="text-emerald-300 font-semibold">{listing.sold} vendue{listing.sold > 1 ? 's' : ''} : à sortir</span>}
      {listing.online > 0 && (
        <span className="text-sky-300">
          en ligne ×{Math.min(listing.online, toSell)}
          {listing.onlinePrice != null && ` à ${prices.format(listing.onlinePrice)}`}
        </span>
      )}
      {toSell > listing.online && <span className="text-slate-500">{toSell - listing.online} pas encore sur Cardmarket</span>}
    </p>
  );
};

/** A surplus or listed copy of the Cardmarket pile, selectable. */
const SaleRow = ({ copy, qty, checked, onCheck, prices, rotating, onSwap, children }) => {
  const cardLang = useCardLang();
  return (
    <li className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheck(e.target.checked)}
        className="w-4 h-4 accent-sky-500 flex-shrink-0"
        aria-label={`Sélectionner ${cardLang.fullName(copy.card)}`}
      />
      <CardThumb card={copy.card} foil={copy.foil} className="w-10 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">
          {cardLang.fullName(copy.card)}
          {copy.foil && <span className="foil-text font-semibold"> foil</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[11px]">
          {copy.binder && <PocketLink copy={copy} />}
          <span className="text-slate-500">{LORCANA_RARITIES.find((r) => r.key === copy.card.rarity)?.label}</span>
          {rotating && (
            <span className="flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold text-amber-200 bg-amber-400/15 ring-1 ring-inset ring-amber-400/25" title="Quitte le Core à la prochaine rotation : à vendre en premier">
              <CalendarClock size={10} /> rotation
            </span>
          )}
          {onSwap && (
            <button onClick={onSwap} className="flex items-center gap-1 text-sky-300/80 hover:text-white" title="Choisir l'exemplaire qui reste dans la pochette">
              <Repeat size={10} />
              {copy.sellsFoil ? 'Garder la foil plutôt' : `Vendre la foil plutôt (${prices.format(prices.getPrice(copy.card, true))})`}
            </button>
          )}
        </div>
        {children}
      </div>
      <span className="text-sm font-bold text-white tabular-nums whitespace-nowrap">×{qty}</span>
      <span className="w-16 text-right text-xs text-slate-300 tabular-nums">{prices.format(copy.price)}</span>
    </li>
  );
};

/**
 * Resale: the copies beyond what the collection and the decks keep (see getSurplusCopies), split
 * between the cards worth selling one by one on Cardmarket and the bulk for lots, with a guided
 * pass to take them out of the binders page by page.
 */
const ResaleTab = ({ ctx, prices }) => {
  const store = useStore();
  const { binders, decks, deckGroups, allocations, prefs, setPref, listForSale, unlistForSale, removeCopies, restoreCopies, setSellFoil, cardmarketSync } = store;
  const notify = useToast();
  const cardLang = useCardLang();
  const { surplus, listed } = useSurplus();
  const { index, collection, filters, query } = ctx;
  const keep = prefs.tradeKeep ?? 1;
  const threshold = prefs.resaleThreshold ?? 0.5;
  const rate = prefs.bulkRatePerThousand ?? 15;
  const language = LANGUAGES[prefs.cardLanguage ?? 'fr'];

  const [status, setStatus] = useState('toList');
  const [selected, setSelected] = useState(() => new Set());
  const [lot, setLot] = useState({ size: 200, noDouble: true, groups: ['common', 'uncommon', 'rare'] });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [wizard, setWizard] = useState(null); // { title, verb, copies, done }

  const rotation = useMemo(() => (index ? getNextRotation(index) : null), [index]);

  const matches = useCallback(
    (copy) =>
      copy.card &&
      matchesCard(copy.card, { ...filters, binders: [], foil: false }, query, ctx) &&
      (!filters.binders.length || filters.binders.includes(copy.binderId ?? copy.binder?.id)) &&
      (!filters.foil || copy.foil),
    [filters, query, ctx]
  );

  const listedRows = useMemo(
    () =>
      listed
        .filter((l) => !l.card || matches(l))
        .map((l) => ({ ...l, location: l.binder ? getLocation(Number(l.cardNumber), l.binder) : null, price: l.card ? prices.getPrice(l.card, l.foil) : null }))
        .sort((a, b) => b.sold - a.sold || b.needed - a.needed || (a.card && b.card ? bySetNumber(a, b) : 0)),
    [listed, matches, prices]
  );

  const { toList, bulk, onSale, leaving, credit } = useMemo(() => {
    const shown = surplus.filter(matches);
    const unit = shown.filter((c) => c.price == null || c.price >= threshold).sort(bySetNumber);
    return {
      toList: unit.filter((c) => c.qty > c.listed).map((c) => ({ ...c, available: c.qty - c.listed })),
      bulk: shown.filter((c) => c.price != null && c.price < threshold && c.qty > c.listed).map((c) => ({ ...c, qty: c.qty - c.listed })),
      onSale: listedRows.filter((l) => l.qty > 0),
      // Taken off sale in Folio, still on Cardmarket until Claude removes them there
      leaving: listedRows.filter((l) => l.online > Math.max(0, l.qty - l.sold)),
      credit: unit.reduce((s, c) => s + c.qty * (c.price ?? 0), 0),
    };
  }, [surplus, listedRows, matches, threshold]);

  const wantCost = useMemo(() => {
    if (!index) return 0;
    const { cards } = getWantList({ binders, decks, index, collection, groups: deckGroups, allocations, specials: prefs.wantSpecials ?? false });
    return getWantCost(cards, index, prices.getPrice);
  }, [binders, decks, index, collection, deckGroups, allocations, prefs.wantSpecials, prices]);

  const rows = status === 'toList' ? toList : onSale;
  const picked = rows.filter((r) => selected.has(r.id));
  const scope = picked.length ? picked : rows;
  const check = (id, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const changeStatus = (next) => {
    setStatus(next);
    setSelected(new Set());
  };

  const saleItems = (list) => list.map((c) => ({ card: c.card, foil: c.foil, qty: c.available ?? c.qty, price: c.price }));
  const needing = onSale.filter((l) => l.needed > 0);
  const soldOnline = onSale.filter((l) => l.sold > 0 && l.binder);
  /** Copies of a sale to take out: the ones Cardmarket sold, else every copy still on sale here. */
  const soldCopies = (list) =>
    list
      .filter((c) => c.binder && (c.sold > 0 || c.qty > c.needed))
      .map((c) => ({ ...c, qty: c.sold > 0 ? c.sold : c.qty - c.needed }));
  const openSold = (list) =>
    setWizard({
      title: 'Cartes vendues · sortir des fardes',
      verb: 'Sors pour l’envoi',
      copies: soldCopies(list),
      message: (n) => `${plural(n, 'carte vendue retirée', 'cartes vendues retirées')} de tes fardes`,
    });

  /** Takes the copies out of Folio once the wizard is done, with a way back. */
  const takeOut = (taken, message) => {
    const snapshot = removeCopies(
      taken.map((c) => ({ id: c.id, binderId: c.binder.id, cardNumber: c.cardNumber, foil: c.foil, qty: c.qty }))
    );
    setWizard(null);
    setSelected(new Set());
    notify({ tone: 'success', message: message(qtyOf(taken)), action: { label: 'Annuler', onClick: () => restoreCopies(snapshot) }, duration: 8000 });
  };

  // Bulk by rarity group, and the lot composed from it
  const bulkGroups = BULK_GROUPS.map((g) => ({ ...g, copies: qtyOf(bulk.filter((c) => g.of(c.card.rarity))) }));
  const bulkCopies = qtyOf(bulk);
  const lotCopies = useMemo(() => {
    const candidates = bulk
      .filter((c) => BULK_GROUPS.some((g) => lot.groups.includes(g.key) && g.of(c.card.rarity)))
      .sort(
        (a, b) =>
          (RARITY_RANK.get(b.card.rarity) ?? 0) - (RARITY_RANK.get(a.card.rarity) ?? 0) || (b.price ?? 0) - (a.price ?? 0) || bySetNumber(a, b)
      );
    const seen = new Set();
    const items = [];
    let left = lot.size || Infinity;
    for (const c of candidates) {
      if (left <= 0) break;
      if (lot.noDouble && seen.has(c.key)) continue;
      seen.add(c.key);
      const qty = Math.min(lot.noDouble ? 1 : c.qty, left);
      items.push({ ...c, qty });
      left -= qty;
    }
    return items;
  }, [bulk, lot]);
  const lotTotal = qtyOf(lotCopies);
  const lotText = [
    `Lot de ${lotTotal} cartes Disney Lorcana${lot.noDouble ? ' sans double' : ''}, en ${language}`,
    BULK_GROUPS.map((g) => [g.label.toLowerCase(), qtyOf(lotCopies.filter((c) => g.of(c.card.rarity)))])
      .filter(([, n]) => n)
      .map(([label, n]) => `${n} ${label}`)
      .join(', '),
    `Chapitres ${[...new Set(lotCopies.map((c) => c.card.set))].sort((a, b) => a - b).join(', ')}`,
    ...(() => {
      const rares = lotCopies.filter((c) => BULK_GROUPS[2].of(c.card.rarity));
      return rares.length ? ['', `Dont : ${rares.map((c) => cardLang.fullName(c.card)).join(', ')}`] : [];
    })(),
  ].join('\n');

  const coverage = wantCost > 0 ? Math.min(1, credit / wantCost) : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Coins size={15} className="text-indigo-300" />
              Revente
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              <b className="text-white text-lg tabular-nums">{prices.format(credit)}</b> de crédit Cardmarket possible
              {coverage != null && (
                <>
                  {' '}
                  · couvre <b className="text-white">{Math.floor(coverage * 100)} %</b> de ta want list ({prices.format(wantCost)})
                </>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Au-delà {keep >= PLAYSET ? 'd’un playset' : 'd’un exemplaire par pochette'} et de ce que jouent tes decks. Un exemplaire reste toujours en farde.
            </p>
          </div>
          <Segmented
            label="Copies gardées"
            value={keep}
            onChange={(value) => setPref('tradeKeep', value)}
            options={[
              { value: 1, label: '1 par pochette' },
              { value: PLAYSET, label: 'Playset' },
            ]}
          />
        </div>
        {coverage != null && <ProgressBar value={coverage} className="h-1.5 mt-3" />}
        <label className="flex flex-wrap items-center gap-3 mt-4 text-xs text-slate-400">
          Vrac sous
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.1"
            value={threshold}
            onChange={(e) => setPref('resaleThreshold', Number(e.target.value))}
            className="flex-1 max-w-xs accent-indigo-500"
          />
          <b className="text-white tabular-nums">{prices.format(threshold)}</b>
          <span className="text-slate-500">en dessous, l’envoi coûte plus que la carte</span>
        </label>
      </section>

      <section data-preview-group className="rounded-2xl ring-1 ring-inset p-4 sm:p-5 bg-sky-500/[0.04] ring-sky-400/20">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <h3 className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-sky-400/15 text-sky-300">
              <Store size={16} />
            </span>
            <span>
              Cardmarket à l’unité
              <span className="block text-xs font-normal text-slate-400">
                {plural(qtyOf(toList.map((c) => ({ qty: c.available }))), 'copie')} à mettre en vente · langue : {language}
                <span className="block text-slate-500">
                  {cardmarketSync?.at
                    ? `Synchro Cardmarket le ${new Date(cardmarketSync.at).toLocaleString('fr-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                    : 'Pas encore synchronisé avec Cardmarket'}{' '}
                  · demande à Claude « vends mes cartes sur Cardmarket » (sauvegarde auto activée)
                </span>
              </span>
            </span>
          </h3>
          <Segmented
            label="Copies affichées"
            value={status}
            onChange={changeStatus}
            options={[
              { value: 'toList', label: `À mettre en vente (${toList.length})` },
              { value: 'onSale', label: `En vente (${onSale.length})` },
            ]}
          />
        </div>

        {soldOnline.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/25 p-3 mb-3">
            <span className="flex-1 min-w-0 text-xs text-emerald-100">
              {plural(qtyOf(soldOnline.map((l) => ({ qty: l.sold }))), 'copie vendue', 'copies vendues')} sur Cardmarket : sors-les de tes fardes pour l’envoi.
            </span>
            <button onClick={() => openSold(soldOnline)} className="btn-primary px-3 py-1.5 text-xs">
              <PackageOpen size={14} /> Les sortir
            </button>
          </div>
        )}

        {status === 'onSale' && needing.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/[0.08] ring-1 ring-inset ring-amber-400/25 p-3 mb-3 text-xs text-amber-100">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px text-amber-300" />
            {plural(needing.length, 'carte en vente sert', 'cartes en vente servent')} maintenant à un deck ou n’est plus dans tes fardes :
            retire-les de la vente ici, Claude les retirera de Cardmarket à la prochaine synchro.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {status === 'toList' ? 'Aucune carte à vendre à l’unité avec ces réglages.' : 'Aucune carte en vente pour l’instant.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <label className="flex items-center gap-2 text-xs text-slate-400 mr-auto cursor-pointer">
                <input
                  type="checkbox"
                  checked={picked.length === rows.length}
                  onChange={(e) => setSelected(new Set(e.target.checked ? rows.map((r) => r.id) : []))}
                  className="w-4 h-4 accent-sky-500"
                />
                {picked.length ? `${picked.length} sélectionnée${picked.length > 1 ? 's' : ''}` : 'Tout sélectionner'}
              </label>
              {status === 'toList' ? (
                <>
                  <CopyButton
                    text={index ? getSaleLines(saleItems(scope), index).join('\n') : ''}
                    label={picked.length ? 'Copier la sélection' : 'Copier la liste'}
                    toast="Liste copiée"
                  />
                  <button onClick={() => downloadCsv(generateSaleCsv(saleItems(scope)), 'folio-a-vendre.csv')} className="btn-secondary px-3 py-1.5">
                    <Download size={15} /> CSV
                  </button>
                  <button
                    onClick={() => {
                      listForSale(picked.map((c) => ({ id: c.id, qty: c.available })));
                      notify({ tone: 'success', message: `${plural(qtyOf(picked.map((c) => ({ qty: c.available }))), 'copie')} en vente` });
                      setSelected(new Set());
                    }}
                    disabled={!picked.length}
                    className="btn-primary px-3 py-1.5"
                  >
                    <Tag size={15} /> Marquer en vente
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      unlistForSale(picked.map((c) => c.id));
                      setSelected(new Set());
                    }}
                    disabled={!picked.length}
                    className="btn-secondary px-3 py-1.5"
                  >
                    <X size={15} /> Retirer de la vente
                  </button>
                  <button
                    onClick={() => openSold(picked)}
                    disabled={soldCopies(picked).length === 0}
                    className="btn-primary px-3 py-1.5"
                  >
                    <PackageOpen size={15} /> Vendues : les sortir
                  </button>
                </>
              )}
            </div>
            <ul className="divide-y divide-white/5">
              {rows.map((c) =>
                c.card ? (
                  <SaleRow
                    key={c.id}
                    copy={c}
                    qty={status === 'toList' ? c.available : c.qty}
                    checked={selected.has(c.id)}
                    onCheck={(on) => check(c.id, on)}
                    prices={prices}
                    rotating={rotation?.leaves(c.key)}
                    onSwap={
                      status === 'toList' && c.canSwap
                        ? () => setSellFoil(getPocketId(c.binder.id, c.cardNumber), !c.sellsFoil)
                        : null
                    }
                  >
                    {status === 'onSale' && <CardmarketStatus listing={c} prices={prices} />}
                    {c.needed > 0 && (
                      <p className="text-[11px] text-amber-300 mt-1">
                        {c.binder ? `${c.needed} ne ${c.needed > 1 ? 'sont' : 'est'} plus en trop : un deck l’utilise` : 'N’est plus dans tes fardes'}
                      </p>
                    )}
                  </SaleRow>
                ) : (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-xs text-slate-500">
                    Pochette n° {c.cardNumber} vidée depuis la mise en vente
                    <button onClick={() => unlistForSale([c.id])} className="ml-auto text-slate-400 hover:text-white">
                      Retirer de la vente
                    </button>
                  </li>
                )
              )}
            </ul>
          </>
        )}

        {status === 'onSale' && leaving.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/5">
            <p className="text-xs font-semibold text-slate-300 mb-1">À retirer de Cardmarket ({leaving.length})</p>
            <p className="text-[11px] text-slate-500 mb-2">Retirées de la vente dans Folio, encore en ligne : Claude les retirera à la prochaine synchro.</p>
            <ul className="divide-y divide-white/5">
              {leaving.map((l) => {
                const extra = l.online - Math.max(0, l.qty - l.sold);
                return (
                  <li key={l.id} className="flex items-center gap-3 py-1.5">
                    {l.card && <CardThumb card={l.card} foil={l.foil} className="w-8 flex-shrink-0" />}
                    <span className="flex-1 min-w-0 text-sm text-slate-300 truncate">
                      <b className="tabular-nums">{extra}×</b> {l.card ? cardLang.fullName(l.card) : `pochette n° ${l.cardNumber}`}
                      {l.foil && <span className="foil-text font-semibold"> foil</span>}
                    </span>
                    {l.card && l.needed === 0 && (
                      <button onClick={() => listForSale([{ id: l.id, qty: extra }])} className="text-[11px] text-slate-400 hover:text-white">
                        Garder en vente
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section data-preview-group className="rounded-2xl ring-1 ring-inset p-4 sm:p-5 bg-stone-400/[0.04] ring-stone-300/15">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <h3 className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-stone-300/15 text-stone-200">
              <Package size={16} />
            </span>
            <span>
              Vrac pour les lots
              <span className="block text-xs font-normal text-slate-400">
                {plural(bulkCopies, 'copie')} sous {prices.format(threshold)} · rachat boutique estimé{' '}
                <b className="text-white">{prices.format((bulkCopies / 1000) * rate)}</b>
              </span>
            </span>
          </h3>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Rachat pour 1 000 cartes
            <input
              type="number"
              min="0"
              step="1"
              value={rate}
              onChange={(e) => setPref('bulkRatePerThousand', Math.max(0, Number(e.target.value) || 0))}
              className="field w-20 py-1 text-right tabular-nums"
            />
            €
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {bulkGroups.map((g) => (
            <div key={g.key} className="rounded-xl bg-white/[0.03] px-3 py-2">
              <div className="text-lg font-bold text-white tabular-nums">{g.copies}</div>
              <div className="text-[11px] text-slate-500">{g.label}</div>
            </div>
          ))}
        </div>

        {bulkCopies > 0 && (
          <>
            <div className="rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-white">Composer un lot</span>
                <Segmented
                  label="Taille du lot"
                  value={lot.size}
                  onChange={(size) => setLot((l) => ({ ...l, size }))}
                  options={LOT_SIZES.map((n) => ({ value: n, label: n ? String(n) : 'Tout' }))}
                />
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lot.noDouble}
                    onChange={(e) => setLot((l) => ({ ...l, noDouble: e.target.checked }))}
                    className="w-4 h-4 accent-indigo-500"
                  />
                  Sans double
                </label>
                {BULK_GROUPS.map((g) => (
                  <label key={g.key} className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lot.groups.includes(g.key)}
                      onChange={(e) =>
                        setLot((l) => ({ ...l, groups: e.target.checked ? [...l.groups, g.key] : l.groups.filter((k) => k !== g.key) }))
                      }
                      className="w-4 h-4 accent-indigo-500"
                    />
                    {g.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 mr-auto">
                  <b className="text-white tabular-nums">{lotTotal}</b> cartes · valeur Cardmarket {prices.format(lotCopies.reduce((s, c) => s + c.qty * (c.price ?? 0), 0))}
                </span>
                <CopyButton text={lotTotal ? lotText : ''} label="Texte de l’annonce" toast="Annonce copiée" />
                <button
                  onClick={() =>
                    setWizard({
                      title: `Lot de ${lotTotal} cartes · sortir des fardes`,
                      verb: 'Sors pour le lot',
                      copies: lotCopies,
                      message: (n) => `${plural(n, 'carte du lot retirée', 'cartes du lot retirées')} de tes fardes`,
                    })
                  }
                  disabled={!lotTotal}
                  className="btn-primary px-3 py-1.5"
                >
                  <PackageOpen size={15} /> Sortir ce lot
                </button>
              </div>
              {lotTotal > 0 && (
                <CardGrid
                  items={lotCopies}
                  className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2"
                  render={(c) => (
                    <div key={c.id} className="min-w-0">
                      <CardThumb card={c.card} foil={c.foil} />
                      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500 tabular-nums">
                        <span>
                          {c.card.set}·{c.cardNumber}
                        </span>
                        {c.qty > 1 && <span className="text-white">×{c.qty}</span>}
                      </div>
                    </div>
                  )}
                />
              )}
            </div>

            <button onClick={() => setBulkOpen(!bulkOpen)} aria-expanded={bulkOpen} className="flex items-center gap-1.5 mt-3 text-xs text-slate-400 hover:text-white">
              <ChevronDown size={14} className={`transition-transform ${bulkOpen ? 'rotate-180' : ''}`} />
              Voir les {plural(bulk.length, 'carte')} du vrac
            </button>
            {bulkOpen && (
              <ul className="divide-y divide-white/5 mt-2">
                {[...bulk].sort(bySetNumber).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5">
                    <CardThumb card={c.card} foil={c.foil} className="w-8 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
                      {cardLang.fullName(c.card)}
                      {c.foil && <span className="foil-text font-semibold"> foil</span>}
                    </span>
                    <span className="flex flex-col items-end gap-0.5 text-[11px]">
                      <PocketLink copy={c} />
                      {c.canSwap && (
                        <button
                          onClick={() => setSellFoil(getPocketId(c.binder.id, c.cardNumber), !c.sellsFoil)}
                          className="flex items-center gap-1 text-sky-300/80 hover:text-white"
                          title="Choisir l'exemplaire qui reste dans la pochette"
                        >
                          <Repeat size={10} />
                          {c.sellsFoil ? 'Garder la foil plutôt' : `Vendre la foil plutôt (${prices.format(prices.getPrice(c.card, true))})`}
                        </button>
                      )}
                    </span>
                    <span className="text-sm font-bold text-white tabular-nums">×{c.qty}</span>
                    <span className="w-14 text-right text-xs text-slate-400 tabular-nums">{prices.format(c.price)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <ResaleWizard
        isOpen={Boolean(wizard)}
        onClose={() => setWizard(null)}
        title={wizard?.title}
        verb={wizard?.verb}
        copies={wizard?.copies ?? []}
        binders={binders}
        onComplete={(taken) => takeOut(taken, wizard.message)}
      />
    </div>
  );
};

export default ResaleTab;
