import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  CornerDownRight,
  Diamond,
  Droplet,
  Hand,
  Layers,
  MapPin,
  Music,
  Pause,
  Play,
  Shield,
  Shuffle,
  SkipBack,
  SkipForward,
  Skull,
  Sparkles,
  Sword,
  Swords,
  Trash2,
  Trophy,
  Undo2,
  Zap,
} from 'lucide-react';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useWidth } from '../../hooks/useWidth';
import { useCardPreview } from '../CardPreview/cardPreviewContext';
import { LORE_TO_WIN } from '../../utils/handStats';
import { styleLabel } from '../../utils/simulation/pilots';
import { SERIES } from './shared';
import LogText from './LogText';

// Milliseconds a turn stays on screen while the game plays by itself
const PLAY_EVERY = 1400;

const KIND_ICONS = {
  mulligan: Shuffle,
  ink: Droplet,
  play: Sparkles,
  sing: Music,
  quest: Diamond,
  challenge: Swords,
  activate: Zap,
  move: MapPin,
  boost: ChevronsUp,
  effect: CornerDownRight,
  win: Trophy,
};

// Where a card that left play went
const LEFT = {
  discard: { label: 'banni', icon: Skull },
  hand: { label: 'en main', icon: Undo2 },
  deck: { label: 'dans la pioche', icon: Layers },
  inkwell: { label: "dans l'encrier", icon: Droplet },
};

const REASONS = { lore: `${LORE_TO_WIN} lore`, deckout: 'deck adverse vide' };

const roundOf = (turn) => Math.ceil(turn / 2);

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * What turn `at` of a replay shows: per player the cards in play with what changed since the
 * turn before (new, shifted, damaged, quested, challenged), the cards that left play, and the
 * turn's log lines.
 */
const describeTurn = (replay, decks, at, lines) => {
  const snap = replay.snapshots[at];
  const before = replay.snapshots[at - 1] ?? null;
  const quested = new Set(lines.filter((l) => l.kind === 'quest').map((l) => l.cards[0]));
  const challenged = new Set(lines.filter((l) => l.kind === 'challenge').map((l) => l.cards[0]));
  const sides = snap.players.map((now, p) => {
    const was = new Map((before?.players[p].cards ?? []).map((c) => [c.id, c]));
    const cards = now.cards.map((c) => {
      const prev = was.get(c.id);
      return {
        ...c,
        card: decks[p].cards[c.idx],
        isNew: !prev,
        shifted: !!prev && prev.idx !== c.idx,
        hurt: c.damage > (prev?.damage ?? 0),
        quested: quested.has(c.id),
        challenged: challenged.has(c.id),
      };
    });
    return {
      now,
      before: before?.players[p] ?? null,
      cards,
      left: now.left.map((c) => ({ ...c, card: decks[p].cards[c.idx] })),
      played: now.played.map((c) => ({ ...c, card: decks[p].cards[c.idx] })),
    };
  });
  return { snap, sides, lines };
};

/** Locations with the characters at them, the other characters, the items. */
const arrange = (cards) => {
  const locations = cards.filter((c) => c.card.kind === 'location');
  const characters = cards.filter((c) => c.card.kind === 'character');
  const atLocation = (c) => locations.some((l) => l.id === c.at);
  return {
    groups: locations.map((location) => ({ location, here: characters.filter((c) => c.at === location.id) })),
    characters: characters.filter((c) => !atLocation(c)),
    items: cards.filter((c) => c.card.kind === 'item'),
  };
};

/**
 * Picture of a simulated card, its full view on click. ring: its outline classes; sideways: a
 * location in play, lying landscape (its picture is printed upright, turned a quarter).
 */
