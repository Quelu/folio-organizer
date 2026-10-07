import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Modal from '../ui/Modal';
import { GAMES, GRID_PRESETS, getGame } from '../../data/games';
import { useLorcanaSets } from '../../hooks/useLorcanaSets';

const toForm = (binder) =>
  binder
    ? {
        name: binder.name,
        gameType: binder.gameType,
        setCode: binder.setCode || '1',
        setSize: binder.setSize ?? '',
        gridCols: binder.gridCols,
        gridRows: binder.gridRows,
      }
    : { name: '', gameType: 'lorcana', setCode: null, setSize: 204, gridCols: 3, gridRows: 3 };

/** Mini grid preview used on the grid preset tiles. */
const GridGlyph = ({ cols, rows, active }) => (
  <div className="grid gap-[3px] w-9" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
    {Array.from({ length: cols * rows }, (_, i) => (
      <span
        key={i}
        className={`aspect-[5/7] rounded-[2px] ${active ? 'bg-indigo-300/80' : 'bg-slate-600/60'}`}
      />
    ))}
  </div>
);

const FormBody = ({ binder, onClose, onSubmit }) => {
  const [form, setForm] = useState(() => toForm(binder));
  const lorcanaSets = useLorcanaSets();
  const isEdit = Boolean(binder);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const selectGame = (gameType) => {
    const wasDefault = form.setSize === '' || form.setSize === getGame(form.gameType).defaultSetSize;
    update({ gameType, ...(wasDefault ? { setSize: getGame(gameType).defaultSetSize ?? '' } : {}) });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const setSize = parseInt(form.setSize, 10);
    onSubmit({
      name: form.name,
      gameType: form.gameType,
      setCode: form.gameType === 'lorcana' ? (form.setCode ?? lorcanaSets[lorcanaSets.length - 1].code) : '',
      setSize: setSize > 0 ? setSize : null,
      gridCols: form.gridCols,
      gridRows: form.gridRows,
    });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6 pb-6 pt-3 space-y-5">
      <div>
        <label className="label" htmlFor="binder-name">
          Nom
        </label>
        <input
          id="binder-name"
          type="text"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Ex : Lorcana — Chapitre 1"
          autoFocus
          required
          className="field"
        />
      </div>

      <div>
        <span className="label">Jeu</span>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(GAMES).map(([key, game]) => (
            <button
              key={key}
              type="button"
              onClick={() => selectGame(key)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-all ring-1 ring-inset ${
                form.gameType === key
                  ? 'bg-indigo-500/15 ring-indigo-400/60 text-white'
                  : 'bg-white/[0.03] ring-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${game.dot}`} />
              {game.fullLabel}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {form.gameType === 'lorcana' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <label className="label" htmlFor="binder-set">
              Set Lorcana
            </label>
            <select
              id="binder-set"
              value={form.setCode ?? lorcanaSets[lorcanaSets.length - 1].code}
              onChange={(e) => update({ setCode: e.target.value })}
              className="field"
            >
              {[...lorcanaSets].reverse().map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.nameFr ?? s.name}
                  {s.nameFr && s.nameFr !== s.name ? ` (${s.name})` : ''}
                </option>
              ))}
            </select>
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <span className="label">Grille des pages</span>
        <div className="grid grid-cols-4 gap-2">
          {GRID_PRESETS.map((p) => {
            const active = form.gridCols === p.cols && form.gridRows === p.rows;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => update({ gridCols: p.cols, gridRows: p.rows })}
                title={p.hint}
                className={`flex flex-col items-center gap-2 py-3 rounded-lg ring-1 ring-inset transition-all ${
                  active
                    ? 'bg-indigo-500/15 ring-indigo-400/60 text-white'
                    : 'bg-white/[0.03] ring-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <GridGlyph cols={p.cols} rows={p.rows} active={active} />
                <span className="text-xs font-semibold">{p.label}</span>
              </button>
            );
          })}
        </div>
        {isEdit && (
          <p className="text-xs text-slate-500 mt-2">
            Changer la grille recalcule l'emplacement de toutes les cartes.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="binder-size">
          Nombre de cartes du set{' '}
          <span className="normal-case tracking-normal text-slate-600">(optionnel)</span>
        </label>
        <input
          id="binder-size"
          type="number"
          min="1"
          inputMode="numeric"
          value={form.setSize}
          onChange={(e) => update({ setSize: e.target.value })}
          placeholder="Ex : 204"
          className="field"
        />
        <p className="text-xs text-slate-500 mt-2">
          Sert à afficher ta progression et toutes les pages du set.
        </p>
      </div>

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Annuler
        </button>
        <button type="submit" className="btn-primary flex-1">
          {isEdit ? 'Enregistrer' : 'Créer la farde'}
        </button>
      </div>
    </form>
  );
};

/** Create (binder = null) or edit an existing binder. */
const BinderFormModal = ({ isOpen, binder, onClose, onSubmit }) => (
  <Modal isOpen={isOpen} onClose={onClose} title={binder ? 'Modifier la farde' : 'Nouvelle farde'}>
    {/* Keyed so the form state resets each time the modal opens on another binder */}
    <FormBody key={binder?.id ?? 'new'} binder={binder} onClose={onClose} onSubmit={onSubmit} />
  </Modal>
);

export default BinderFormModal;
