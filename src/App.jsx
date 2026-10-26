import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { Library, Menu as MenuIcon, Hash, MousePointerClick, Download, Loader2 } from 'lucide-react';
import { useBinders } from './hooks/useBinders';
import { StoreContext } from './hooks/storeContext';
import CatalogProvider from './hooks/CatalogProvider';
import Sidebar from './components/Sidebar/Sidebar';
import CardSearchModal from './components/Search/CardSearchModal';
import CardPreviewProvider from './components/CardPreview/CardPreviewProvider';
import DecksView from './components/Decks/DecksView';
import CollectionView from './components/Collection/CollectionView';
import TradesView from './components/Trades/TradesView';
import BinderView from './components/BinderView/BinderView';
import BinderFormModal from './components/Modals/BinderFormModal';
import ConfirmDialog from './components/ui/ConfirmDialog';
import ToastProvider from './components/ui/ToastProvider';
import { useToast } from './components/ui/toastContext';

// The assistant brings the Anthropic SDK and the Markdown renderer: loaded when first opened
const AssistantView = lazy(() => import('./components/Assistant/AssistantView'));

const STEPS = [
  { icon: Hash, title: 'Tape un numéro', text: 'La carte est rangée et tu vois sa page, sa rangée et sa colonne.' },
  { icon: MousePointerClick, title: 'Gère depuis la grille', text: 'Clique une poche pour voir la carte et ajuster les quantités.' },
  { icon: Download, title: 'Exporte', text: 'Envoie tes cartes Lorcana vers Dreamborn en un clic.' },
];

const welcomeItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
};

