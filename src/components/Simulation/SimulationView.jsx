import { useMemo, useState } from 'react';
import { Menu as MenuIcon, ArrowLeft, FlaskConical, Play, Square, ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';
import { Panel, Segmented } from '../Collection/CollectionParts';
import ProgressBar from '../ui/ProgressBar';
import SimulationResults from './SimulationResults';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useSimulation, MAX_GAMES } from '../../hooks/useSimulation';
import { useCardAbilities } from '../../hooks/useCardAbilities';
import { analyzeDeck, MIN_DECK_SIZE } from '../../utils/deckRules';
import { getInk, localizeCard } from '../../utils/catalog';
import { keywordLabel } from '../../utils/deckProfile';
import { detectStyle, prepareSimDeck } from '../../utils/simulation/deck';
import { STYLES, styleLabel } from '../../utils/simulation/pilots';
import { winRate } from '../../utils/simulation/stats';
import { SERIES, formatNumber, formatPoints } from './shared';

// Games needed at most (an even match, near 50 %): a lopsided one gets there sooner
const PRECISIONS = [
  {
    value: 0.05,
    label: '± 5 pts',
    title: 'Environ 400 parties',
    help: "environ 400 parties, en une seconde ou deux. Assez pour voir lequel des deux decks est favori quand l'écart est net.",
  },
  {
    value: 0.03,
    label: '± 3 pts',
    title: 'Environ 1 000 parties',
    help: "environ 1 000 parties, en quelques secondes. Sépare un match à 55 % d'un match à 62 %.",
  },
  {
    value: 0.02,
    label: '± 2 pts',
    title: 'Environ 2 500 parties',
    help: "environ 2 500 parties, de quelques secondes à une dizaine. Le bon compromis pour comparer deux versions d'un deck.",
  },
  {
    value: 0.01,
    label: '± 1 pt',
    title: 'Environ 10 000 parties',
    help: "environ 10 000 parties, jusqu'à une demi-minute selon les decks. Pour départager deux decks très proches ou mesurer l'effet d'une seule carte.",
  },
];

const IGNORED = { action: 'action : encrée seulement', item: 'objet : encré seulement', ability: 'capacités inconnues, stats jouées' };

/** Why a card is not fully played: what is left out of it. */
const ignoredLabel = (x, lang) =>
  x.reason === 'partial' ? `sans ${x.unsupported.map((name) => keywordLabel(name, lang)).join(', ')}` : IGNORED[x.reason];

/** A deck ready to simulate: its analysis, style and prepared cards with the abilities the engine plays. */
const useSimDeck = (deck, index, lang, abilities) =>
  useMemo(() => {
    if (!deck || !index || !abilities) return null;
    const analysis = analyzeDeck(deck, index, null, lang);
    const inks = [...new Set(analysis.entries.flatMap((e) => e.card?.inks ?? []))];
    return {
      deck,
      inks,
      total: analysis.total,
      detected: detectStyle(analysis),
      sim: prepareSimDeck(analysis, (card) => localizeCard(card, lang).fullName, abilities),
    };
  }, [deck, index, lang, abilities]);

