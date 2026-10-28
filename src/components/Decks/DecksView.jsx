import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, ClipboardPaste, AlertTriangle, AlertCircle, CheckCircle2, Layers, BookMarked, Menu as MenuIcon, Loader2, Split, ChevronRight, Lock, Tag, Settings2 } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import ConfirmDialog from '../ui/ConfirmDialog';
import DeckEditor from './DeckEditor';
import DeckImportModal from './DeckImportModal';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useCollection } from '../../hooks/useCollection';
import { useToast } from '../ui/toastContext';
import { analyzeDeck } from '../../utils/deckRules';
import { useCopyAllocation } from '../../hooks/useCopyAllocation';
import SharedCardsPanel from './SharedCardsPanel';
import { TagChip, DeckTagsModal } from './DeckTags';
import { getInk } from '../../utils/catalog';
import { getDeckTags, matchesTags } from '../../utils/deckTags';

const DeckTile = ({ deck, tags, analysis, contested, onOpen }) => (
  <motion.button
    layout
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.95 }}
    whileHover={{ y: -3 }}
    onClick={onOpen}
    className="text-left rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 hover:ring-white/15 p-4 transition-colors"
  >
    <div className="flex items-center gap-1.5 mb-2 h-3">
      {analysis.inks.map((ink) => (
        <span key={ink} className="w-3 h-3 rounded-full ring-2 ring-slate-950" style={{ background: getInk(ink).color }} title={getInk(ink).label} />
      ))}
      <span className="ml-auto flex items-center gap-1.5">
        {contested > 0 && (
          <span
            className="flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] font-bold bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30"
            title="Cartes partagées avec un autre deck, à répartir"
          >
            <Split size={10} /> {contested}
          </span>
        )}
        {deck.locked && (
          <span title="Deck verrouillé : ses cartes lui sont réservées">
            <Lock size={11} className="text-sky-300" aria-label="Verrouillé" />
          </span>
        )}
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{deck.format === 'core' ? 'Core' : 'Infinity'}</span>
      </span>
    </div>
    <div className="font-semibold text-white truncate">{deck.name}</div>
    {tags.length > 0 && (
      <div className="flex flex-wrap gap-1 mt-1.5">
        {tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      </div>
    )}
    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
      <span className={analysis.total >= 60 ? '' : 'text-amber-300'}>{analysis.total}/60</span>
      {analysis.errors.length > 0 ? (
        <span className="flex items-center gap-1 text-rose-300">
          <AlertCircle size={12} /> {analysis.errors.length} problème{analysis.errors.length > 1 ? 's' : ''}
        </span>
      ) : analysis.warnings.length > 0 ? (
        <span className="flex items-center gap-1 text-amber-300">
          <AlertTriangle size={12} /> {analysis.warnings.length}
        </span>
      ) : (
        analysis.total > 0 && (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 size={12} /> valide
          </span>
        )
      )}
    </div>
    <div className="mt-3 flex items-center gap-2">
      <ProgressBar value={analysis.ownedRatio} className="flex-1 h-1" />
      <span className="text-[10px] tabular-nums text-slate-500">{Math.round(analysis.ownedRatio * 100)} % possédé</span>
    </div>
  </motion.button>
);

