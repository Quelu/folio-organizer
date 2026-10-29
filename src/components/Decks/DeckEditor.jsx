import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Split,
  ArrowLeft,
  Minus,
  Plus,
  MoreHorizontal,
  Copy,
  Trash2,
  Sparkles,
  BookMarked,
  Layers,
  ImageDown,
  Lock,
  LockOpen,
  Menu as MenuIcon,
  FlaskConical,
  ClipboardPaste,
  ExternalLink,
} from 'lucide-react';
import Menu from '../ui/Menu';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import ProgressBar from '../ui/ProgressBar';
import DeckStats from './DeckStats';
import DeckCardPicker from './DeckCardPicker';
import MissingCards from './MissingCards';
import PullList from './PullList';
import DeckVersions from './DeckVersions';
import HandSimulator from './HandSimulator';
import DeckProfile from './DeckProfile';
import DeckImageModal from './DeckImageModal';
import DeckListModal from './DeckListModal';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { analyzeDeck, changeDeckCard, formatDeckList, getMaxCopies } from '../../utils/deckRules';
import { getInk, getMainType, CARD_TYPES, FORMATS } from '../../utils/catalog';
import { useCardLang } from '../../hooks/useCardLang';
import { useCopyAllocation } from '../../hooks/useCopyAllocation';
import { useDeckColor } from '../../hooks/useDeckColor';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useToast } from '../ui/toastContext';
import SharedCardsPanel from './SharedCardsPanel';
import { DeckTagPicker } from './DeckTags';

