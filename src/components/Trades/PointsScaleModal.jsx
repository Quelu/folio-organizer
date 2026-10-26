import { useState } from 'react';
import Modal from '../ui/Modal';
import { useStore } from '../../hooks/storeContext';
import { useToast } from '../ui/toastContext';
import { LORCANA_RARITIES } from '../../data/games';
import { DEFAULT_TRADE_POINTS, getPointsScale, formatPoints } from '../../utils/tradeMatch';

const PRESETS = [
  { key: 'double', label: 'Doublement', hint: 'Par défaut : chaque rareté vaut le double de la précédente', scale: DEFAULT_TRADE_POINTS },
  {
    key: 'linear',
    label: 'Progression régulière',
    hint: 'Un point de plus à chaque rareté',
    scale: { rarities: Object.fromEntries(LORCANA_RARITIES.map((r, i) => [r.key, i + 1])), foil: 2 },
  },
  {
    key: 'flat',
    label: 'Carte pour carte',
    hint: 'Toutes les cartes se valent, foils compris',
    scale: { rarities: Object.fromEntries(LORCANA_RARITIES.map((r) => [r.key, 1])), foil: 1 },
  },
];

// The fields keep what is typed ("1,5", "") until saved
const toText = (n) => String(n).replace('.', ',');
const toDraft = (scale) => ({
  rarities: Object.fromEntries(LORCANA_RARITIES.map((r) => [r.key, toText(scale.rarities[r.key])])),
  foil: toText(scale.foil),
});

const parse = (text) => {
  const n = Number(String(text).replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
};

const sameScale = (draft, scale) =>
  parse(draft.foil) === scale.foil && LORCANA_RARITIES.every((r) => parse(draft.rarities[r.key]) === scale.rarities[r.key]);

/** The form, mounted while the modal is open: it starts from the saved scale each time. */
const PointsForm = ({ onClose }) => {
  const { prefs, setPref } = useStore();
  const notify = useToast();
  const [draft, setDraft] = useState(() => toDraft(getPointsScale(prefs.tradePoints)));

  const common = parse(draft.rarities.Common);
  const foil = parse(draft.foil);
  const invalid = foil == null || foil < 1 || LORCANA_RARITIES.some((r) => parse(draft.rarities[r.key]) == null);

  const save = () => {
    setPref('tradePoints', {
      rarities: Object.fromEntries(LORCANA_RARITIES.map((r) => [r.key, parse(draft.rarities[r.key])])),
      foil,
    });
    notify({ tone: 'success', message: 'Points de rareté enregistrés' });
    onClose();
  };

  return (
    <div className="px-6 pb-6 pt-2 space-y-5">
      <p className="text-sm text-slate-400 leading-relaxed">
        Ce que vaut chaque carte dans un échange par points : Folio équilibre le total des deux côtés. Les points sont
        indiqués dans la proposition copiée, pour que l’autre joueur connaisse la règle.
      </p>

      <div>
        <span className="label">Préréglages</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const active = sameScale(draft, preset.scale);
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => setDraft(toDraft(preset.scale))}
                aria-pressed={active}
                title={preset.hint}
                className={`px-3 py-1.5 rounded-lg text-sm ring-1 ring-inset transition-colors ${
                  active ? 'bg-indigo-500/15 ring-indigo-400/60 text-white' : 'bg-white/[0.03] ring-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="label">Points par rareté</span>
        <ul className="space-y-1.5">
          {LORCANA_RARITIES.map((r) => {
            const points = parse(draft.rarities[r.key]);
            return (
              <li key={r.key} className="flex items-center gap-3">
                <label htmlFor={`points-${r.key}`} className="w-28 flex-shrink-0 text-sm text-slate-300">
                  {r.label}
                </label>
                <input
                  id={`points-${r.key}`}
                  inputMode="decimal"
                  value={draft.rarities[r.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, rarities: { ...d.rarities, [r.key]: e.target.value } }))}
                  aria-invalid={points == null}
                  className={`field w-20 py-1.5 text-right tabular-nums ${points == null ? 'ring-rose-400/70' : ''}`}
                />
                <span className="text-xs text-slate-500 tabular-nums">
                  {points != null && common && r.key !== 'Common' && `= ${formatPoints(points / common)} commune${points / common > 1 ? 's' : ''}`}
                </span>
              </li>
            );
          })}
          <li className="flex items-center gap-3 pt-2">
            <label htmlFor="points-foil" className="w-28 flex-shrink-0 text-sm text-slate-300">
              <span className="foil-text font-semibold">Foil</span> ×
            </label>
            <input
              id="points-foil"
              inputMode="decimal"
              value={draft.foil}
              onChange={(e) => setDraft((d) => ({ ...d, foil: e.target.value }))}
              aria-invalid={foil == null || foil < 1}
              className={`field w-20 py-1.5 text-right tabular-nums ${foil == null || foil < 1 ? 'ring-rose-400/70' : ''}`}
            />
            <span className="text-xs text-slate-500">multiplie les points d’une copie foil (pas les Épiques, Enchantées et Iconiques, toujours foil)</span>
          </li>
        </ul>
        {invalid && <p className="text-xs text-rose-300 mt-2">Des points positifs partout, et un foil d’au moins ×1.</p>}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button onClick={onClose} className="btn-secondary sm:flex-1">
          Annuler
        </button>
        <button onClick={save} disabled={invalid} className="btn-primary sm:flex-1">
          Enregistrer
        </button>
      </div>
    </div>
  );
};

/** Points of the rarities for trades by points (prefs.tradePoints). */
const PointsScaleModal = ({ isOpen, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Points de rareté">
    <PointsForm onClose={onClose} />
  </Modal>
);

export default PointsScaleModal;
