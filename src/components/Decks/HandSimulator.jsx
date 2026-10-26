import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shuffle, RefreshCw, ArrowDownToLine, Droplet } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import ProgressBar from '../ui/ProgressBar';
import { Segmented } from '../Collection/CollectionParts';
import { useCardLang } from '../../hooks/useCardLang';
import {
  OPENING_HAND,
  CARDS_BY_TURN_3,
  LORE_TO_WIN,
  shuffle,
  buildLibrary,
  probAtLeast,
  probOnCurve,
  simulateGoldfish,
  formatPercent,
} from '../../utils/handStats';

const INK_TURNS = 7;

const SIDES = [
  { value: true, label: 'En commençant' },
  { value: false, label: 'En jouant second' },
];

const formatTurn = (n) => (n == null ? '—' : n.toLocaleString('fr-BE', { maximumFractionDigits: 1 }));

/** Shuffles the library and draws an opening hand. */
const deal = (library, signature) => {
  const shuffled = shuffle(library);
  return {
    signature,
    hand: shuffled.slice(0, OPENING_HAND),
    library: shuffled.slice(OPENING_HAND),
    selected: [],
    mulliganed: false,
    draws: 0,
  };
};

const Counter = ({ label, value }) => (
  <div className="flex items-baseline gap-1.5">
    <span className="text-sm font-bold text-white tabular-nums">{value}</span>
    <span className="text-xs text-slate-500">{label}</span>
  </div>
);

const ProbRow = ({ label, value }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-slate-400 w-40 flex-shrink-0">{label}</span>
    <ProgressBar value={value} className="flex-1 h-1.5" />
    <span className="text-xs font-semibold text-white tabular-nums w-11 text-right">{formatPercent(value)}</span>
  </div>
);

