import { useMemo, useState } from 'react';
import { Layers, Save, Replace, ChevronDown, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import { DeckDiff } from '../Decks/DeckVersions';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { useToast } from '../ui/toastContext';
import { resolveProposedCards } from '../../ai/tools';
import { analyzeDeck, formatDeckList } from '../../utils/deckRules';
import { getInk } from '../../utils/catalog';

/**
 * A deck proposed by the assistant (propose_deck call): checked against the rules and the
 * collection, saved as a new deck or applied to the deck it improves (after keeping a version).
 */
const DeckProposal = ({ input }) => {
  const notify = useToast();
  const { decks, createDeck, updateDeck, setView } = useStore();
  const { index } = useCatalog();
  const collection = useCollection();
  const [open, setOpen] = useState(false);
  const [savedId, setSavedId] = useState(null);

  const resolved = useMemo(() => (index ? resolveProposedCards(input, index) : { cards: [], unknown: [] }), [input, index]);
  const format = input?.format === 'infinity' ? 'infinity' : 'core';
  const deck = useMemo(
    () => ({ name: input?.name ?? 'Deck proposé', format, cards: resolved.cards }),
    [input?.name, format, resolved.cards]
  );
  const analysis = useMemo(() => analyzeDeck(deck, index, collection), [deck, index, collection]);
  const target = input?.replaces_deck_id ? decks.find((d) => d.id === input.replaces_deck_id) : null;

  if (!index) return null;

  const save = () => {
    const id = createDeck({ name: deck.name, format, cards: deck.cards, notes: input.summary ?? '', source: 'ai' });
    setSavedId(id);
    notify({ tone: 'success', message: 'Deck enregistré' });
  };

  const apply = () => {
    updateDeck(target.id, { cards: deck.cards, format }, `Avant modification IA (${new Date().toLocaleDateString('fr-BE')})`);
    setSavedId(target.id);
    notify({ tone: 'success', message: `« ${target.name} » mis à jour (version précédente gardée)` });
  };

  return (
    <div className="my-3 rounded-2xl bg-gradient-to-br from-violet-500/[0.08] to-indigo-500/[0.04] ring-1 ring-inset ring-violet-400/25 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center flex-shrink-0">
          <Layers size={18} className="text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">{deck.name}</div>
          <div className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap mt-0.5">
            {analysis.inks.map((ink) => (
              <span key={ink} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: getInk(ink).color }} />
                {getInk(ink).label}
              </span>
            ))}
            <span>· {analysis.total} cartes · {format === 'core' ? 'Core' : 'Infinity'}</span>
          </div>
        </div>
      </div>

      {input?.summary && <p className="text-sm text-slate-300 mt-3 leading-relaxed">{input.summary}</p>}

      <div className="mt-3 flex items-center gap-2.5">
        <ProgressBar value={analysis.ownedRatio} className="flex-1 h-1.5" />
        <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
          {analysis.owned}/{analysis.total} possédées
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {analysis.errors.map((e, i) => (
          <p key={i} className="flex gap-1.5 text-xs text-rose-300">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> {e.message}
          </p>
        ))}
        {resolved.unknown.length > 0 && (
          <p className="flex gap-1.5 text-xs text-amber-300">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> Cartes inconnues ignorées : {resolved.unknown.join(', ')}
          </p>
        )}
        {analysis.valid && (
          <p className="flex gap-1.5 text-xs text-emerald-300">
            <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" /> Deck valide
            {analysis.missing.length > 0 &&
              ` · manque ${analysis.missing.reduce((s, e) => s + e.missing, 0)} carte(s)`}
          </p>
        )}
      </div>

      <button onClick={() => setOpen((o) => !o)} className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-white">
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Masquer' : 'Voir'} {target ? 'les changements' : 'la liste'}
      </button>
      {open &&
        (target ? (
          <div className="mt-2">
            <DeckDiff before={target.cards} after={deck.cards} />
          </div>
        ) : (
          <pre className="mt-2 text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{formatDeckList(deck, index)}</pre>
        ))}

      <div className="flex gap-2 mt-4 flex-wrap">
        {savedId ? (
          <button onClick={() => setView({ kind: 'decks', deckId: savedId })} className="btn-secondary px-3 py-2">
            <ExternalLink size={15} />
            Ouvrir le deck
          </button>
        ) : (
          <>
            {target && (
              <button onClick={apply} className="btn-primary px-3 py-2">
                <Replace size={15} />
                Appliquer à « {target.name} »
              </button>
            )}
            <button onClick={save} className={target ? 'btn-secondary px-3 py-2' : 'btn-primary px-3 py-2'}>
              <Save size={15} />
              Enregistrer comme nouveau deck
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default DeckProposal;
