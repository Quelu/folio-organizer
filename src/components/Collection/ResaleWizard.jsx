import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, PackageCheck, Undo2 } from 'lucide-react';
import Modal from '../ui/Modal';
import CardThumb from '../ui/CardThumb';
import ProgressBar from '../ui/ProgressBar';
import { useCatalog } from '../../hooks/catalogContext';
import { useCardLang } from '../../hooks/useCardLang';
import { findPocketCard } from '../../utils/catalog';
import { getCounts } from '../../utils/cards';
import { getCardsOnPage } from '../../utils/calculations';

/**
 * A binder page as it lies in the binder, every pocket to take copies from outlined with the
 * number to take out: one look per page instead of one per card.
 * @param {Map<string, { qty: number, foil: number }>} takes copies to take out by card number
 */
const PageMap = ({ binder, page, takes, cell = 64 }) => {
  const { index } = useCatalog();
  return (
    <div
      className="grid gap-1.5 rounded-xl bg-slate-950/60 ring-1 ring-inset ring-white/10 p-2 w-fit"
      style={{ gridTemplateColumns: `repeat(${binder.gridCols}, ${cell}px)` }}
    >
      {getCardsOnPage(page, binder).map((num, i) => {
        if (num == null) return <div key={`gap-${i}`} className="aspect-[5/7] rounded-md bg-white/[0.02]" />;
        const card = index ? findPocketCard(index, binder.setCode, num) : null;
        const { normal, foil } = getCounts(binder.cards[String(num)]);
        const take = takes.get(String(num));
        if (take) {
          return (
            <div key={num} className="relative aspect-[5/7] rounded-md ring-2 ring-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.3)] z-10">
              {card ? <CardThumb card={card} preview={false} className="w-full h-full rounded-md" /> : <div className="w-full h-full rounded-md bg-white/10" />}
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-amber-400 text-slate-950 tabular-nums">
                ×{take.qty}
                {take.foil > 0 && ' ✦'}
              </span>
            </div>
          );
        }
        return normal + foil > 0 && card ? (
          <CardThumb key={num} card={card} preview={false} className="w-full opacity-25 rounded-md" />
        ) : (
          <div key={num} className="aspect-[5/7] rounded-md border border-dashed border-white/10 flex items-center justify-center text-[9px] text-slate-600 tabular-nums">
            {num}
          </div>
        );
      })}
    </div>
  );
};

/** Copies to take out, one step per binder page, binders in sidebar order, pages front to back. */
const toPages = (copies, binders) => {
  const order = new Map(binders.map((b, i) => [b.id, i]));
  const pages = new Map();
  for (const copy of copies) {
    const id = `${copy.binder.id}:${copy.location.page}`;
    const page = pages.get(id) ?? { id, binder: copy.binder, page: copy.location.page, copies: [] };
    page.copies.push(copy);
    pages.set(id, page);
  }
  return [...pages.values()]
    .map((p) => ({ ...p, copies: p.copies.sort((a, b) => Number(a.cardNumber) - Number(b.cardNumber)) }))
    .sort((a, b) => order.get(a.binder.id) - order.get(b.binder.id) || a.page - b.page);
};