const Thumb = ({ card, className = '', ring = 'ring-1 ring-white/10', sideways = false, style }) => {
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const cardPreview = useCardPreview();
  const [loaded, setLoaded] = useState(false);
  const printing = index?.byId.get(card.id);
  const src = printing ? cardLang.image(printing, 'small') : null;
  const open = (e) => {
    e.stopPropagation();
    if (printing && cardPreview) cardPreview.open(printing, { origin: e.currentTarget });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e)}
      data-preview-id={printing?.id}
      aria-label={`Voir ${card.name} en grand`}
      title={card.name}
      style={style}
      className={`relative overflow-hidden rounded-md bg-slate-900 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        sideways ? 'aspect-[7/5]' : 'aspect-[5/7]'
      } ${ring} ${className}`}
    >
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[8px] leading-tight text-slate-400">{card.name}</span>
      )}
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={`absolute object-cover transition-opacity duration-300 ${
            sideways ? 'left-1/2 top-1/2 w-[71.43%] h-[140%] -translate-x-1/2 -translate-y-1/2 rotate-90' : 'inset-0 w-full h-full'
          } ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
};

const Badge = ({ className, title, style, children }) => (
  <span
    title={title}
    style={style}
    className={`absolute z-10 flex items-center justify-center gap-0.5 h-[18px] min-w-[18px] px-1 rounded-full text-[10px] font-bold ring-2 ring-slate-950 pointer-events-none ${className}`}
  >
    {children}
  </span>
);

/** A stat on the board, colored when an effect moved it from the printed value. */
const Stat = ({ icon: Icon, value, printed, title }) => (
  <span title={title} className={`flex items-center gap-0.5 ${value > printed ? 'text-emerald-300' : value < printed ? 'text-rose-300' : 'text-slate-400'}`}>
    <Icon size={9} aria-hidden />
    {value}
  </span>
);

const cardMotion = {
  initial: { opacity: 0, scale: 0.85 },
  exit: { opacity: 0, scale: 0.85, transition: { duration: 0.15 } },
  transition: { type: 'spring', stiffness: 380, damping: 32 },
};

/** A card in play: exerted cards lie sideways, the badges tell what happened to it this turn. */
const Slot = ({ view, side, focus }) => {
  const { card, damage, exerted, isNew, shifted, hurt, quested, challenged, under } = view;
  const location = card.kind === 'location';
  const lit = focus?.has(view.id);
  const ring = lit ? 'ring-2 ring-white shadow-lg shadow-white/10' : isNew || shifted ? 'ring-2' : undefined;
  return (
    <motion.div
      layout
      layoutId={`card-${view.id}`}
      {...cardMotion}
      animate={{ opacity: focus && !lit ? 0.35 : 1, scale: 1 }}
      className="flex flex-col items-center gap-1 w-[84px]"
    >
      <div className="relative w-[84px] h-[84px] flex items-center justify-center">
        <motion.div
          initial={false}
          animate={{ rotate: exerted ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className={location ? 'w-[84px]' : 'w-[60px]'}
        >
          <Thumb
            card={card}
            sideways={location}
            ring={ring}
            style={!lit && (isNew || shifted) ? { '--tw-ring-color': SERIES[side] } : undefined}
          />
        </motion.div>
        {(isNew || shifted) && (
          <Badge className="top-0 left-0 text-white" style={{ background: SERIES[side] }} title={shifted ? 'Joué ce tour avec Alter' : 'Joué ce tour'}>
            {shifted ? <span className="text-[9px] px-0.5">Alter</span> : <Sparkles size={10} strokeWidth={2.5} />}
          </Badge>
        )}
        {damage > 0 && (
          <Badge
            className={`top-0 right-0 text-white ${hurt ? 'bg-rose-500' : 'bg-rose-700'}`}
            title={`${plural(damage, 'dégât')}${hurt ? ', dont une partie ce tour' : ''}`}
          >
            <motion.span key={damage} initial={hurt ? { scale: 1.8 } : false} animate={{ scale: 1 }}>
              {damage}
            </motion.span>
          </Badge>
        )}
        {quested && (
          <Badge className="bottom-0 left-0 bg-amber-400 text-slate-950" title="Part en quête ce tour">
            <Diamond size={10} strokeWidth={2.5} />
          </Badge>
        )}
        {challenged && (
          <Badge className="bottom-0 right-0 bg-slate-100 text-slate-950" title="A défié ce tour">
            <Swords size={10} strokeWidth={2.5} />
          </Badge>
        )}
      </div>
      <span className="flex items-center gap-1.5 h-3 text-[10px] tabular-nums">
        {card.kind === 'character' && (
          <>
            <Stat icon={Sword} value={view.strength} printed={card.strength} title="Force" />
            <Stat icon={Shield} value={view.willpower} printed={card.willpower} title="Volonté" />
            <Stat icon={Diamond} value={view.lore} printed={card.lore} title="Lore" />
          </>
        )}
        {location && (
          <>
            <Stat icon={Shield} value={view.willpower} printed={card.willpower} title="Volonté" />
            <Stat icon={Diamond} value={view.lore} printed={card.lore} title="Lore à chaque début de tour" />
          </>
        )}
        {under > 0 && (
          <span className="flex items-center gap-0.5 text-slate-400" title={`${plural(under, 'carte')} dessous`}>
            <Layers size={9} aria-hidden />
            {under}
          </span>
        )}
      </span>
    </motion.div>
  );
};

/** A card that left play this turn, faded, with where it went. */
const Ghost = ({ view, focus }) => {
  const { label, icon: Icon } = LEFT[view.zone] ?? LEFT.discard;
  const lit = focus?.has(view.id);
  return (
    <motion.div
      layout
      {...cardMotion}
      animate={{ opacity: focus && !lit ? 0.35 : 1, scale: 1 }}
      className="flex flex-col items-center gap-1 w-[84px]"
      title={`${view.card.name} : ${label} ce tour`}
    >
      <div className="relative w-[84px] h-[84px] flex items-center justify-center">
        <div className={`${view.card.kind === 'location' ? 'w-[84px]' : 'w-[60px]'} opacity-30 grayscale`}>
          <Thumb card={view.card} sideways={view.card.kind === 'location'} ring={lit ? 'ring-2 ring-white' : undefined} />
        </div>
        <Icon size={22} className="absolute text-slate-200 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] pointer-events-none" aria-hidden />
      </div>
      <span className="h-3 text-[10px] text-slate-500">{label}</span>
    </motion.div>
  );
};

/** Lore of a player out of 20, the points won this turn brighter. */
const LoreTrack = ({ lore, gain, color }) => {
  const shown = Math.min(LORE_TO_WIN, lore);
  return (
    <span className="flex items-center gap-2" title={`${lore} lore sur ${LORE_TO_WIN}${gain ? ` (${gain > 0 ? '+' : ''}${gain} ce tour)` : ''}`}>
      <span className="flex items-baseline gap-0.5 tabular-nums">
        <span className="text-lg font-bold text-white leading-none">{lore}</span>
        <span className="text-[11px] text-slate-500">/{LORE_TO_WIN}</span>
      </span>
      <span className="hidden sm:flex gap-px" aria-hidden>
        {Array.from({ length: LORE_TO_WIN }, (_, i) => (
          <span
            key={i}
            className="w-1.5 h-2.5 rounded-[1px] transition-colors"
            style={{ background: i < shown ? color : 'rgba(255,255,255,0.08)', opacity: i < shown && i < shown - Math.max(0, gain) ? 0.5 : 1 }}
          />
        ))}
      </span>
      {gain !== 0 && (
        <span className={`text-xs font-semibold tabular-nums ${gain > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
          {gain > 0 ? '+' : '−'}
          {Math.abs(gain)}
        </span>
      )}
    </span>
  );
};

