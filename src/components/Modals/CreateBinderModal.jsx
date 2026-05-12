import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

const LORCANA_SETS = [
  { code: '1', name: 'The First Chapter' },
  { code: '2', name: 'Rise of the Floodborn' },
  { code: '3', name: 'Into the Inklands' },
  { code: '4', name: "Ursula's Return" },
  { code: '5', name: 'Shimmering Skies' },
  { code: '6', name: "Azurite Sea" },
  { code: '7', name: "Archazia's Island" },
  { code: '8', name: 'Lorcana Set 8' },
  { code: '9', name: 'Lorcana Set 9' },
  { code: '10', name: 'Lorcana Set 10' },
  { code: '11', name: 'Lorcana Set 11' },
  { code: '12', name: 'Wilds Unknown' },
];

const GRID_PRESETS = [
  { cols: 3, rows: 3, label: '3×3 — 9 poches (standard)' },
  { cols: 4, rows: 3, label: '4×3 — 12 poches' },
  { cols: 4, rows: 4, label: '4×4 — 16 poches' },
  { cols: 2, rows: 2, label: '2×2 — 4 poches' },
];

const INITIAL_FORM = { name: '', gameType: 'lorcana', setCode: '1', gridCols: 3, gridRows: 3 };

const CreateBinderModal = ({ isOpen, onClose, onCreate }) => {
  const [form, setForm] = useState(INITIAL_FORM);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleGridChange = (e) => {
    const [cols, rows] = e.target.value.split('x').map(Number);
    setForm((f) => ({ ...f, gridCols: cols, gridRows: rows }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onCreate({ ...form });
    setForm(INITIAL_FORM);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 z-40 backdrop-blur-sm"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 32, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.96 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                <h2 className="text-base font-semibold text-white">Nouvelle farde</h2>
                <button
                  onClick={onClose}
                  className="p-1 text-gray-500 hover:text-white transition-colors rounded"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Nom</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={set('name')}
                    placeholder="Ex: Lorcana Chapitre 1"
                    autoFocus
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  />
                </div>

                {/* Game type */}
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Jeu</label>
                  <select
                    value={form.gameType}
                    onChange={set('gameType')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  >
                    <option value="lorcana">Disney Lorcana</option>
                    <option value="pokemon">Pokémon TCG</option>
                    <option value="magic">Magic: The Gathering</option>
                    <option value="other">Autre</option>
                  </select>
                </div>

                {/* Lorcana set selector */}
                <AnimatePresence>
                  {form.gameType === 'lorcana' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <label className="block text-sm font-medium text-gray-400 mb-1.5">
                        Set Lorcana
                      </label>
                      <select
                        value={form.setCode}
                        onChange={set('setCode')}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      >
                        {LORCANA_SETS.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.code} — {s.name}
                          </option>
                        ))}
                      </select>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Grid preset */}
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Grille</label>
                  <select
                    value={`${form.gridCols}x${form.gridRows}`}
                    onChange={handleGridChange}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  >
                    {GRID_PRESETS.map((p) => (
                      <option key={`${p.cols}x${p.rows}`} value={`${p.cols}x${p.rows}`}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg font-medium transition-colors border border-gray-700 text-sm"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition-colors text-sm"
                  >
                    Créer
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CreateBinderModal;
