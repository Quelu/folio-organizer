import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Library, Swords, ChevronDown, Check, Lock, Link2, Unlink, X, MapPin, ShoppingBag } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { CardGrid, Segmented } from './CollectionParts';
import { PocketHint } from '../Trades/PocketMap';
import IncomingPurchases from './IncomingPurchases';
import { useToast } from '../ui/toastContext';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useDeckColor } from '../../hooks/useDeckColor';
import { getMainPrinting, SPECIAL_RARITIES } from '../../utils/catalog';
import { matchesCard } from '../../utils/collectionFilters';
import { getDeckWantsLines, getSaleLines, splitWantsLists } from '../../utils/cardmarketExport';
import { getWantList, summarizeWants, suggestDeckGroups, getDeckSetSignature, getWantCost, getWantSpecials } from '../../utils/wantList';

/** Section colors: binders violet, decks orange, a copy serving both teal. */
const TONES = {
  binder: { bar: 'bg-violet-400', text: 'text-violet-300', section: 'bg-violet-500/[0.04] ring-violet-400/20', icon: 'bg-violet-400/15 text-violet-300' },
  deck: { bar: 'bg-orange-400', text: 'text-orange-300', section: 'bg-orange-500/[0.04] ring-orange-400/20', icon: 'bg-orange-400/15 text-orange-300' },
  both: { bar: 'bg-teal-400', text: 'text-teal-300' },
};

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const SPECIAL_LABELS = { Epic: 'Épiques', Enchanted: 'Enchantées', Iconic: 'Iconiques' };

/** Cardmarket wants of empty pockets, each in its chapter's printing. */
const pocketWants = (wanted, index) => getSaleLines(wanted.map((w) => ({ card: w.card, foil: false, qty: 1 })), index);

/** Cardmarket wants of a deck's missing copies, as the newest regular printing. */
const deckWants = (lines, index) =>
  getDeckWantsLines(
    lines.map((l) => ({ key: l.key, qty: l.missing })),
    index,
    getMainPrinting,
    false
  );

/** Copy buttons for a wants list, split in lists Cardmarket accepts. */
const WantsCopy = ({ lines, label = 'Wants Cardmarket' }) => {
  const lists = splitWantsLists(lines).map((l) => l.join('\n'));
  return lists.map((text, i) => (
    <CopyButton
      key={i}
      text={text}
      label={lists.length > 1 ? `${label} ${i + 1}/${lists.length}` : label}
      toast="Liste Cardmarket copiée"
      className="btn-secondary px-2.5 py-1 text-xs"
    />
  ));
};

const BoughtButton = ({ onClick, label = 'Achetée', title = 'Achetée : en attente de réception' }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-300 whitespace-nowrap"
  >
    <ShoppingBag size={11} /> {label}
  </button>
);

const BothBadge = ({ label, title }) => (
  <span
    title={title}
    className="px-1.5 py-px rounded text-[10px] font-semibold text-teal-200 bg-teal-400/15 ring-1 ring-inset ring-teal-400/25 whitespace-nowrap"
  >
    {label}
  </span>
);