const Counter = ({ icon: Icon, value, delta = 0, title }) => (
  <span className="flex items-center gap-1" title={title}>
    <Icon size={12} className="text-slate-500" aria-hidden />
    <span className="text-slate-200">{value}</span>
    {delta > 0 && <span className="text-emerald-300">+{delta}</span>}
  </span>
);

/** Name, lore, ink, hand, deck and discard of a player, and their hand face up. */
const PlayerBar = ({ p, label, style, side, active, deck }) => {
  const { now, before } = side;
  const inked = before ? now.inkwell - before.inkwell : 0;
  const ink = active
    ? `${plural(now.inkwell, 'carte')} dans l'encrier, ${now.ink} encre${now.ink > 1 ? 's' : ''} non dépensée${now.ink > 1 ? 's' : ''} à la fin du tour`
    : `${plural(now.inkwell, 'carte')} dans l'encrier`;
  // The same card twice in hand still needs two keys
  const seen = new Map();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: SERIES[p] }} />
        <span className="text-sm font-semibold text-white truncate max-w-[14rem]">{label}</span>
        <span className="text-[11px] text-slate-500">{styleLabel(style)}</span>
      </span>
      <LoreTrack lore={now.lore} gain={before ? now.lore - before.lore : 0} color={SERIES[p]} />
      <span className="flex items-center gap-3 text-xs tabular-nums">
        <Counter icon={Droplet} value={active ? `${now.ink}/${now.inkwell}` : now.inkwell} delta={inked} title={ink} />
        <Counter icon={Hand} value={now.hand.length} title="Cartes en main" />
        <Counter icon={Layers} value={now.library} title="Cartes dans la pioche" />
        <Counter icon={Trash2} value={now.discard} title="Cartes dans la défausse" />
      </span>
      {now.hand.length > 0 && (
        <span className="flex gap-1 sm:ml-auto" aria-label="Main">
          {now.hand.map((idx) => {
            const n = (seen.get(idx) ?? 0) + 1;
            seen.set(idx, n);
            return <Thumb key={`${idx}-${n}`} card={deck.cards[idx]} className="w-[30px] rounded-[4px]" />;
          })}
        </span>
      )}
    </div>
  );
};

