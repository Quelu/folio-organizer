import { useMemo, useState } from 'react';
import { Menu as MenuIcon, Loader2, Minus, Plus, Scale, Search } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { usePrices } from '../../hooks/usePrices';
import { baseNumber, findPocketCard, matchesQuery, SPECIAL_RARITIES } from '../../utils/catalog';
import { analyzeDeck } from '../../utils/deckRules';
import { getTradeableSurplus, buildTradeText, BULK_PRICE } from '../../utils/trades';
import { getLorcanaSetName } from '../../data/games';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { useCardLang } from '../../hooks/useCardLang';
import { useCopyAllocation } from '../../hooks/useCopyAllocation';

const total = (items, selection) => items.reduce((s, i) => s + (i.price ?? 0) * (selection[i.id] ?? 0), 0);

/**
 * Picks surplus copies worth about the target: the most valuable ones that fit first, then single
 * copies added or removed while that brings the total closer.
 */
const balance = (haves, target) => {
  const pool = haves.filter((h) => h.price != null && h.price >= BULK_PRICE).sort((a, b) => b.price - a.price);
  const selection = {};
  let sum = 0;
  for (const h of pool) {
    while ((selection[h.id] ?? 0) < h.qty && sum + h.price <= target * 1.02) {
      selection[h.id] = (selection[h.id] ?? 0) + 1;
      sum += h.price;
    }
  }
  for (let step = 0; step < 50; step++) {
    let best = null;
    let bestDiff = Math.abs(sum - target);
    for (const h of pool) {
      const count = selection[h.id] ?? 0;
      if (count < h.qty && Math.abs(sum + h.price - target) < bestDiff) {
        best = { h, delta: 1 };
        bestDiff = Math.abs(sum + h.price - target);
      }
      if (count > 0 && Math.abs(sum - h.price - target) < bestDiff) {
        best = { h, delta: -1 };
        bestDiff = Math.abs(sum - h.price - target);
      }
    }
    if (!best) break;
    selection[best.h.id] = (selection[best.h.id] ?? 0) + best.delta;
    sum += best.h.price * best.delta;
  }
  return Object.fromEntries(Object.entries(selection).filter(([, n]) => n > 0));
};

