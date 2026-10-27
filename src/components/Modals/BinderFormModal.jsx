import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Modal from '../ui/Modal';
import { GAMES, GRID_PRESETS, getGame, getLorcanaSetName } from '../../data/games';
import { useLorcanaSets } from '../../hooks/useLorcanaSets';
import { useCatalog } from '../../hooks/catalogContext';
import { getInkSections, INKS } from '../../utils/catalog';

const toForm = (binder) =>
  binder
    ? {
        name: binder.name,
        gameType: binder.gameType,
        setCode: binder.setCode || '1',
        setSize: binder.setSize ?? '',
        gridCols: binder.gridCols,
        gridRows: binder.gridRows,
        inkDividers: Boolean(binder.sections?.length),
      }
    : { name: '', gameType: 'lorcana', setCode: null, setSize: 204, gridCols: 3, gridRows: 3, inkDividers: false };

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
  const { index } = useCatalog();
  const isEdit = Boolean(binder);
  const isLorcana = form.gameType === 'lorcana';

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const selectGame = (gameType) => {
    const wasDefault = form.setSize === '' || form.setSize === getGame(form.gameType).defaultSetSize;
    update({ gameType, ...(wasDefault ? { setSize: getGame(gameType).defaultSetSize ?? '' } : {}) });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const setSize = parseInt(form.setSize, 10) > 0 ? parseInt(form.setSize, 10) : null;
    const setCode = isLorcana ? (form.setCode ?? lorcanaSets[lorcanaSets.length - 1].code) : '';
    // Ink boundaries from the catalog; the saved ones while it loads
    const sections =
      isLorcana && form.inkDividers ? (index ? getInkSections(index, setCode, setSize) : (binder?.sections ?? [])) : [];
    onSubmit({
      name: form.name,
      gameType: form.gameType,
      setCode,
      setSize,
      gridCols: form.gridCols,
      gridRows: form.gridRows,
      sections: sections.length ? sections : null,
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
              {[...lorcanaSets].reverse().map((s) => {
                const nameFr = getLorcanaSetName(s.code);
                return (
                  <option key={s.code} value={s.code}>
                    {s.code} — {nameFr ?? s.name}
                    {nameFr && nameFr !== s.name ? ` (${s.name})` : ''}
                  </option>
                );
              })}
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

      {isLorcana && (
        <label className="flex items-start gap-3 cursor-pointer select-none rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/10 p-3">
          <input
            type="checkbox"
            checked={form.inkDividers}
            onChange={(e) => update({ inkDividers: e.target.checked })}
            disabled={!index && !binder?.sections}
            className="mt-0.5 w-4 h-4 accent-indigo-500"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              Intercalaires par encre
              <span className="flex -space-x-0.5">
                {INKS.map((ink) => (
                  <span key={ink.key} className="w-2 h-2 rounded-full ring-1 ring-slate-950" style={{ background: ink.color }} />
                ))}
              </span>
            </span>
            <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
              {index || binder?.sections
                ? 'Chaque encre commence sur une nouvelle page, comme les cartes hors set : la fin de la page précédente reste vide.'
                : 'Disponible une fois le catalogue chargé.'}
              {isEdit && Boolean(binder.sections?.length) !== form.inkDividers && (
                <span className="block text-amber-300/90 mt-1">Les cartes changeront de place : réorganise ta farde après.</span>
              )}
            </span>
          </span>
        </label>
      )}

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
