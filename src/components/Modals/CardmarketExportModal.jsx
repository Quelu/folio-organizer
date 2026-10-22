import { useEffect, useRef, useState } from 'react';
import { Copy, Check, ExternalLink, AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { fetchLorcastSet } from '../../utils/lorcastApi';
import { getCardmarketWants, splitWantsLists, CARDMARKET_MAX_ENTRIES } from '../../utils/cardmarketExport';
import { LORCANA_RARITIES } from '../../data/games';

const CARDMARKET_WANTS_URL = 'https://www.cardmarket.com/fr/Lorcana/Wants';

/** Rarity toggles, each with the number of missing cards it holds. */
const RarityFilter = ({ missing, excluded, onChange }) => {
  const counts = new Map();
  for (const line of missing) counts.set(line.rarity, (counts.get(line.rarity) ?? 0) + 1);
  // Rarities Lorcast may add later still get a toggle, after the known ones
  const rarities = [
    ...LORCANA_RARITIES.filter((r) => counts.has(r.key)),
    ...[...counts.keys()]
      .filter((key) => !LORCANA_RARITIES.some((r) => r.key === key))
      .map((key) => ({ key, label: key ?? 'Inconnue' })),
  ];

  const toggle = (key) => onChange(excluded.includes(key) ? excluded.filter((k) => k !== key) : [...excluded, key]);

  return (
    <div>
      <span className="label">Raretés à acheter</span>
      <div className="flex flex-wrap gap-2">
        {rarities.map(({ key, label }) => {
          const included = !excluded.includes(key);
          return (
            <button
              key={key ?? 'unknown'}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={included}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ring-1 ring-inset transition-all ${
                included
                  ? 'bg-indigo-500/15 ring-indigo-400/60 text-white'
                  : 'bg-white/[0.03] ring-white/10 text-slate-500 hover:text-slate-300 hover:bg-white/5'
              }`}
            >
              <span className={included ? '' : 'line-through'}>{label}</span>
              <span className={`text-xs font-semibold tabular-nums ${included ? 'text-indigo-300' : ''}`}>
                {counts.get(key)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 mt-2">Clique une rareté pour l'exclure, par exemple les Enchantées hors de prix.</p>
    </div>
  );
};

/** One block to paste in a Cardmarket wants list. */
const WantsList = ({ lines, index, total }) => {
  const notify = useToast();
  const [copied, setCopied] = useState(false);
  const areaRef = useRef(null);
  const timerRef = useRef(null);
  const text = lines.map((l) => l.text).join('\n');

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    let done;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      // No Clipboard API outside secure contexts (app opened over the LAN on a phone): copy the selection
      areaRef.current?.select();
      done = document.execCommand('copy');
    }
    if (!done) {
      notify({ tone: 'error', message: 'Copie impossible : la liste est sélectionnée, copie-la à la main' });
      return;
    }
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
    notify({ tone: 'success', message: total > 1 ? `Liste ${index + 1} copiée` : 'Liste copiée' });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm text-slate-300">
          {total > 1 && <b className="text-white">Liste {index + 1}/{total} · </b>}
          {lines.length} carte{lines.length > 1 ? 's' : ''}
          <span className="text-slate-500">
            {' '}
            (n° {lines[0].cardNumber} à {lines[lines.length - 1].cardNumber})
          </span>
        </span>
        <button onClick={copy} className={copied ? 'btn-secondary px-3 py-1.5 text-emerald-300' : 'btn-primary px-3 py-1.5'}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copiée' : 'Copier'}
        </button>
      </div>
      <textarea
        ref={areaRef}
        readOnly
        value={text}
        rows={Math.min(lines.length, 8)}
        onFocus={(e) => e.target.select()}
        className="field font-mono text-xs leading-relaxed resize-none scrollbar-thin whitespace-pre"
        aria-label={`Deck list Cardmarket${total > 1 ? ` ${index + 1}` : ''}`}
      />
    </div>
  );
};

const ExportBody = ({ binder, excludedRarities, onExcludedRaritiesChange }) => {
  const [set, setSet] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);
  const [withExpansion, setWithExpansion] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchLorcastSet(binder.setCode).then((data) => {
      if (!cancelled) setSet(data ? { status: 'ready', data } : { status: 'error', data: null });
    });
    return () => {
      cancelled = true;
    };
  }, [binder.setCode, attempt]);

  if (set.status === 'loading') {
    return (
      <div className="px-6 pb-8 pt-6 flex items-center justify-center gap-2.5 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" />
        Chargement des cartes du set…
      </div>
    );
  }

  if (set.status === 'error') {
    return (
      <div className="px-6 pb-6 pt-3 space-y-4">
        <p className="text-sm text-slate-400">Impossible de récupérer la liste des cartes du set depuis Lorcast.</p>
        <button
          onClick={() => {
            setSet({ status: 'loading', data: null });
            setAttempt((a) => a + 1);
          }}
          className="btn-secondary"
        >
          <RotateCcw size={15} />
          Réessayer
        </button>
      </div>
    );
  }

  const { lines: missing, unknown, lastNumber } = getCardmarketWants(binder, set.data, withExpansion);
  const lines = missing.filter((l) => !excludedRarities.includes(l.rarity));
  const lists = splitWantsLists(lines);
  const versioned = lines.filter((l) => l.version).length;

  if (missing.length === 0 && unknown.length === 0) {
    return (
      <div className="px-6 pb-6 pt-3">
        <p className="text-sm text-slate-400">
          Il ne manque aucune carte entre 1 et {lastNumber} : rien à acheter 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 pt-2 space-y-5">
      <p className="text-sm text-slate-400 leading-relaxed">
        <b className="text-white">
          {missing.length} carte{missing.length > 1 ? 's' : ''} manquante{missing.length > 1 ? 's' : ''}
        </b>{' '}
        sur {lastNumber}
        {lines.length < missing.length && (
          <>
            , <b className="text-white">{lines.length}</b> à acheter
          </>
        )}
        , un exemplaire de chaque.
        {versioned > 0 && (
          <>
            {' '}
            {versioned > 1 ? `${versioned} partagent leur nom` : '1 partage son nom'} avec une Enchanted, Epic ou
            Iconic : {versioned > 1 ? 'leur' : 'sa'} version est précisée (<span className="font-mono text-slate-300">V.1</span> pour la carte normale,{' '}
            <span className="font-mono text-slate-300">V.2</span> et plus pour les versions spéciales) pour que
            Cardmarket ne propose pas la mauvaise.
          </>
        )}
      </p>

      {missing.length > 0 && (
        <RarityFilter missing={missing} excluded={excludedRarities} onChange={onExcludedRaritiesChange} />
      )}

      {set.data.setName && (
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={withExpansion}
            onChange={(e) => setWithExpansion(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-indigo-500"
          />
          <span className="text-sm text-slate-300">
            Uniquement des cartes de <b className="text-white">{set.data.setName}</b>
            <span className="block text-xs text-slate-500 mt-0.5">
              Décoché, Cardmarket accepte la carte de n'importe quelle extension (rééditions comprises).
            </span>
          </span>
        </label>
      )}

      {unknown.length > 0 && (
        <p className="flex gap-2 text-xs text-amber-300/90 leading-relaxed">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Introuvable{unknown.length > 1 ? 's' : ''} chez Lorcast, non inclus : n° {unknown.join(', ')}.
          </span>
        </p>
      )}

      {lists.length > 1 && (
        <p className="text-xs text-slate-500">
          Cardmarket accepte {CARDMARKET_MAX_ENTRIES} entrées max par liste de wants : crée une liste pour chaque bloc.
        </p>
      )}

      {lines.length === 0 && missing.length > 0 && (
        <p className="text-sm text-slate-400">Toutes les cartes manquantes sont exclues par le filtre de raretés.</p>
      )}

      <div className="space-y-5">
        {lists.map((list, i) => (
          <WantsList key={i} lines={list} index={i} total={lists.length} />
        ))}
      </div>

      {lines.length > 0 && (
        <div className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 text-xs text-slate-400 leading-relaxed">
          Sur Cardmarket, crée une liste de wants, ouvre l'ajout d'une deck list, colle le bloc puis valide avec{' '}
          <b className="text-slate-200">Add</b>.
          <a
            href={CARDMARKET_WANTS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 mt-2 text-indigo-300 hover:text-white font-semibold transition-colors w-fit"
          >
            Ouvrir mes wants Cardmarket
            <ExternalLink size={13} />
          </a>
        </div>
      )}
    </div>
  );
};

/** Missing cards of a Lorcana binder as Cardmarket deck lists, to buy them from a wants list. */
const CardmarketExportModal = ({ isOpen, binder, excludedRarities, onExcludedRaritiesChange, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Cartes manquantes → Cardmarket" size="lg">
    {/* Keyed so the options reset when another binder is opened */}
    <ExportBody
      key={binder.id}
      binder={binder}
      excludedRarities={excludedRarities}
      onExcludedRaritiesChange={onExcludedRaritiesChange}
    />
  </Modal>
);

export default CardmarketExportModal;