/** One card of a list, with a checkbox and a copy stepper when there are several. */
const Row = ({ item, selected, onChange, format }) => {
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

/** A searchable, selectable card list with its total. */
const Panel = ({ title, hint, items, selection, onSelect, format, empty, actions }) => {
  const [query, setQuery] = useState('');
  const shown = items.filter((i) => matchesQuery(i.card, query));
  const count = items.reduce((s, i) => s + (selection[i.id] ?? 0), 0);

  return (
    <section data-preview-group className="rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-3 sm:p-4 flex flex-col min-h-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="text-xs text-slate-400 tabular-nums">
          {count} carte{count > 1 ? 's' : ''} · <b className="text-white">{format(total(items, selection))}</b>
        </span>
      </div>
      {hint && <p className="text-xs text-slate-500 mb-3">{hint}</p>}
      {actions}
      {items.length > 8 && (
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer…"
            className="field pl-8 py-2"
          />
        </div>
      )}
      {items.length > 0 && (
        <div className="flex gap-3 mb-1 px-2 text-[11px]">
          <button
            onClick={() => onSelect(Object.fromEntries(shown.map((i) => [i.id, i.qty])))}
            className="text-indigo-300 hover:text-white"
          >
            Tout
          </button>
          <button onClick={() => onSelect({})} className="text-slate-500 hover:text-white">
            Aucune
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">{empty}</p>
      ) : (
        <ul className="space-y-0.5 overflow-y-auto scrollbar-thin max-h-[55vh] -mx-1 px-1">
          {shown.map((item) => (
            <Row
              key={item.id}
              item={item}
              selected={selection[item.id] ?? 0}
              onChange={(n) => onSelect({ ...selection, [item.id]: n })}
              format={format}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

/** Equal-value trades: missing cards of a binder or deck against the user's surplus copies. */
const TradesView = ({ onOpenSidebar }) => {
  const { binders, decks, prefs, setPref } = useStore();
  const cardLang = useCardLang();
  const { availableFor } = useCopyAllocation();
  const { index } = useCatalog();
  const collection = useCollection();
  const { status, getPrice, format, source: priceSource } = usePrices();
  const keep = prefs.tradeKeep ?? 1;

  const lorcanaBinders = binders.filter((b) => b.gameType === 'lorcana' && b.setCode);
  const myDecks = decks.filter((d) => d.kind !== 'reference');
  const [source, setSource] = useState(() =>
    lorcanaBinders[0]
      ? { kind: 'binder', id: lorcanaBinders[0].id }
      : myDecks[0]
        ? { kind: 'deck', id: myDecks[0].id }
        : null
  );
  const [withSpecials, setWithSpecials] = useState(false);
  const [wanted, setWanted] = useState({});
  const [offered, setOffered] = useState({});

  const changeSource = (next) => {
    setSource(next);
    setWanted({});
  };

  const wants = useMemo(() => {
    if (!index || !source) return [];
    if (source.kind === 'binder') {
      const binder = binders.find((b) => b.id === source.id);
      const setCards = binder && index.bySet.get(binder.setCode);
      if (!setCards) return [];
      const lastRegular = Math.max(
        0,
        ...setCards.filter((c) => !SPECIAL_RARITIES.includes(c.rarity)).map((c) => baseNumber(c.number))
      );
      const lastNumber = withSpecials
        ? Math.max(binder.setSize ?? 0, ...setCards.map((c) => baseNumber(c.number)))
        : (binder.setSize ?? lastRegular);
      const items = [];
      for (let n = 1; n <= lastNumber; n++) {
        if (binder.cards[String(n)]) continue;
        const card = findPocketCard(index, binder.setCode, n);
        if (!card || (!withSpecials && SPECIAL_RARITIES.includes(card.rarity))) continue;
        items.push({ id: card.id, card, foil: false, qty: 1, price: getPrice(card, false) });
      }
      return items;
    }
    const deck = decks.find((d) => d.id === source.id);
    if (!deck) return [];
    return analyzeDeck(deck, index, collection, 'en', availableFor)
      .missing.filter((e) => e.card)
      .map((e) => ({ id: e.card.id, card: e.card, foil: false, qty: e.missing, price: getPrice(e.card, false) }));
  }, [index, source, binders, decks, collection, withSpecials, getPrice, availableFor]);

  const haves = useMemo(
    () => (status === 'ready' ? getTradeableSurplus(collection, decks, keep, getPrice) : []),
    [status, collection, decks, keep, getPrice]
  );

  const wantTotal = total(wants, wanted);
  const offerTotal = total(haves, offered);
  const diff = offerTotal - wantTotal;
  const picked = (items, selection) =>
    items
      .filter((i) => selection[i.id] > 0)
      .map((i) => ({ card: i.card, foil: i.foil, qty: selection[i.id], price: i.price }));

  const sourceValue = source ? `${source.kind}:${source.id}` : '';

  return (
    <div className="flex flex-col h-full relative">
      <header className="px-4 sm:px-6 pt-4 pb-3">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start gap-3">
            <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
              <MenuIcon size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
                Lorcana
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">Échanges</h1>
            </div>
          </div>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            Choisis les cartes que tu cherches et tes doubles à proposer : Folio équilibre les deux côtés et prépare un
            message à envoyer.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 pb-28">
        <div className="max-w-5xl mx-auto space-y-4">
          {!index ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Chargement du catalogue de cartes…
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={sourceValue}
                  onChange={(e) => {
                    const [kind, id] = e.target.value.split(':');
                    changeSource({ kind, id });
                  }}
                  className="field w-auto py-2 pr-8"
                  aria-label="Cartes recherchées"
                >
                  {!source && <option value="">Aucune source</option>}
                  {lorcanaBinders.length > 0 && (
                    <optgroup label="Manquantes d'une farde">
                      {lorcanaBinders.map((b) => (
                        <option key={b.id} value={`binder:${b.id}`}>
                          {b.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {myDecks.length > 0 && (
                    <optgroup label="Manquantes d'un deck">
                      {myDecks.map((d) => (
                        <option key={d.id} value={`deck:${d.id}`}>
                          {d.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <div className="flex items-center rounded-lg ring-1 ring-inset ring-white/10 p-0.5" role="group" aria-label="Exemplaires gardés">
                  {[
                    { n: 1, label: 'Garder 1' },
                    { n: 4, label: 'Garder 4 (playset)' },
                  ].map(({ n, label }) => (
                    <button
                      key={n}
                      onClick={() => {
                        setPref('tradeKeep', n);
                        setOffered({});
                      }}
                      aria-pressed={keep === n}
                      className={`px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                        keep === n ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {!source ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  Crée une farde Lorcana ou un deck pour chercher des cartes à échanger.
                </p>
              ) : (
                <div className="grid lg:grid-cols-2 gap-4 items-start">
                  <Panel
                    title="Je cherche"
                    hint={source.kind === 'binder' ? 'Cartes absentes de la farde.' : 'Cartes du deck qui te manquent.'}
                    items={wants}
                    selection={wanted}
                    onSelect={setWanted}
                    format={format}
                    empty="Rien ne manque ici 🎉"
                    actions={
                      source.kind === 'binder' && (
                        <label className="flex items-center gap-2 mb-2 text-xs text-slate-400 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={withSpecials}
                            onChange={(e) => {
                              setWithSpecials(e.target.checked);
                              setWanted({});
                            }}
                            className="w-3.5 h-3.5 accent-indigo-500"
                          />
                          Inclure Épiques, Enchantées et Iconiques
                        </label>
                      )
                    }
                  />
                  <Panel
                    title="Je propose"
                    hint={`Tes doubles : au-delà de ${keep} exemplaire${keep > 1 ? 's' : ''} par carte, cartes de tes decks exclues.`}
                    items={haves}
                    selection={offered}
                    onSelect={setOffered}
                    format={format}
                    empty={status === 'loading' ? 'Chargement des prix…' : "Pas de doubles à échanger pour l'instant."}
                  />
                </div>
              )}

              <p className="text-[11px] text-slate-600">
                {priceSource === 'Cardmarket'
                  ? 'Prix Cardmarket (tendance), en euros.'
                  : 'Cardmarket injoignable : prix Lorcast (TCGplayer) en dollars, à prendre comme ordre de grandeur.'}
              </p>
            </>
          )}
        </div>
      </div>

      {source && index && (
        <div className="absolute inset-x-0 bottom-0 px-4 sm:px-6 pb-4 pointer-events-none">
          <div className="surface max-w-5xl mx-auto rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 pointer-events-auto">
            <div className="text-sm tabular-nums">
              <span className="text-slate-500">Je cherche</span> <b className="text-white">{format(wantTotal)}</b>
              <span className="text-slate-600 mx-2">·</span>
              <span className="text-slate-500">Je propose</span> <b className="text-white">{format(offerTotal)}</b>
            </div>
            {wantTotal + offerTotal > 0 && (
              <span
                className={`text-xs font-semibold tabular-nums ${
                  Math.abs(diff) <= Math.max(wantTotal, offerTotal) * 0.05 ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {Math.abs(diff) <= Math.max(wantTotal, offerTotal) * 0.05
                  ? 'Équilibré'
                  : diff > 0
                    ? `Tu donnes ${format(diff)} de plus`
                    : `Il manque ${format(-diff)} de ton côté`}
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => setOffered(balance(haves, wantTotal))}
                disabled={wantTotal === 0 || haves.length === 0}
                className="btn-secondary px-3 py-1.5"
              >
                <Scale size={15} />
                Équilibrer
              </button>
              <CopyButton
                text={
                  wantTotal + offerTotal > 0 ? buildTradeText(picked(wants, wanted), picked(haves, offered), format, cardLang.fullName) : ''
                }
                label="Copier la proposition"
                toast="Proposition d'échange copiée"
                className="btn-primary px-3 py-1.5"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradesView;
