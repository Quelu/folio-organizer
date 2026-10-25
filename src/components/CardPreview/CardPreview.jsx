import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Hexagon,
  RotateCw,
  Swords,
  Shield,
  Diamond,
  Footprints,
  MapPin,
  Layers,
  Sparkles,
  Check,
  Ban,
} from 'lucide-react';
import TiltCard from '../ui/TiltCard';
import { useStore } from '../../hooks/storeContext';
import { useCollection } from '../../hooks/useCollection';
import { usePrices } from '../../hooks/usePrices';
import { useCatalog } from '../../hooks/catalogContext';
import { getInk, getLegality, FORMATS, CARD_TYPES } from '../../utils/catalog';
import { getLorcanaSetName, LORCANA_RARITIES } from '../../data/games';

// Same moves as the binder's card sheet: the card flips in, then slides sideways between cards
const slideVariants = {
  enter: (dir) => ({ opacity: 0, x: dir * 90, rotateY: dir * 35 }),
  center: { opacity: 1, x: 0, rotateY: 0 },
  exit: (dir) => ({ opacity: 0, x: dir * -90, rotateY: dir * -35, transition: { duration: 0.22, ease: 'easeIn' } }),
};

const infoList = { show: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } } };
const infoItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 28 } },
};

const RARITY_STYLES = {
  Common: 'bg-slate-500/15 text-slate-300 ring-slate-400/25',
  Uncommon: 'bg-teal-500/15 text-teal-200 ring-teal-400/25',
  Rare: 'bg-orange-500/15 text-orange-200 ring-orange-400/25',
  Super_rare: 'bg-zinc-300/15 text-zinc-100 ring-zinc-200/30',
  Legendary: 'bg-amber-400/15 text-amber-200 ring-amber-300/40',
};

/** Rules text symbols ({I}, {E}…) drawn as small icons. */
const SYMBOLS = {
  I: { icon: Hexagon, label: 'encre' },
  IW: { icon: Hexagon, label: 'encrier' },
  E: { icon: RotateCw, label: 'épuiser' },
  S: { icon: Swords, label: 'force' },
  W: { icon: Shield, label: 'volonté' },
  L: { icon: Diamond, label: 'lore' },
};

const RulesLine = ({ line }) => {
  // Ability names are written in capitals before their effect: "DEEP FREEZE When you play…"
  const named = line.match(/^([A-Z0-9][A-Z0-9'’!?.,&\- ]*[A-Z0-9!?'’])\s+(?=\S*[a-z])/);
  const rest = named ? line.slice(named[0].length) : line;
  return (
    <p className="leading-relaxed">
      {named && <b className="font-extrabold text-white tracking-wide">{named[1]} </b>}
      {rest.split(/(\{[A-Z]+\})/).map((part, i) => {
        const symbol = SYMBOLS[part.slice(1, -1)];
        if (!symbol) return part;
        return (
          <symbol.icon
            key={i}
            size={13}
            aria-label={symbol.label}
            className="inline-block -mt-0.5 mx-0.5 text-indigo-200"
          />
        );
      })}
    </p>
  );
};

const Stat = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.07] px-3 py-2">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
      <Icon size={11} />
      {label}
    </div>
    <div className="text-lg font-black text-white tabular-nums leading-tight">{value}</div>
  </div>
);

