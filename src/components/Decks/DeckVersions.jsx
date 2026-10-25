import { useState } from 'react';
import { History, RotateCcw, Save, GitCompare } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useToast } from '../ui/toastContext';
import { diffDeckCards } from '../../utils/deckRules';

const formatDate = (at) =>
  new Date(at).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Changes from one card list to another, + in green, − in red. */
export const DeckDiff = ({ before, after }) => {
  const cardLang = useCardLang();
  const diff = diffDeckCards(before, after);
  if (diff.length === 0) return <p className="text-xs text-slate-500">Aucune différence.</p>;
  return (
    <ul className="space-y-0.5">
      {diff.map((d) => {
        const delta = d.after - d.before;
        return (
          <li key={d.key} className="flex items-center gap-2 text-xs">
            <span className={`w-8 text-right font-bold tabular-nums ${delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
            <span className="text-slate-300 truncate">{cardLang.keyName(d.key, d.name)}</span>
            <span className="text-slate-600 tabular-nums">
              {d.before} → {d.after}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

/** Saved versions of a deck: compare with the current list, restore. */
const DeckVersions = ({ deck }) => {
  const notify = useToast();
  const { saveDeckVersion, restoreDeckVersion } = useStore();
  const [label, setLabel] = useState('');
  const [openId, setOpenId] = useState(null);
  const versions = [...(deck.versions ?? [])].reverse();

  return (
    <div className="space-y-5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          saveDeckVersion(deck.id, label.trim() || 'Version manuelle');
          setLabel('');
          notify({ tone: 'success', message: 'Version enregistrée' });
        }}
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom de la version (ex. avant le tournoi)"
          className="field"
        />
        <button type="submit" className="btn-secondary whitespace-nowrap">
          <Save size={15} />
          Enregistrer
        </button>
      </form>

      <p className="text-xs text-slate-500">
        Une version est gardée automatiquement avant chaque modification proposée par l'assistant IA et avant chaque
        restauration ({deck.versions?.length ?? 0} sur 15 max).
      </p>

      {versions.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <History size={15} /> Aucune version enregistrée.
        </p>
      )}

      <div className="space-y-2">
        {versions.map((v) => {
          const size = v.cards.reduce((s, c) => s + c.qty, 0);
          const isOpen = openId === v.id;
          return (
            <div key={v.id} className="rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{v.label}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(v.at)} · {size} cartes
                  </div>
                </div>
                <button
                  onClick={() => setOpenId(isOpen ? null : v.id)}
                  className={`btn-icon ${isOpen ? 'text-white bg-white/10' : ''}`}
                  title="Comparer avec le deck actuel"
                  aria-label="Comparer avec le deck actuel"
                >
                  <GitCompare size={16} />
                </button>
                <button
                  onClick={() => {
                    restoreDeckVersion(deck.id, v.id);
                    notify({ tone: 'success', message: `« ${v.label} » restaurée` });
                  }}
                  className="btn-secondary px-2.5 py-1.5 text-xs"
                >
                  <RotateCcw size={14} />
                  Restaurer
                </button>
              </div>
              {isOpen && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                    De cette version au deck actuel
                  </div>
                  <DeckDiff before={v.cards} after={deck.cards} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DeckVersions;