/** The cards a player has in play, by location, then the items, then the cards gone this turn. */
const PlayArea = ({ p, side, focus }) => {
  const { groups, characters, items } = arrange(side.cards);
  const empty = !side.cards.length && !side.left.length;
  return (
    <div className="flex flex-wrap items-start gap-2 min-h-[104px]">
      {empty && <p className="self-center text-xs text-slate-600">Aucune carte en jeu</p>}
      <AnimatePresence mode="popLayout" initial={false}>
        {/* A location framed with the characters at it */}
        {groups.map(({ location, here }) =>
          here.length ? (
            <motion.div
              layout
              key={`at-${location.id}`}
              {...cardMotion}
              animate={{ opacity: 1, scale: 1 }}
              className="flex gap-1 rounded-xl ring-1 ring-inset ring-white/10 bg-white/[0.03] p-1"
            >
              <Slot view={location} side={p} focus={focus} />
              {here.map((c) => (
                <Slot key={c.id} view={c} side={p} focus={focus} />
              ))}
            </motion.div>
          ) : (
            <Slot key={location.id} view={location} side={p} focus={focus} />
          )
        )}
        {characters.map((c) => (
          <Slot key={c.id} view={c} side={p} focus={focus} />
        ))}
        {items.length > 0 && (characters.length > 0 || groups.length > 0) && <motion.div layout key="items" className="self-stretch w-px my-2 bg-white/10" />}
        {items.map((c) => (
          <Slot key={c.id} view={c} side={p} focus={focus} />
        ))}
        {side.left.map((c) => (
          <Ghost key={`left-${c.id}`} view={c} focus={focus} />
        ))}
      </AnimatePresence>
    </div>
  );
};