const DeckSlot = ({ slot, decks, deckId, onDeck, choice, onChoice, info, lang }) => {
  const [open, setOpen] = useState(false);
  const mine = decks.filter((d) => d.kind !== 'reference');
  const references = decks.filter((d) => d.kind === 'reference');
  const { coverage } = info?.sim ?? {};
  const metrics = info
    ? `coût moyen ${formatNumber(info.detected.avgCost, 1)} · ${Math.round(info.detected.cheapShare * 100)} % de cartes à 1-2 · ${info.detected.removal} removal`
    : null;

  return (
    <div className="rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5 p-3 space-y-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[slot] }} />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Deck {slot === 0 ? 'A' : 'B'}</span>
        {info && (
          <span className="flex -space-x-1 ml-auto">
            {info.inks.map((ink) => (
              <span key={ink} className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-950" style={{ background: getInk(ink).color }} title={getInk(ink).label} />
            ))}
          </span>
        )}
      </div>
      <select className="field" value={deckId ?? ''} onChange={(e) => onDeck(e.target.value)} aria-label={`Deck ${slot === 0 ? 'A' : 'B'}`}>
        {mine.length > 0 && (
          <optgroup label="Mes decks" className="bg-slate-900">
            {mine.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        )}
        {references.length > 0 && (
          <optgroup label="Decks de référence" className="bg-slate-900">
            {references.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {info && (
        <>
          <div className="space-y-1.5">
            <div className="max-w-full overflow-x-auto scrollbar-thin">
              <Segmented
                label="Style de jeu"
                value={choice}
                onChange={onChoice}
                options={[
                  { value: 'auto', label: 'Auto', title: `Style détecté : ${styleLabel(info.detected.style)}` },
                  ...STYLES.map((s) => ({ value: s.key, label: s.label })),
                ]}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              <span className="text-slate-400">Détecté : {styleLabel(info.detected.style)}</span> · {metrics}
            </p>
          </div>
          {info.total < MIN_DECK_SIZE && (
            <p className="flex items-center gap-1.5 text-xs text-amber-300">
              <AlertTriangle size={13} className="flex-shrink-0" />
              {info.total} cartes : le deck risque de manquer de pioche.
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={!coverage.ignored.length}
              className="w-full flex items-center gap-3 text-left disabled:cursor-default"
              aria-expanded={open}
            >
              <span className="text-xs text-slate-400 w-32 flex-shrink-0">Effets simulés</span>
              <ProgressBar value={coverage.total ? coverage.played / coverage.total : 0} className="flex-1 h-1.5" />
              <span className="text-xs text-slate-400 tabular-nums">
                <b className="text-white">{coverage.played}</b>/{coverage.total}
              </span>
              {coverage.ignored.length > 0 && (
                <ChevronDown size={14} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
              )}
            </button>
            {open && (
              <ul className="mt-2 space-y-1 max-h-48 overflow-auto scrollbar-thin">
                {coverage.ignored.map((x) => (
                  <li key={x.index} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-slate-300 truncate">
                      <span className="text-slate-500 tabular-nums">{x.qty}× </span>
                      {info.sim.cards[x.index].name}
                    </span>
                    <span className="text-slate-500 text-right min-w-0 max-w-[55%] truncate" title={ignoredLabel(x, lang)}>
                      {ignoredLabel(x, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Games between two decks played in the background by pilots following each deck's style, for
 * win rates with their margin of error, game lengths, lore curves and card impacts. Opened from
 * the decks: deckId, the deck it was opened from, goes first.
 */
const SimulationView = ({ onOpenSidebar, onBack, deckId = null }) => {
  const { decks } = useStore();
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const abilities = useCardAbilities();
  const { run, start, stop } = useSimulation();
  const sorted = useMemo(() => [...decks.filter((d) => d.kind !== 'reference'), ...decks.filter((d) => d.kind === 'reference')], [decks]);

  const [ids, setIds] = useState(() => {
    const last = run?.ids ?? [sorted[0]?.id ?? null, sorted[1]?.id ?? sorted[0]?.id ?? null];
    if (!deckId) return last;
    // Against the last opponent, or another deck
    const opponent = [last[1], last[0], ...sorted.map((d) => d.id)].find((id) => id && id !== deckId) ?? deckId;
    return [deckId, opponent];
  });
  const [choices, setChoices] = useState(() => run?.choices ?? ['auto', 'auto']);
  const [target, setTarget] = useState(() => run?.target ?? 0.02);
  const precision = PRECISIONS.find((x) => x.value === target) ?? PRECISIONS[2];

  // A deleted deck gives way to the first one
  const deckAt = (slot) => decks.find((d) => d.id === ids[slot]) ?? sorted[0] ?? null;
  const a = useSimDeck(deckAt(0), index, cardLang.lang, abilities);
  const b = useSimDeck(deckAt(1), index, cardLang.lang, abilities);
  const infos = [a, b];
  const styles = infos.map((info, slot) => (choices[slot] === 'auto' ? info?.detected.style : choices[slot]));
  const running = run?.status === 'running';
  const ready = a && b && a.sim.copies.length > 0 && b.sim.copies.length > 0;

  const launch = () => {
    const labels = infos.map((info) => info.deck.name);
    // The same deck on both sides still needs two names
    if (labels[0] === labels[1]) labels.splice(0, 2, `${labels[0]} (A)`, `${labels[1]} (B)`);
    start({
      ids: infos.map((info) => info.deck.id),
      choices,
      decks: infos.map((info) => info.sim),
      styles,
      labels,
      target,
    });
  };

  const stale =
    run && !running && (run.ids.some((id, slot) => id !== infos[slot]?.deck.id) || run.styles.some((s, slot) => s !== styles[slot]));
  const margin = run?.tally.games ? winRate(run.tally, 0).margin : null;

  const header = (
    <header className="px-4 sm:px-6 pt-4 pb-4 border-b border-white/5">
      <div className="flex items-start gap-2">
        <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
          <MenuIcon size={20} />
        </button>
        <button onClick={onBack} className="btn-icon -ml-1 mt-0.5" aria-label="Retour aux decks" title="Retour aux decks">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Simulation</h1>
          <p className="text-xs text-slate-500 mt-0.5">Fais s'affronter deux decks pour estimer leurs chances l'un contre l'autre.</p>
        </div>
      </div>
    </header>
  );

  if (!index || !abilities || sorted.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <p className="p-6 text-sm text-slate-500">
          {!index || !abilities ? 'Chargement du catalogue…' : 'Crée ou importe un deck pour lancer une simulation.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 py-5">
        <div className="max-w-6xl mx-auto space-y-4">
          <Panel
            icon={FlaskConical}
            title="Match"
            hint="Chaque deck est joué par un pilote qui suit son style : l'aggro part en quête au plus vite, le contrôle défie d'abord et garde ses personnages à l'abri, le midrange pèse chaque échange. Les capacités des cartes sont jouées d'après les fiches de Lorcanito ; une capacité que le moteur ne connaît pas encore est laissée de côté, et la barre « Effets simulés » le signale."
          >
            <div className="grid lg:grid-cols-2 gap-3">
              {[0, 1].map((slot) => (
                <DeckSlot
                  key={slot}
                  slot={slot}
                  decks={sorted}
                  deckId={infos[slot]?.deck.id}
                  onDeck={(id) => setIds((prev) => prev.map((x, i) => (i === slot ? id : x)))}
                  choice={choices[slot]}
                  onChoice={(c) => setChoices((prev) => prev.map((x, i) => (i === slot ? c : x)))}
                  info={infos[slot]}
                  lang={cardLang.lang}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Précision</span>
                <Segmented options={PRECISIONS} value={target} onChange={setTarget} label="Précision du taux de victoire" />
              </div>
              <div className="flex-1" />
              {running ? (
                <button onClick={stop} className="btn-secondary">
                  <Square size={15} />
                  Arrêter
                </button>
              ) : (
                <button onClick={launch} disabled={!ready} className="btn-primary">
                  <Play size={15} />
                  Lancer
                </button>
              )}
            </div>
            <div className="mt-3 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5 px-3 py-2.5 text-xs leading-relaxed text-slate-400 space-y-1">
              <p>
                La précision est la marge d'erreur visée sur le taux de victoire : la simulation enchaîne les parties jusqu'à ce
                que, 19 fois sur 20, le vrai résultat du match soit dans la fourchette affichée. Plus elle est fine, plus il faut
                de parties ; un match déséquilibré en demande moins. Elle mesure le hasard des parties, pas les limites du
                modèle (pilotes simplifiés, effets non simulés).
              </p>
              <p>
                <span className="font-medium text-white">{precision.label}</span> : {precision.help}
              </p>
            </div>
            {run && (
              <div className="mt-4 space-y-1.5">
                <ProgressBar
                  value={run.status === 'done' ? 1 : margin ? Math.min(1, Math.max((run.target / margin) ** 2, run.tally.games / MAX_GAMES)) : 0}
                  className="h-1.5"
                />
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  {running && <Loader2 size={12} className="animate-spin" />}
                  {formatNumber(run.tally.games)} parties
                  {margin != null && ` · marge ± ${formatPoints(margin)}`}
                  {` · ${formatNumber(run.elapsed / 1000, 1)} s`}
                  {run.status === 'stopped' && ' · arrêtée avant la précision demandée'}
                  {run.status === 'done' && run.tally.games >= MAX_GAMES && margin > run.target && ` · limite de ${formatNumber(MAX_GAMES)} parties atteinte`}
                  {run.status === 'error' && <span className="text-rose-300"> · {run.error}</span>}
                  {stale && <span className="text-amber-300"> · les réglages ont changé, relance pour les appliquer</span>}
                </p>
              </div>
            )}
          </Panel>
          {run && <SimulationResults run={run} />}
        </div>
      </div>
    </div>
  );
};

export default SimulationView;
