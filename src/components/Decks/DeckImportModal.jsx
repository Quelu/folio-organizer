import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, BookMarked } from 'lucide-react';
import Modal from '../ui/Modal';
import ProgressBar from '../ui/ProgressBar';
import MissingCards from './MissingCards';
import { useCatalog } from '../../hooks/catalogContext';
import { useStore } from '../../hooks/storeContext';
import { useCollection } from '../../hooks/useCollection';
import { useToast } from '../ui/toastContext';
import { parseDeckList, analyzeDeck } from '../../utils/deckRules';
import { FORMATS } from '../../utils/catalog';

const PLACEHOLDER = `4 Elsa - Spirit of Winter
4 Be Our Guest
2x Hades - King of Olympus
…`;

/** Paste a deck list found online: how much of it you own, what is missing, then save it. */
const ImportBody = ({ initialKind, onClose, onSaved }) => {
  const notify = useToast();
  const { index, loaded, total } = useCatalog();
  const { createDeck } = useStore();
  const collection = useCollection();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [format, setFormat] = useState('core');

  const parsed = useMemo(() => (index && text.trim() ? parseDeckList(text, index) : null), [index, text]);
  const analysis = useMemo(
    () => (parsed ? analyzeDeck({ cards: parsed.cards, format }, index, collection) : null),
    [parsed, format, index, collection]
  );

  const save = (kind) => {
    const id = createDeck({
      name: name.trim() || (kind === 'reference' ? 'Deck de référence' : 'Deck importé'),
      kind,
      format,
      cards: parsed.cards,
      source: 'import',
      sourceUrl: sourceUrl.trim(),
    });
    notify({ tone: 'success', message: kind === 'reference' ? 'Ajouté aux decks de référence' : 'Deck enregistré' });
    onSaved(id);
    onClose();
  };

  if (!index) {
    return (
      <p className="px-6 pb-6 pt-3 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> Chargement du catalogue ({loaded}/{total})…
      </p>
    );
  }

  return (
    <div className="px-6 pb-6 pt-2 space-y-5">
      <p className="text-sm text-slate-400 leading-relaxed">
        Colle une liste trouvée sur Dreamborn, Inkdecks, Lorcana.gg… (une carte par ligne, « 4 Nom - Version »). Tu
        vois tout de suite ce que tu possèdes déjà.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={8}
        autoFocus
        className="field font-mono text-xs leading-relaxed scrollbar-thin"
        aria-label="Liste du deck"
      />

      {parsed?.unresolved.length > 0 && (
        <div className="flex gap-2 text-xs text-amber-300/90 leading-relaxed">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Non reconnue{parsed.unresolved.length > 1 ? 's' : ''} : {parsed.unresolved.map((u) => u.line).join(' · ')}
          </span>
        </div>
      )}

      {analysis && analysis.total > 0 && (
        <>
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-white font-semibold">
                Tu possèdes {Math.round(analysis.ownedRatio * 100)} % du deck
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                {analysis.owned}/{analysis.total} cartes · {analysis.inks.join(' / ')}
              </span>
            </div>
            <ProgressBar value={analysis.ownedRatio} className="h-2" />
            {analysis.errors.length > 0 && (
              <p className="text-xs text-amber-300/90 mt-2">{analysis.errors.map((e) => e.message).join(' ')}</p>
            )}
          </div>

          <MissingCards entries={analysis.missing} />

          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-white/5">
            <div>
              <label className="label" htmlFor="import-name">
                Nom
              </label>
              <input id="import-name" value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="Ex. Amber/Steel Worlds 2026" />
            </div>
            <div>
              <span className="label">Format</span>
              <div className="flex gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFormat(f.key)}
                    aria-pressed={format === f.key}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm ring-1 ring-inset transition-colors ${
                      format === f.key ? 'bg-indigo-500/15 ring-indigo-400/60 text-white' : 'ring-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="import-url">
                Source (optionnel)
              </label>
              <input id="import-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="field" placeholder="https://…" />
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button onClick={() => save(initialKind === 'reference' ? 'reference' : 'mine')} className="btn-primary flex-1">
              {initialKind === 'reference' ? <BookMarked size={16} /> : <Save size={16} />}
              {initialKind === 'reference' ? 'Ajouter aux références' : 'Enregistrer dans mes decks'}
            </button>
            <button
              onClick={() => save(initialKind === 'reference' ? 'mine' : 'reference')}
              className="btn-secondary flex-1"
            >
              {initialKind === 'reference' ? 'Plutôt dans mes decks' : 'Plutôt comme référence pour l’IA'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const DeckImportModal = ({ isOpen, kind = 'mine', onClose, onSaved }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Puis-je monter ce deck ?" size="lg">
    <ImportBody initialKind={kind} onClose={onClose} onSaved={onSaved} />
  </Modal>
);

export default DeckImportModal;
