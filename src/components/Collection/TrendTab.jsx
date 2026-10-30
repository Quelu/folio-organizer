import { useMemo, useRef } from 'react';
import { TrendingUp, TrendingDown, FolderSync, AlertTriangle, Download, Upload, Loader2 } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import PriceChange from '../ui/PriceChange';
import { changeTone } from '../ui/changeFormat';
import TrendChart from './TrendChart';
import { Panel, Segmented } from './CollectionParts';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useLorcanaSets } from '../../hooks/useLorcanaSets';
import { usePriceHistory } from '../../hooks/usePriceHistory';
import { usePriceHistoryBackup } from '../../hooks/priceHistoryContext';
import { useToast } from '../ui/toastContext';
import { matchesCard, matchesCopies } from '../../utils/collectionFilters';
import { addMonths, daysBetween, loadMonths, localDay, parseHistory, serializeHistory, seriesChange } from '../../utils/priceHistory';
import { getLorcanaSetName } from '../../data/games';

const PERIODS = [
  { value: 7, label: '7 j', title: 'Une semaine : l’effet d’une sortie de chapitre' },
  { value: 30, label: '1 mois' },
  { value: 90, label: '3 mois' },
  { value: 365, label: '1 an', title: 'Un point par semaine' },
];
const PERIOD_LABELS = { 7: 'sur 7 jours', 30: 'sur 1 mois', 90: 'sur 3 mois', 365: 'sur 1 an' };
const MOVERS = 6;
// Under a euro, a few cents look like huge swings
const MIN_PRICE = 1;

const formatDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });

