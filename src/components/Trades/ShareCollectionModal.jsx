import { useMemo, useState } from 'react';
import { Download, Share2, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { Segmented } from '../Collection/CollectionParts';
import { useToast } from '../ui/toastContext';
import { useStore } from '../../hooks/storeContext';
import { useTradeSide, DEFAULT_TRADE_WANTS } from '../../hooks/useTradeSide';
import { buildCollectionShare, getShareFilename } from '../../utils/tradeShare';
import { getBinderStats } from '../../utils/calculations';
import { getLorcanaSetName } from '../../data/games';

const sum = (items) => items.reduce((s, i) => s + i.qty, 0);

const download = (file) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
};

// Phones share files to a messaging app; desktops only download them
const canShareFiles = () => {
  try {
    return Boolean(navigator.canShare?.({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] }));
  } catch {
    return false;
  }
};

/** The export form, mounted while the modal is open: the collection is only read then. */
const ShareForm = ({ onClose, initialBinderIds }) => {
  const { binders, prefs, setPref } = useStore();
  const notify = useToast();
  const lorcanaBinders = useMemo(() => binders.filter((b) => b.gameType === 'lorcana' && b.setCode), [binders]);
  const [scope, setScope] = useState(initialBinderIds?.length ? 'binders' : 'all');
  const [chosen, setChosen] = useState(initialBinderIds ?? []);
  const [name, setName] = useState(prefs.traderName ?? '');
  const [shareable] = useState(canShareFiles);
  const side = useTradeSide(scope === 'all' ? null : chosen);
  const keep = prefs.tradeKeep ?? 1;
  const wantsPrefs = { ...DEFAULT_TRADE_WANTS, ...prefs.tradeWants };
  const setWants = (changes) => setPref('tradeWants', { ...wantsPrefs, ...changes });

  const owner = name.trim();
  const scopeLabel =
    scope === 'all'
      ? 'Toute la collection'
      : lorcanaBinders
          .filter((b) => chosen.includes(b.id))
          .map((b) => b.name)
          .join(', ');
  const ready = Boolean(side) && owner && (scope === 'all' || chosen.length > 0);
  const copies = side?.owned.reduce((s, o) => s + o.total, 0) ?? 0;

  const buildFile = () => {
    setPref('traderName', owner);
    const share = buildCollectionShare({ owner, scope: scopeLabel, keep, owned: side.owned, haves: side.haves, wants: side.wants });
    return new File([JSON.stringify(share, null, 2)], getShareFilename(owner), { type: 'application/json' });
  };

  const handleDownload = () => {
    download(buildFile());
    notify({ tone: 'success', message: 'Collection téléchargée : envoie le fichier à l’autre joueur' });
    onClose();
  };

  const handleShare = async () => {
    try {
      await navigator.share({ files: [buildFile()], title: `Collection Folio de ${owner}` });
      onClose();
    } catch (e) {
      if (e?.name !== 'AbortError') notify({ tone: 'error', message: 'Partage impossible : télécharge le fichier' });
    }
  };

  const toggleBinder = (id) => setChosen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="px-6 pb-6 pt-2 space-y-5">
      <p className="text-sm text-slate-400 leading-relaxed">
        Folio crée un fichier à envoyer à un autre joueur. Une fois importé dans{' '}
        <b className="text-slate-200">Échanges</b>, il lui montre aussitôt les échanges équitables entre vos deux
        collections.
      </p>

      <div>
        <label htmlFor="trader-name" className="label">
          Ton nom
        </label>
        <input
          id="trader-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Prénom ou pseudo, vu par l’autre joueur"
          className="field"
        />
      </div>

      <div>
        <span className="label">Cartes partagées</span>
        <Segmented
          label="Cartes partagées"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Toute la collection' },
            { value: 'binders', label: 'Certaines fardes' },
          ]}
        />
        {scope === 'binders' && (
          <ul className="mt-3 space-y-1 max-h-56 overflow-y-auto scrollbar-thin -mx-1 px-1">
            {lorcanaBinders.map((b) => (
              <li key={b.id}>
                <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={chosen.includes(b.id)}
                    onChange={() => toggleBinder(b.id)}
                    className="w-4 h-4 accent-indigo-500 flex-shrink-0"
                  />
                  <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">{b.name}</span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {getLorcanaSetName(b.setCode) ?? `Set ${b.setCode}`} · {getBinderStats(b).copies} cartes
                  </span>
                </label>
              </li>
            ))}
            {lorcanaBinders.length === 0 && <li className="text-sm text-slate-500">Aucune farde Lorcana liée à un chapitre.</li>}
          </ul>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <span className="label">Ce que tu cherches</span>
          <p className="text-xs text-slate-500 mb-2">Les cartes absentes des fardes partagées, et en plus&nbsp;:</p>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={wantsPrefs.decks}
              onChange={(e) => setWants({ decks: e.target.checked })}
              className="w-4 h-4 accent-indigo-500"
            />
            Les copies qui manquent à tes decks
          </label>
          <label className="flex items-center gap-2 mt-1.5 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={wantsPrefs.specials}
              onChange={(e) => setWants({ specials: e.target.checked })}
              className="w-4 h-4 accent-indigo-500"
            />
            Les Épiques, Enchantées et Iconiques
          </label>
        </div>
        <div>
          <span className="label">Ce que tu proposes</span>
          <p className="text-xs text-slate-500 mb-2">Tes doubles, les copies de tes decks mises de côté.</p>
          <Segmented
            label="Exemplaires gardés"
            value={keep}
            onChange={(n) => setPref('tradeKeep', n)}
            options={[
              { value: 1, label: 'Garder 1' },
              { value: 4, label: 'Garder 4 (playset)' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'exemplaires partagés', value: copies },
          { label: 'doubles proposés', value: side ? sum(side.haves) : null },
          { label: 'cartes cherchées', value: side ? sum(side.wants) : null },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2.5">
            <div className="text-lg font-bold text-white tabular-nums leading-tight">
              {s.value == null ? <Loader2 size={16} className="animate-spin text-slate-500" /> : s.value.toLocaleString('fr-BE')}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button onClick={onClose} className="btn-secondary sm:flex-1">
          Annuler
        </button>
        {shareable && (
          <button onClick={handleShare} disabled={!ready} className="btn-secondary sm:flex-1">
            <Share2 size={16} />
            Envoyer…
          </button>
        )}
        <button onClick={handleDownload} disabled={!ready} className="btn-primary sm:flex-1">
          <Download size={16} />
          Télécharger le fichier
        </button>
      </div>
      {!owner && <p className="text-xs text-slate-500 -mt-2 text-right">Indique ton nom pour créer le fichier.</p>}
    </div>
  );
};

/**
 * Exports the collection, or some binders, as a file for another player: their Folio finds the
 * trades between both collections once they import it.
 * @param {string[]|null} initialBinderIds binders chosen when opened from one of them
 */
const ShareCollectionModal = ({ isOpen, onClose, initialBinderIds = null }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Partager ma collection" size="lg">
    <ShareForm onClose={onClose} initialBinderIds={initialBinderIds} />
  </Modal>
);

export default ShareCollectionModal;
