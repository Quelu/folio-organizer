import { useMemo } from 'react';
import { MapPin, PackageCheck, Undo2, CheckCheck, AlertTriangle } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { useStore } from '../../hooks/storeContext';
import { useCollection } from '../../hooks/useCollection';
import { useToast } from '../ui/toastContext';
import { getPullList } from '../../utils/collection';
import { findPocketCard } from '../../utils/catalog';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useCopyAllocation } from '../../hooks/useCopyAllocation';

/** "Page 3 · feuille 2 recto · rangée 1, col. 2" */
const describeLocation = (loc) =>
  `Page ${loc.page} · feuille ${loc.sheet} ${loc.side} · rangée ${loc.row}, col. ${loc.col}`;

/**
 * Where to take each card of a deck from, binder by binder in page order, so every binder is
 * leafed through once. Taken cards are marked as out of their pocket.
 */
const PullList = ({ deck, onLocate }) => {
  const notify = useToast();
  const { binders, pulls, pullCards, returnCards } = useStore();
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const collection = useCollection();
  const { availableFor } = useCopyAllocation();
  const { rows, short } = useMemo(
    () => getPullList(deck, collection, pulls, binders, availableFor),
    [deck, collection, pulls, binders, availableFor]
  );

  const groups = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.binder.id === row.binder.id) last.rows.push(row);
    else groups.push({ binder: row.binder, rows: [row] });
  }

  const deckPulls = pulls.filter((p) => p.deckId === deck.id);
  const pulledCount = deckPulls.reduce((s, p) => s + p.qty, 0);
  const toTake = rows.reduce((s, r) => s + r.take, 0);

  const takeAll = () => {
    pullCards(
      deck.id,
      rows.map((r) => ({ binderId: r.binder.id, cardNumber: r.cardNumber, qty: r.take }))
    );
    notify({ tone: 'success', message: `${toTake} carte${toTake > 1 ? 's' : ''} marquée${toTake > 1 ? 's' : ''} comme sortie${toTake > 1 ? 's' : ''}` });
  };

  return (
    <div data-preview-group className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">
          {toTake > 0 ? (
            <>
              <b className="text-white">{toTake}</b> carte{toTake > 1 ? 's' : ''} à sortir de{' '}
              {groups.length} farde{groups.length > 1 ? 's' : ''}, dans l'ordre des pages.
            </>
          ) : pulledCount > 0 ? (
            'Toutes les cartes disponibles sont sorties pour ce deck.'
          ) : (
            "Aucune carte de ce deck n'est dans tes fardes."
          )}
        </p>
        {toTake > 0 && (
          <button onClick={takeAll} className="btn-primary px-3 py-2">
            <CheckCheck size={15} />
            Tout marquer comme sorti
          </button>
        )}
      </div>

      {groups.map(({ binder, rows: binderRows }) => (
        <section key={binder.id}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {binder.name}
            <span className="text-slate-600"> · {binderRows.reduce((s, r) => s + r.take, 0)} carte(s)</span>
          </h3>
          <div className="space-y-1.5">
            {binderRows.map((row) => (
              <div
                key={`${row.binder.id}-${row.cardNumber}`}
                className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5"
              >
                <CardThumb card={row.card} className="w-10 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    <b className="tabular-nums">{row.take}×</b> {cardLang.fullName(row.card)}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    n° {row.cardNumber} · {describeLocation(row.location)}
                  </div>
                </div>
                <button
                  onClick={() => onLocate(row.binder.id, parseInt(row.cardNumber, 10))}
                  className="btn-icon"
                  title="Voir dans la farde"
                  aria-label="Voir dans la farde"
                >
                  <MapPin size={16} />
                </button>
                <button
                  onClick={() => pullCards(deck.id, [{ binderId: row.binder.id, cardNumber: row.cardNumber, qty: row.take }])}
                  className="btn-secondary px-2.5 py-1.5 text-xs"
                  title="Marquer comme sortie de la farde"
                >
                  <PackageCheck size={14} />
                  Sortie
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {short.length > 0 && (
        <div className="rounded-xl bg-amber-500/[0.06] ring-1 ring-inset ring-amber-400/20 p-4">
          <p className="flex gap-2 text-sm text-amber-200 mb-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            Pas assez d'exemplaires disponibles dans tes fardes :
          </p>
          <ul className="text-xs text-slate-300 space-y-0.5 pl-6 list-disc">
            {short.map((s) => (
              <li key={s.key}>
                {s.missing}× {cardLang.keyName(s.key, s.name)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deckPulls.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Déjà sorties · {pulledCount}
            </h3>
            <button
              onClick={() => {
                returnCards(deck.id);
                notify({ message: 'Cartes remises dans les fardes' });
              }}
              className="btn-secondary px-2.5 py-1.5 text-xs"
            >
              <Undo2 size={14} />
              Tout remettre
            </button>
          </div>
          <div className="space-y-1">
            {deckPulls.map((p) => {
              const binder = binders.find((b) => b.id === p.binderId);
              if (!binder) return null;
              const card = index ? findPocketCard(index, binder.setCode, p.cardNumber) : null;
              return (
                <div key={p.id} className="flex items-center gap-2 text-xs text-slate-400 px-2 py-1 rounded-lg hover:bg-white/[0.03]">
                  <span className="flex-1 truncate">
                    <b className="text-slate-200">{p.qty}×</b> {cardLang.fullName(card, `n° ${p.cardNumber}`)}{' '}
                    <span className="text-slate-600">
                      · {binder.name} n° {p.cardNumber}
                    </span>
                  </span>
                  <button
                    onClick={() => returnCards(deck.id, { binderId: p.binderId, cardNumber: p.cardNumber })}
                    className="btn-icon p-1"
                    title="Remettre dans la farde"
                    aria-label="Remettre dans la farde"
                  >
                    <Undo2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default PullList;
