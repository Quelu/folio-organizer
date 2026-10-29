import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Replace } from 'lucide-react';
import Modal from '../ui/Modal';
import { DeckDiff } from './DeckVersions';
import { useCatalog } from '../../hooks/catalogContext';
import { useStore } from '../../hooks/storeContext';
import { useToast } from '../ui/toastContext';
import { parseDeckList, diffDeckCards, getDeckSize } from '../../utils/deckRules';

/** Paste the deck's list again (its source changed): what changes, then its cards are replaced. */
const ListBody = ({ deck, onClose }) => {
  const notify = useToast();
  const { index, loaded, total } = useCatalog();
  const { updateDeck } = useStore();
  const [text, setText] = useState('');

  const parsed = useMemo(() => (index && text.trim() ? parseDeckList(text, index) : null), [index, text]);
  const changed = parsed && parsed.cards.length > 0 && diffDeckCards(deck.cards, parsed.cards).length > 0;

  const apply = () => {
    updateDeck(deck.id, { cards: parsed.cards }, `Avant mise à jour de la liste (${new Date().toLocaleDateString('fr-BE')})`);
    notify({ tone: 'success', message: 'Liste mise à jour (version précédente gardée)' });
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
        Colle la liste à jour (une carte par ligne, « 4 Nom - Version ») : elle remplace les cartes de « {deck.name} ».
        L'ancienne liste est gardée dans ses versions.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'4 Elsa - Spirit of Winter\n4 Be Our Guest\n…'}
        rows={8}
        autoFocus
        className="field font-mono text-xs leading-relaxed scrollbar-thin"
        aria-label="Nouvelle liste du deck"
      />

      {parsed?.unresolved.length > 0 && (
        <div className="flex gap-2 text-xs text-amber-300/90 leading-relaxed">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Non reconnue{parsed.unresolved.length > 1 ? 's' : ''} : {parsed.unresolved.map((u) => u.line).join(' · ')}
          </span>
        </div>
      )}

      {parsed?.cards.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Changements</span>
            <span className="text-xs text-slate-500 tabular-nums">
              {getDeckSize(deck)} → {getDeckSize(parsed)} cartes
            </span>
          </div>
          <DeckDiff before={deck.cards} after={parsed.cards} />
        </div>
      )}

      <button onClick={apply} disabled={!changed} className="btn-primary w-full">
        <Replace size={16} />
        Remplacer la liste
      </button>
    </div>
  );
};

const DeckListModal = ({ isOpen, deck, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Mettre à jour la liste" size="lg">
    <ListBody deck={deck} onClose={onClose} />
  </Modal>
);

export default DeckListModal;
