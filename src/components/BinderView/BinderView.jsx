import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, RotateCcw } from 'lucide-react';
import { getPockets, getPage } from '../../utils/calculations';
import { getDreambornExportRows, generateDreambornCsv, downloadCsv } from '../../utils/csvExport';
import CardInputBar from './CardInputBar';
import PageGrid from './PageGrid';
import PageIndicator from './PageIndicator';

const BinderView = ({ binder, onAddCard, onRemoveCard, onRemoveLastAdded, onBulkMarkExported, onResetExports }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [direction, setDirection] = useState(1);
  const [lastAddedCard, setLastAddedCard] = useState(null);
  const [pageHint, setPageHint] = useState(null); // { sheets, forward, fromPhysical, toPhysical }
  const animTimerRef = useRef(null);
  const hintTimerRef = useRef(null);

  const pockets = getPockets(binder.gridRows, binder.gridCols);

  // Highest page that contains a known card
  const maxCardNumber = Object.keys(binder.cards).reduce(
    (max, num) => Math.max(max, parseInt(num, 10)),
    0
  );
  const totalPages = Math.max(
    currentPage,
    maxCardNumber > 0 ? Math.ceil(maxCardNumber / pockets) : 1
  );

  // Reset view when switching binders
  useEffect(() => {
    setCurrentPage(1);
    setDirection(1);
    setLastAddedCard(null);
    setPageHint(null);
  }, [binder.id]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const navigateTo = useCallback(
    (newPage) => {
      setDirection(newPage >= currentPage ? 1 : -1);
      setCurrentPage(newPage);
      setLastAddedCard(null);
    },
    [currentPage]
  );

  const showCardFeedback = useCallback(
    (cardNumber) => {
      const page = getPage(cardNumber, pockets);
      const forward = page >= currentPage;
      setDirection(forward ? 1 : -1);

      // Compute physical sheet delta (2 grid-pages per physical sheet, recto/verso)
      const fromSheet = Math.ceil(currentPage / 2);
      const toSheet = Math.ceil(page / 2);
      const sheets = Math.abs(toSheet - fromSheet);

      if (sheets > 0) {
        setPageHint({ sheets, forward, fromSheet, toSheet });
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        hintTimerRef.current = setTimeout(() => setPageHint(null), 4000);
      } else {
        setPageHint(null);
      }

      setCurrentPage(page);
      setLastAddedCard(cardNumber);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = setTimeout(() => setLastAddedCard(null), 650);
    },
    [pockets, currentPage]
  );

  const handleAdd = useCallback(
    async (cardNumber) => {
      showCardFeedback(cardNumber);
      await onAddCard(binder.id, cardNumber);
    },
    [binder.id, onAddCard, showCardFeedback]
  );

  const handleIncrement = useCallback(
    async (cardNumber) => {
      showCardFeedback(cardNumber);
      await onAddCard(binder.id, cardNumber);
    },
    [binder.id, onAddCard, showCardFeedback]
  );

  const handleDecrement = useCallback(
    (cardNumber) => {
      onRemoveCard(binder.id, cardNumber);
    },
    [binder.id, onRemoveCard]
  );

  const handleExport = useCallback(() => {
    const csv = generateDreambornCsv(binder);
    const safeName = binder.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadCsv(csv, `dreamborn_${safeName}_set${binder.setCode}.csv`);
    onBulkMarkExported(binder.id);
  }, [binder, onBulkMarkExported]);

  // Counts for the export UI
  const pendingRows = getDreambornExportRows(binder);
  const pendingCount = pendingRows.reduce((s, r) => s + r.toExport, 0);
  const totalExported = Object.values(binder.cards).reduce(
    (s, c) => s + (c.exportedQuantity ?? 0),
    0
  );

  return (
    <div className="flex flex-col h-full relative">
      {/* Page-turn hint — fixed toast bottom-center, always visible */}
      <AnimatePresence>
        {pageHint && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl bg-amber-950 border border-amber-700/70 text-amber-200 pointer-events-none max-w-sm w-max"
          >
            {pageHint.forward ? (
              <ChevronsRight size={22} className="flex-shrink-0 text-amber-400" />
            ) : (
              <ChevronsLeft size={22} className="flex-shrink-0 text-amber-400" />
            )}
            <span className="text-sm font-medium leading-snug whitespace-nowrap">
              {pageHint.forward ? 'Tournez' : 'Revenez'}{' '}
              <span className="font-bold text-amber-100">
                {pageHint.sheets} feuille{pageHint.sheets > 1 ? 's' : ''}
              </span>{' '}
              {pageHint.forward ? "vers l'avant" : "vers l'arrière"}
              {' — '}feuille{' '}
              <span className="font-bold text-amber-100">#{pageHint.toSheet}</span>
              {' '}
              <span className="text-amber-500 text-xs">
                (p.{pageHint.toSheet * 2 - 1} & p.{pageHint.toSheet * 2})
              </span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <CardInputBar
        binder={binder}
        onAdd={handleAdd}
        onIncrement={handleIncrement}
        onDecrement={handleDecrement}
        onRemoveLast={onRemoveLastAdded}
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-xl mx-auto">
          {/* Binder name header */}
          <div className="mb-4 text-sm text-gray-500 font-medium truncate pr-28">
            {binder.name}
          </div>

          <PageGrid
            binder={binder}
            page={currentPage}
            lastAddedCard={lastAddedCard}
            direction={direction}
          />

          {/* Page navigation */}
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              onClick={() => navigateTo(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-gray-400 hover:text-white transition-colors border border-gray-700"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-gray-400 min-w-[100px] text-center">
              Page{' '}
              <span className="text-white font-semibold">{currentPage}</span>
              {' / '}
              <span className="text-gray-500">{totalPages}</span>
            </span>
            <button
              onClick={() => navigateTo(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-gray-400 hover:text-white transition-colors border border-gray-700"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Dreamborn export section — Lorcana only */}
          {binder.gameType === 'lorcana' && (
            <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-300">Export Dreamborn</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pendingCount > 0 ? (
                      <>
                        <span className="text-emerald-400 font-medium">{pendingCount} exemplaire{pendingCount > 1 ? 's' : ''}</span>
                        {' '}à exporter
                        {totalExported > 0 && (
                          <span className="ml-2 text-gray-600">· {totalExported} déjà exporté{totalExported > 1 ? 's' : ''}</span>
                        )}
                      </>
                    ) : totalExported > 0 ? (
                      <span className="text-gray-500">Tout est exporté ({totalExported} exemplaire{totalExported > 1 ? 's' : ''})</span>
                    ) : (
                      <span className="text-gray-600">Aucune carte à exporter</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  {totalExported > 0 && (
                    <button
                      onClick={() => onResetExports(binder.id)}
                      title="Réinitialiser les marques d'export"
                      className="p-2 bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 rounded-lg border border-gray-700 hover:border-red-800 transition-colors"
                    >
                      <RotateCcw size={15} />
                    </button>
                  )}
                  <button
                    onClick={handleExport}
                    disabled={pendingCount === 0}
                    className="flex items-center gap-2 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    <Download size={15} />
                    CSV
                  </button>
                </div>
              </div>
              {/* Legend */}
              <div className="flex gap-4 text-xs text-gray-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-600/80 flex items-center justify-center text-white">✓</span>
                  Tout exporté
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-amber-600/80 flex items-center justify-center text-white text-[9px] font-bold">1/2</span>
                  Partiellement exporté
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <PageIndicator page={currentPage} />
    </div>
  );
};

export default BinderView;