const WizardBody = ({ copies, binders, verb, onComplete, onClose }) => {
  const cardLang = useCardLang();
  const pages = useMemo(() => toPages(copies, binders), [copies, binders]);
  const [done, setDone] = useState(() => new Set());
  const [at, setAt] = useState(0);
  const isEnd = at >= pages.length;
  const page = pages[at];
  const go = (i) => setAt(Math.max(0, Math.min(pages.length, i)));
  const confirm = () => {
    if (!page) return;
    setDone((prev) => new Set(prev).add(page.id));
    go(at + 1);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === 'Enter' && page) {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const qtyOf = (list) => list.reduce((s, c) => s + c.qty, 0);
  const total = qtyOf(copies);
  const taken = pages.filter((p) => done.has(p.id)).flatMap((p) => p.copies);
  const takes = page
    ? new Map(
        page.copies.reduce((map, c) => {
          const t = map.get(c.cardNumber) ?? { qty: 0, foil: 0 };
          map.set(c.cardNumber, { qty: t.qty + c.qty, foil: t.foil + (c.foil ? c.qty : 0) });
          return map;
        }, new Map())
      )
    : new Map();

  return (
    <div className="px-6 pb-6 pt-2 space-y-5">
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-slate-400">
            {isEnd ? 'Terminé' : `Page ${at + 1} sur ${pages.length}`}
          </span>
          <span className="tabular-nums text-slate-400">
            <b className={qtyOf(taken) === total ? 'text-emerald-300' : 'text-white'}>{qtyOf(taken)}</b>/{total} cartes
          </span>
        </div>
        <ProgressBar value={total ? qtyOf(taken) / total : 0} className="h-1 mt-1.5" />
      </div>

      {page ? (
        <div className="grid sm:grid-cols-[auto_1fr] gap-5 items-start">
          <div>
            <div className="mb-2 leading-tight">
              <div className="text-sm font-semibold text-white">{page.binder.name}</div>
              <div className="text-xs text-slate-400 tabular-nums">
                Page {page.page} · feuille {page.copies[0].location.sheet} {page.copies[0].location.side}
              </div>
            </div>
            <PageMap binder={page.binder} page={page.page} takes={takes} />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">{verb}</div>
            <ul className="space-y-2">
              {page.copies.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5">
                  <CardThumb card={c.card} foil={c.foil} className="w-9 flex-shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
                    <b className="tabular-nums">{c.qty}×</b> {cardLang.fullName(c.card)}
                    {c.foil && <span className="foil-text font-semibold"> foil</span>}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                    n° {c.cardNumber} · r. {c.location.row} c. {c.location.col}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-3">Un exemplaire reste dans chaque pochette.</p>
            {done.has(page.id) && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-300 mt-2">
                <Check size={14} /> Page faite
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="py-8 text-center space-y-2">
          <PackageCheck size={28} className="mx-auto text-emerald-300" />
          <p className="text-sm text-white font-semibold">
            {qtyOf(taken) === total ? `${total} cartes sorties` : `${qtyOf(taken)}/${total} cartes sorties`}
          </p>
          <p className="text-xs text-slate-400">
            Retire-les de tes fardes dans Folio : tu pourras annuler juste après.
            {qtyOf(taken) < total && ' Les pages passées restent dans tes fardes.'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button onClick={() => go(at - 1)} disabled={at === 0} className="btn-secondary px-3 py-2" aria-label="Page précédente">
          <ArrowLeft size={15} />
        </button>
        {page && done.has(page.id) && (
          <button
            onClick={() =>
              setDone((prev) => {
                const next = new Set(prev);
                next.delete(page.id);
                return next;
              })
            }
            className="btn-secondary px-3 py-2 text-xs"
          >
            <Undo2 size={14} /> Pas encore
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          {page ? (
            <>
              <button onClick={() => go(at + 1)} className="btn-secondary px-3 py-2">
                Passer <ArrowRight size={15} />
              </button>
              <button onClick={confirm} className="btn-primary px-4 py-2">
                <Check size={15} /> Page faite · {qtyOf(page.copies)}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="btn-secondary px-3 py-2">
                Fermer
              </button>
              <button onClick={() => onComplete(taken)} disabled={taken.length === 0} className="btn-primary px-4 py-2">
                <PackageCheck size={15} /> Retirer {qtyOf(taken)} cartes de mes fardes
              </button>
            </>
          )}
        </div>
      </div>
      <p className="hidden sm:block text-[11px] text-slate-600 text-center">Entrée : page faite · ← → : précédente, suivante</p>
    </div>
  );
};

/**
 * Guided pass to take surplus copies out of the binders, page by page, then remove them from
 * the collection (sold, or gone in a lot).
 * @param {{ id, binder, cardNumber, location, card, foil, qty }[]} copies
 * @param {(taken: object[]) => void} onComplete the copies of the pages done
 */
const ResaleWizard = ({ isOpen, onClose, title, ...props }) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
    <WizardBody onClose={onClose} {...props} />
  </Modal>
);

export default ResaleWizard;