const RarityBadge = ({ rarity }) => {
  const label = LORCANA_RARITIES.find((r) => r.key === rarity)?.label ?? rarity;
  const special = ['Epic', 'Enchanted', 'Iconic'].includes(rarity);
  return special ? (
    <span className="foil-surface px-2 py-0.5 rounded-md text-[11px] font-bold text-white ring-1 ring-white/40 shadow-lg shadow-fuchsia-900/40">
      {label}
    </span>
  ) : (
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ${RARITY_STYLES[rarity] ?? RARITY_STYLES.Common}`}>
      {label}
    </span>
  );
};

/** Text about the card: identity, stats, rules, where the user's copies are, price, legality. */
const CardInfo = ({ card, foil, onLocate, onOpenDeck, onClose }) => {
  const { decks } = useStore();
  const { index } = useCatalog();
  const collection = useCollection();
  const prices = usePrices();
  const entry = collection.entries.get(card.key);
  const copies = entry?.copies ?? [];
  const usedBy = decks.filter((d) => d.kind !== 'reference' && d.cards.some((c) => c.key === card.key));
  const price = prices.getPrice(card, false);
  const foilPrice = prices.getPrice(card, true);
  const isCharacter = card.strength != null || card.willpower != null;
  const typeLabel = card.types.map((t) => CARD_TYPES.find((x) => x.key === t)?.label ?? t).join(' · ');

  return (
    <motion.div key={card.id} variants={infoList} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={infoItem} className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
            {getLorcanaSetName(card.set) ?? `Chapitre ${card.set}`} · n° {card.number}
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight mt-1">{card.name}</h2>
          {card.version && <p className="text-base sm:text-lg text-slate-300 leading-snug">{card.version}</p>}
        </div>
        <button onClick={onClose} className="btn-icon -mr-2 -mt-1" aria-label="Fermer" title="Fermer (Esc)">
          <X size={18} />
        </button>
      </motion.div>

      <motion.div variants={infoItem} className="flex flex-wrap items-center gap-2">
        {card.inks.map((ink) => (
          <span
            key={ink}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold text-white ring-1 ring-inset ring-white/10"
            style={{ background: `${getInk(ink).color}26` }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: getInk(ink).color, boxShadow: `0 0 8px ${getInk(ink).color}` }} />
            {getInk(ink).label}
          </span>
        ))}
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-white/[0.05] text-slate-200 ring-1 ring-inset ring-white/10">
          <Hexagon size={11} className={card.inkwell ? 'fill-sky-300/40 text-sky-300' : 'text-slate-500'} />
          {card.cost} · {card.inkwell ? 'encrable' : 'non encrable'}
        </span>
        {card.rarity && <RarityBadge rarity={card.rarity} />}
        {foil && (
          <span className="foil-text text-[11px] font-bold flex items-center gap-1">
            <Sparkles size={11} className="text-fuchsia-300" /> Foil
          </span>
        )}
      </motion.div>

      <motion.p variants={infoItem} className="text-xs text-slate-400">
        <span className="text-slate-200 font-medium">{typeLabel}</span>
        {card.classifications.length > 0 && <> · {card.classifications.join(' · ')}</>}
      </motion.p>

      {(isCharacter || card.lore != null || card.moveCost != null) && (
        <motion.div variants={infoItem} className="grid grid-cols-3 gap-2">
          {card.strength != null && <Stat icon={Swords} label="Force" value={card.strength} />}
          {card.willpower != null && <Stat icon={Shield} label="Volonté" value={card.willpower} />}
          {card.lore != null && <Stat icon={Diamond} label="Lore" value={card.lore} />}
          {card.moveCost != null && <Stat icon={Footprints} label="Déplacement" value={card.moveCost} />}
        </motion.div>
      )}

      {card.text && (
        <motion.div
          variants={infoItem}
          className="rounded-xl bg-gradient-to-br from-white/[0.05] to-white/[0.02] ring-1 ring-inset ring-white/[0.07] px-4 py-3 text-sm text-slate-300 space-y-2"
        >
          {card.text.split('\n').map((line, i) => (
            <RulesLine key={i} line={line} />
          ))}
        </motion.div>
      )}

      <motion.div variants={infoItem}>
        <span className="label">Dans ta collection</span>
        {entry ? (
          <>
            <p className="text-sm text-slate-300 mb-2">
              <b className="text-white tabular-nums">×{entry.total}</b>
              {entry.foil > 0 && <span className="foil-text font-semibold"> dont {entry.foil} foil</span>}
              {entry.copies.length > 1 || copies[0]?.card.id !== card.id ? (
                <span className="text-slate-500"> · toutes éditions</span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {copies.map((copy) => (
                <button
                  key={`${copy.binder.id}-${copy.cardNumber}`}
                  onClick={() => onLocate(copy.binder.id, parseInt(copy.cardNumber, 10))}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-300 bg-white/[0.04] ring-1 ring-inset ring-white/10 hover:bg-indigo-500/15 hover:ring-indigo-400/50 hover:text-white transition-colors"
                  title="Ouvrir la farde sur cette carte"
                >
                  <MapPin size={12} className="text-indigo-300" />
                  <span className="font-medium">{copy.binder.name}</span>
                  <span className="text-slate-500">
                    p.{copy.location.page} · R{copy.location.row} C{copy.location.col}
                  </span>
                  <span className="text-slate-400">×{copy.normal + copy.foil}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Pas encore dans tes fardes.</p>
        )}
        {usedBy.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {usedBy.map((deck) => (
              <button
                key={deck.id}
                onClick={() => onOpenDeck(deck.id)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-sky-200 bg-sky-500/10 ring-1 ring-inset ring-sky-400/25 hover:bg-sky-500/20 transition-colors"
              >
                <Layers size={12} />
                {deck.cards.find((c) => c.key === card.key)?.qty}× dans {deck.name}
              </button>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div variants={infoItem} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
        <div className="text-sm">
          <span className="text-white font-bold tabular-nums">{prices.format(price)}</span>
          {foilPrice != null && foilPrice !== price && (
            <span className="text-slate-400">
              {' '}
              · <span className="foil-text font-semibold">foil</span> {prices.format(foilPrice)}
            </span>
          )}
          <span className="block text-[10px] text-slate-600">{prices.source}</span>
        </div>
        {index && (
          <div className="flex gap-1.5">
            {FORMATS.map((f) => {
              const legal = getLegality(index, card.key, f.key) === 'legal';
              return (
                <span
                  key={f.key}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ${
                    legal ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/25' : 'bg-white/[0.03] text-slate-500 ring-white/10'
                  }`}
                >
                  {legal ? <Check size={11} /> : <Ban size={11} />}
                  {f.label}
                </span>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

/** Lorcast serves each picture in normal and large sizes: the large one for sharp screens. */
const largeImage = (url) => url?.replace('/digital/normal/', '/digital/large/');

/**
 * Full-screen card view opened from any thumbnail: the binder sheet's flip-in, pointer tilt,
 * holographic glare and foil sheen, with the card's details and the user's copies.
 */
const CardPreview = ({ state, onClose, onNavigate, onLocate, onOpenDeck }) => {
  const card = state?.cards[state.index];
  const count = state?.cards.length ?? 0;
  const foil = Boolean(card && state.foilIds.has(card.id));
  const glow = card?.inks.map((ink) => getInk(ink).color) ?? [];

  return createPortal(
    <AnimatePresence>
      {card && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md"
          />
          <div key="stage" className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-6 pointer-events-none">
            {count > 1 && (
              <>
                <button
                  onClick={() => onNavigate(-1)}
                  disabled={state.index === 0}
                  className="hidden sm:flex pointer-events-auto absolute left-4 lg:left-8 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full surface text-slate-300 hover:text-white hover:scale-110 transition-all disabled:opacity-0"
                  aria-label="Carte précédente"
                  title="Carte précédente (←)"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  onClick={() => onNavigate(1)}
                  disabled={state.index === count - 1}
                  className="hidden sm:flex pointer-events-auto absolute right-4 lg:right-8 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full surface text-slate-300 hover:text-white hover:scale-110 transition-all disabled:opacity-0"
                  aria-label="Carte suivante"
                  title="Carte suivante (→)"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={card.fullName}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className="pointer-events-auto w-full sm:w-auto sm:max-w-5xl max-h-[94vh] overflow-y-auto scrollbar-thin rounded-t-3xl sm:rounded-none surface sm:bg-transparent sm:border-0 sm:shadow-none sm:backdrop-blur-none sm:overflow-visible"
            >
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-6 sm:gap-10 p-5 sm:p-0">
                {/* Card */}
                <div className="relative flex-shrink-0 w-56 sm:w-72 lg:w-[22rem]" style={{ perspective: 1400 }}>
                  <motion.div
                    aria-hidden
                    className="absolute -inset-10 rounded-full blur-3xl pointer-events-none"
                    style={{
                      background: `radial-gradient(circle at 35% 35%, ${glow[0] ?? '#6366f1'}66, transparent 60%), radial-gradient(circle at 70% 70%, ${glow[1] ?? glow[0] ?? '#8b5cf6'}55, transparent 60%)`,
                    }}
                    animate={{ opacity: [0.55, 0.9, 0.55], scale: [0.94, 1.04, 0.94] }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    initial={{ rotateY: -100, scale: 0.85 }}
                    animate={{ rotateY: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.05 }}
                  >
                    <AnimatePresence mode="popLayout" initial={false} custom={state.dir}>
                      <motion.div
                        key={card.id}
                        custom={state.dir}
                        variants={slideVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        drag={count > 1 ? 'x' : false}
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.5}
                        onDragEnd={(_, info) => {
                          if (info.offset.x < -70) onNavigate(1);
                          else if (info.offset.x > 70) onNavigate(-1);
                        }}
                      >
                        <TiltCard
                          max={18}
                          className="pocket-shine aspect-[5/7] rounded-[18px] overflow-hidden ring-1 ring-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] bg-slate-900"
                        >
                          {foil && (
                            <div aria-hidden className="foil-sheen pointer-events-none absolute inset-0 z-[4] mix-blend-color-dodge" />
                          )}
                          {card.image ? (
                            <img
                              src={card.image}
                              srcSet={`${card.image} 1x, ${largeImage(card.image)} 2x`}
                              alt={card.fullName}
                              draggable={false}
                              className="absolute inset-0 w-full h-full object-cover select-none"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-lg font-bold text-slate-400">
                              {card.fullName}
                            </div>
                          )}
                        </TiltCard>
                      </motion.div>
                    </AnimatePresence>
                  </motion.div>
                  {count > 1 && (
                    <div className="mt-4 flex items-center justify-center gap-3 text-xs text-slate-500 tabular-nums">
                      <button onClick={() => onNavigate(-1)} disabled={state.index === 0} className="btn-icon p-1 sm:hidden" aria-label="Carte précédente">
                        <ChevronLeft size={16} />
                      </button>
                      {state.index + 1} / {count}
                      <button onClick={() => onNavigate(1)} disabled={state.index === count - 1} className="btn-icon p-1 sm:hidden" aria-label="Carte suivante">
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="w-full sm:w-[24rem] lg:w-[28rem] sm:surface sm:rounded-2xl sm:p-6 sm:max-h-[86vh] sm:overflow-y-auto scrollbar-thin">
                  <CardInfo card={card} foil={foil} onLocate={onLocate} onOpenDeck={onOpenDeck} onClose={onClose} />
                  <div className="hidden sm:flex gap-3 mt-5 pt-4 border-t border-white/5 text-[11px] text-slate-500">
                    {count > 1 && (
                      <span>
                        <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> Carte voisine
                      </span>
                    )}
                    <span>
                      <kbd className="kbd">Esc</kbd> Fermer
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default CardPreview;
