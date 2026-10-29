import { useMemo, useState } from 'react';
import { Menu as MenuIcon, CalendarClock, Layers, Library, Sparkles, ArrowRight, CheckCircle2, Download } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { Panel, CardGrid, Segmented } from '../Collection/CollectionParts';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { usePrices } from '../../hooks/usePrices';
import { useCardLang } from '../../hooks/useCardLang';
import { getInk, getMainPrinting } from '../../utils/catalog';
import { getNextRotation, getDeckSize, describeChapters, formatLongDate } from '../../utils/deckRules';
import { getLorcanaSetName } from '../../data/games';
import { getTradeableSurplus } from '../../utils/trades';
import { getSaleLines, generateSaleCsv } from '../../utils/cardmarketExport';
import { downloadCsv } from '../../utils/csvExport';

const PLAYSET = 4;


const plural = (n, word) => `${n.toLocaleString('fr-BE')} ${word}${n > 1 ? 's' : ''}`;

/** Asks the assistant to replace the cards a deck loses at the rotation. */
const replacementPrompt = (deck, names, rotation) =>
  `${rotation.sets.length > 1 ? 'Les' : 'Le'} ${describeChapters(rotation.sets)} quitte${rotation.sets.length > 1 ? 'nt' : ''} le Core${
    rotation.date ? ` le ${formatLongDate(rotation.date)}` : ' à la prochaine rotation'
  }. Dans mon deck « ${deck.name} » (id ${deck.id}), remplace ${names.length > 1 ? 'les cartes qui partent' : 'la carte qui part'} (${names.join(', ')}) par des cartes qui resteront légales en Core, de préférence des cartes que j'ai déjà. Explique tes choix puis propose la nouvelle liste.`;

const Tile = ({ label, value, hint }) => (
  <div title={hint}>
    <div className="text-base sm:text-lg font-bold tabular-nums leading-tight text-white">{value}</div>
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
  </div>
);

