import { useState, useEffect } from 'react';
import { Hash, Plus, Minus, LocateFixed, Undo2, CheckCircle2, MapPin, History } from 'lucide-react';
import { motion, AnimatePresence, useAnimate } from 'motion/react';
import { parseCardInput, getLocation } from '../../utils/calculations';

const LocationText = ({ loc }) => (
  <>
    Page <b className="text-white">{loc.page}</b>
    <span className="text-slate-600"> · </span>
    rangée <b className="text-white">{loc.row}</b>, col. <b className="text-white">{loc.col}</b>
    <span className="text-slate-600"> · </span>
    feuille {loc.sheet} {loc.side}
  </>
);

/** Live feedback line under the input: preview while typing, last action otherwise. */
const StatusLine = ({ binder, value, parsed, lastAction }) => {
  if (value.trim()) {
    if (!parsed) {
      return (
        <span className="text-rose-300/90">
          Format attendu : <code>12</code>, <code>12x3</code> ou une liste <code>4 8 15x2</code>
        </span>
      );
    }
    if (parsed.length === 1) {
      const { cardNumber, qty } = parsed[0];
      const owned = binder.cards[String(cardNumber)]?.quantity ?? 0;
      return (
        <span className="text-slate-400 flex items-center gap-1.5">
          <MapPin size={13} className="text-indigo-300 flex-shrink-0" />
          <span>
            <LocationText loc={getLocation(cardNumber, binder)} />
            <span className="text-slate-600"> · </span>
            {owned > 0 ? (
              <span className="text-amber-300">déjà ×{owned}</span>
            ) : (
              <span className="text-emerald-300">nouvelle carte</span>
            )}
            {qty > 1 && <span className="text-slate-500"> (+{qty})</span>}
          </span>
        </span>
      );
    }
    const copies = parsed.reduce((s, e) => s + e.qty, 0);
    return (
      <span className="text-slate-400">
        <b className="text-white">{parsed.length}</b> cartes · <b className="text-white">{copies}</b> exemplaires
        à ajouter
      </span>
    );
  }

  if (lastAction) {
    return (
      <AnimatePresence mode="wait">
        <motion.span
          key={lastAction.id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-slate-400 flex items-center gap-1.5"
        >
          {lastAction.type === 'undo' ? (
            <>
              <Undo2 size={13} className="text-amber-300 flex-shrink-0" />
              <span>
                Annulé : #{lastAction.cardNumber}
                {lastAction.qty > 1 && ` ×${lastAction.qty}`}
              </span>
            </>
          ) : lastAction.type === 'batch' ? (
            <>
              <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
              <span>{lastAction.count} cartes ajoutées</span>
            </>
          ) : (
            <>
              {lastAction.type === 'locate' ? (
                <LocateFixed size={13} className="text-indigo-300 flex-shrink-0" />
              ) : (
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
              )}
              <span>
                <b className="text-white">#{lastAction.cardNumber}</b>
                {lastAction.type === 'add' ? ' ajoutée → ' : ' se trouve '}
                <LocationText loc={getLocation(lastAction.cardNumber, binder)} />
                {lastAction.type === 'add' && (
                  <span className="text-slate-500">
                    {' '}
                    (×{binder.cards[String(lastAction.cardNumber)]?.quantity ?? 0} au total)
                  </span>
                )}
              </span>
            </>
          )}
        </motion.span>
      </AnimatePresence>
    );
  }

  return <span className="text-slate-600">Tape un numéro de carte pour voir où la ranger.</span>;
};

const CardInputBar = ({
  inputRef,
  binder,
  recent,
  lastAction,
  onAdd,
  onLocate,
  onDecrement,
  onUndo,
  onPageStep,
  canUndo,
}) => {
  const [value, setValue] = useState('');
  const [fieldScope, animateField] = useAnimate();
  const parsed = value.trim() ? parseCardInput(value) : null;
  const single = parsed?.length === 1 ? parsed[0] : null;

  // Re-focus input when binder changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [binder.id, inputRef]);

  const refocus = () => inputRef.current?.focus();

  const shake = () => animateField(fieldScope.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.35 });
  const flash = (rgb) =>
    animateField(
      'input',
      { boxShadow: [`0 0 0 0 rgba(${rgb},0.55)`, `0 0 0 10px rgba(${rgb},0)`] },
      { duration: 0.55, ease: 'easeOut' }
    );

  const submit = () => {
    if (!parsed) {
      if (value.trim()) shake();
      return;
    }
    flash('52,211,153');
    onAdd(parsed);
    setValue('');
    refocus();
  };

  const locate = () => {
    if (!single) {
      if (value.trim()) shake();
      return;
    }
    flash('129,140,248');
    onLocate(single.cardNumber);
    refocus();
  };

  const step = (delta) => {
    if (!single) {
      if (value.trim()) shake();
      return;
    }
    flash(delta > 0 ? '52,211,153' : '251,113,133');
    if (delta > 0) onAdd([{ cardNumber: single.cardNumber, qty: 1 }]);
    else onDecrement(single.cardNumber);
    refocus();
  };

  const handleKeyDown = (e) => {
    const isEmpty = value === '';
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) locate();
        else submit();
        break;
      case '+':
        e.preventDefault();
        step(1);
        break;
      case '-':
        e.preventDefault();
        step(-1);
        break;
      case 'Escape':
        setValue('');
        break;
      case 'Backspace':
        if (isEmpty) {
          e.preventDefault();
          onUndo();
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (isEmpty) {
          e.preventDefault();
          onPageStep(e.key === 'ArrowRight' ? 1 : -1);
        }
        break;
    }
  };

  return (
    <div className="border-b border-white/5 bg-slate-950/40 backdrop-blur px-4 sm:px-6 py-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div ref={fieldScope} className="flex-1 relative">
            <Hash size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="N° de carte… (ex : 42, 42x2, 3 17 88)"
              autoFocus
              aria-label="Numéro de carte"
              className={`field text-base pl-10 py-3 ${parsed === null && value.trim() ? 'ring-rose-400/60' : ''}`}
            />
          </div>

          <button
            onClick={() => step(-1)}
            disabled={!single}
            title="Retirer un exemplaire (touche −)"
            aria-label="Retirer un exemplaire"
            className="btn-secondary px-3 py-3"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={locate}
            disabled={!single}
            title="Localiser sans ajouter (Maj + Entrée)"
            aria-label="Localiser la carte"
            className="btn-secondary px-3 py-3 hidden sm:inline-flex"
          >
            <LocateFixed size={16} />
          </button>
          <button
            onClick={submit}
            disabled={!parsed}
            title="Ajouter (Entrée)"
            className="btn-primary px-4 py-3"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>

        <div className="mt-2.5 min-h-[20px] flex items-center justify-between gap-4 text-xs">
          <StatusLine binder={binder} value={value} parsed={parsed} lastAction={lastAction} />
          {canUndo && !value && (
            <button
              onClick={() => {
                onUndo();
                refocus();
              }}
              className="flex-shrink-0 flex items-center gap-1 text-slate-500 hover:text-white transition-colors"
              title="Annuler le dernier ajout (⌫ quand le champ est vide)"
            >
              <Undo2 size={13} /> Annuler
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3 overflow-hidden">
          {recent.length > 0 ? (
            <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto scrollbar-thin pb-0.5">
              <History size={13} className="text-slate-600 flex-shrink-0" />
              <AnimatePresence initial={false} mode="popLayout">
                {recent.map((r, i) => (
                  <motion.button
                    key={r.seq}
                    layout
                    initial={{ opacity: 0, scale: 0.5, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                    onClick={() => {
                      onLocate(r.cardNumber);
                      refocus();
                    }}
                    className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium tabular-nums ring-1 ring-inset transition-colors ${
                      i === 0
                        ? 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30'
                        : 'bg-white/[0.03] text-slate-400 ring-white/10 hover:text-white'
                    }`}
                    title={`Localiser la carte #${r.cardNumber}`}
                  >
                    #{r.cardNumber}
                    {r.qty > 1 && <span className="opacity-60"> ×{r.qty}</span>}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div />
          )}
          <div className="hidden md:flex items-center gap-3 ml-auto flex-shrink-0 text-[11px] text-slate-500">
            <span>
              <kbd className="kbd">↵</kbd> Ajouter
            </span>
            <span>
              <kbd className="kbd">⇧↵</kbd> Localiser
            </span>
            <span>
              <kbd className="kbd">+</kbd>
              <kbd className="kbd ml-0.5">−</kbd> Quantité
            </span>
            <span>
              <kbd className="kbd">⌫</kbd> Annuler
            </span>
            <span>
              <kbd className="kbd">←</kbd>
              <kbd className="kbd ml-0.5">→</kbd> Pages
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardInputBar;
