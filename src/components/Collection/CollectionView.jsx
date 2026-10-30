import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu as MenuIcon, Loader2, RotateCcw, Search, SlidersHorizontal, X, LayoutGrid, Sparkles, Layers, Coins, Heart, ChartLine } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { useCardLang } from '../../hooks/useCardLang';
import { usePrices } from '../../hooks/usePrices';
import { usePriceHistory } from '../../hooks/usePriceHistory';
import { daysBetween, seriesChange } from '../../utils/priceHistory';
import { getDeckUsage } from '../../utils/collection';
import {
  EMPTY_FILTERS,
  countFilters,
  getOwnedPrintings,
  getPocketPrintings,
  matchesCard,
  matchesCopies,
  pickFilters,
  sortItems,
} from '../../utils/collectionFilters';
import FilterPanel, { ActiveFilters } from './FilterPanel';
import CardsExplorer from './CardsExplorer';
import { CompletionTab, PlaysetsTab } from './ToolTabs';
import ResaleTab from './ResaleTab';
import WantListTab from './WantListTab';
import TrendTab from './TrendTab';
import PriceChange from '../ui/PriceChange';

const CARD_FILTERS = ['sets', 'inks', 'costs', 'rarities', 'types', 'inkwell', 'core'];
const ALL_FILTERS = Object.keys(EMPTY_FILTERS);
// Owned copies filters make no sense for cards nobody owns
const MISSING_FILTERS = [...CARD_FILTERS, 'decks'];

/** Tabs of the collection; filters: the ones each tab uses (the text search applies everywhere). */
const TABS = [
  { key: 'cards', label: 'Cartes', icon: LayoutGrid, filters: ALL_FILTERS },
  { key: 'completion', label: 'Complétion', icon: Sparkles, filters: CARD_FILTERS },
  { key: 'playsets', label: 'Playsets', icon: Layers, filters: CARD_FILTERS },
  { key: 'wants', label: 'Want list', icon: Heart, filters: [...CARD_FILTERS, 'decks', 'binders'] },
  { key: 'resale', label: 'Revente', icon: Coins, filters: [...CARD_FILTERS, 'foil', 'binders'] },
  { key: 'trend', label: 'Cote', icon: ChartLine, filters: ALL_FILTERS },
];

// The price change shown beside the value and sorted on in the explorer
const TREND_DAYS = 30;

const DEFAULT_EXPLORER = { mode: 'owned', sort: 'number', reverse: false, group: 'none', layout: 'grid', size: 'm' };

const unitPrice = (prices, card) => prices.getPrice(card, false) ?? prices.getPrice(card, true);
const copiesValue = (prices, item) =>
  item.normal * (prices.getPrice(item.card, false) ?? 0) + item.foil * (prices.getPrice(item.card, true) ?? 0);

const formatSets = (sets) => (sets.length > 4 ? `${sets.slice(0, 4).join(', ')}…` : sets.join(', '));

/**
 * The whole collection: an explorer of the owned (or missing) cards with filters on the side,
 * and the collection tools (completion, playsets, doubles, deck needs) as tabs sharing them.
 */
