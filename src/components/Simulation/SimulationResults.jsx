import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Swords, Timer, TrendingUp, Layers, ScrollText, Shuffle, ArrowUp, ArrowDown } from 'lucide-react';
import { Panel, Segmented } from '../Collection/CollectionParts';
import { replayGame } from '../../hooks/useSimulation';
import { LORE_TO_WIN } from '../../utils/handStats';
import { CURVE_ROUNDS, IMPACT_MIN_GAMES, cardImpact, gameLength, loreCurve, winRate } from '../../utils/simulation/stats';
import { SERIES, STATUS, SURFACE, formatNumber, formatPoints } from './shared';
import CardName from './CardName';

const formatPercent = (x, digits = 0) => `${(x * 100).toLocaleString('fr-BE', { maximumFractionDigits: digits })} %`;
const formatMargin = (margin) => `± ${formatPoints(margin)}`;

/** A color key beside a name: rect for bars, line for lines. The name keeps the text color. */
const Key = ({ color, line = false, children }) => (
  <span className="inline-flex items-center gap-1.5 min-w-0 text-xs text-slate-300">
    <span
      className={`flex-shrink-0 ${line ? 'w-3.5 h-0.5 rounded-full' : 'w-2.5 h-2.5 rounded-sm'}`}
      style={{ background: color }}
    />
    <span className="truncate">{children}</span>
  </span>
);

const Legend = ({ labels, line }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1">
    {labels.map((label, p) => (
      <Key key={p} color={SERIES[p]} line={line}>
        {label}
      </Key>
    ))}
  </div>
);

const Tile = ({ label, value, hint }) => (
  <div title={hint}>
    <div className="text-base font-bold text-white leading-tight">{value}</div>
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
  </div>
);

