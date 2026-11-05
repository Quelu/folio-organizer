import { useCallback, useMemo, useState } from 'react';
import { MapPin, PackageCheck, Undo2, CheckCheck, AlertTriangle, BookOpen } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { PocketHint } from '../Trades/PocketMap';
import ResaleWizard from '../Collection/ResaleWizard';
import { useStore } from '../../hooks/storeContext';
import { useCollection } from '../../hooks/useCollection';
import { useToast } from '../ui/toastContext';
import { getPullList } from '../../utils/collection';
import { findPocketCard } from '../../utils/catalog';
import { getLocation } from '../../utils/calculations';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useCopyAllocation } from '../../hooks/useCopyAllocation';

/** "Page 3 · feuille 2 recto · rangée 1, col. 2" */
const describeLocation = (loc) =>
  `Page ${loc.page} · feuille ${loc.sheet} ${loc.side} · rangée ${loc.row}, col. ${loc.col}`;

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** What the page-by-page wizard says, taking a deck's cards out or putting them back. */
const WIZARD = {
  out: {
    verb: 'Sors de ta farde',
    texts: {
      hint: 'Sors chaque carte de sa pochette entourée et pose-la avec le deck.',
      done: (n) => `${n} cartes sorties`,
      next: 'Marque-les comme sorties pour ce deck : tu pourras les remettre depuis « Déjà sorties ».',
      skipped: ' Les pages passées restent à sortir.',
      finish: (n) => `Marquer ${n} cartes comme sorties`,
    },
  },
  in: {
    verb: 'Remets dans ta farde',
    texts: {
      done: (n) => `${n} cartes remises`,
      next: 'Marque-les comme remises dans leurs fardes.',
      skipped: ' Les pages passées restent sorties pour ce deck.',
      finish: (n) => `Marquer ${n} cartes comme remises`,
    },
  },
};

/** Hover or focus of a pocket's place: the binder page around it floats next to it. */
const usePocketHint = (pocket) => {
  const [anchor, setAnchor] = useState(null);
  const hide = useCallback(() => setAnchor(null), []);
  const show = (e) => setAnchor(e.currentTarget.getBoundingClientRect());
  return {
    bind: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
    hint: anchor && <PocketHint pocket={pocket} anchor={anchor} onClose={hide} />,
  };
};

const PLACE = 'cursor-help rounded outline-none underline decoration-dotted decoration-slate-600 underline-offset-2 hover:text-white focus-visible:text-white';

/** A pocket to take copies from, its page shown on hover of its place. */
const PullRow = ({ row, onLocate, onPull }) => {
  const cardLang = useCardLang();
  const { bind, hint } = usePocketHint({ binder: row.binder, cardNumber: row.cardNumber, mode: 'out' });
  return (
    <div className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5">
      <CardThumb card={row.card} className="w-10 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">
          <b className="tabular-nums">{row.take}×</b> {cardLang.fullName(row.card)}
        </div>
        <div className="text-xs text-slate-500 truncate">
          <span {...bind} tabIndex={0} className={PLACE}>
            n° {row.cardNumber} · {describeLocation(row.location)}
          </span>
        </div>
      </div>
      <button
        {...bind}
        onClick={() => onLocate(row.binder.id, parseInt(row.cardNumber, 10))}
        className="btn-icon"
        title="Ouvrir la farde à cette page"
        aria-label="Ouvrir la farde à cette page"
      >
        <MapPin size={16} />
      </button>
      <button onClick={onPull} className="btn-secondary px-2.5 py-1.5 text-xs" title="Marquer comme sortie de la farde">
        <PackageCheck size={14} />
        Sortie
      </button>
      {hint}
    </div>
  );
};

/** A pocket some of the deck's copies came from, where they go back shown on hover. */
const PulledRow = ({ pocket, onReturn }) => {
  const cardLang = useCardLang();
  const { bind, hint } = usePocketHint({ binder: pocket.binder, cardNumber: pocket.cardNumber, mode: 'in', card: pocket.card });
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400 px-2 py-1 rounded-lg hover:bg-white/[0.03]">
      <span className="flex-1 truncate">
        <b className="text-slate-200">{pocket.qty}×</b> {cardLang.fullName(pocket.card, `n° ${pocket.cardNumber}`)}{' '}
        <span {...bind} tabIndex={0} className={`text-slate-500 ${PLACE}`}>
          · {pocket.binder.name} n° {pocket.cardNumber} · p. {pocket.location.page}
        </span>
      </span>
      <button onClick={onReturn} className="btn-icon p-1" title="Remettre dans la farde" aria-label="Remettre dans la farde">
        <Undo2 size={13} />
      </button>
      {hint}
    </div>
  );
};

/**
 * Where to take each card of a deck from, binder by binder in page order, so every binder is
 * leafed through once. Taken cards are marked as out of their pocket; a page-by-page wizard takes
 * them out, or puts them back, one binder page at a time.
 */