/** A block of the want list, its cards unfolded on demand. */
const Block = ({ header, open, onToggle, children }) => (
  <div className="rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06]">
    <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
      {header}
      <ChevronDown size={15} className={`flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="px-3 pb-3">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

/** An empty pocket: the card, its number, and the binder page around it on hover of its place. */
const PocketTile = ({ want, price, onBought }) => {
  const [anchor, setAnchor] = useState(null);
  const hide = useCallback(() => setAnchor(null), []);
  const show = (e) => setAnchor(e.currentTarget.getBoundingClientRect());
  return (
    <div className="min-w-0">
      <CardThumb card={want.card} />
      <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          className="flex items-center gap-0.5 text-slate-400 hover:text-white tabular-nums"
          aria-label={`Emplacement du n° ${want.cardNumber}`}
        >
          <MapPin size={11} />
          {want.cardNumber}
        </button>
        <span className="text-slate-500 tabular-nums">{price}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
        {want.alsoDeck && <BothBadge label="+ deck" title="Un de tes decks en manque aussi : cette copie servira aux deux" />}
        <BoughtButton onClick={onBought} />
      </div>
      {anchor && <PocketHint pocket={{ binder: want.binder, cardNumber: want.cardNumber, mode: 'in', card: want.card }} anchor={anchor} onClose={hide} />}
    </div>
  );
};

/** A card a deck unit misses: who plays it, what is owned, what to find. */
const DeckLine = ({ line, unit, colorOf, onOpenDeck, onBought }) => {
  const cardLang = useCardLang();
  const shared = line.sharedWith.flatMap((u) => u.decks.map((d) => d.name));
  return (
    <li className="flex items-center gap-3 py-2">
      {line.card ? <CardThumb card={line.card} className="w-10 flex-shrink-0" /> : <div className="w-10 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{cardLang.keyName(line.key, line.name)}</div>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {unit.grouped &&
            line.decks.map((d) => (
              <button
                key={d.deck.id}
                onClick={() => onOpenDeck(d.deck.id)}
                className="inline-flex items-center gap-1.5 px-1.5 py-px rounded text-[10px] text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 hover:text-white"
                title="Ouvrir le deck"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(d.deck.id) }} />
                {d.deck.name} ×{d.qty}
              </button>
            ))}
          {line.alsoBinder && <BothBadge label="farde + deck" title="Une pochette de tes fardes l'attend aussi : une copie servira aux deux" />}
          {shared.length > 0 && (
            <span className="text-[10px] text-slate-500" title={`Aussi joué par : ${shared.join(', ')}`}>
              partagée avec {plural(shared.length, 'autre deck')}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap" title="Copies possédées pour ce deck / copies jouées">
        <b className="text-white">{line.owned}</b>/{line.need}
      </span>
      <span className="w-10 text-right text-sm font-bold tabular-nums text-orange-300">+{line.missing}</span>
      {line.card && <BoughtButton onClick={onBought} title={`${line.missing} achetée${line.missing > 1 ? 's' : ''} : en attente de réception`} />}
    </li>
  );
};

/**
 * The want list: the empty pockets of the binders and the copies the decks miss, side by side,
 * each card counted once in the totals and the Cardmarket list (see getWantList).
 */
const WantListTab = ({ ctx, prices, onOpenDeck }) => {
  const { binders, decks: allDecks, deckGroups, allocations, purchases, prefs, setPref, groupDecks, ungroupDecks, markBought, cancelPurchases } = useStore();
  const notify = useToast();
  const cardLang = useCardLang();
  const colorOf = useDeckColor();
  const { index, collection, filters, query } = ctx;
  const specials = useMemo(() => getWantSpecials(prefs), [prefs]);
  const toggleSpecial = (rarity, on) =>
    setPref('wantSpecialRarities', on ? [...specials, rarity] : specials.filter((r) => r !== rarity));
  const dismissed = useMemo(() => prefs.dismissedDeckGroups ?? [], [prefs.dismissedDeckGroups]);
  const [lens, setLens] = useState('all');
  const [openBlocks, setOpenBlocks] = useState({});
  const toggle = (id) => setOpenBlocks((o) => ({ ...o, [id]: !o[id] }));

  const list = useMemo(
    () => getWantList({ binders, decks: allDecks, index, collection, groups: deckGroups, allocations, specials, incoming: purchases }),
    [binders, allDecks, index, collection, deckGroups, allocations, specials, purchases]
  );
  const suggestions = useMemo(() => suggestDeckGroups(allDecks, deckGroups, dismissed), [allDecks, deckGroups, dismissed]);

  // What the filters and the lens leave on screen; the totals follow
  const shown = useMemo(() => {
    const binderFilter = filters.binders.length ? new Set(filters.binders) : null;
    const deckFilter = filters.decks.length ? new Set(filters.decks) : null;
    const binderLists =
      lens !== 'decks'
      ? list.binders
          .filter((b) => !binderFilter || binderFilter.has(b.binder.id))
          .map((b) => ({ ...b, wanted: b.wanted.filter((w) => matchesCard(w.card, filters, query, ctx)) }))
      : [];
    // The chapter filter names the binders' chapters; a deck card is any printing
    const lineFilters = { ...filters, sets: [] };
    const units =
      lens !== 'binders'
        ? list.units
            .filter((u) => !deckFilter || u.decks.some((d) => deckFilter.has(d.id)))
            .map((u) => ({
              ...u,
              lines: u.cards
                .filter((l) => l.missing > 0 && (!l.card ? !query : matchesCard(l.card, lineFilters, query, ctx)))
                .sort((a, b) => b.missing - a.missing || cardLang.keyName(a.key, a.name).localeCompare(cardLang.keyName(b.key, b.name))),
            }))
        : [];
    const summary = summarizeWants(
      binderLists.flatMap((b) => b.wanted),
      units.flatMap((u) => u.lines),
      index
    );
    return { binderLists, units, ...summary };
  }, [list, filters, query, ctx, lens, index, cardLang]);

  const priceOf = (card) => (card ? prices.getPrice(card) : null);

  /** Notes copies as bought (pockets: 1 in their printing; deck lines: their missing copies), with a way back. */
  const bought = ({ pockets = [], lines = [] }) => {
    const items = [
      ...pockets.map((w) => ({ cardId: w.card.id, key: w.key, qty: 1 })),
      ...lines.filter((l) => l.card).map((l) => ({ cardId: l.card.id, key: l.key, qty: l.missing })),
    ];
    const ids = markBought(items);
    const n = items.reduce((s, i) => s + i.qty, 0);
    notify({
      tone: 'success',
      message: `${n} copie${n > 1 ? 's' : ''} en attente de réception`,
      action: { label: 'Annuler', onClick: () => cancelPurchases(ids) },
      duration: 7000,
    });
  };
  const awaiting = Object.values(purchases).reduce((s, p) => s + p.qty, 0);
  const cost = getWantCost(shown.cards, index, prices.getPrice);

  // Pockets in their chapter's printing, the decks' extra copies as the newest regular printing
  const cardmarketLists = splitWantsLists([
    ...getSaleLines(
      shown.cards.flatMap((c) => c.pockets.map((w) => ({ card: w.card, foil: false, qty: 1 }))),
      index
    ),
    ...getDeckWantsLines(
      shown.cards.filter((c) => c.copies > c.pockets.length).map((c) => ({ key: c.key, qty: c.copies - c.pockets.length })),
      index,
      getMainPrinting,
      false
    ),
  ]).map((lines) => lines.join('\n'));

  const { totals } = shown;
  const segments = [
    { key: 'binder', label: 'Fardes', value: totals.binderOnly },
    { key: 'both', label: 'Les deux', value: totals.both },
    { key: 'deck', label: 'Decks', value: totals.deckOnly },
  ];
  const completeUnits = shown.units.filter((u) => u.missing === 0 && !filters.decks.length);
  const wantingUnits = shown.units.filter((u) => u.lines.length > 0);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Heart size={15} className="text-indigo-300" />
              Want list
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {totals.copies === 0 ? (
                <span className="text-emerald-300">Rien ne manque ici 🎉</span>
              ) : (
                <>
                  <b className="text-white text-lg tabular-nums">{totals.copies}</b> {totals.copies > 1 ? 'copies' : 'copie'} à trouver ·
                  environ <b className="text-white">{prices.format(cost)}</b>
                </>
              )}
              {awaiting > 0 && <span className="text-emerald-300"> · {awaiting} en attente de réception</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Partie affichée"
              value={lens}
              onChange={setLens}
              options={[
                { value: 'all', label: 'Tout' },
                { value: 'binders', label: 'Fardes', icon: Library },
                { value: 'decks', label: 'Decks', icon: Swords },
              ]}
            />
            {totals.copies > 0 &&
              cardmarketLists.map((text, i) => (
                <CopyButton
                  key={i}
                  text={text}
                  label={cardmarketLists.length > 1 ? `Cardmarket ${i + 1}/${cardmarketLists.length}` : 'Copier pour Cardmarket'}
                  toast="Liste Cardmarket copiée"
                />
              ))}
          </div>
        </div>
        {totals.copies > 0 && (
          <>
            <div className="flex h-2 rounded-full overflow-hidden bg-white/5 mt-4" aria-hidden>
              {segments.map((s) => (
                <div key={s.key} className={`h-full ${TONES[s.key].bar}`} style={{ width: `${(s.value / totals.copies) * 100}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
              {segments.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5" title={s.key === 'both' ? 'Une copie remplit une pochette et sert à un deck' : undefined}>
                  <span className={`w-2 h-2 rounded-sm ${TONES[s.key].bar}`} />
                  {s.label} <b className="text-white tabular-nums">{s.value}</b>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <IncomingPurchases index={index} />

      {lens !== 'decks' && (
        <section data-preview-group className={`rounded-2xl ring-1 ring-inset p-4 sm:p-5 space-y-2 ${TONES.binder.section}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-white">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONES.binder.icon}`}>
                <Library size={16} />
              </span>
              <span>
                Pour mes fardes
                <span className="block text-xs font-normal text-slate-400">Une copie par pochette vide, dans la version du chapitre</span>
              </span>
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400" role="group" aria-label="Raretés spéciales voulues">
              <span>Aussi :</span>
              {SPECIAL_RARITIES.map((rarity) => (
                <label key={rarity} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={specials.includes(rarity)}
                    onChange={(e) => toggleSpecial(rarity, e.target.checked)}
                    className="w-4 h-4 accent-violet-500"
                  />
                  {SPECIAL_LABELS[rarity]}
                </label>
              ))}
            </div>
          </div>
          {shown.binderLists.length === 0 && <p className="text-sm text-slate-500">Aucune farde ne correspond à ces filtres.</p>}
          {shown.binderLists.map(({ binder, wanted, awaiting: binderAwaiting, owned, total }) =>
            wanted.length === 0 ? (
              <div key={binder.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06]">
                <span className="flex-1 min-w-0 text-sm text-slate-300 truncate">{binder.name}</span>
                <span className="text-xs text-emerald-300 flex items-center gap-1">
                  <Check size={13} />{' '}
                  {owned === total ? 'complète' : binderAwaiting ? `${binderAwaiting} en attente de réception` : 'rien avec ces filtres'}
                </span>
              </div>
            ) : (
              <Block
                key={binder.id}
                open={Boolean(openBlocks[binder.id])}
                onToggle={() => toggle(binder.id)}
                header={
                  <>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-white truncate">{binder.name}</span>
                      <span className="flex items-center gap-2 mt-1">
                        <ProgressBar value={total ? owned / total : 0} className="flex-1 max-w-48 h-1.5" />
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {owned}/{total}
                          {binderAwaiting > 0 && <span className="text-emerald-300"> · {binderAwaiting} en attente</span>}
                        </span>
                      </span>
                    </span>
                    <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${TONES.binder.text}`}>
                      {plural(wanted.length, 'pochette')}
                    </span>
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <WantsCopy lines={pocketWants(wanted, index)} />
                  <button onClick={() => bought({ pockets: wanted })} className="btn-secondary px-2.5 py-1 text-xs">
                    <ShoppingBag size={13} /> Tout marquer acheté ({wanted.length})
                  </button>
                </div>
                <CardGrid
                  items={wanted}
                  render={(w) => (
                    <PocketTile key={w.card.id} want={w} price={prices.format(priceOf(w.card))} onBought={() => bought({ pockets: [w] })} />
                  )}
                />
              </Block>
            )
          )}
        </section>
      )}

      {lens !== 'binders' && (
        <section data-preview-group className={`rounded-2xl ring-1 ring-inset p-4 sm:p-5 space-y-2 ${TONES.deck.section}`}>
          <h3 className="flex items-center gap-2.5 text-sm font-semibold text-white mb-2">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONES.deck.icon}`}>
              <Swords size={16} />
            </span>
            <span>
              Pour mes decks
              <span className="block text-xs font-normal text-slate-400">
                Toutes versions · les copies rangées en farde comptent · decks de référence exclus
              </span>
            </span>
          </h3>

          {suggestions.map((s) => (
            <div key={getDeckSetSignature(s.deckIds)} className="rounded-xl bg-indigo-500/[0.07] ring-1 ring-inset ring-indigo-400/20 p-3">
              <p className="text-sm text-slate-200">
                {s.decks.map((d) => `« ${d.name} »`).join(', ')} partagent au moins {Math.floor(s.overlap * 100)} % de leurs cartes.
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Des variantes du même deck ? Montées une à la fois, elles ne demandent pour chaque carte que le plus grand nombre de copies que l’une d’elles joue.
              </p>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => groupDecks(s.deckIds)} className="btn-primary px-3 py-1.5 text-xs">
                  <Link2 size={14} /> Une à la fois
                </button>
                <button
                  onClick={() => setPref('dismissedDeckGroups', [...dismissed, getDeckSetSignature(s.deckIds)])}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  <X size={14} /> Montées ensemble
                </button>
              </div>
            </div>
          ))}

          {wantingUnits.length === 0 && completeUnits.length === 0 && (
            <p className="text-sm text-slate-500">Aucun deck ne correspond à ces filtres.</p>
          )}
          {wantingUnits.map((unit) => (
            <Block
              key={unit.id}
              open={Boolean(openBlocks[unit.id])}
              onToggle={() => toggle(unit.id)}
              header={
                <>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {unit.decks.map((d) => (
                        <span key={d.id} className="flex items-center gap-1.5 text-sm text-white min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorOf(d.id) }} />
                          <span className="truncate">{d.name}</span>
                        </span>
                      ))}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 mt-1">
                      {unit.grouped && (
                        <span className="px-1.5 py-px rounded text-[10px] font-semibold text-orange-200 bg-orange-400/15 ring-1 ring-inset ring-orange-400/25">
                          {unit.decks.length} variantes · une à la fois
                        </span>
                      )}
                      {unit.locked && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-sky-300" title="Deck verrouillé : il garde ses copies">
                          <Lock size={10} /> verrouillé
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {unit.need - unit.missing}/{unit.need} copies possédées
                      </span>
                    </span>
                  </span>
                  <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${TONES.deck.text}`}>
                    {unit.lines.reduce((s, l) => s + l.missing, 0)} à trouver
                  </span>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <WantsCopy lines={deckWants(unit.lines, index)} />
                <button onClick={() => bought({ lines: unit.lines })} className="btn-secondary px-2.5 py-1 text-xs">
                  <ShoppingBag size={13} /> Tout marquer acheté ({unit.lines.reduce((s, l) => s + l.missing, 0)})
                </button>
              </div>
              <ul className="divide-y divide-white/5">
                {unit.lines.map((line) => (
                  <DeckLine
                    key={line.key}
                    line={line}
                    unit={unit}
                    colorOf={colorOf}
                    onOpenDeck={onOpenDeck}
                    onBought={() => bought({ lines: [line] })}
                  />
                ))}
              </ul>
              <div className="flex flex-wrap gap-3 mt-2">
                {unit.decks.map((d) => (
                  <button key={d.id} onClick={() => onOpenDeck(d.id)} className="text-[11px] text-slate-500 hover:text-white">
                    Ouvrir « {d.name} »
                  </button>
                ))}
                {unit.grouped && (
                  <button onClick={() => ungroupDecks(unit.id)} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white">
                    <Unlink size={11} /> Compter séparément
                  </button>
                )}
              </div>
            </Block>
          ))}
          {completeUnits.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-xs text-slate-500">
              <span className="flex items-center gap-1 text-emerald-300">
                <Check size={13} /> Complets :
              </span>
              {completeUnits.map((unit) =>
                unit.decks.map((d) => (
                  <button key={d.id} onClick={() => onOpenDeck(d.id)} className="hover:text-white">
                    {d.name}
                  </button>
                ))
              )}
              {completeUnits.some((u) => u.grouped) &&
                completeUnits
                  .filter((u) => u.grouped)
                  .map((u) => (
                    <button key={u.id} onClick={() => ungroupDecks(u.id)} className="flex items-center gap-1 hover:text-white">
                      <Unlink size={11} /> séparer {u.decks.map((d) => d.name).join(' / ')}
                    </button>
                  ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default WantListTab;