/** The deck's source as a link to open: "inkdecks.com/…" gets its https://. */
const sourceLink = (url) => {
  const value = url?.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

const TABS = [
  { key: 'list', label: 'Liste' },
  { key: 'profile', label: 'Analyse' },
  { key: 'missing', label: 'Manquantes' },
  { key: 'pull', label: 'Collecte' },
  { key: 'hand', label: 'Main de départ' },
  { key: 'versions', label: 'Versions' },
];

/** One deck line: picture, name, cost, owned copies and a quantity stepper. */
const DeckRow = ({ entry, rotating, share, onChange }) => {
  const cardLang = useCardLang();
  const colorOf = useDeckColor();
  const { card, qty, owned } = entry;
  const name = cardLang.fullName(card, entry.name);
  // Copies another deck holds: assigned to it, or still disputed with it
  const others = share?.decks.filter((d) => d.deck.id !== share.deckId && (d.assigned > 0 || share.contested)) ?? [];
  const short = owned < qty;
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
      {card ? <CardThumb card={card} className="w-9 flex-shrink-0" /> : <div className="w-9 aspect-[5/7] rounded bg-white/5" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 truncate">{name}</div>
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
          {card?.inks.map((ink) => (
            <span key={ink} className="w-1.5 h-1.5 rounded-full" style={{ background: getInk(ink).color }} />
          ))}
          <span>
            {card ? `${card.cost}${card.inkwell ? ' ⬡' : ''}` : '?'}
          </span>
          <span className={short ? 'text-amber-300' : 'text-emerald-400/80'}>
            · {Math.min(owned, qty)}/{qty} possédée{qty > 1 ? 's' : ''}
          </span>
          {rotating && <span className="text-amber-300/80">· rotation</span>}
        </div>
        {others.length > 0 && (
          <div
            className={`mt-0.5 flex items-center gap-1 text-[10px] ${share.contested ? 'text-amber-300' : 'text-sky-300/90'}`}
            title={share.contested ? 'Exemplaires disputés avec un autre deck : répartis-les plus haut' : 'Exemplaires réservés pour un autre deck'}
          >
            <Split size={10} className="flex-shrink-0" />
            <span className="truncate">
              {share.contested
                ? `partagée avec ${others.map((d) => d.deck.name).join(', ')}`
                : others
                    .map((d) => (d.deck.locked ? `${d.assigned} verrouillée${d.assigned > 1 ? 's' : ''} dans ${d.deck.name}` : `${d.assigned} pour ${d.deck.name}`))
                    .join(', ')}
            </span>
            {others.map((d) => (
              <span key={d.deck.id} className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorOf(d.deck.id) }} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center rounded-lg ring-1 ring-inset ring-white/10 bg-slate-950/50">
        <button onClick={() => onChange(-1)} className="btn-icon p-1.5" aria-label={`Retirer ${name}`}>
          <Minus size={13} />
        </button>
        <span className="w-6 text-center text-sm font-bold text-white tabular-nums">{qty}</span>
        <button
          onClick={() => onChange(1)}
          disabled={qty >= getMaxCopies(card)}
          className="btn-icon p-1.5"
          aria-label={`Ajouter ${name}`}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
};

/** A deck's page: card list and picker, missing cards, pull list, hand simulator, versions. */
const DeckEditor = ({ deck, onBack, onOpenSidebar, onLocate, onDelete }) => {
  const { updateDeck, duplicateDeck, setView } = useStore();
  const notify = useToast();
  const { index } = useCatalog();
  const collection = useCollection();
  const [tab, setTab] = useState('list');
  const [imageOpen, setImageOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const source = sourceLink(deck.sourceUrl);
  // On a phone the deck's name needs the room: "Simuler" goes in the menu
  const wide = useMediaQuery('(min-width: 640px)');
  const cardLang = useCardLang();
  const allocation = useCopyAllocation();
  const analysis = useMemo(
    () => analyzeDeck(deck, index, collection, cardLang.lang, allocation.availableFor),
    [deck, index, collection, cardLang.lang, allocation]
  );
  const shareOf = (key) => {
    const item = allocation.shared.find((s) => s.key === key);
    return item ? { ...item, deckId: deck.id } : null;
  };
  const rotatingKeys = new Set(analysis.rotating.map((e) => e.key));

  const setCards = (cards) => updateDeck(deck.id, { cards });
  const setLocked = (locked) => {
    updateDeck(deck.id, { locked });
    notify({
      message: locked
        ? 'Cartes verrouillées : elles ne servent plus qu’à ce deck, ni aux autres decks ni aux échanges'
        : 'Cartes déverrouillées : elles reviennent en commun avec tes autres decks',
      action: { label: 'Annuler', onClick: () => updateDeck(deck.id, { locked: !locked }) },
    });
  };
  const groups = CARD_TYPES.map((t) => ({
    ...t,
    entries: analysis.entries
      .filter((e) => (e.card ? getMainType(e.card) : 'Character') === t.key)
      .sort(
        (a, b) =>
          (a.card?.cost ?? 99) - (b.card?.cost ?? 99) ||
          cardLang.fullName(a.card, a.name).localeCompare(cardLang.fullName(b.card, b.name))
      ),
  })).filter((g) => g.entries.length);

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 sm:px-6 pt-4 pb-3">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start gap-2">
            <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
              <MenuIcon size={20} />
            </button>
            <button onClick={onBack} className="btn-icon -ml-1 mt-0.5" aria-label="Retour aux decks" title="Retour aux decks">
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {deck.kind === 'reference' && (
                  <span className="px-2 py-0.5 rounded-md font-semibold bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/25">
                    Référence
                  </span>
                )}
                {deck.locked && (
                  <span
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/25"
                    title="Ses cartes lui sont réservées : aucun autre deck ne les utilise et elles ne sont jamais proposées en échange"
                  >
                    <Lock size={11} /> Verrouillé
                  </span>
                )}
                {analysis.inks.map((ink) => (
                  <span key={ink} className="flex items-center gap-1 text-slate-400">
                    <span className="w-2 h-2 rounded-full" style={{ background: getInk(ink).color }} />
                    {getInk(ink).label}
                  </span>
                ))}
                <DeckTagPicker deck={deck} />
              </div>
              <input
                value={deck.name}
                onChange={(e) => updateDeck(deck.id, { name: e.target.value })}
                className="w-full bg-transparent text-xl sm:text-2xl font-bold text-white mt-1 focus:outline-none focus:ring-0 rounded"
                aria-label="Nom du deck"
              />
            </div>
            {wide && (
              <button
                onClick={() => setView({ kind: 'decks', simulate: true, from: deck.id })}
                className="btn-secondary px-3 py-2 mt-0.5"
                title="Faire affronter un autre deck à ce deck"
              >
                <FlaskConical size={15} className="text-violet-300" />
                Simuler
              </button>
            )}
            <button
              onClick={() => setView({ kind: 'assistant', deckId: deck.id })}
              className="btn-secondary px-3 py-2 mt-0.5"
              title="Demander à l'assistant IA d'améliorer ce deck"
            >
              <Sparkles size={15} className="text-violet-300" />
              <span className="hidden sm:inline">Améliorer avec l'IA</span>
            </button>
            <Menu
              label="Plus d'actions"
              trigger={
                <span className="btn-icon mt-0.5">
                  <MoreHorizontal size={18} />
                </span>
              }
              items={[
                wide
                  ? null
                  : {
                      label: 'Simuler contre un autre deck',
                      icon: FlaskConical,
                      onClick: () => setView({ kind: 'decks', simulate: true, from: deck.id }),
                    },
                {
                  label: deck.kind === 'reference' ? 'Passer dans mes decks' : 'Passer en référence',
                  icon: deck.kind === 'reference' ? Layers : BookMarked,
                  // A reference deck takes no copies from the collection: nothing left to lock
                  onClick: () => updateDeck(deck.id, { kind: deck.kind === 'reference' ? 'mine' : 'reference', locked: false }),
                },
                deck.kind !== 'reference'
                  ? {
                      label: deck.locked ? 'Déverrouiller ses cartes' : 'Verrouiller ses cartes',
                      icon: deck.locked ? LockOpen : Lock,
                      onClick: () => setLocked(!deck.locked),
                    }
                  : null,
                {
                  label: 'Mettre à jour la liste',
                  icon: ClipboardPaste,
                  onClick: () => setListOpen(true),
                },
                {
                  label: 'Exporter en image',
                  icon: ImageDown,
                  onClick: () => setImageOpen(true),
                },
                {
                  label: 'Dupliquer',
                  icon: Copy,
                  onClick: () => {
                    const id = duplicateDeck(deck.id);
                    if (id) setView({ kind: 'decks', deckId: id });
                  },
                },
                'divider',
                { label: 'Supprimer le deck', icon: Trash2, onClick: onDelete, danger: true },
              ]}
            />
          </div>

          <div className="flex items-center gap-x-5 gap-y-2 mt-3 flex-wrap">
            <div className="flex items-center rounded-lg ring-1 ring-inset ring-white/10 p-0.5">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => updateDeck(deck.id, { format: f.key })}
                  aria-pressed={deck.format === f.key}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    deck.format === f.key ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              <b className={analysis.total >= 60 ? 'text-white' : 'text-amber-300'}>{analysis.total}</b>/60 cartes
            </span>
            <div className="flex items-center gap-2.5 flex-1 min-w-[160px] max-w-xs">
              <ProgressBar value={analysis.ownedRatio} className="flex-1 h-1.5" />
              <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                <b className="text-white">{Math.round(analysis.ownedRatio * 100)} %</b> possédé
              </span>
            </div>
          </div>

          <div className="flex gap-1 mt-4 overflow-x-auto scrollbar-thin -mx-1 px-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  tab === t.key ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
                {t.key === 'missing' && analysis.missing.length > 0 && (
                  <span className="ml-1.5 text-[11px] text-amber-300 tabular-nums">
                    {analysis.missing.reduce((s, e) => s + e.missing, 0)}
                  </span>
                )}
                {tab === t.key && (
                  <motion.span layoutId="deck-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 py-5 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          {(tab === 'list' || tab === 'missing') && deck.kind !== 'reference' && (
            <div className="mb-5">
              <SharedCardsPanel
                deckId={deck.id}
                defaultOpen={false}
                onOpenDeck={(id) => setView({ kind: 'decks', deckId: id })}
              />
            </div>
          )}
          {tab === 'list' && (
            <div className="grid md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px] gap-6">
              <section data-preview-group>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Deck</h2>
                  <span title="Noms anglais, le format de Dreamborn, Inktable et Pixelborn">
                    <CopyButton text={formatDeckList(deck, index)} label="Copier la liste" toast="Liste copiée (noms anglais)" />
                  </span>
                </div>
                {groups.length === 0 && (
                  <p className="text-sm text-slate-500 py-6">Deck vide : ajoute des cartes avec la recherche.</p>
                )}
                {groups.map((g) => (
                  <div key={g.key} className="mb-4">
                    <div className="text-[11px] uppercase tracking-wider text-slate-600 px-2 mb-1">
                      {g.label}s · {g.entries.reduce((s, e) => s + e.qty, 0)}
                    </div>
                    {g.entries.map((entry) => (
                      <DeckRow
                        key={entry.key}
                        entry={entry}
                        rotating={rotatingKeys.has(entry.key)}
                        share={shareOf(entry.key)}
                        onChange={(delta) =>
                          setCards(
                            changeDeckCard(deck.cards, entry.card ?? { key: entry.key, id: entry.id, fullName: entry.name }, delta)
                          )
                        }
                      />
                    ))}
                  </div>
                ))}
              </section>
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Ajouter des cartes</h2>
                <DeckCardPicker deck={deck} deckInks={analysis.inks} onAdd={(card) => setCards(changeDeckCard(deck.cards, card, 1))} />
              </section>
              <aside className="space-y-5 md:col-span-2 xl:col-span-1">
                <DeckStats analysis={analysis} />
                <div>
                  <label className="label" htmlFor="deck-notes">
                    Notes
                  </label>
                  <textarea
                    id="deck-notes"
                    value={deck.notes}
                    onChange={(e) => updateDeck(deck.id, { notes: e.target.value })}
                    rows={4}
                    placeholder={deck.kind === 'reference' ? 'Archétype, résultat en tournoi, plan de jeu… (lu par l’assistant IA)' : 'Plan de jeu, mulligans, matchups…'}
                    className="field text-xs scrollbar-thin"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="deck-source">
                    Source
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="deck-source"
                      type="url"
                      value={deck.sourceUrl ?? ''}
                      onChange={(e) => updateDeck(deck.id, { sourceUrl: e.target.value })}
                      placeholder="https://… (Dreamborn, Inkdecks…)"
                      className="field text-xs"
                    />
                    {source && (
                      <a
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-icon flex-shrink-0"
                        title="Ouvrir la source"
                        aria-label="Ouvrir la source"
                      >
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          )}
          {tab === 'profile' && <DeckProfile analysis={analysis} />}
          {tab === 'missing' && (
            <div className="max-w-2xl">
              <MissingCards entries={analysis.missing} />
            </div>
          )}
          {tab === 'pull' && (
            <div className="max-w-3xl">
              <PullList deck={deck} onLocate={onLocate} />
            </div>
          )}
          {tab === 'hand' && <HandSimulator analysis={analysis} />}
          {tab === 'versions' && (
            <div className="max-w-2xl">
              <DeckVersions deck={deck} />
            </div>
          )}
        </div>
      </div>
      <DeckImageModal isOpen={imageOpen} onClose={() => setImageOpen(false)} deck={deck} analysis={analysis} />
      <DeckListModal isOpen={listOpen} onClose={() => setListOpen(false)} deck={deck} />
    </div>
  );
};

export default DeckEditor;