/** Both players across the table: deck B on top, deck A at the bottom, the player whose turn it is tinted. */
const Board = ({ turn, run, focus }) => {
  const { snap, sides } = turn;
  const area = (p) => (
    <div
      // Room around the middle line for the turn's marker
      className={`px-3 sm:px-4 space-y-3 transition-colors ${p === 1 ? 'pt-3 pb-5' : 'pt-5 pb-3'}`}
      style={{ background: snap.turn > 0 && snap.current === p ? `${SERIES[p]}0f` : undefined }}
    >
      {p === 0 && <PlayArea p={p} side={sides[p]} focus={focus} />}
      <PlayerBar p={p} label={run.labels[p]} style={run.styles[p]} side={sides[p]} active={snap.turn > 0 && snap.current === p} deck={run.decks[p]} />
      {p === 1 && <PlayArea p={p} side={sides[p]} focus={focus} />}
    </div>
  );
  return (
    <div className="rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5 overflow-hidden">
      {area(1)}
      <div className="relative h-px bg-white/10">
        {snap.turn > 0 && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 ring-1 ring-white/10 text-[10px] text-slate-400 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-sm" style={{ background: SERIES[snap.current] }} />
            {snap.current === 1 ? '▲' : '▼'} tour de {run.labels[snap.current]}
          </span>
        )}
      </div>
      {area(0)}
    </div>
  );
};

// Timeline geometry, in pixels
const TL = { H: 72, top: 14, bottom: 16, side: 2 };

/**
 * The game turn by turn: each column a turn tinted by the player whose turn it is, the lore of
 * both players, a mark per card banished. Click or drag to move through it.
 */
