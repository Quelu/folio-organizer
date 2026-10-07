import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import {
  getPockets,
  getPage,
  getSheet,
  getSpread,
  getSpreadPages,
  getCardsOnPage,
  getBinderStats,
} from '../../utils/calculations';
import { getDreambornExportRows, generateDreambornCsv, downloadCsv } from '../../utils/csvExport';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useToast } from '../ui/toastContext';
import CardDetailModal from '../Modals/CardDetailModal';
import BinderHeader from './BinderHeader';
import CardInputBar from './CardInputBar';
import BinderSpread from './BinderSpread';
import PageNavigator from './PageNavigator';

const BinderView = ({
  binder,
  addHistory,
  prefs,
  onSetPref,
  onAddCards,
  onRemoveCard,
  onSetQuantity,
  onRemoveLastAdded,
  onHydrateImages,
  onBulkMarkExported,
  onResetExports,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenSidebar,
}) => {
  const notify = useToast();
  const [currentPage, setCurrentPage] = useState(1);
  const [direction, setDirection] = useState(1);
  const [highlight, setHighlight] = useState(null); // { cardNumber, token, kind: 'add'|'remove'|'locate' }
  const [celebrate, setCelebrate] = useState(null); // { page, token }
  const [pageHint, setPageHint] = useState(null); // { sheets, forward, toSheet }
  const [lastAction, setLastAction] = useState(null);
  const [detailCard, setDetailCard] = useState(null);
  const highlightTimerRef = useRef(null);
  const hintTimerRef = useRef(null);
  const celebrateTimerRef = useRef(null);
  const tokenRef = useRef(0);
  const inputRef = useRef(null);

  const canSpread = useMediaQuery('(min-width: 1024px)');
  const spreadMode = canSpread && prefs.viewMode === 'spread';

  const pockets = getPockets(binder.gridRows, binder.gridCols);
  const maxCardNumber = Object.keys(binder.cards).reduce((max, num) => Math.max(max, parseInt(num, 10)), 0);
  const totalPages = Math.max(
    1,
    currentPage,
    binder.setSize ? Math.ceil(binder.setSize / pockets) : 0,
    Math.ceil(maxCardNumber / pockets)
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(highlightTimerRef.current);
      clearTimeout(hintTimerRef.current);
      clearTimeout(celebrateTimerRef.current);
    };
  }, []);

  // Fetch missing card images for the visible pages
  const visiblePages = spreadMode ? getSpreadPages(getSpread(currentPage)).filter(Boolean) : [currentPage];
  const missingImages = visiblePages
    .flatMap((p) => getCardsOnPage(p, pockets))
    .filter((n) => binder.cards[String(n)] && !binder.cards[String(n)].imageUrl);
  const missingKey = missingImages.join(',');
  useEffect(() => {
    if (missingKey) onHydrateImages(binder.id, missingKey.split(',').map(Number));
  }, [missingKey, binder.id, binder.setCode, onHydrateImages]);

  const navigateTo = useCallback(
    (newPage) => {
      setDirection(newPage >= currentPage ? 1 : -1);
      setCurrentPage(Math.max(1, newPage));
      setHighlight(null);
    },
    [currentPage]
  );

  const stepPage = useCallback(
    (delta) => {
      if (spreadMode) {
        const target = getSpread(currentPage) + delta;
        if (target < 0) return;
        const [left, right] = getSpreadPages(target);
        if ((left ?? right) > totalPages) return;
        navigateTo(left ?? right);
      } else {
        const target = currentPage + delta;
        if (target < 1 || target > totalPages) return;
        navigateTo(target);
      }
    },
    [spreadMode, currentPage, totalPages, navigateTo]
  );

  /** Plays the add / remove / locate feedback on a pocket. */
  const pulseCard = useCallback((cardNumber, kind) => {
    setHighlight({ cardNumber, kind, token: ++tokenRef.current });
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlight(null), 1600);
  }, []);

  /** Moves to the card's page, pulses it and tells how many sheets to turn in the real binder. */
  const focusCard = useCallback(
    (cardNumber, kind = 'locate') => {
      const page = getPage(cardNumber, pockets);
      const forward = page >= currentPage;
      setDirection(forward ? 1 : -1);

      const sheets = Math.abs(getSheet(page) - getSheet(currentPage));
      clearTimeout(hintTimerRef.current);
      if (sheets > 0) {
        setPageHint({ sheets, forward, toSheet: getSheet(page) });
        hintTimerRef.current = setTimeout(() => setPageHint(null), 4000);
      } else {
        setPageHint(null);
      }

      setCurrentPage(page);
      pulseCard(cardNumber, kind);
    },
    [pockets, currentPage, pulseCard]
  );

  /** Celebrates pages (and the whole set) that the given additions complete. */
  const celebrateCompletions = useCallback(
    (entries) => {
      const newNumbers = [...new Set(entries.map((e) => e.cardNumber))].filter((n) => !binder.cards[String(n)]);
      if (newNumbers.length === 0) return;

      const completed = [...new Set(newNumbers.map((n) => getPage(n, pockets)))].filter((page) =>
        getCardsOnPage(page, pockets).every((n) => binder.cards[String(n)] || newNumbers.includes(n))
      );
      const lastPage = getPage(entries[entries.length - 1].cardNumber, pockets);
      const page = completed.includes(lastPage) ? lastPage : completed[0];
      if (page) {
        setCelebrate({ page, token: ++tokenRef.current });
        clearTimeout(celebrateTimerRef.current);
        celebrateTimerRef.current = setTimeout(() => setCelebrate(null), 2200);
        notify({ tone: 'success', message: `Page ${page} complète !` });
      }

      if (binder.setSize) {
        const before = getBinderStats(binder).owned;
        const gained = newNumbers.filter((n) => n <= binder.setSize).length;
        if (before < binder.setSize && before + gained >= binder.setSize) {
          notify({ tone: 'success', message: `Set complet : ${binder.setSize}/${binder.setSize} 🎉`, duration: 7000 });
        }
      }
    },
    [binder, pockets, notify]
  );

  const handleAdd = useCallback(
    (entries) => {
      celebrateCompletions(entries);
      onAddCards(binder.id, entries);
      const last = entries[entries.length - 1];
      focusCard(last.cardNumber, 'add');
      setLastAction(
        entries.length === 1
          ? { id: tokenRef.current, type: 'add', cardNumber: last.cardNumber }
          : { id: tokenRef.current, type: 'batch', count: entries.length }
      );
    },
    [binder.id, onAddCards, focusCard, celebrateCompletions]
  );

  const handleLocate = useCallback(
    (cardNumber) => {
      focusCard(cardNumber);
      setLastAction({ id: tokenRef.current, type: 'locate', cardNumber });
    },
    [focusCard]
  );

  const handleDecrement = useCallback(
    (cardNumber) => {
      onRemoveCard(binder.id, cardNumber);
      focusCard(cardNumber, 'remove');
    },
    [binder.id, onRemoveCard, focusCard]
  );

  const handleUndo = useCallback(() => {
    const entry = onRemoveLastAdded(binder.id);
    if (!entry) return;
    focusCard(entry.cardNumber, 'remove');
    setLastAction({ id: tokenRef.current, type: 'undo', cardNumber: entry.cardNumber, qty: entry.qty });
  }, [binder.id, onRemoveLastAdded, focusCard]);

  const handleStepCard = useCallback(
    (cardNumber, delta) => {
      if (delta > 0) {
        celebrateCompletions([{ cardNumber, qty: 1 }]);
        onAddCards(binder.id, [{ cardNumber, qty: 1 }]);
      } else {
        onRemoveCard(binder.id, cardNumber);
      }
      pulseCard(cardNumber, delta > 0 ? 'add' : 'remove');
    },
    [binder.id, onAddCards, onRemoveCard, pulseCard, celebrateCompletions]
  );

  const handleDetailNavigate = useCallback(
    (cardNumber) => {
      if (cardNumber < 1) return;
      setDetailCard(cardNumber);
      const page = getPage(cardNumber, pockets);
      if (page !== currentPage) navigateTo(page);
    },
    [pockets, currentPage, navigateTo]
  );

  const handleSetQuantity = useCallback(
    (cardNumber, qty) => onSetQuantity(binder.id, cardNumber, Math.max(0, qty)),
    [binder.id, onSetQuantity]
  );

  const closeDetail = useCallback(() => {
    setDetailCard(null);
    // Give the keyboard back to the card input so entry can continue right away
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const pendingCount = getDreambornExportRows(binder).reduce((s, r) => s + r.toExport, 0);
  const totalExported = Object.values(binder.cards).reduce((s, c) => s + (c.exportedQuantity ?? 0), 0);

  const handleExport = useCallback(() => {
    const csv = generateDreambornCsv(binder);
    const safeName = binder.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadCsv(csv, `dreamborn_${safeName}_set${binder.setCode}.csv`);
    onBulkMarkExported(binder.id);
    notify({
      tone: 'success',
      message: `${pendingCount} exemplaire${pendingCount > 1 ? 's' : ''} exporté${pendingCount > 1 ? 's' : ''} vers Dreamborn`,
    });
  }, [binder, onBulkMarkExported, notify, pendingCount]);

  const recent = addHistory
    .filter((h) => h.binderId === binder.id)
    .map((h, seq) => ({ ...h, seq }))
    .slice(-10)
    .reverse();

  // Size the pages from the available height so a whole page (or spread) fits on screen
  const pageRatio = (binder.gridCols * 5) / (binder.gridRows * 7);
  const pageMaxWidth = spreadMode
    ? `clamp(640px, calc((100dvh - 400px) * ${(pageRatio * 2).toFixed(3)} + 32px), 1100px)`
    : `clamp(320px, calc((100dvh - 400px) * ${pageRatio.toFixed(3)}), 576px)`;

  const canPrev = currentPage > 1;
  const canNext = spreadMode
    ? (getSpreadPages(getSpread(currentPage) + 1)[0] ?? 1) <= totalPages
    : currentPage < totalPages;

  return (
    <div className="flex flex-col h-full relative">
      <BinderHeader
        binder={binder}
        spreadMode={spreadMode}
        canSpread={canSpread}
        pendingExport={pendingCount}
        totalExported={totalExported}
        onToggleView={(mode) => onSetPref('viewMode', mode)}
        onOpenSidebar={onOpenSidebar}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onExport={handleExport}
        onResetExports={() => {
          onResetExports(binder.id);
          notify({ message: "Marques d'export réinitialisées" });
        }}
      />

      <CardInputBar
        inputRef={inputRef}
        binder={binder}
        recent={recent}
        lastAction={lastAction}
        canUndo={recent.length > 0}
        onAdd={handleAdd}
        onLocate={handleLocate}
        onDecrement={handleDecrement}
        onUndo={handleUndo}
        onPageStep={stepPage}
      />

      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 py-6">
        <div className="mx-auto relative" style={{ maxWidth: pageMaxWidth }}>
          {/* Page-turn hint for the physical binder */}
          <div className="absolute inset-x-0 -top-4 z-20 flex justify-center pointer-events-none">
            <AnimatePresence>
              {pageHint && (
                <motion.div
                  initial={{ opacity: 0, y: -12, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.95 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl shadow-black/50 bg-amber-400 text-amber-950 max-w-[calc(100vw-2rem)]"
                  role="status"
                >
                  {pageHint.forward ? (
                    <ChevronsRight size={22} className="flex-shrink-0" />
                  ) : (
                    <ChevronsLeft size={22} className="flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium leading-snug">
                    {pageHint.forward ? 'Tourne' : 'Reviens'}{' '}
                    <b className="font-extrabold">
                      {pageHint.sheets} feuille{pageHint.sheets > 1 ? 's' : ''}
                    </b>{' '}
                    {pageHint.forward ? "vers l'avant" : 'en arrière'} → feuille <b className="font-extrabold">{pageHint.toSheet}</b>
                    <span className="opacity-60 text-xs ml-1.5">
                      (p.{pageHint.toSheet * 2 - 1}–{pageHint.toSheet * 2})
                    </span>
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <BinderSpread
            binder={binder}
            page={currentPage}
            spreadMode={spreadMode}
            direction={direction}
            highlight={highlight}
            celebrate={celebrate}
            onOpenCard={setDetailCard}
            onStepCard={handleStepCard}
          />

          <PageNavigator
            binder={binder}
            page={currentPage}
            totalPages={totalPages}
            spreadMode={spreadMode}
            onNavigate={navigateTo}
            onStep={stepPage}
            canPrev={canPrev}
            canNext={canNext}
          />

          {Object.keys(binder.cards).length === 0 && (
            <p className="text-center text-sm text-slate-500 mt-8">
              Farde vide — tape un numéro ci-dessus ou clique sur un emplacement pour commencer.
            </p>
          )}
        </div>
      </div>

      <CardDetailModal
        binder={binder}
        cardNumber={detailCard}
        onClose={closeDetail}
        onNavigate={handleDetailNavigate}
        onSetQuantity={handleSetQuantity}
      />
    </div>
  );
};

export default BinderView;