const Welcome = ({ onCreate, onOpenSidebar }) => (
  <div className="flex-1 flex flex-col">
    <div className="lg:hidden p-3">
      <button onClick={onOpenSidebar} className="btn-icon" aria-label="Ouvrir le menu">
        <MenuIcon size={20} />
      </button>
    </div>
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-8 text-center p-8"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.09 } } }}
    >
      <motion.div variants={welcomeItem} className="relative">
        <motion.div
          className="absolute inset-0 blur-3xl bg-indigo-500/40 rounded-full"
          animate={{ opacity: [0.5, 1, 0.5], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative animate-float w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-2xl shadow-indigo-500/40">
          <Library size={38} className="text-white" />
        </div>
      </motion.div>
      <motion.div variants={welcomeItem}>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-tight">Range tes cartes sans réfléchir</h1>
        <p className="text-slate-400 max-w-md mx-auto leading-relaxed">
          Folio te dit exactement sur quelle page, quelle feuille et dans quelle poche chaque carte doit aller.
        </p>
      </motion.div>
      <motion.button
        variants={welcomeItem}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={onCreate}
        className="btn-primary px-8 py-3 text-base"
      >
        Créer ma première farde
      </motion.button>
      <div className="grid sm:grid-cols-3 gap-3 max-w-3xl w-full mt-4">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <motion.div
            key={title}
            variants={welcomeItem}
            whileHover={{ y: -4 }}
            className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 hover:ring-white/15 transition-colors p-4 text-left"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold text-indigo-300 tabular-nums">0{i + 1}</span>
              <Icon size={15} className="text-slate-400" />
              <span className="text-sm font-semibold text-white">{title}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{text}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  </div>
);

const AppContent = () => {
  const notify = useToast();
  const [formState, setFormState] = useState({ open: false, binder: null });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null); // { binderId, cardNumber, token }

  const store = useBinders();
  const {
    binders,
    activeBinder,
    addHistory,
    prefs,
    state,
    createBinder,
    updateBinder,
    deleteBinder,
    restoreBinder,
    duplicateBinder,
    setActiveBinder,
    addCards,
    setCardCounts,
    removeCard,
    removeLastAdded,
    hydrateImages,
    bulkMarkExported,
    resetExports,
    setPref,
    importState,
    decks,
    pulls,
    view,
    setView,
  } = store;

  // Cmd/Ctrl+K opens the card search from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Opens a binder on a card, from the search or a deck's pull list. */
  const locateCard = useCallback(
    (binderId, cardNumber) => {
      setSearchOpen(false);
      setActiveBinder(binderId);
      setFocusRequest({ binderId, cardNumber, token: Date.now() });
    },
    [setActiveBinder]
  );

  const openCreate = useCallback(() => {
    setSidebarOpen(false);
    setFormState({ open: true, binder: null });
  }, []);
  const openEdit = useCallback((binder) => {
    setSidebarOpen(false);
    setFormState({ open: true, binder });
  }, []);
  const closeForm = useCallback(() => setFormState((s) => ({ ...s, open: false })), []);

  const handleFormSubmit = (data) => {
    if (formState.binder) {
      updateBinder(formState.binder.id, data);
      notify({ tone: 'success', message: 'Farde mise à jour' });
    } else {
      createBinder(data);
    }
  };

  const requestDelete = (binderId) => {
    setSidebarOpen(false);
    setPendingDelete(binders.find((b) => b.id === binderId) ?? null);
  };

  const confirmDelete = () => {
    const snapshot = deleteBinder(pendingDelete.id);
    if (!snapshot) return;
    notify({
      message: `« ${snapshot.binder.name} » supprimée`,
      action: { label: 'Annuler', onClick: () => restoreBinder(snapshot) },
      duration: 7000,
    });
  };

  const handleDuplicate = (binderId) => {
    duplicateBinder(binderId);
    notify({ tone: 'success', message: 'Farde dupliquée (sans les cartes)' });
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify({ tone: 'success', message: 'Sauvegarde téléchargée' });
  };

  const readBackup = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data?.binders)) throw new Error();
      setPendingImport(data);
    } catch {
      notify({ tone: 'error', message: "Ce fichier n'est pas une sauvegarde Folio valide" });
    }
  };

  const sidebarProps = {
    binders,
    view,
    deckCount: decks.filter((d) => d.kind !== 'reference').length,
    onNavigate: setView,
    onSearch: () => setSearchOpen(true),
    cardLanguage: prefs.cardLanguage ?? 'fr',
    onCardLanguage: (lang) => setPref('cardLanguage', lang),
    activeBinderId: view.kind === 'binder' ? (activeBinder?.id ?? null) : null,
    onSelect: setActiveBinder,
    onCreateNew: openCreate,
    onEdit: openEdit,
    onDuplicate: handleDuplicate,
    onDelete: requestDelete,
    onExportBackup: exportBackup,
    onImportBackup: readBackup,
  };

  return (
    <StoreContext.Provider value={store}>
      <CatalogProvider lang={prefs.cardLanguage}>
        <CardPreviewProvider onLocate={locateCard}>
          <div className="flex h-[100dvh] text-slate-100 overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_60%)]">
            <Sidebar {...sidebarProps} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <main className="flex-1 flex flex-col overflow-hidden min-w-0">
              {view.kind === 'decks' ? (
                <DecksView onOpenSidebar={() => setSidebarOpen(true)} onLocate={locateCard} />
              ) : view.kind === 'stats' ? (
                <CollectionView onOpenSidebar={() => setSidebarOpen(true)} />
              ) : view.kind === 'trades' ? (
                <TradesView onOpenSidebar={() => setSidebarOpen(true)} />
              ) : view.kind === 'assistant' ? (
                <Suspense
                  fallback={
                    <div className="flex-1 flex items-center justify-center text-slate-500">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  }
                >
                  <AssistantView onOpenSidebar={() => setSidebarOpen(true)} />
                </Suspense>
              ) : activeBinder ? (
                <BinderView
                  key={activeBinder.id}
                  binder={activeBinder}
                  focusRequest={focusRequest?.binderId === activeBinder.id ? focusRequest : null}
                  pulls={pulls}
                  decks={decks}
                  addHistory={addHistory}
                  prefs={prefs}
                  onSetPref={setPref}
                  onAddCards={addCards}
                  onRemoveCard={removeCard}
                  onSetCounts={setCardCounts}
                  onRemoveLastAdded={removeLastAdded}
                  onHydrateImages={hydrateImages}
                  onBulkMarkExported={bulkMarkExported}
                  onResetExports={resetExports}
                  onEdit={() => openEdit(activeBinder)}
                  onDuplicate={() => handleDuplicate(activeBinder.id)}
                  onDelete={() => requestDelete(activeBinder.id)}
                  onOpenSidebar={() => setSidebarOpen(true)}
                />
              ) : (
                <Welcome onCreate={openCreate} onOpenSidebar={() => setSidebarOpen(true)} />
              )}
            </main>

            <CardSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} onLocate={locateCard} />

            <BinderFormModal
              isOpen={formState.open}
              binder={formState.binder}
              onClose={closeForm}
              onSubmit={handleFormSubmit}
            />

            <ConfirmDialog
              isOpen={Boolean(pendingDelete)}
              onClose={() => setPendingDelete(null)}
              onConfirm={confirmDelete}
              title="Supprimer la farde ?"
              message={
                pendingDelete &&
                `« ${pendingDelete.name} » et ses ${Object.keys(pendingDelete.cards).length} cartes seront supprimées. Tu pourras annuler pendant quelques secondes.`
              }
              confirmLabel="Supprimer"
              danger
            />

            <ConfirmDialog
              isOpen={Boolean(pendingImport)}
              onClose={() => setPendingImport(null)}
              onConfirm={() => {
                importState(pendingImport);
                notify({ tone: 'success', message: `${pendingImport.binders.length} farde(s) restaurée(s)` });
              }}
              title="Restaurer la sauvegarde ?"
              message={
                pendingImport &&
                `Tes ${binders.length} farde(s) et ${decks.length} deck(s) actuels seront remplacés par les ${pendingImport.binders.length} farde(s) et ${pendingImport.decks?.length ?? 0} deck(s) du fichier.`
              }
              confirmLabel="Restaurer"
              danger
            />
          </div>
        </CardPreviewProvider>
      </CatalogProvider>
    </StoreContext.Provider>
  );
};

const App = () => (
  // Honors the OS "reduce motion" setting for every animation in the app
  <MotionConfig reducedMotion="user">
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  </MotionConfig>
);

export default App;