/** Deck list (yours and the reference decks the AI learns from), or one deck's editor. */
const DecksView = ({ onOpenSidebar, onLocate }) => {
  const notify = useToast();
  const { decks, deckTags, view, setView, createDeck, deleteDeck, restoreDeck } = useStore();
  const { index, status, loaded, total } = useCatalog();
  const cardLang = useCardLang();
  const collection = useCollection();
  const [tab, setTab] = useState('mine');
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  // Tags the list is filtered on, kept while a deck is open; matchAll: decks with all of them
  const [tagFilter, setTagFilter] = useState([]);
  const [matchAll, setMatchAll] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const allocation = useCopyAllocation();
  const analyses = useMemo(
    () => new Map(decks.map((d) => [d.id, analyzeDeck(d, index, collection, cardLang.lang, allocation.availableFor)])),
    [decks, index, collection, cardLang.lang, allocation]
  );
  // Shared cards still to split, per deck
  const contestedByDeck = (deckId) =>
    allocation.shared.filter((s) => s.contested && s.decks.some((d) => d.deck.id === deckId)).length;
  const illegal = decks.filter(
    (d) => d.kind !== 'reference' && d.format === 'core' && analyses.get(d.id).errors.some((e) => e.code === 'legality')
  );
  const rotating = decks.filter((d) => d.kind !== 'reference' && d.format === 'core' && analyses.get(d.id).rotating.length);

  const openDeck = view.deckId ? decks.find((d) => d.id === view.deckId) : null;
  const inTab = decks.filter((d) => (tab === 'reference' ? d.kind === 'reference' : d.kind !== 'reference'));
  // A deleted tag drops out of the filter
  const selectedTags = tagFilter.filter((id) => deckTags.some((t) => t.id === id));
  const shown = inTab.filter((d) => matchesTags(d, selectedTags, matchAll));
  const toggleTag = (tagId) =>
    setTagFilter((ids) => (ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]));

  const confirmDelete = () => {
    const snapshot = deleteDeck(pendingDelete.id);
    if (!snapshot) return;
    notify({
      message: `« ${snapshot.deck.name} » supprimé`,
      action: { label: 'Annuler', onClick: () => restoreDeck(snapshot) },
      duration: 7000,
    });
  };

  const deleteDialog = (
    <ConfirmDialog
      isOpen={Boolean(pendingDelete)}
      onClose={() => setPendingDelete(null)}
      onConfirm={confirmDelete}
      title="Supprimer le deck ?"
      message={pendingDelete && `« ${pendingDelete.name} » sera supprimé et ses cartes sorties remises dans les fardes.`}
      confirmLabel="Supprimer"
      danger
    />
  );

  if (openDeck) {
    return (
      <>
        <DeckEditor
          key={openDeck.id}
          deck={openDeck}
          onBack={() => setView({ kind: 'decks' })}
          onOpenSidebar={onOpenSidebar}
          onLocate={onLocate}
          onDelete={() => setPendingDelete(openDeck)}
        />
        {deleteDialog}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 sm:px-6 pt-4 pb-3">
        <div className="max-w-5xl mx-auto flex items-start gap-3">
          <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
            <MenuIcon size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Decks</h1>
            <p className="text-xs text-slate-500 mt-0.5">Construis avec ta collection, sors les cartes des fardes, teste tes mains.</p>
          </div>
          <button onClick={() => setImportOpen(true)} className="btn-secondary px-3 py-2">
            <ClipboardPaste size={15} />
            <span className="hidden sm:inline">Importer une liste</span>
          </button>
          <button
            onClick={() => {
              const id = createDeck({ name: tab === 'reference' ? 'Nouvelle référence' : 'Nouveau deck', kind: tab });
              setView({ kind: 'decks', deckId: id });
            }}
            className="btn-primary px-3 py-2"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Nouveau</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 pb-8">
        <div className="max-w-5xl mx-auto space-y-5">
          {!index && (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={15} className="animate-spin" />
              {status === 'error' ? 'Catalogue Lorcana indisponible.' : `Chargement du catalogue Lorcana (${loaded}/${total})…`}
            </p>
          )}

          {(illegal.length > 0 || rotating.length > 0) && (
            <div className="space-y-2">
              {[
                ...illegal.map((d) => ({ deck: d, tone: 'error', text: 'contient des cartes qui ne sont plus légales en Core.' })),
                ...rotating.map((d) => ({
                  deck: d,
                  tone: 'warning',
                  text: analyses.get(d.id).warnings.find((w) => w.code === 'rotation')?.message,
                })),
              ].map(({ deck: d, tone, text }) => (
                <button
                  key={`${tone}-${d.id}`}
                  onClick={() => setView({ kind: 'decks', deckId: d.id })}
                  className={`w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 ring-1 ring-inset transition-colors ${
                    tone === 'error'
                      ? 'bg-gradient-to-br from-rose-500/[0.09] to-transparent ring-rose-400/25 hover:ring-rose-400/40'
                      : 'bg-gradient-to-br from-amber-500/[0.07] to-transparent ring-amber-400/20 hover:ring-amber-400/35'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      tone === 'error' ? 'bg-rose-400/15 text-rose-300' : 'bg-amber-400/15 text-amber-300'
                    }`}
                  >
                    {tone === 'error' ? <AlertCircle size={17} /> : <AlertTriangle size={17} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-white truncate">{d.name}</span>
                    <span className="block text-xs text-slate-400 leading-snug">{text}</span>
                  </span>
                  <ChevronRight size={16} className="flex-shrink-0 text-slate-500" />
                </button>
              ))}
            </div>
          )}

          {tab === 'mine' && <SharedCardsPanel onOpenDeck={(id) => setView({ kind: 'decks', deckId: id })} />}

          <div className="flex gap-1">
            {[
              { key: 'mine', label: 'Mes decks', icon: Layers },
              { key: 'reference', label: 'Decks de référence', icon: BookMarked },
            ].map((t) => {
              const count = decks.filter((d) => (t.key === 'reference' ? d.kind === 'reference' : d.kind !== 'reference')).length;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    tab === t.key ? 'bg-white/[0.07] text-white ring-1 ring-inset ring-white/10' : 'text-slate-500 hover:text-white'
                  }`}
                >
                  <t.icon size={15} />
                  {t.label}
                  <span className="text-xs text-slate-500 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>

          {deckTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filtrer par tags">
              <Tag size={13} className="text-slate-500 mr-0.5" aria-hidden />
              {deckTags.map((tag) => {
                const active = selectedTags.includes(tag.id);
                const count = inTab.filter((d) => d.tags?.includes(tag.id)).length;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                      active ? 'font-medium' : 'ring-1 ring-inset ring-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    style={active ? { color: tag.color, background: `${tag.color}1f`, boxShadow: `inset 0 0 0 1px ${tag.color}99` } : undefined}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tag.color }} />
                    {tag.name}
                    <span className="text-[11px] tabular-nums opacity-60">{count}</span>
                  </button>
                );
              })}
              {selectedTags.length > 1 && (
                <div className="flex items-center rounded-md ring-1 ring-inset ring-white/10 p-0.5 ml-1" role="group" aria-label="Decks affichés">
                  {[
                    { value: false, label: 'Un des tags' },
                    { value: true, label: 'Tous les tags' },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setMatchAll(opt.value)}
                      aria-pressed={matchAll === opt.value}
                      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                        matchAll === opt.value ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {selectedTags.length > 0 && (
                <button type="button" onClick={() => setTagFilter([])} className="px-1.5 text-xs text-slate-500 hover:text-white">
                  Effacer
                </button>
              )}
              <button
                type="button"
                onClick={() => setTagsOpen(true)}
                className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-white"
              >
                <Settings2 size={13} /> Gérer les tags
              </button>
            </div>
          )}

          {tab === 'reference' && (
            <p className="text-sm text-slate-400 leading-relaxed rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-4">
              Ajoute ici des decks qui gagnent (Dreamborn, Inkdecks, Lorcana.gg, résultats de tournois) : colle leur liste
              avec « Importer une liste » et note l'archétype et le résultat. L'assistant IA s'en sert comme modèles
              pour construire des decks avec tes cartes.
            </p>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence initial={false}>
              {shown.map((deck) => (
                <DeckTile
                  key={deck.id}
                  deck={deck}
                  tags={getDeckTags(deck, deckTags)}
                  analysis={analyses.get(deck.id)}
                  contested={contestedByDeck(deck.id)}
                  onOpen={() => setView({ kind: 'decks', deckId: deck.id })}
                />
              ))}
            </AnimatePresence>
          </div>
          {shown.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-10">
              {inTab.length > 0
                ? `Aucun deck avec ${selectedTags.length > 1 ? (matchAll ? 'tous ces tags' : 'un de ces tags') : 'ce tag'}.`
                : tab === 'reference'
                  ? 'Aucun deck de référence.'
                  : "Aucun deck pour l'instant : crée-en un, importe une liste ou demande à l'assistant IA."}
            </p>
          )}
        </div>
      </div>

      <DeckImportModal
        isOpen={importOpen}
        kind={tab}
        onClose={() => setImportOpen(false)}
        onSaved={(id) => setView({ kind: 'decks', deckId: id })}
      />
      <DeckTagsModal isOpen={tagsOpen} onClose={() => setTagsOpen(false)} />
      {deleteDialog}
    </div>
  );
};

export default DecksView;