const DeckRow = ({ deck, rotating, index, rotation, onOpen, onAsk }) => {
  const cardLang = useCardLang();
  const size = getDeckSize(deck);
  const copies = rotating.reduce((s, c) => s + c.qty, 0);
  const inks = [...new Set(deck.cards.flatMap((c) => index.byId.get(c.id)?.inks ?? []))];
  const names = rotating.map((c) => cardLang.keyName(c.key, c.name));
  return (
    <div className="rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5 p-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2">
            <span className="flex -space-x-1">
              {inks.map((ink) => (
                <span key={ink} className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-950" style={{ background: getInk(ink).color }} />
              ))}
            </span>
            <span className="text-sm font-semibold text-white truncate">{deck.name}</span>
            {deck.kind === 'reference' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/25">
                Référence
              </span>
            )}
          </div>
          <p className="text-xs text-amber-300/90 mt-0.5">
            {plural(copies, 'carte')} sur {size} quitte{copies > 1 ? 'nt' : ''} le Core ({Math.round((copies / Math.max(1, size)) * 100)} %)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpen} className="btn-secondary px-3 py-1.5 text-xs">
            Ouvrir
            <ArrowRight size={13} />
          </button>
          <button
            onClick={() => onAsk(replacementPrompt(deck, names, rotation))}
            className="btn-secondary px-3 py-1.5 text-xs"
            title="Demander à l'assistant IA des remplaçants légaux après la rotation"
          >
            <Sparkles size={13} className="text-violet-300" />
            Remplacer avec l'IA
          </button>
        </div>
      </div>
      <div data-preview-group className="flex gap-1.5 mt-3 overflow-x-auto scrollbar-thin pb-1">
        {rotating.map((c) => {
          const card = index.byId.get(c.id) ?? getMainPrinting(index, c.key);
          return (
            <div key={c.key} className="relative w-12 flex-shrink-0" title={`${c.qty}× ${cardLang.keyName(c.key, c.name)}`}>
              <CardThumb card={card ?? { fullName: c.name, inks: [] }} />
              <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-slate-950/85 text-[10px] font-bold text-white tabular-nums">
                {c.qty}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** The next Core rotation: decks losing cards and owned cards leaving Core, with their value. */
const RotationView = ({ onOpenSidebar }) => {
  const { decks, deckGroups, listings, sellFoil, setView, prefs, setPref } = useStore();
  const { index } = useCatalog();
  const collection = useCollection();
  const prices = usePrices();
  const cardLang = useCardLang();
  const keep = prefs.tradeKeep ?? 1;
  // Chapters left out of the sale export
  const [excluded, setExcluded] = useState(() => new Set());

  const data = useMemo(() => {
    if (!index) return null;
    const rotation = getNextRotation(index);
    if (!rotation.active) return { rotation };
    const coreDecks = decks.filter((d) => d.format === 'core' && d.cards.length);
    const touched = coreDecks
      .map((deck) => ({ deck, rotating: deck.cards.filter((c) => rotation.leaves(c.key)) }))
      .filter((d) => d.rotating.length)
      .sort((a, b) => b.rotating.reduce((s, c) => s + c.qty, 0) - a.rotating.reduce((s, c) => s + c.qty, 0));
    const cards = [...collection.entries.values()]
      .filter((e) => rotation.leaves(e.key))
      .map((e) => ({
        ...e,
        value: e.copies.reduce(
          (s, c) => s + c.normal * (prices.getPrice(c.card) ?? 0) + c.foil * (prices.getPrice(c.card, true) ?? 0),
          0
        ),
      }))
      .sort((a, b) => b.value - a.value || a.card.fullName.localeCompare(b.card.fullName));
    // Copies to sell: beyond the kept ones, every deck counted (an Infinity deck keeps its copies)
    const groups = new Map();
    for (const item of getTradeableSurplus(collection, decks, keep, prices.getPrice, { groups: deckGroups, listings, sellFoil })) {
      if (!rotation.leaves(item.key)) continue;
      const set = String(item.card.set);
      if (!groups.has(set))
        groups.set(set, {
          set,
          name: getLorcanaSetName(set) ?? item.card.setName ?? '',
          items: [],
        });
      groups.get(set).items.push(item);
    }
    const sale = [...groups.values()]
      .map((g) => ({
        ...g,
        items: g.items.sort(
          (a, b) =>
            parseInt(a.card.number, 10) - parseInt(b.card.number, 10) ||
            a.card.number.localeCompare(b.card.number) ||
            Number(a.foil) - Number(b.foil),
        ),
        copies: g.items.reduce((s, i) => s + i.qty, 0),
        value: g.items.reduce((s, i) => s + i.qty * (i.price ?? 0), 0),
      }))
      .sort((a, b) => a.set.localeCompare(b.set, undefined, { numeric: true }));
    return { rotation, coreDecks, touched, cards, sale };
  }, [index, decks, collection, prices, keep, deckGroups, listings, sellFoil]);

  const header = (
    <header className="px-4 sm:px-6 pt-4 pb-4 border-b border-white/5">
      <div className="flex items-start gap-3">
        <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
          <MenuIcon size={20} />
        </button>
        <div className="flex-1 min-w-0 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/25">
              Core
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">Rotation</h1>
          </div>
          {data?.cards && (
            <div className="flex items-center gap-4 sm:gap-6 text-right">
              <Tile label="date" value={data.rotation.date ? formatLongDate(data.rotation.date) : 'à annoncer'} />
              <Tile label="decks touchés" value={`${data.touched.length}/${data.coreDecks.length}`} hint="Tes decks Core qui perdent des cartes" />
              <Tile label="cartes" value={data.cards.reduce((s, e) => s + e.total, 0).toLocaleString('fr-BE')} hint="Exemplaires de ta collection qui quittent le Core" />
              <Tile
                label="valeur"
                value={prices.status === 'ready' ? prices.format(data.cards.reduce((s, e) => s + e.value, 0)) : '…'}
                hint={`Prix ${prices.source}, foils au prix foil`}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );

  if (!data || !data.cards) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <p className="p-6 text-sm text-slate-500">
          {!data ? 'Chargement du catalogue…' : "Aucune rotation du Core n'est annoncée pour l'instant."}
        </p>
      </div>
    );
  }

  const { rotation, coreDecks, touched, cards, sale } = data;
  const chapters = rotation.sets.map((s) => `${s} · ${getLorcanaSetName(s) ?? ''}`.replace(/ · $/, ''));
  const selected = sale.filter((g) => !excluded.has(g.set)).flatMap((g) => g.items);
  const selectedCopies = selected.reduce((s, i) => s + i.qty, 0);
  const saleText = getSaleLines(selected, index).join('\n');
  const toggleChapter = (set) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(set)) next.delete(set);
      else next.add(set);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 py-5">
        <div className="max-w-6xl mx-auto space-y-4">
          <Panel icon={CalendarClock} title="Chapitres qui quittent le Core">
            <div className="flex flex-wrap gap-1.5">
              {chapters.map((c) => (
                <span key={c} className="px-2 py-1 rounded-md text-xs bg-amber-500/10 text-amber-200 ring-1 ring-inset ring-amber-400/30">
                  {c}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">
              {rotation.date ? `Le ${formatLongDate(rotation.date)}, ` : 'À la prochaine rotation, '}
              leurs cartes ne seront plus jouables en Core, sauf celles réimprimées dans un chapitre qui reste. Elles restent jouables en
              Infinity.
            </p>
          </Panel>

          <Panel
            icon={Layers}
            title="Tes decks Core"
            hint="Les cartes qui partent, deck par deck. L'assistant IA peut proposer des remplaçants parmi tes cartes."
          >
            {coreDecks.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun deck au format Core.</p>
            ) : touched.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 size={15} />
                {coreDecks.length > 1 ? `Tes ${coreDecks.length} decks Core resteront légaux.` : 'Ton deck Core restera légal.'}
              </p>
            ) : (
              <div className="space-y-2">
                {touched.map(({ deck, rotating }) => (
                  <DeckRow
                    key={deck.id}
                    deck={deck}
                    rotating={rotating}
                    index={index}
                    rotation={rotation}
                    onOpen={() => setView({ kind: 'decks', deckId: deck.id })}
                    onAsk={(draft) => setView({ kind: 'assistant', draft })}
                  />
                ))}
                {coreDecks.length > touched.length && (
                  <p className="text-xs text-slate-500 pt-1">
                    {coreDecks.length - touched.length > 1
                      ? `Tes ${coreDecks.length - touched.length} autres decks Core ne perdent aucune carte.`
                      : 'Ton autre deck Core ne perd aucune carte.'}
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel
            icon={Library}
            title="Tes cartes qui quittent le Core"
            hint={`${
              keep >= PLAYSET ? 'Au-delà d’un playset par carte' : 'Au-delà d’un exemplaire gardé en farde'
            }, plus les copies de tes decks (Infinity compris). Coche les chapitres à vendre sur Cardmarket ou ailleurs.`}
            action={
              selected.length > 0 && (
                <div className="flex items-center gap-2">
                  <CopyButton text={saleText} label="Copier" toast="Liste copiée (format Cardmarket)" />
                  <button
                    onClick={() => downloadCsv(generateSaleCsv(selected), 'rotation-a-vendre.csv')}
                    className="btn-secondary px-3 py-1.5"
                    title="Chapitre, numéro, nom, foil, quantité et prix unitaire"
                  >
                    <Download size={15} />
                    CSV
                  </button>
                </div>
              )
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <Segmented
                label="Copies gardées"
                value={keep}
                onChange={(value) => setPref('tradeKeep', value)}
                options={[
                  { value: 1, label: 'Collection · garder 1' },
                  { value: PLAYSET, label: 'Playset · garder 4' },
                ]}
              />
              {sale.length > 0 && (
                <span className="text-xs text-slate-400 tabular-nums">
                  <b className="text-white">{selectedCopies.toLocaleString('fr-BE')}</b> à vendre
                  {prices.status === 'ready' && ` · ${prices.format(selected.reduce((s, i) => s + i.qty * (i.price ?? 0), 0))}`}
                </span>
              )}
            </div>
            {cards.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune carte de ta collection ne quitte le Core.</p>
            ) : sale.length === 0 ? (
              <p className="text-sm text-slate-500">Rien à vendre : tu ne gardes que ce que tu as choisi de conserver.</p>
            ) : (
              <div className="space-y-3">
                {sale.map((g) => {
                  const on = !excluded.has(g.set);
                  return (
                    <div key={g.set} className="rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5">
                      <label className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleChapter(g.set)}
                          className="w-4 h-4 accent-indigo-500"
                        />
                        <span className={`flex-1 min-w-0 truncate text-sm font-semibold ${on ? 'text-white' : 'text-slate-500'}`}>
                          {g.set} · {g.name}
                        </span>
                        <span className="text-xs tabular-nums text-slate-400 whitespace-nowrap">
                          {plural(g.copies, 'carte')}
                          {prices.status === 'ready' && ` · ${prices.format(g.value)}`}
                        </span>
                      </label>
                      {on && (
                        <div data-preview-group className="px-1 pb-2">
                          <CardGrid
                            items={g.items}
                            className="space-y-0.5"
                            render={(i) => (
                              <div key={i.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
                                <CardThumb card={i.card} className="w-8 flex-shrink-0" />
                                <div className="flex-1 min-w-0 text-sm text-slate-200 truncate">
                                  <b className="tabular-nums">{i.qty}×</b> {cardLang.fullName(i.card)}
                                  <span className="text-xs text-slate-500"> · n° {i.card.number}</span>
                                  {i.foil && <span className="foil-text text-xs font-semibold"> · foil</span>}
                                </div>
                                <span className="text-xs tabular-nums text-slate-400">
                                  {i.price ? prices.format(i.qty * i.price) : '—'}
                                </span>
                              </div>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
};

export default RotationView;
