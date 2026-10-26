import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCatalog } from '../../hooks/catalogContext';
import { useToast } from '../ui/toastContext';

const formatDate = (at) => new Date(at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });

/**
 * Freshness of the card data and a button fetching it again: new chapters, translations,
 * legalities. Data also refreshes by itself every two days.
 */
const CatalogStatus = () => {
  const notify = useToast();
  const { index, status, loaded, updatedAt, update } = useCatalog();
  const pendingRef = useRef(false);
  const busy = status === 'loading';

  useEffect(() => {
    if (!pendingRef.current || busy) return;
    pendingRef.current = false;
    notify(
      status === 'error'
        ? { tone: 'error', message: 'Mise à jour impossible : vérifie ta connexion' }
        : { tone: 'success', message: `Cartes à jour : ${index?.sets.length ?? loaded} chapitres` }
    );
  }, [busy, status, index, loaded, notify]);

  return (
    <button
      onClick={() => {
        pendingRef.current = true;
        update();
      }}
      disabled={busy}
      className="w-full flex items-center gap-2 px-4 pt-2.5 text-left text-[11px] text-slate-600 hover:text-slate-300 disabled:hover:text-slate-600 transition-colors"
      title="Télécharger à nouveau les cartes, traductions et légalités (nouveaux chapitres compris)"
    >
      <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
      <span className="flex-1 truncate">
        {busy
          ? 'Mise à jour des cartes…'
          : `${index?.sets.length ?? loaded} chapitres${updatedAt ? ` · à jour du ${formatDate(updatedAt)}` : ''}`}
      </span>
      {!busy && <span className="text-indigo-300/80">Mettre à jour</span>}
    </button>
  );
};

export default CatalogStatus;