const CollectionView = ({ onOpenSidebar }) => {
  const { binders, decks: allDecks, prefs, setPref, view, setView } = useStore();
  const { index, status, loaded, total, refresh } = useCatalog();
  const collection = useCollection();
  const cardLang = useCardLang();
  const prices = usePrices();
  const history = usePriceHistory();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const [filtersOpen, setFiltersOpen] = useState(false);

  const tab = TABS.find((t) => t.key === view.tab) ?? TABS[0];
  const setTab = (key) => setView({ kind: 'stats', tab: key });
  const explorer = { ...DEFAULT_EXPLORER, ...prefs.collectionExplorer };
  const setExplorer = (changes) => setPref('collectionExplorer', { ...explorer, ...changes });
  const filters = useMemo(() => ({ ...EMPTY_FILTERS, ...prefs.collectionFilters }), [prefs.collectionFilters]);
  const setFilters = (next) => setPref('collectionFilters', next);

  const applicable = tab.key === 'cards' && explorer.mode === 'missing' ? MISSING_FILTERS : tab.filters;
  const tabFilters = useMemo(() => pickFilters(filters, applicable), [filters, applicable]);

  const decks = useMemo(() => allDecks.filter((d) => d.kind !== 'reference'), [allDecks]);
  const lorcanaBinders = useMemo(() => binders.filter((b) => b.gameType === 'lorcana' && b.setCode), [binders]);
  const collectedSets = useMemo(
    () => [...new Set(lorcanaBinders.map((b) => b.setCode))].sort((a, b) => Number(a) - Number(b)),
    [lorcanaBinders]
  );
  // Chapters to list cards from: the chosen ones, else the ones the user has a binder for
  const scopeSets = useMemo(
    () => (filters.sets.length ? [...filters.sets].sort((a, b) => Number(a) - Number(b)) : collectedSets),
    [filters.sets, collectedSets]
  );
  const usage = useMemo(() => getDeckUsage(decks), [decks]);
  const owned = useMemo(() => getOwnedPrintings(collection), [collection]);

  const ctx = useMemo(
    () => ({ index, usage, owned, collection, decks, scopeSets, filters: tabFilters, query }),
    [index, usage, owned, collection, decks, scopeSets, tabFilters, query]
  );

  const setCounts = useMemo(() => {
    if (!index) return {};
    const counts = Object.fromEntries(index.sets.map((s) => [s, { owned: 0, total: getPocketPrintings(index, s).length }]));
    for (const item of owned.values()) if (counts[item.card.set]) counts[item.card.set].owned++;
    return counts;
  }, [index, owned]);

  const summary = useMemo(() => {
    let copies = 0;
    let foils = 0;
    let value = 0;
    for (const item of owned.values()) {
      copies += item.total;
      foils += item.foil;
      value += copiesValue(prices, item);
    }
    return { cards: collection.entries.size, copies, foils, value };
  }, [owned, collection, prices]);

  // Points of the last 30 days of the price history: two at least to tell a change
  const trendPoints = useMemo(() => (history.status === 'ready' ? history.points(TREND_DAYS) : []), [history]);

  /** The collection's value change over the last 30 days, or since the first recorded day. */
  const valueTrend = useMemo(() => {
    if (trendPoints.length < 2) return null;
    const change = seriesChange(history.valueSeries([...owned.values()], trendPoints));
    const span = daysBetween(history.days[trendPoints[0]].day, history.days[trendPoints[trendPoints.length - 1]].day);
    return change?.ratio == null ? null : { ...change, span };
  }, [history, trendPoints, owned]);

  const results = useMemo(() => {
    if (!index || tab.key !== 'cards') return { items: [], copies: 0, foils: 0, value: 0 };
    const source =
      explorer.mode === 'owned'
        ? [...owned.values()]
        : scopeSets.flatMap((set) =>
            getPocketPrintings(index, set)
              .filter((card) => explorer.mode === 'all' || !owned.has(card.id))
              .map(
                (card) =>
                  owned.get(card.id) ?? {
                    card,
                    key: card.key,
                    normal: 0,
                    foil: 0,
                    total: 0,
                    keyTotal: collection.entries.get(card.key)?.total ?? 0,
                    copies: [],
                  }
              )
          );
    const items = source
      .filter((item) => matchesCard(item.card, tabFilters, query, ctx) && matchesCopies(item, tabFilters))
      .map((item) => ({
        ...item,
        price: unitPrice(prices, item.card),
        change: trendPoints.length > 1 ? (seriesChange(history.priceSeries(item.card, item.total > 0 && item.normal === 0, trendPoints))?.ratio ?? null) : null,
      }));
    let copies = 0;
    let foils = 0;
    let value = 0;
    for (const item of items) {
      copies += item.total;
      foils += item.foil;
      value += explorer.mode === 'missing' ? (item.price ?? 0) : copiesValue(prices, item);
    }
    return { items: sortItems(items, explorer.sort, explorer.reverse, { name: cardLang.fullName }), copies, foils, value };
  }, [index, tab.key, explorer.mode, explorer.sort, explorer.reverse, owned, scopeSets, collection, tabFilters, query, ctx, prices, cardLang, history, trendPoints]);

  // Back to the top when the results change, not left in the middle of another list
  const scrollRef = useRef(null);
  const resetKey = JSON.stringify([tab.key, tabFilters, query, explorer.mode, explorer.sort, explorer.reverse, explorer.group]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  const usesScope = (tab.key === 'cards' && explorer.mode !== 'owned') || tab.key === 'completion' || tab.key === 'playsets';
  const scopeHint =
    usesScope && !filters.sets.length && collectedSets.length > 0 ? `chapitres de tes fardes : ${formatSets(collectedSets)}` : null;
  const activeCount = countFilters(tabFilters);

  const exploreMissing = (patch) => {
    setPref('collectionFilters', { ...filters, ...patch });
    setPref('collectionExplorer', { ...explorer, mode: 'missing' });
    setTab('cards');
  };

  const panelProps = {
    filters,
    onChange: setFilters,
    applicable,
    sets: index?.sets ?? [],
    setCounts,
    collectedSets,
    decks,
    binders: lorcanaBinders,
  };

  const renderTab = () => {
    if (usesScope && scopeSets.length === 0) {
      return (
        <p className="text-sm text-slate-500 text-center py-16">
          Choisis un ou plusieurs chapitres dans les filtres pour voir leurs cartes.
        </p>
      );
    }
    switch (tab.key) {
      case 'completion':
        return <CompletionTab ctx={ctx} onExploreMissing={exploreMissing} />;
      case 'playsets':
        return <PlaysetsTab ctx={ctx} />;
      case 'resale':
        return <ResaleTab ctx={ctx} prices={prices} />;
      case 'trend':
        return <TrendTab ctx={ctx} prices={prices} onSets={(sets) => setFilters({ ...filters, sets })} />;
      case 'wants':
        return <WantListTab ctx={ctx} prices={prices} onOpenDeck={(deckId) => setView({ kind: 'decks', deckId })} />;
      default:
        return (
          <CardsExplorer
            explorer={explorer}
            onExplorer={setExplorer}
            results={results}
            resetKey={resetKey}
            scopeHint={scopeHint}
            usage={usage}
            prices={prices}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 sm:px-6 pt-4 border-b border-white/5">
        <div className="flex items-start gap-3">
          <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
            <MenuIcon size={20} />
          </button>
          <div className="flex-1 min-w-0 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/25">
                Lorcana
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">Collection</h1>
            </div>
            {index && summary.copies > 0 && (
              <div className="flex items-center gap-4 sm:gap-6 text-right">
                {[
                  { label: 'cartes', value: summary.cards.toLocaleString('fr-BE') },
                  { label: 'exemplaires', value: summary.copies.toLocaleString('fr-BE') },
                  { label: 'foils', value: summary.foils.toLocaleString('fr-BE'), foil: true },
                  {
                    label: 'valeur',
                    value: prices.status === 'ready' ? prices.format(summary.value) : '…',
                    title: valueTrend
                      ? `Prix ${prices.source}, foils au prix foil · ${prices.format(valueTrend.from)} il y a ${valueTrend.span} j : voir la cote`
                      : `Prix ${prices.source}, foils au prix foil`,
                    trend: valueTrend,
                  },
                ].map((s) => {
                  const Stat = s.trend ? 'button' : 'div';
                  return (
                    <Stat
                      key={s.label}
                      title={s.title}
                      {...(s.trend && { type: 'button', onClick: () => setTab('trend') })}
                      className={`${s.foil && !summary.foils ? 'hidden' : ''} ${s.trend ? 'text-right rounded-md -mx-1.5 px-1.5 hover:bg-white/[0.04] transition-colors' : ''}`}
                    >
                      <div className={`text-base sm:text-lg font-bold tabular-nums leading-tight ${s.foil ? 'foil-text' : 'text-white'}`}>
                        {s.value}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        {s.label}
                        {s.trend && <PriceChange ratio={s.trend.ratio} suffix={`${s.trend.span} j`} className="ml-1.5 normal-case tracking-normal" />}
                      </div>
                    </Stat>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <nav className="flex gap-1 mt-3 -mb-px overflow-x-auto scrollbar-thin" role="tablist" aria-label="Outils de la collection">
          {TABS.map((t) => {
            const active = t.key === tab.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`relative flex items-center gap-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                  active ? 'text-white' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <t.icon size={15} className={active ? 'text-indigo-300' : ''} />
                {t.label}
                {active && (
                  <motion.span
                    layoutId="collection-tab"
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-400"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {lorcanaBinders.length === 0 ? (
        <p className="text-sm text-slate-500 text-center mt-10 px-6">
          Crée une farde Lorcana liée à un chapitre pour explorer ta collection.
        </p>
      ) : !index ? (
        <div className="flex flex-col items-center gap-3 mt-10 text-sm text-slate-400">
          {status === 'error' ? (
            <>
              <p>Impossible de charger le catalogue des cartes depuis Lorcast.</p>
              <button onClick={refresh} className="btn-secondary">
                <RotateCcw size={15} />
                Réessayer
              </button>
            </>
          ) : (
            <span className="flex items-center gap-2.5">
              <Loader2 size={16} className="animate-spin" />
              Chargement du catalogue… {total > 0 && `${loaded}/${total} chapitres`}
            </span>
          )}
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <aside className="hidden xl:flex flex-col w-64 flex-shrink-0 border-r border-white/5">
            <div className="px-4 pt-4 pb-1 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Filtres</span>
              {activeCount > 0 && (
                <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-[11px] text-slate-500 hover:text-white">
                  Tout effacer
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin pb-6">
              <FilterPanel {...panelProps} />
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 sm:px-6 pt-4 pb-3 space-y-2.5">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nom FR ou EN, classe, capacité… (ex. elsa, princesse, 12-42)"
                    className="field pl-9 py-2"
                    aria-label="Chercher dans la collection"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="btn-icon p-1 absolute right-1.5 top-1/2 -translate-y-1/2"
                      aria-label="Effacer la recherche"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button onClick={() => setFiltersOpen(true)} className="btn-secondary xl:hidden px-3 py-2">
                  <SlidersHorizontal size={15} />
                  <span className="hidden sm:inline">Filtres</span>
                  {activeCount > 0 && (
                    <span className="px-1.5 rounded-full bg-indigo-500 text-white text-[11px] font-bold tabular-nums">{activeCount}</span>
                  )}
                </button>
              </div>
              <ActiveFilters filters={filters} onChange={setFilters} applicable={applicable} decks={decks} binders={lorcanaBinders} />
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 pb-10">
              {renderTab()}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {filtersOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFiltersOpen(false)}
              className="xl:hidden fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="xl:hidden fixed inset-y-0 right-0 z-40 w-[85vw] max-w-xs flex flex-col bg-slate-950 border-l border-white/5"
              aria-label="Filtres"
            >
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="font-semibold text-white">Filtres</span>
                <div className="flex items-center gap-1">
                  {activeCount > 0 && (
                    <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-slate-500 hover:text-white px-2">
                      Tout effacer
                    </button>
                  )}
                  <button onClick={() => setFiltersOpen(false)} className="btn-icon" aria-label="Fermer les filtres">
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <FilterPanel {...panelProps} />
              </div>
              <div className="p-3 border-t border-white/5">
                <button onClick={() => setFiltersOpen(false)} className="btn-primary w-full">
                  {tab.key === 'cards' ? `Voir ${results.items.length} carte${results.items.length > 1 ? 's' : ''}` : 'Appliquer'}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CollectionView;