const PullList = ({ deck, onLocate }) => {
  const notify = useToast();
  const { binders, pulls, pullCards, returnCards } = useStore();
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const collection = useCollection();
  const { availableFor } = useCopyAllocation();
  const [wizard, setWizard] = useState(null); // { mode, copies } snapshot, while it is open
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

  // Copies taken out for this deck, one line per pocket
  const pulled = useMemo(() => {
    const pockets = new Map();
    for (const p of pulls) {
      if (p.deckId !== deck.id) continue;
      const binder = binders.find((b) => b.id === p.binderId);
      if (!binder) continue;
      const id = `${p.binderId}:${p.cardNumber}`;
      const pocket = pockets.get(id) ?? {
        id,
        binder,
        cardNumber: p.cardNumber,
        location: getLocation(parseInt(p.cardNumber, 10), binder),
        card: index ? findPocketCard(index, binder.setCode, p.cardNumber) : null,
        foil: false,
        qty: 0,
      };
      pocket.qty += p.qty;
      pockets.set(id, pocket);
    }
    const order = new Map(binders.map((b, i) => [b.id, i]));
    return [...pockets.values()].sort(
      (a, b) => order.get(a.binder.id) - order.get(b.binder.id) || Number(a.cardNumber) - Number(b.cardNumber)
    );
  }, [pulls, deck.id, binders, index]);
  const pulledCount = pulled.reduce((s, p) => s + p.qty, 0);
  const toTake = rows.reduce((s, r) => s + r.take, 0);

  const pull = (list) => {
    pullCards(
      deck.id,
      list.map((r) => ({ binderId: r.binder.id, cardNumber: r.cardNumber, qty: r.qty }))
    );
    const n = list.reduce((s, r) => s + r.qty, 0);
    notify({ tone: 'success', message: `${plural(n, 'carte')} marquée${n > 1 ? 's' : ''} comme sortie${n > 1 ? 's' : ''}` });
  };
  const putBack = (list) => {
    for (const p of list) returnCards(deck.id, { binderId: p.binder.id, cardNumber: p.cardNumber });
    const n = list.reduce((s, p) => s + p.qty, 0);
    notify({ message: `${plural(n, 'carte')} remise${n > 1 ? 's' : ''} dans les fardes` });
  };
  /** A row of the pull list as the wizard's copy: the copies to take from its pocket. */
  const toCopy = (r) => ({
    id: `${r.binder.id}:${r.cardNumber}`,
    binder: r.binder,
    cardNumber: r.cardNumber,
    location: r.location,
    card: r.card,
    foil: false,
    qty: r.take,
  });

  return (
    <div data-preview-group className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">
          {toTake > 0 ? (
            <>
              <b className="text-white">{toTake}</b> carte{toTake > 1 ? 's' : ''} à sortir de{' '}
              {plural(groups.length, 'farde')}, dans l'ordre des pages.
            </>
          ) : pulledCount > 0 ? (
            'Toutes les cartes disponibles sont sorties pour ce deck.'
          ) : (
            "Aucune carte de ce deck n'est dans tes fardes."
          )}
        </p>
        {toTake > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => pull(rows.map(toCopy))} className="btn-secondary px-3 py-2">
              <CheckCheck size={15} />
              Tout marquer comme sorti
            </button>
            <button onClick={() => setWizard({ mode: 'out', copies: rows.map(toCopy) })} className="btn-primary px-3 py-2">
              <BookOpen size={15} />
              Sortir page par page
            </button>
          </div>
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
              <PullRow key={`${row.binder.id}-${row.cardNumber}`} row={row} onLocate={onLocate} onPull={() => pull([toCopy(row)])} />
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

      {pulled.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Déjà sorties · {pulledCount}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => putBack(pulled)} className="btn-secondary px-2.5 py-1.5 text-xs">
                <Undo2 size={14} />
                Tout remettre
              </button>
              {pulled.some((p) => p.card) && (
                <button
                  onClick={() => setWizard({ mode: 'in', copies: pulled.filter((p) => p.card) })}
                  className="btn-secondary px-2.5 py-1.5 text-xs"
                >
                  <BookOpen size={14} />
                  Remettre page par page
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            {pulled.map((p) => (
              <PulledRow key={p.id} pocket={p} onReturn={() => putBack([p])} />
            ))}
          </div>
        </section>
      )}

      <ResaleWizard
        isOpen={Boolean(wizard)}
        onClose={() => setWizard(null)}
        title={wizard?.mode === 'in' ? `${deck.name} · remettre dans les fardes` : `${deck.name} · sortir des fardes`}
        mode={wizard?.mode ?? 'out'}
        verb={WIZARD[wizard?.mode ?? 'out'].verb}
        texts={WIZARD[wizard?.mode ?? 'out'].texts}
        binders={binders}
        copies={wizard?.copies ?? []}
        onComplete={(done) => {
          if (wizard.mode === 'in') putBack(done);
          else pull(done);
          setWizard(null);
        }}
      />
    </div>
  );
};

export default PullList;