/** Where the price history is backed up, and the download and import of the whole of it. */
const HistoryBackup = ({ days }) => {
  const backup = usePriceHistoryBackup();
  const notify = useToast();
  const fileRef = useRef(null);

  const download = async () => {
    const blob = new Blob([serializeHistory(await loadMonths())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-prix-historique-${localDay()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file) => {
    try {
      const months = parseHistory(JSON.parse(await file.text()));
      if (!months) throw new Error();
      const added = await addMonths(months);
      notify({ tone: 'success', message: added ? `Historique des prix : ${added} jour(s) ajouté(s)` : 'Historique des prix déjà à jour' });
    } catch {
      notify({ tone: 'error', message: "Ce fichier n'est pas un historique des prix Folio" });
    }
  };

  const choose = async () => {
    if (await backup.choose()) notify({ tone: 'success', message: 'Sauvegarde automatique activée' });
  };

  const warning = (text, action) => (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-amber-300">
      <AlertTriangle size={14} className="flex-shrink-0" />
      {text}
      {action}
    </p>
  );

  return (
    <div className="rounded-xl ring-1 ring-inset ring-white/5 px-4 py-3 text-xs text-slate-400 space-y-2">
      {!backup?.supported
        ? warning('Ce navigateur ne peut pas écrire dans un dossier : télécharge l’historique de temps en temps (Chrome et Edge le sauvegardent tout seuls).')
        : backup.status === 'on'
          ? (
            <p className="flex items-center gap-2">
              <FolderSync size={14} className="flex-shrink-0 text-emerald-400/80" />
              <span>
                Sauvegardé dans « {backup.folderName} », un fichier <code className="text-slate-300">folio-prix-AAAA-MM.json</code> par mois.
                Un navigateur vidé ou un autre ordinateur le retrouve en reprenant ce dossier.
              </span>
            </p>
          )
          : backup.status === 'paused'
            ? warning(
                'Sauvegarde auto en pause : les nouveaux jours ne sont que dans ce navigateur.',
                <button onClick={backup.resume} className="underline hover:text-amber-200">
                  Reprendre
                </button>
              )
            : warning(
                backup.status === 'error' ? 'La sauvegarde auto a échoué.' : 'L’historique n’est que dans ce navigateur.',
                <button onClick={choose} className="underline hover:text-amber-200">
                  Le sauvegarder dans un dossier…
                </button>
              )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {days.length > 0 ? `${days.length} jour${days.length > 1 ? 's' : ''} relevé${days.length > 1 ? 's' : ''} depuis le ${formatDay(days[0].day)}` : 'Aucun relevé pour l’instant'}
        </span>
        <div className="flex gap-1.5">
          <button onClick={download} disabled={!days.length} className="btn-secondary px-2.5 py-1 text-xs">
            <Download size={13} /> Télécharger
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-secondary px-2.5 py-1 text-xs" title="Ajoute les jours d’un historique téléchargé">
            <Upload size={13} /> Importer
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) importFile(file);
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** A card whose price moved, from its price at the start of the period to now. */
const MoverRow = ({ move, format }) => {
  const cardLang = useCardLang();
  const { card } = move.item;
  return (
    <li className="flex items-center gap-3 py-1.5">
      <CardThumb card={card} foil={move.foil} className="w-9 flex-shrink-0" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm text-slate-100 truncate">{cardLang.fullName(card)}</div>
        <div className="text-[11px] text-slate-500 tabular-nums">
          {card.id}
          {move.foil && <span className="foil-text font-semibold"> · foil</span>} · {format(move.from)} → {format(move.to)}
        </div>
      </div>
      <PriceChange ratio={move.ratio} className="text-xs" />
    </li>
  );
};

/**
 * How the value of the collection moved: the owned cards (with the filters) at each day's
 * Cardmarket prices, so adding cards never looks like a rise. By chapter, and the cards that
 * moved most. The history only exists from the first day Folio recorded.
 */
const TrendTab = ({ ctx, prices, onSets }) => {
  const { owned, filters, query } = ctx;
  const { prefs, setPref } = useStore();
  const history = usePriceHistory();
  const chapters = useLorcanaSets();
  const period = prefs.collectionTrendPeriod ?? 30;

  const items = useMemo(
    () => [...owned.values()].filter((item) => matchesCard(item.card, filters, query, ctx) && matchesCopies(item, filters)),
    [owned, filters, query, ctx]
  );

  const trend = useMemo(() => {
    if (history.status !== 'ready') return null;
    const points = history.points(period);
    if (points.length < 2) return { points };
    const values = history.valueSeries(items, points);
    const series = points.map((i, k) => ({ day: history.days[i].day, value: values[k] }));

    const bySet = new Map();
    for (const item of items) bySet.set(item.card.set, [...(bySet.get(item.card.set) ?? []), item]);
    const sets = [...bySet]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([set, list]) => ({ set, change: seriesChange(history.valueSeries(list, points)) }))
      .filter((s) => s.change?.ratio != null);

    const moves = items.flatMap((item) => {
      const foil = item.normal === 0;
      const change = seriesChange(history.priceSeries(item.card, foil, points));
      return change?.ratio && Math.max(change.from, change.to) >= MIN_PRICE ? [{ item, foil, ...change }] : [];
    });
    return {
      points,
      series,
      change: seriesChange(values),
      sets,
      up: moves.filter((m) => m.ratio > 0).sort((a, b) => b.ratio - a.ratio).slice(0, MOVERS),
      down: moves.filter((m) => m.ratio < 0).sort((a, b) => a.ratio - b.ratio).slice(0, MOVERS),
    };
  }, [history, period, items]);

  if (history.status === 'loading' || !trend) {
    return history.status === 'unavailable' ? (
      <p className="text-sm text-slate-500 text-center py-16">Le suivi des prix s’appuie sur Cardmarket, injoignable pour l’instant.</p>
    ) : (
      <div className="flex justify-center py-16 text-slate-500">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const days = history.days;
  if (trend.points.length < 2) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto py-8">
        <div className="text-center space-y-2">
          <TrendingUp size={28} className="mx-auto text-indigo-300" />
          <p className="text-sm text-slate-300">
            {days.length ? `Premier relevé des prix le ${formatDay(days[days.length - 1].day)}.` : 'Les prix du jour sont en cours de relevé.'}
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Cardmarket ne publie que les prix du jour : Folio les relève chaque jour où il est ouvert, et la courbe se dessine à partir
            du deuxième jour. 7 jours suffisent pour voir l’effet d’une sortie de chapitre.
          </p>
        </div>
        <HistoryBackup days={days} />
      </div>
    );
  }

  const firstDay = days[trend.points[0]].day;
  const lastDay = days[trend.points[trend.points.length - 1]].day;
  // History shorter than the period: say where it really starts
  const sinceFirst = trend.points[0] === 0 && daysBetween(firstDay, lastDay) < period;
  const markers = chapters
    .filter((s) => s.releasedAt && s.releasedAt.slice(0, 10) >= firstDay && s.releasedAt.slice(0, 10) <= lastDay)
    .map((s) => ({ day: s.releasedAt.slice(0, 10), label: `Ch. ${s.code}` }));
  const { change } = trend;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Période" options={PERIODS} value={period} onChange={(value) => setPref('collectionTrendPeriod', value)} />
        <p className="text-xs text-slate-500">
          <b className="text-slate-300 tabular-nums">{items.length}</b> carte{items.length > 1 ? 's' : ''} · prix {prices.source}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-16">Aucune carte ne correspond à ces filtres.</p>
      ) : (
        <>
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-bold text-white tabular-nums">{prices.format(change.to)}</span>
              <span className={`text-sm tabular-nums ${changeTone(change.ratio)}`}>
                {change.diff >= 0 ? '+' : '−'}
                {prices.format(Math.abs(change.diff))}
              </span>
              <PriceChange ratio={change.ratio} className="text-sm" />
              <span className="text-xs text-slate-500">{sinceFirst ? `depuis le premier relevé, le ${formatDay(firstDay)}` : PERIOD_LABELS[period]}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Tes cartes actuelles aux prix de chaque jour : en ajouter ne fait pas monter la courbe.</p>
          </div>

          <TrendChart points={trend.series} markers={markers} format={prices.format} />

          {(trend.sets.length > 1 || filters.sets.length === 1) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500 mr-1">Par chapitre</span>
              {trend.sets.map(({ set, change: c }) => {
                const active = filters.sets.length === 1 && filters.sets[0] === set;
                return (
                  <button
                    key={set}
                    onClick={() => onSets(active ? [] : [set])}
                    aria-pressed={active}
                    title={`${getLorcanaSetName(set) ?? `Chapitre ${set}`} : ${prices.format(c.from)} → ${prices.format(c.to)}`}
                    className={`px-2 py-1 rounded-md text-xs ring-1 ring-inset transition-colors ${
                      active ? 'bg-indigo-500/15 ring-indigo-400/40 text-white' : 'ring-white/10 text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    Ch. {set} <PriceChange ratio={c.ratio} />
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel icon={TrendingUp} title="Plus fortes hausses" hint={`Cartes d’au moins ${prices.format(MIN_PRICE)}`}>
              {trend.up.length ? (
                <ul className="divide-y divide-white/[0.04]">
                  {trend.up.map((m) => (
                    <MoverRow key={m.item.card.id} move={m} format={prices.format} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Aucune hausse sur la période.</p>
              )}
            </Panel>
            <Panel icon={TrendingDown} title="Plus fortes baisses" hint={`Cartes d’au moins ${prices.format(MIN_PRICE)}`}>
              {trend.down.length ? (
                <ul className="divide-y divide-white/[0.04]">
                  {trend.down.map((m) => (
                    <MoverRow key={m.item.card.id} move={m} format={prices.format} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Aucune baisse sur la période.</p>
              )}
            </Panel>
          </div>
        </>
      )}

      <HistoryBackup days={days} />
    </div>
  );
};

export default TrendTab;