/** Share of the games reaching 20 lore on each turn, alone and without card effects. */
const Goldfish = ({ library, shifts }) => {
  const [onThePlay, setOnThePlay] = useState(true);
  const results = useMemo(
    () => ({
      play: simulateGoldfish(library, { onThePlay: true, shifts }),
      draw: simulateGoldfish(library, { onThePlay: false, shifts }),
    }),
    [library, shifts]
  );
  const result = onThePlay ? results.play : results.draw;
  // Turns 1… with the share won that turn and by that turn
  const turns = result.byTurn.slice(1).map((share, i, all) => ({
    turn: i + 1,
    share,
    cumulative: all.slice(0, i + 1).reduce((s, x) => s + x, 0),
  }));
  const first = turns.findIndex((t) => t.share > 0);
  const last = turns.findLastIndex((t) => t.share > 0);
  const shown = first === -1 ? [] : turns.slice(Math.max(0, first - 1), last + 2);
  const max = Math.max(...shown.map((t) => t.share), 0.01);

  return (
    <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 lg:col-span-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className="label">Goldfish : {LORE_TO_WIN} lore sans adversaire</span>
          <p className="text-[11px] text-slate-500 max-w-xl leading-relaxed -mt-1">
            Parties simulées sans effets de cartes : une carte encrée par tour (une action ou un objet d'abord), puis les personnages et
            lieux les plus chers jouables, Alter compris. Utile pour comparer la vitesse brute de deux versions du deck.
          </p>
        </div>
        <Segmented options={SIDES} value={onThePlay} onChange={setOnThePlay} label="Joueur" />
      </div>
      <div className="flex gap-x-6 gap-y-1 flex-wrap mt-3">
        <Counter label="tour moyen" value={formatTurn(result.average)} />
        <Counter label="tour médian" value={formatTurn(result.median)} />
        {result.never > 0 && <Counter label="sans victoire au tour 25" value={formatPercent(result.never)} />}
      </div>
      {shown.length > 0 ? (
        <div className="flex items-end gap-0.5 h-28 mt-4">
          {shown.map(({ turn, share, cumulative }) => (
            <div
              key={turn}
              className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
              title={`Tour ${turn} : ${formatPercent(share)} des parties gagnées ce tour-là, ${formatPercent(cumulative)} au plus tard ce tour-là`}
            >
              <span className="text-[10px] tabular-nums text-slate-400">{share >= 0.05 ? formatPercent(share) : ''}</span>
              <motion.div
                className="w-full rounded-t bg-gradient-to-t from-indigo-500/60 to-violet-400/80"
                initial={false}
                animate={{ height: `${(share / max) * 100}%` }}
                transition={{ type: 'spring', stiffness: 160, damping: 22 }}
                style={{ minHeight: share ? 3 : 0 }}
              />
              <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{turn}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 mt-4">Aucune partie n'atteint {LORE_TO_WIN} lore : ajoute des personnages qui quêtent.</p>
      )}
    </div>
  );
};

/** Opening hand simulator (Lorcana mulligan) and exact draw odds for a deck. */
const HandSimulator = ({ analysis }) => {
  const cardLang = useCardLang();
  const library = useMemo(() => buildLibrary(analysis.entries), [analysis.entries]);
  const signature = analysis.entries.map((e) => `${e.key}:${e.qty}`).join('|');
  const [game, setGame] = useState(() => deal(library, signature));
  // A new deck list deals a new hand
  if (game.signature !== signature) setGame(deal(library, signature));

  const size = analysis.total;
  const inHand = game.hand.length;
  const inkableInHand = game.hand.filter((c) => c.card?.inkwell).length;
  const canMulligan = !game.mulliganed && game.draws === 0;

  const toggle = (uid) => {
    if (!canMulligan) return;
    setGame((g) => ({
      ...g,
      selected: g.selected.includes(uid) ? g.selected.filter((x) => x !== uid) : [...g.selected, uid],
    }));
  };

  // Lorcana mulligan: the chosen cards go to the bottom, as many are drawn, then the deck is shuffled
  const mulligan = () => {
    setGame((g) => {
      const kept = g.hand.filter((c) => !g.selected.includes(c.uid));
      const putBack = g.hand.filter((c) => g.selected.includes(c.uid));
      const stack = [...g.library, ...putBack];
      return {
        ...g,
        hand: [...kept, ...stack.slice(0, putBack.length)],
        library: shuffle(stack.slice(putBack.length)),
        selected: [],
        mulliganed: true,
      };
    });
  };

  const draw = () => {
    setGame((g) =>
      g.library.length ? { ...g, hand: [...g.hand, g.library[0]], library: g.library.slice(1), draws: g.draws + 1 } : g
    );
  };

  const odds = useMemo(() => {
    const cheap = analysis.entries.filter((e) => e.card && e.card.cost <= 2).reduce((s, e) => s + e.qty, 0);
    const onCurve = (e, onThePlay) =>
      e.card
        ? probOnCurve({
            deckSize: size,
            inkable: analysis.inkable,
            turns: e.card.cost,
            onThePlay,
            copies: e.qty,
            copiesInkable: e.card.inkwell,
          })
        : null;
    const cards = [...analysis.entries]
      .sort((a, b) => b.qty - a.qty || (a.card?.cost ?? 99) - (b.card?.cost ?? 99) || a.name.localeCompare(b.name))
      .map((e) => ({
        key: e.key,
        name: cardLang.fullName(e.card, e.name),
        qty: e.qty,
        cost: e.card?.cost ?? null,
        opening: probAtLeast(1, e.qty, size, OPENING_HAND),
        play: probAtLeast(1, e.qty, size, CARDS_BY_TURN_3.play),
        draw: probAtLeast(1, e.qty, size, CARDS_BY_TURN_3.draw),
        curvePlay: onCurve(e, true),
        curveDraw: onCurve(e, false),
      }));
    return {
      inkable: [1, 2, 3, 4].map((k) => probAtLeast(k, analysis.inkable, size, OPENING_HAND)),
      cheap: probAtLeast(1, cheap, size, OPENING_HAND),
      inkTurns: Array.from({ length: INK_TURNS }, (_, i) => ({
        turn: i + 1,
        play: probOnCurve({ deckSize: size, inkable: analysis.inkable, turns: i + 1, onThePlay: true }),
        draw: probOnCurve({ deckSize: size, inkable: analysis.inkable, turns: i + 1, onThePlay: false }),
      })),
      cards,
    };
  }, [analysis.entries, analysis.inkable, size, cardLang]);

  // Shift cards and the keys of the cards they can go on, for the goldfish games
  const shifts = useMemo(
    () =>
      new Map(
        (analysis.profile?.shifts ?? [])
          .filter((s) => s.shift.cost != null)
          .map((s) => [s.entry.key, { cost: s.shift.cost, bases: new Set(s.bases.map((b) => b.key)) }])
      ),
    [analysis.profile]
  );

  if (size === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">Ajoute des cartes au deck pour simuler une main.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setGame(deal(library, signature))} className="btn-secondary px-3 py-1.5">
            <RefreshCw size={15} />
            Nouvelle main
          </button>
          <button
            onClick={mulligan}
            disabled={!canMulligan || game.selected.length === 0}
            className="btn-primary px-3 py-1.5"
            title="Renvoie les cartes choisies sous le deck, en repioche autant puis mélange"
          >
            <Shuffle size={15} />
            Mulligan{game.selected.length > 0 && ` (${game.selected.length})`}
          </button>
          <button onClick={draw} disabled={game.library.length === 0} className="btn-secondary px-3 py-1.5">
            <ArrowDownToLine size={15} />
            Piocher
          </button>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap ml-auto">
            <Counter label="en main" value={inHand} />
            <Counter label="encrables" value={inkableInHand} />
            <Counter label="dans le deck" value={game.library.length} />
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-3">
          {canMulligan
            ? 'Clique les cartes à renvoyer sous le deck, puis Mulligan : tu en repioches autant et le deck est mélangé.'
            : game.draws > 0
              ? `${game.draws} carte${game.draws > 1 ? 's' : ''} piochée${game.draws > 1 ? 's' : ''} depuis la main de départ.`
              : 'Mulligan fait : pioche pour avancer dans les tours.'}
          {size < OPENING_HAND && ` Le deck n'a que ${size} carte${size > 1 ? 's' : ''}.`}
        </p>

        <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-7 gap-2 mt-4">
          <AnimatePresence>
            {game.hand.map((c) => {
              const isSelected = game.selected.includes(c.uid);
              return (
                <motion.button
                  key={c.uid}
                  layout
                  type="button"
                  onClick={() => toggle(c.uid)}
                  aria-pressed={isSelected}
                  aria-label={cardLang.fullName(c.card, c.name)}
                  title={cardLang.fullName(c.card, c.name)}
                  initial={{ opacity: 0, y: -28, rotate: -8, scale: 0.9 }}
                  animate={{ opacity: 1, y: isSelected ? -10 : 0, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  className={`relative rounded-lg text-left ${canMulligan ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <CardThumb
                    preview={false}
                    card={c.card ?? { fullName: c.name, inks: [] }}
                    className={isSelected ? 'ring-2 ring-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.45)]' : ''}
                    dimmed={isSelected}
                  />
                  {c.card?.inkwell && (
                    <span
                      className="absolute top-1 left-1 w-[18px] h-[18px] rounded-full bg-slate-950/80 flex items-center justify-center text-sky-300"
                      title="Encrable"
                    >
                      <Droplet size={10} />
                    </span>
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 space-y-2.5">
          <span className="label">Main de départ ({Math.min(OPENING_HAND, size)} cartes)</span>
          {odds.inkable.map((p, i) => (
            <ProbRow key={i} label={`≥ ${i + 1} encrable${i ? 's' : ''}`} value={p} />
          ))}
          <ProbRow label="≥ 1 carte coûtant ≤ 2" value={odds.cheap} />
          <p className="text-[11px] text-slate-500 pt-1">
            {analysis.inkable} cartes encrables sur {size}. Probabilités exactes, sans compter le mulligan.
          </p>
        </div>

        <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4">
          <span className="label">Encrer à chaque tour</span>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="font-medium py-1 px-1">Jusqu'au tour</th>
                <th className="font-medium py-1 px-1">En commençant</th>
                <th className="font-medium py-1 px-1">En jouant second</th>
              </tr>
            </thead>
            <tbody>
              {odds.inkTurns.map((t) => (
                <tr key={t.turn} className="border-t border-white/5">
                  <td className="py-1.5 px-1 text-slate-300 tabular-nums">{t.turn}</td>
                  {[t.play, t.draw].map((p, i) => (
                    <td key={i} className="py-1.5 px-1">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={p} className="flex-1 h-1.5" />
                        <span className="text-white font-semibold tabular-nums w-10 text-right">{formatPercent(p)}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500 pt-2">Chance d'avoir une carte encrable à mettre dans l'encrier à chacun de ces tours.</p>
        </div>

        <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 lg:col-span-2">
          <span className="label">Chaque carte</span>
          <div className="max-h-96 overflow-auto scrollbar-thin -mx-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-slate-500 text-left">
                  <th className="font-medium py-1.5 px-1">Carte</th>
                  <th className="font-medium py-1.5 px-1 text-right">Coût</th>
                  <th className="font-medium py-1.5 px-1 text-right whitespace-nowrap" title="Au moins une copie dans la main de départ">
                    Main
                  </th>
                  <th className="font-medium py-1.5 px-1 text-right whitespace-nowrap" title={`Au moins une copie au tour 3 en commençant (${CARDS_BY_TURN_3.play} cartes vues)`}>
                    T3 · 1<sup>er</sup>
                  </th>
                  <th className="font-medium py-1.5 px-1 text-right whitespace-nowrap" title={`Au moins une copie au tour 3 en jouant second (${CARDS_BY_TURN_3.draw} cartes vues)`}>
                    T3 · 2<sup>e</sup>
                  </th>
                  <th
                    className="font-medium py-1.5 px-1 text-right whitespace-nowrap"
                    title="Jouable au tour de son coût en commençant : une copie en main et une carte encrée à chaque tour d'ici là"
                  >
                    À temps · 1<sup>er</sup>
                  </th>
                  <th
                    className="font-medium py-1.5 px-1 text-right whitespace-nowrap"
                    title="Jouable au tour de son coût en jouant second : une copie en main et une carte encrée à chaque tour d'ici là"
                  >
                    À temps · 2<sup>e</sup>
                  </th>
                </tr>
              </thead>
              <tbody>
                {odds.cards.map((c) => (
                  <tr key={c.key} className="border-t border-white/5">
                    <td className="py-1.5 px-1 text-slate-300">
                      <span className="text-slate-500 tabular-nums">{c.qty}× </span>
                      {c.name}
                    </td>
                    <td className="py-1.5 px-1 text-right tabular-nums text-slate-400">{c.cost ?? '?'}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap text-white">{formatPercent(c.opening)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap text-slate-300">{formatPercent(c.play)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap text-slate-300">{formatPercent(c.draw)}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap text-slate-300">
                      {c.curvePlay == null ? '—' : formatPercent(c.curvePlay)}
                    </td>
                    <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap text-slate-300">
                      {c.curveDraw == null ? '—' : formatPercent(c.curveDraw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Goldfish library={library} shifts={shifts} />
      </div>
    </div>
  );
};

export default HandSimulator;
