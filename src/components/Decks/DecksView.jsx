import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, ClipboardPaste, AlertTriangle, AlertCircle, CheckCircle2, Layers, BookMarked, Menu as MenuIcon, Loader2 } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import ConfirmDialog from '../ui/ConfirmDialog';
import DeckEditor from './DeckEditor';
import DeckImportModal from './DeckImportModal';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { useToast } from '../ui/toastContext';
import { analyzeDeck } from '../../utils/deckRules';
import { getSharedCopyConflicts } from '../../utils/collection';
import { getInk } from '../../utils/catalog';

const DeckTile = ({ deck, analysis, onOpen }) => (
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
      <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">{deck.format === 'core' ? 'Core' : 'Infinity'}</span>
    </div>
    <div className="font-semibold text-white truncate">{deck.name}</div>
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
  const { decks, view, setView, createDeck, deleteDeck, restoreDeck } = useStore();
  const { index, status, loaded, total } = useCatalog();
  const collection = useCollection();
  const [tab, setTab] = useState('mine');
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const analyses = useMemo(
    () => new Map(decks.map((d) => [d.id, analyzeDeck(d, index, collection)])),
    [decks, index, collection]
  );
  const conflicts = useMemo(() => getSharedCopyConflicts(decks, collection), [decks, collection]);
  const illegal = decks.filter(
    (d) => d.kind !== 'reference' && d.format === 'core' && analyses.get(d.id).errors.some((e) => e.code === 'legality')
  );
  const rotating = decks.filter((d) => d.kind !== 'reference' && d.format === 'core' && analyses.get(d.id).rotating.length);

  const openDeck = view.deckId ? decks.find((d) => d.id === view.deckId) : null;
  const shown = decks.filter((d) => (tab === 'reference' ? d.kind === 'reference' : d.kind !== 'reference'));

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

          {(conflicts.length > 0 || illegal.length > 0 || rotating.length > 0) && (
            <div className="space-y-2">
              {illegal.map((d) => (
                <button
                  key={`illegal-${d.id}`}
                  onClick={() => setView({ kind: 'decks', deckId: d.id })}
                  className="w-full flex gap-2 text-left text-sm text-rose-200 rounded-xl bg-rose-500/[0.07] ring-1 ring-inset ring-rose-400/20 px-4 py-3"
                >
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <b>{d.name}</b> contient des cartes qui ne sont plus légales en Core.
                  </span>
                </button>
              ))}
              {rotating.map((d) => (
                <button
                  key={`rot-${d.id}`}
                  onClick={() => setView({ kind: 'decks', deckId: d.id })}
                  className="w-full flex gap-2 text-left text-sm text-amber-200 rounded-xl bg-amber-500/[0.06] ring-1 ring-inset ring-amber-400/20 px-4 py-3"
                >
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <b>{d.name}</b> : {analyses.get(d.id).rotating.length} carte(s) légale(s) en Core uniquement via le chapitre{' '}
                    {analyses.get(d.id).coreSets[0]}, le premier à sortir à la prochaine rotation.
                  </span>
                </button>
              ))}
              {conflicts.length > 0 && (
                <div className="flex gap-2 text-sm text-amber-200 rounded-xl bg-amber-500/[0.06] ring-1 ring-inset ring-amber-400/20 px-4 py-3">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    Cartes partagées entre decks sans assez d'exemplaires :
                    <ul className="mt-1 text-xs text-slate-300 space-y-0.5">
                      {conflicts.map((c) => (
                        <li key={c.key}>
                          <b>{c.name}</b> : {c.owned} possédée{c.owned > 1 ? 's' : ''}, {c.needed} utilisées ({c.decks.map((u) => `${u.qty} dans ${u.deck.name}`).join(', ')})
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

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
                <DeckTile key={deck.id} deck={deck} analysis={analyses.get(deck.id)} onOpen={() => setView({ kind: 'decks', deckId: deck.id })} />
              ))}
            </AnimatePresence>
          </div>
          {shown.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-10">
              {tab === 'reference' ? 'Aucun deck de référence.' : "Aucun deck pour l'instant : crée-en un, importe une liste ou demande à l'assistant IA."}
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
      {deleteDialog}
    </div>
  );
};

export default DecksView;