const Timeline = ({ snapshots, at, onSelect, labels }) => {
  const [boxRef, W] = useWidth();
  const n = snapshots.length;
  const cw = (W - TL.side * 2) / n;
  const x = (i) => TL.side + (i + 0.5) * cw;
  const y = (v) => TL.H - TL.bottom - (Math.min(v, LORE_TO_WIN) / LORE_TO_WIN) * (TL.H - TL.top - TL.bottom);
  const lastRound = roundOf(snapshots.at(-1).turn);
  // Round numbers every few rounds so they never touch
  const every = Math.max(1, Math.ceil(18 / (2 * cw || 1)));

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((((e.clientX - rect.left) / rect.width) * W - TL.side) / cw);
    onSelect(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e) => {
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(Math.min(n - 1, Math.max(0, to)));
  };
  const s = snapshots[at];

  return (
    <div ref={boxRef} style={{ height: TL.H }}>
      {W > 0 && (
        <svg
          width={W}
          height={TL.H}
          viewBox={`0 0 ${W} ${TL.H}`}
          className="block touch-none select-none cursor-pointer outline-none rounded-md focus-visible:ring-1 focus-visible:ring-white/30"
          role="slider"
          tabIndex={0}
          aria-label="Tour affiché"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={at}
          aria-valuetext={s.turn ? `Tour ${roundOf(s.turn)}, ${labels[s.current]}` : 'Mise en place'}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => e.buttons && pick(e)}
        >
          {snapshots.map(
            (snap, i) =>
              i > 0 && (
                <rect
                  key={i}
                  x={TL.side + i * cw + 0.5}
                  y={TL.top}
                  width={Math.max(0, cw - 1)}
                  height={TL.H - TL.top - TL.bottom}
                  rx={2}
                  fill={SERIES[snap.current]}
                  opacity={0.1}
                />
              )
          )}
          <rect x={TL.side + at * cw} y={1} width={cw} height={TL.H - 2} rx={3} fill="white" opacity={0.08} />
          <line x1={TL.side} x2={W - TL.side} y1={y(LORE_TO_WIN)} y2={y(LORE_TO_WIN)} stroke="rgba(255,255,255,0.14)" strokeDasharray="2 3" />
          {[0, 1].map((p) => (
            <polyline
              key={p}
              points={snapshots.map((snap, i) => `${x(i)},${y(snap.players[p].lore)}`).join(' ')}
              fill="none"
              stroke={SERIES[p]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* A mark per card banished, in the color of the player who lost it */}
          {snapshots.map((snap, i) =>
            snap.players
              .flatMap((pl, p) => pl.left.filter((c) => c.zone === 'discard').map(() => p))
              .map((p, k, all) => <circle key={`${i}-${k}`} cx={x(i) + (k - (all.length - 1) / 2) * 5} cy={6} r={2} fill={SERIES[p]} />)
          )}
          {[0, 1].map((p) => (
            <circle key={p} cx={x(at)} cy={y(s.players[p].lore)} r={3.5} fill={SERIES[p]} stroke="#0b1020" strokeWidth={1.5} />
          ))}
          {Array.from({ length: lastRound }, (_, r) => r + 1)
            .filter((r) => (r - 1) % every === 0)
            .map((r) => (
              <text key={r} x={TL.side + 2 * r * cw} y={TL.H - 3} textAnchor="middle" className="fill-slate-500 text-[10px] tabular-nums">
                {r}
              </text>
            ))}
        </svg>
      )}
    </div>
  );
};

const IconButton = ({ icon: Icon, label, onClick, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="btn-icon p-1.5" aria-label={label} title={label}>
    <Icon size={16} />
  </button>
);

/** What the player did this turn: a summary, the cards played, the log lines (hovering one lights up its cards). */
const TurnPanel = ({ turn, run, replay, cards, focusLine, onFocusLine, last }) => {
  const { snap, sides, lines } = turn;
  const { result } = replay;
  const me = sides[snap.current];
  const played = sides.flatMap((side, p) => side.played.map((c) => ({ ...c, p })));
  const banished = sides.reduce((s, side) => s + side.left.filter((c) => c.zone === 'discard').length, 0);
  const challenges = lines.filter((l) => l.kind === 'challenge').length;
  const facts = snap.turn
    ? [
        me.before && me.now.lore > me.before.lore && `+${me.now.lore - me.before.lore} lore`,
        played.length && `${played.length} carte${played.length > 1 ? 's' : ''} jouée${played.length > 1 ? 's' : ''}`,
        challenges && plural(challenges, 'défi'),
        banished && `${banished} banni${banished > 1 ? 's' : ''}`,
      ].filter(Boolean)
    : [];

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white">{snap.turn ? `Tour ${roundOf(snap.turn)}` : 'Mise en place'}</span>
        {snap.turn > 0 && (
          <span className="flex items-center gap-1.5 min-w-0 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: SERIES[snap.current] }} />
            <span className="truncate">{run.labels[snap.current]}</span>
          </span>
        )}
      </div>
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {facts.map((f) => (
            <span key={f} className="px-2 py-0.5 rounded-full bg-white/5 ring-1 ring-inset ring-white/10 text-[11px] text-slate-300">
              {f}
            </span>
          ))}
        </div>
      )}
      {played.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Joué ce tour</p>
          <div className="flex flex-wrap gap-1.5">
            {played.map((c) => (
              <Thumb key={c.id} card={c.card} className="w-[38px] rounded-[5px]" ring={focusLine?.has(c.id) ? 'ring-2 ring-white' : undefined} />
            ))}
          </div>
        </div>
      )}
      <ol className="space-y-0.5 text-xs" onPointerLeave={() => onFocusLine(null)}>
        {lines.map((line, i) => {
          const Icon = KIND_ICONS[line.kind] ?? CornerDownRight;
          const ids = line.cards.length ? line.cards : null;
          return (
            <li
              key={i}
              onPointerEnter={() => onFocusLine(ids)}
              onClick={() => onFocusLine(ids)}
              className={`flex items-start gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors ${ids ? 'hover:bg-white/[0.05]' : ''}`}
            >
              <Icon size={12} className="mt-0.5 flex-shrink-0" style={{ color: SERIES[line.player] }} aria-hidden />
              <span className="text-slate-300 min-w-0">
                {(!snap.turn || line.player !== snap.current) && <span className="text-slate-500">{run.labels[line.player]} </span>}
                <LogText text={line.text} cards={cards} />
              </span>
            </li>
          );
        })}
        {!lines.length && <li className="text-slate-600">Rien d'autre ce tour : pioche et passe.</li>}
      </ol>
      {last && (
        <p className="flex items-center gap-2 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/10 px-3 py-2 text-xs text-slate-200">
          <Trophy size={14} className="text-amber-300 flex-shrink-0" />
          {result.winner == null ? 'Égalité : limite de tours atteinte.' : `${run.labels[result.winner]} gagne (${REASONS[result.reason]}).`}
        </p>
      )}
    </div>
  );
};

