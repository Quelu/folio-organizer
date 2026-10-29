import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import {
  getPage,
  getPageCount,
  getSpread,
  getSpreadPages,
  getCardsOnPage,
  getBinderStats,
} from '../../utils/calculations';
import { getDreambornExportRows, generateDreambornCsv, downloadCsv } from '../../utils/csvExport';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useOpenWantList } from '../../hooks/useOpenWantList';
import { getBinderPulls } from '../../utils/collection';
import { useToast } from '../ui/toastContext';
import CardDetailModal from '../Modals/CardDetailModal';
import CardmarketExportModal from '../Modals/CardmarketExportModal';
import BinderHeader from './BinderHeader';
import CardInputBar from './CardInputBar';
import BinderSpread from './BinderSpread';
import PageNavigator from './PageNavigator';

const BinderView = ({
  binder,
  focusRequest,
  pulls,
  decks,
  addHistory,
  prefs,
  onSetPref,
  onAddCards,
  onRemoveCard,
  onSetCounts,
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
  const openWantList = useOpenWantList();
  const [currentPage, setCurrentPage] = useState(1);
  const [highlight, setHighlight] = useState(null); // { cardNumber, token, kind: 'add'|'remove'|'locate' }
  const [celebrate, setCelebrate] = useState(null); // { page, token }
  const [pageHint, setPageHint] = useState(null); // { turns, forward, page, left, right }
  const [lastAction, setLastAction] = useState(null);
  const [detailCard, setDetailCard] = useState(null);
  const [cardmarketOpen, setCardmarketOpen] = useState(false);
  const highlightTimerRef = useRef(null);
  const hintTimerRef = useRef(null);
  const celebrateTimerRef = useRef(null);
  const tokenRef = useRef(0);
  const inputRef = useRef(null);

  const canSpread = useMediaQuery('(min-width: 1024px)');
  const spreadMode = canSpread && prefs.viewMode === 'spread';

  const totalPages = Math.max(currentPage, getPageCount(binder));

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
    .flatMap((p) => getCardsOnPage(p, binder))
    .filter((n) => n && binder.cards[String(n)] && !binder.cards[String(n)].imageUrl);
  const missingKey = missingImages.join(',');
  useEffect(() => {
    if (missingKey && binder.gameType === 'lorcana') {
      onHydrateImages(binder.id, binder.setCode, missingKey.split(',').map(Number));
    }
  }, [missingKey, binder.id, binder.gameType, binder.setCode, onHydrateImages]);

  const navigateTo = useCallback(
    (newPage) => {
      setCurrentPage(Math.max(1, newPage));
      setHighlight(null);
    },
    []
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
      const page = getPage(cardNumber, binder);
      const forward = page >= currentPage;

      // An open binder shows a spread (verso of a sheet + recto of the next one): every sheet
      // turned moves exactly one spread, whatever the view mode used on screen.
      const turns = Math.abs(getSpread(page) - getSpread(currentPage));
      const [left, right] = getSpreadPages(getSpread(page));
      clearTimeout(hintTimerRef.current);
      if (turns > 0) {
        setPageHint({ turns, forward, page, left, right });
        hintTimerRef.current = setTimeout(() => setPageHint(null), 4000);
      } else {
        setPageHint(null);
      }

      setCurrentPage(page);
      pulseCard(cardNumber, kind);
    },
    [binder, currentPage, pulseCard]
  );

  /** Celebrates pages (and the whole set) that the given additions complete. */
  const celebrateCompletions = useCallback(
    (entries) => {
      const newNumbers = [...new Set(entries.map((e) => e.cardNumber))].filter((n) => !binder.cards[String(n)]);
      if (newNumbers.length === 0) return;

      const completed = [...new Set(newNumbers.map((n) => getPage(n, binder)))].filter((page) =>
        getCardsOnPage(page, binder).every((n) => !n || binder.cards[String(n)] || newNumbers.includes(n))
      );
      const lastPage = getPage(entries[entries.length - 1].cardNumber, binder);
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
    [binder, notify]
  );

  const handleAdd = useCallback(
    (entries) => {
      celebrateCompletions(entries);
      onAddCards(binder.id, entries);
      const last = entries[entries.length - 1];
      focusCard(last.cardNumber, 'add');
      setLastAction(
        entries.length === 1
          ? { id: tokenRef.current, type: 'add', cardNumber: last.cardNumber, foil: last.foil }
          : { id: tokenRef.current, type: 'batch', count: entries.length }
      );
    },
    [binder.id, onAddCards, focusCard, celebrateCompletions]
  );

  // Opened from the card search or a deck's pull list: go straight to the card
  const focusToken = focusRequest?.token;
  const focusCardNumber = focusRequest?.cardNumber;
  useEffect(() => {
    if (!focusToken) return;
    const frame = requestAnimationFrame(() => focusCard(focusCardNumber));
    return () => cancelAnimationFrame(frame);
    // Only for a new request, not when focusCard changes with the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  const handleLocate = useCallback(
    (cardNumber) => {
      focusCard(cardNumber);
      setLastAction({ id: tokenRef.current, type: 'locate', cardNumber });
    },
    [focusCard]
  );

  const handleDecrement = useCallback(
    (cardNumber, foil) => {
      onRemoveCard(binder.id, cardNumber, foil);
      focusCard(cardNumber, 'remove');
    },
    [binder.id, onRemoveCard, focusCard]
  );

  const handleUndo = useCallback(() => {
    const entry = onRemoveLastAdded(binder.id);
    if (!entry) return;
    focusCard(entry.cardNumber, 'remove');
    setLastAction({ id: tokenRef.current, type: 'undo', cardNumber: entry.cardNumber, qty: entry.qty, foil: entry.foil });
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
      const page = getPage(cardNumber, binder);
      if (page !== currentPage) navigateTo(page);
    },
    [binder, currentPage, navigateTo]
  );

  const handleSetCounts = useCallback(
    (cardNumber, counts) => onSetCounts(binder.id, cardNumber, counts),
    [binder.id, onSetCounts]
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

  // Pockets whose copies are out of the binder for a deck: { [cardNumber]: [{ deckName, qty }] }
  const pulledByPocket = Object.fromEntries(
    Object.entries(getBinderPulls(pulls, binder.id)).map(([num, list]) => [
      num,
      list.map((p) => ({ deckName: decks.find((d) => d.id === p.deckId)?.name ?? 'Deck', qty: p.qty })),
    ])
  );

  const recent = addHistory
    .filter((h) => h.binderId === binder.id)
    .map((h, seq) => ({ ...h, seq }))
    .slice(-10)
    .reverse();
  // Most recent addition still in the binder, framed on its page so it is easy to spot
  const lastAddedCard = recent.find((r) => binder.cards[String(r.cardNumber)])?.cardNumber ?? null;

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
        onCardmarket={() => setCardmarketOpen(true)}
        onWantList={() => openWantList({ binders: [binder.id] })}
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
                    Tourne{' '}
                    <b className="font-extrabold">
                      {pageHint.turns} page{pageHint.turns > 1 ? 's' : ''}
                    </b>{' '}
                    {pageHint.forward ? 'vers la droite' : 'vers la gauche'}
                    <span className="opacity-50"> · </span>
                    {pageHint.left ? (
                      <>
                        pages {pageHint.left}–{pageHint.right}, carte sur la{' '}
                        <b className="font-extrabold">{pageHint.page === pageHint.left ? 'gauche' : 'droite'}</b>
                      </>
                    ) : (
                      <>
                        <b className="font-extrabold">page 1</b> (première page)
                      </>
                    )}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <BinderSpread
            binder={binder}
            page={currentPage}
            spreadMode={spreadMode}
            highlight={highlight}
            celebrate={celebrate}
            lastAddedCard={lastAddedCard}
            pulledByPocket={pulledByPocket}
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
        pulled={detailCard != null ? (pulledByPocket[String(detailCard)] ?? []) : []}
        onClose={closeDetail}
        onNavigate={handleDetailNavigate}
        onSetCounts={handleSetCounts}
      />

      <CardmarketExportModal
        isOpen={cardmarketOpen}
        binder={binder}
        excludedRarities={prefs.cardmarketExcludedRarities}
        onExcludedRaritiesChange={(rarities) => onSetPref('cardmarketExcludedRarities', rarities)}
        onClose={() => setCardmarketOpen(false)}
      />
    </div>
  );
};

export default BinderView;