/** Deck A's share of a set of games against deck B's, with the margin of error. */
const SplitBar = ({ label, rate, labels }) => (
  <div
    // On a phone the bar takes its own line under the label and the value
    className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[13rem_minmax(0,1fr)_9rem] items-center gap-x-3 gap-y-1"
    title={`${labels[0]} : ${formatPercent(rate.rate, 1)} (entre ${formatPercent(rate.low, 1)} et ${formatPercent(rate.high, 1)}) · ${labels[1]} : ${formatPercent(1 - rate.rate, 1)}`}
  >
    <span className="text-xs text-slate-400 truncate">{label}</span>
    <div className="col-span-2 sm:col-span-1 order-last sm:order-none flex gap-0.5 h-3 min-w-0">
      <motion.div
        className="rounded-l-[4px]"
        style={{ background: SERIES[0] }}
        initial={false}
        animate={{ width: `${rate.rate * 100}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
      />
      <div className="flex-1 rounded-r-[4px]" style={{ background: SERIES[1] }} />
    </div>
    <span className="text-xs tabular-nums text-white text-right whitespace-nowrap">
      {formatPercent(rate.rate)} <span className="text-slate-500">{formatMargin(rate.margin)}</span>
    </span>
  </div>
);

const verdict = (rate, labels) => {
  if (rate.low > 0.5) return `${labels[0]} est favori.`;
  if (rate.high < 0.5) return `${labels[1]} est favori.`;
  return 'Pas de favori net : les deux restent dans la marge.';
};

const WinPanel = ({ run }) => {
  const { tally, labels } = run;
  const overall = winRate(tally, 0);
  const aFirst = winRate(tally, 0, true);
  const bFirst = winRate(tally, 0, false);
  return (
    <Panel icon={Swords} title="Taux de victoire" hint="Les égalités (limite de tours) comptent pour une demi-victoire. Marge d'erreur à 95 %.">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-5">
        <div>
          <Key color={SERIES[0]}>{labels[0]}</Key>
          <div className="text-5xl font-bold text-white tracking-tight mt-1">{formatPercent(overall.rate)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {formatMargin(overall.margin)} · entre {formatPercent(overall.low)} et {formatPercent(overall.high)}
          </div>
        </div>
        <p className="text-sm text-slate-300 pb-1">{verdict(overall, labels)}</p>
      </div>
      <div className="space-y-2.5">
        <SplitBar label="Toutes les parties" rate={overall} labels={labels} />
        {aFirst && <SplitBar label={`Quand ${labels[0]} commence`} rate={aFirst} labels={labels} />}
        {bFirst && <SplitBar label={`Quand ${labels[1]} commence`} rate={bFirst} labels={labels} />}
      </div>
      <div className="mt-4">
        <Legend labels={labels} />
      </div>
    </Panel>
  );
};

/** Share of the games each deck wins on each round, stacked. */
const RoundsChart = ({ byRound, labels }) => {
  const [hover, setHover] = useState(null);
  const first = byRound.findIndex((r) => r.wins[0] + r.wins[1] > 0);
  const last = byRound.findLastIndex((r) => r.wins[0] + r.wins[1] > 0);
  if (first === -1) return null;
  const shown = byRound.slice(first, last + 1);
  const max = Math.max(...shown.map((r) => r.wins[0] + r.wins[1]));
  const hovered = hover != null ? shown[hover] : null;

  return (
    <div className="relative">
      <div className="flex items-stretch gap-1 h-40" onPointerLeave={() => setHover(null)}>
        {shown.map((r, i) => {
          const total = r.wins[0] + r.wins[1];
          const top = r.wins[1] > 0 ? 1 : 0;
          return (
            <div
              key={r.round}
              tabIndex={0}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`Tour ${r.round} : ${labels[0]} ${formatPercent(r.wins[0], 1)}, ${labels[1]} ${formatPercent(r.wins[1], 1)}`}
              className={`flex-1 min-w-0 flex flex-col items-center gap-1 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
                hover === i ? 'bg-white/[0.04]' : ''
              }`}
            >
              <div className="flex-1 w-full flex items-end justify-center">
                <div className="w-full max-w-[24px] flex flex-col-reverse gap-0.5" style={{ height: `${(total / max) * 100}%` }}>
                  {[0, 1].map((p) =>
                    r.wins[p] > 0 ? (
                      <div
                        key={p}
                        className={p === top ? 'rounded-t-[4px]' : ''}
                        style={{ background: SERIES[p], flex: `${r.wins[p] / total} 1 0`, minHeight: 2 }}
                      />
                    ) : null
                  )}
                </div>
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums">{r.round}</span>
            </div>
          );
        })}
      </div>
      {hovered && (
        <div
          className="absolute -top-2 z-10 -translate-x-1/2 -translate-y-full pointer-events-none surface rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
          style={{ left: `${((hover + 0.5) / shown.length) * 100}%` }}
        >
          <div className="text-slate-400 mb-0.5">Tour {hovered.round}</div>
          {[0, 1].map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="w-3 h-0.5 rounded-full" style={{ background: SERIES[p] }} />
              <b className="text-white tabular-nums">{formatPercent(hovered.wins[p], 1)}</b>
              <span className="text-slate-400">{labels[p]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const LengthPanel = ({ run }) => {
  const { tally, labels } = run;
  const { average, byRound } = gameLength(tally);
  const share = (n) => formatPercent(n / tally.games, 1);
  return (
    <Panel icon={Timer} title="Durée des parties" hint="Part des parties gagnées par chaque deck à chaque tour (un tour de chaque joueur).">
      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
        <Tile label="tour moyen" value={average == null ? '—' : formatNumber(average, 1)} />
        <Tile label={`${LORE_TO_WIN} lore`} value={share(tally.reasons.lore)} hint={`Parties finies par ${LORE_TO_WIN} lore`} />
        <Tile label="deck vide" value={share(tally.reasons.deckout)} hint="Parties perdues faute de carte à piocher" />
        {tally.reasons.timeout > 0 && <Tile label="égalités" value={share(tally.reasons.timeout)} hint="Parties arrêtées à la limite de tours" />}
        <Tile
          label="mulligan moyen"
          value={tally.mulligans.map((m) => formatNumber(m / tally.games, 1)).join(' / ')}
          hint={`Cartes remises en début de partie : ${labels[0]} / ${labels[1]}`}
        />
      </div>
      <RoundsChart byRound={byRound} labels={labels} />
      <div className="mt-3">
        <Legend labels={labels} />
      </div>
    </Panel>
  );
};

// Lore chart geometry, in pixels
const H = 220;
const PAD = { left: 30, right: 40, top: 12, bottom: 26 };

/** Width of an element, followed as it resizes. */
const useWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

/** Average lore of each deck at the end of each round, with a crosshair. */
const LoreChart = ({ curves, labels, rounds }) => {
  const svgRef = useRef(null);
  const [boxRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const W = width;
  const x = (r) => PAD.left + ((r - 1) / Math.max(1, rounds - 1)) * (W - PAD.left - PAD.right);
  const y = (v) => H - PAD.bottom - (v / LORE_TO_WIN) * (H - PAD.top - PAD.bottom);
  const points = curves.map((c) => c.slice(0, rounds).map((v, i) => [x(i + 1), y(v)]));
  const step = rounds > 12 || W < 360 ? 2 : 1;
  const ends = curves.map((c) => c[rounds - 1]);
  // End labels only when they cannot collide
  const endLabels = Math.abs(y(ends[0]) - y(ends[1])) >= 14;

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const r = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (rounds - 1)) + 1;
    setHover(Math.min(rounds, Math.max(1, r)));
  };

  return (
    <div ref={boxRef} className="relative min-w-0" style={{ height: H }}>
      {W > 0 && (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Lore moyen par tour : ${labels[0]} ${formatNumber(ends[0], 1)}, ${labels[1]} ${formatNumber(ends[1], 1)} au tour ${rounds}`}
        >
          {[0, 5, 10, 15, 20].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={v ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)'} />
              <text x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[10px] tabular-nums">
                {v}
              </text>
            </g>
          ))}
          {Array.from({ length: rounds }, (_, i) => i + 1)
            .filter((r) => (r - 1) % step === 0)
            .map((r) => (
              <text key={r} x={x(r)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[10px] tabular-nums">
                {r}
              </text>
            ))}
          {hover && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.25)" />}
          {points.map((pts, p) => (
            <polyline
              key={p}
              points={pts.map((pt) => pt.join(',')).join(' ')}
              fill="none"
              stroke={SERIES[p]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {points.map((pts, p) => {
            const [cx, cy] = hover ? pts[hover - 1] : pts.at(-1);
            return <circle key={p} cx={cx} cy={cy} r={4.5} fill={SERIES[p]} stroke={SURFACE} strokeWidth={2} />;
          })}
          {!hover &&
            endLabels &&
            points.map((pts, p) => (
              <text key={p} x={pts.at(-1)[0] + 9} y={pts.at(-1)[1]} dominantBaseline="middle" className="fill-slate-300 text-[11px] font-semibold tabular-nums">
                {formatNumber(ends[p], 1)}
              </text>
            ))}
        </svg>
      )}
      {hover && (
        <div
          className="absolute top-0 z-10 pointer-events-none surface rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: hover > rounds / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
          }}
        >
          <div className="text-slate-400 mb-0.5">Tour {hover}</div>
          {[0, 1].map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="w-3 h-0.5 rounded-full" style={{ background: SERIES[p] }} />
              <b className="text-white tabular-nums">{formatNumber(curves[p][hover - 1], 1)}</b>
              <span className="text-slate-400">{labels[p]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const LorePanel = ({ run }) => {
  const { tally, labels } = run;
  const curves = [loreCurve(tally, 0), loreCurve(tally, 1)];
  // Up to the round by which nearly every game is over
  let rounds = CURVE_ROUNDS;
  let ended = 0;
  for (let r = 1; r < tally.rounds.length; r++) {
    ended += tally.rounds[r] ?? 0;
    if (ended >= tally.games * 0.98) {
      rounds = Math.min(CURVE_ROUNDS, Math.max(6, r));
      break;
    }
  }
  return (
    <Panel
      icon={TrendingUp}
      title="Lore par tour"
      hint="Lore moyen de chaque deck à la fin de son tour. Une partie finie garde son dernier score : le deck qui gagne plafonne à 20."
    >
      <LoreChart curves={curves} labels={labels} rounds={rounds} />
      <div className="mt-2">
        <Legend labels={labels} line />
      </div>
    </Panel>
  );
};

const UNCOVERED = { action: 'action encrée', item: 'objet encré', ability: 'capacités ignorées', partial: 'en partie' };

const ImpactPanel = ({ run }) => {
  const [side, setSide] = useState(0);
  const { tally, labels, decks } = run;
  const rows = useMemo(() => cardImpact(tally, side, decks[side].cards), [tally, side, decks]);
  return (
    <Panel
      icon={Layers}
      title="Impact des cartes"
      hint={`Victoires quand la carte arrive en main, et quand elle n'y arrive pas. Une corrélation, pas une cause : les parties longues voient plus de cartes. Grisé : moins de ${IMPACT_MIN_GAMES} parties d'un côté.`}
      action={
        <Segmented
          options={labels.map((label, p) => ({ value: p, label: `Deck ${'AB'[p]}`, title: label }))}
          value={side}
          onChange={setSide}
          label="Deck"
        />
      }
    >
      <div className="mb-3">
        <Key color={SERIES[side]}>{labels[side]}</Key>
      </div>
      <div className="overflow-x-auto scrollbar-thin -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
              <th className="font-medium px-1 pb-2">Carte</th>
              <th className="font-medium px-1 pb-2 text-right">Piochée</th>
              <th className="font-medium px-1 pb-2 text-right">Si piochée</th>
              <th className="font-medium px-1 pb-2 text-right">Sinon</th>
              <th className="font-medium px-1 pb-2 text-right">Écart</th>
            </tr>
          </thead>
          <tbody data-preview-group className="tabular-nums">
            {rows.map((row) => {
              const up = row.delta != null && row.delta >= 0;
              const Arrow = up ? ArrowUp : ArrowDown;
              return (
                <tr
                  key={row.index}
                  className={`border-t border-white/5 ${row.reliable ? '' : 'opacity-45'}`}
                  title={row.reliable ? undefined : 'Trop peu de parties pour un écart fiable'}
                >
                  <td className="px-1 py-1.5 text-slate-200">
                    <span className="flex items-center gap-2 min-w-0">
                      <CardName card={row.card} className="truncate max-w-[16rem]" />
                      {row.card.uncovered && (
                        <span className="flex-shrink-0 px-1.5 py-px rounded text-[10px] text-slate-400 bg-white/5 ring-1 ring-inset ring-white/10">
                          {UNCOVERED[row.card.uncovered]}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right text-slate-400">{formatPercent(row.drawn)}</td>
                  <td className="px-1 py-1.5 text-right text-slate-300">{row.withCard == null ? '—' : formatPercent(row.withCard)}</td>
                  <td className="px-1 py-1.5 text-right text-slate-300">{row.withoutCard == null ? '—' : formatPercent(row.withoutCard)}</td>
                  <td className="px-1 py-1.5 text-right">
                    {row.delta == null ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <span className="inline-flex items-center justify-end gap-1 font-semibold text-white">
                        <Arrow size={12} style={{ color: up ? STATUS.good : STATUS.critical }} aria-hidden />
                        {`${up ? '+' : '−'}${formatPoints(row.delta)}`}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

const REASONS = { lore: `${LORE_TO_WIN} lore`, deckout: 'deck adverse vide', timeout: 'limite de tours' };

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The cards of both decks by name, and a pattern finding those names in the log's sentences:
 * longest first, so a name never cuts a longer one short.
 */
const logCards = (decks) => {
  const byName = new Map(decks.flatMap((d) => d.cards.map((card) => [card.name, card])));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = names.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${names.join('|')})(?![\\p{L}\\p{N}])`, 'u') : null;
  return { byName, pattern };
};

/** A log sentence, its card names showing their card on hover. */
const LogText = ({ text, cards }) =>
  cards.pattern
    ? text.split(cards.pattern).map((part, i) => (i % 2 ? <CardName key={i} card={cards.byName.get(part)} className="text-slate-100" /> : part))
    : text;

/** One game of the run played again, turn by turn, to check how the pilots play. */
const LogPanel = ({ run }) => {
  const [n, setN] = useState(null);
  const replay = useMemo(() => (n == null ? null : replayGame(run, n)), [run, n]);
  const cards = useMemo(() => logCards(run.decks), [run.decks]);
  const { labels } = run;
  const pick = () => setN(Math.floor(Math.random() * run.tally.games));

  const summary = replay
    ? `Partie n° ${formatNumber(n + 1)} · ${labels[replay.result.first]} commence · ${
        replay.result.winner == null
          ? 'égalité'
          : `${labels[replay.result.winner]} gagne au tour ${Math.ceil(replay.result.turns / 2)} (${REASONS[replay.result.reason]})`
      }`
    : null;

  return (
    <Panel
      icon={ScrollText}
      title="Journal d'une partie"
      hint="Une partie de la simulation rejouée à l'identique, pour vérifier les choix des pilotes."
      action={
        <button onClick={pick} className="btn-secondary px-3 py-1.5 text-xs flex-shrink-0">
          <Shuffle size={13} />
          {replay ? 'Une autre' : 'Voir une partie'}
        </button>
      }
    >
      {replay && (
        <>
          <p className="text-xs text-slate-300 mb-3">{summary}</p>
          <ol data-preview-group className="max-h-96 overflow-auto scrollbar-thin space-y-1 text-xs">
            {replay.log.map((line, i) => {
              const prev = replay.log[i - 1];
              const newRound = !prev || prev.round !== line.round;
              return (
                <li key={i} className={`flex items-start gap-2 ${newRound && i ? 'pt-2 mt-1 border-t border-white/5' : ''}`}>
                  <span className="w-12 flex-shrink-0 text-slate-500 tabular-nums">{newRound ? (line.round ? `Tour ${line.round}` : 'Début') : ''}</span>
                  <span className="w-2 h-2 rounded-sm mt-1 flex-shrink-0" style={{ background: SERIES[line.player] }} />
                  <span className="text-slate-300">
                    <span className="text-slate-500">{labels[line.player]} </span>
                    <LogText text={line.text} cards={cards} />
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Panel>
  );
};

/** Every result of a run, refreshed while it plays. */
const SimulationResults = ({ run }) =>
  run.tally.games > 0 && (
    <div className="space-y-4">
      <WinPanel run={run} />
      <div className="grid lg:grid-cols-2 gap-4 [&>*]:min-w-0">
        <LengthPanel run={run} />
        <LorePanel run={run} />
      </div>
      <ImpactPanel run={run} />
      <LogPanel run={run} />
    </div>
  );

export default SimulationResults;