/**
 * A replayed game on a board: the timeline of its turns, the board at the end of the chosen
 * turn and what happened during it. ← → move through the turns.
 */
const GameReplay = ({ run, replay, cards }) => {
  const { snapshots, log } = replay;
  const last = snapshots.length - 1;
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Cards of the hovered log line, for the turn it belongs to
  const [focus, setFocus] = useState(null);
  const linesByTurn = useMemo(() => {
    const byTurn = snapshots.map(() => []);
    for (const line of log) byTurn[line.turn]?.push(line);
    return byTurn;
  }, [snapshots, log]);
  const turn = useMemo(() => describeTurn(replay, run.decks, at, linesByTurn[at]), [replay, run.decks, at, linesByTurn]);
  const focused = focus?.at === at ? focus.ids : null;

  const go = (i) => setAt(Math.min(last, Math.max(0, i)));

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => (at >= last ? setPlaying(false) : setAt(at + 1)), PLAY_EVERY);
    return () => clearTimeout(timer);
  }, [playing, at, last]);

  const togglePlay = () => {
    if (!playing && at >= last) setAt(0);
    setPlaying(!playing);
  };

  const onKey = (e) => {
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1 }[e.key];
    if (to == null || e.target.closest('input, select, textarea')) return;
    e.preventDefault();
    setPlaying(false);
    go(to);
  };

  return (
    <div className="space-y-3" onKeyDown={onKey}>
      <div className="space-y-1">
        <Timeline
          snapshots={snapshots}
          at={at}
          labels={run.labels}
          onSelect={(i) => {
            setPlaying(false);
            go(i);
          }}
        />
        <div className="flex items-center gap-1">
          <IconButton icon={SkipBack} label="Début de la partie" onClick={() => go(0)} disabled={at === 0} />
          <IconButton icon={ChevronLeft} label="Tour précédent (←)" onClick={() => go(at - 1)} disabled={at === 0} />
          <button type="button" onClick={togglePlay} className="btn-secondary px-3 py-1.5 text-xs" aria-pressed={playing}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
            {playing ? 'Pause' : 'Lecture'}
          </button>
          <IconButton icon={ChevronRight} label="Tour suivant (→)" onClick={() => go(at + 1)} disabled={at === last} />
          <IconButton icon={SkipForward} label="Fin de la partie" onClick={() => go(last)} disabled={at === last} />
          <span className="ml-2 text-xs text-slate-500 tabular-nums">
            {at} / {last}
          </span>
          <span className="ml-auto hidden sm:flex items-center gap-1 text-[11px] text-slate-500">
            <span className="kbd">←</span>
            <span className="kbd">→</span>
            pour changer de tour
          </span>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem] gap-4 items-start">
        <Board turn={turn} run={run} focus={focused} />
        <TurnPanel
          turn={turn}
          run={run}
          replay={replay}
          cards={cards}
          focusLine={focused}
          onFocusLine={(ids) => setFocus(ids ? { at, ids: new Set(ids) } : null)}
          last={at === last}
        />
      </div>
    </div>
  );
};

export default GameReplay;
