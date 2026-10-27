import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, PackageCheck, PackageOpen, PackagePlus, Undo2 } from 'lucide-react';
import Modal from '../ui/Modal';
import CardThumb from '../ui/CardThumb';
import ProgressBar from '../ui/ProgressBar';
import { useCardLang } from '../../hooks/useCardLang';
import { getLorcanaSetName } from '../../data/games';
import { getTradeClassLabel } from '../../utils/tradeMatch';
import { PocketMap } from './PocketMap';

const PHASES = {
  out: {
    title: 'Sortir tes cartes',
    verb: 'Sors',
    confirm: 'Sortie',
    done: 'Sortie',
    icon: PackageOpen,
  },
  in: {
    title: 'Ranger les cartes reçues',
    verb: 'Range',
    confirm: 'Rangée',
    done: 'Rangée',
    icon: PackagePlus,
  },
};

const count = (steps, found) => ({
  done: steps.filter((s) => found.has(s.id)).reduce((n, s) => n + s.qty, 0),
  total: steps.reduce((n, s) => n + s.qty, 0),
});

/** One card to take out or put in, on its binder page. */
const StepCard = ({ step, checked }) => {
  const cardLang = useCardLang();
  const phase = PHASES[step.kind];
  return (
    <div className="grid sm:grid-cols-[auto_1fr] gap-5 items-start">
      <div className="flex justify-center order-2 sm:order-1">
        {step.binder ? (
          <PocketMap binder={step.binder} cardNumber={step.cardNumber} mode={step.kind} card={step.card} cell={64} />
        ) : (
          <p className="w-52 rounded-xl bg-amber-500/[0.06] ring-1 ring-inset ring-amber-400/20 p-3 text-xs text-amber-200 leading-relaxed">
            Pas de farde pour le chapitre {getLorcanaSetName(step.card.set) ?? step.card.set} : garde cette carte de côté.
          </p>
        )}
      </div>
      <div className="flex sm:flex-col gap-4 items-start order-1 sm:order-2 min-w-0">
        <CardThumb card={step.card} foil={step.foil} size="large" className="w-24 sm:w-36 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-slate-500">{phase.verb}</div>
          <div className="text-lg font-semibold text-white leading-snug">
            <span
              className={`inline-flex items-center justify-center min-w-[2rem] px-1.5 mr-1.5 rounded-lg text-base tabular-nums ${
                step.qty > 1 ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white'
              }`}
            >
              {step.qty}×
            </span>
            {cardLang.fullName(step.card)}
            {step.foil && <span className="foil-text font-semibold text-sm"> foil</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {getTradeClassLabel(step.card.rarity ?? '?').label} · n° {step.card.number}
          </div>
          {step.qty > 1 && (
            <p className="text-xs text-amber-200 mt-2">
              {step.kind === 'out' ? `${step.qty} exemplaires à sortir de cette pochette` : `${step.qty} exemplaires à glisser dans cette pochette`}
            </p>
          )}
          {checked && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-300 mt-2">
              <Check size={14} /> {phase.done}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Guided pass through a validated trade: the cards to take out, binder by binder and pocket by
 * pocket in page order, then the received ones to put in. Each step shows the pocket on its page.
 * @param {{ id, kind: 'out'|'in', card, foil, qty, binder?, cardNumber? }[]} steps outs first, then ins
 * @param {Set<string>} found ids of the steps done
 */
const WizardBody = ({ steps, found, onCheck, onComplete, onClose, owner }) => {
  const outs = steps.filter((s) => s.kind === 'out');
  const ins = steps.filter((s) => s.kind === 'in');
  // Positions: the outs, a pause between both phases, the ins, the end
  const pages = [...outs, ...(outs.length && ins.length ? [{ kind: 'pause' }] : []), ...ins, { kind: 'end' }];
  const [at, setAt] = useState(() => {
    const next = pages.findIndex((p) => p.id && !found.has(p.id));
    return next === -1 ? pages.length - 1 : next;
  });
  const page = pages[at];
  const go = (i) => setAt(Math.max(0, Math.min(pages.length - 1, i)));
  const confirm = () => {
    if (page.id) onCheck(page.id, true);
    go(at + 1);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea')) return;
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === 'Enter' && page.id) {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const outCount = count(outs, found);
  const inCount = count(ins, found);
  const checked = page.id && found.has(page.id);
  const phaseOf = page.kind === 'out' || page.kind === 'in' ? page.kind : null;
  const position = phaseOf ? (phaseOf === 'out' ? outs : ins).indexOf(page) + 1 : null;

  return (
    <div className="px-6 pb-6 pt-2 space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'out', list: outs, n: outCount, label: '1. Sortir' },
          { key: 'in', list: ins, n: inCount, label: '2. Ranger' },
        ].map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={p.list.length === 0}
            onClick={() => go(pages.indexOf(p.list.find((s) => !found.has(s.id)) ?? p.list[0]))}
            className={`text-left rounded-xl px-3 py-2 ring-1 ring-inset transition-colors disabled:opacity-40 ${
              phaseOf === p.key ? 'bg-indigo-500/10 ring-indigo-400/50' : 'bg-white/[0.02] ring-white/5 hover:ring-white/15'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-white">{p.label}</span>
              <span className="tabular-nums text-slate-400">
                <b className={p.n.done === p.n.total ? 'text-emerald-300' : 'text-white'}>{p.n.done}</b>/{p.n.total}
              </span>
            </div>
            <ProgressBar value={p.n.total ? p.n.done / p.n.total : 0} className="h-1 mt-1.5" />
          </button>
        ))}
      </div>

      {phaseOf ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">{PHASES[phaseOf].title}</h3>
            <span className="text-xs text-slate-500 tabular-nums">
              {position}/{(phaseOf === 'out' ? outs : ins).length}
            </span>
          </div>
          <StepCard step={page} checked={checked} />
        </>
      ) : page.kind === 'pause' ? (
        <div className="py-8 text-center space-y-2">
          <PackageCheck size={28} className="mx-auto text-emerald-300" />
          <p className="text-sm text-white font-semibold">
            {outCount.done === outCount.total
              ? `Sorties terminées : ${outCount.total} cartes pour ${owner}`
              : `Fin des sorties : ${outCount.done}/${outCount.total} cartes sorties pour ${owner}`}
          </p>
          <p className="text-xs text-slate-400">Fais l’échange, puis range les {inCount.total} cartes reçues.</p>
        </div>
      ) : (
        <div className="py-8 text-center space-y-2">
          <PackageCheck size={28} className="mx-auto text-emerald-300" />
          <p className="text-sm text-white font-semibold">
            {outCount.done === outCount.total && inCount.done === inCount.total ? 'Tout est fait !' : 'Fin du parcours'}
          </p>
          <p className="text-xs text-slate-400">
            {outCount.done}/{outCount.total} sorties · {inCount.done}/{inCount.total} rangées. Mets à jour tes fardes pour
            enregistrer l’échange.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button onClick={() => go(at - 1)} disabled={at === 0} className="btn-secondary px-3 py-2" aria-label="Précédente">
          <ArrowLeft size={15} />
        </button>
        {page.id && checked && (
          <button onClick={() => onCheck(page.id, false)} className="btn-secondary px-3 py-2 text-xs">
            <Undo2 size={14} /> Pas encore
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          {page.id ? (
            <>
              <button onClick={() => go(at + 1)} className="btn-secondary px-3 py-2">
                Passer <ArrowRight size={15} />
              </button>
              <button onClick={confirm} className="btn-primary px-4 py-2">
                <Check size={15} />
                {checked ? 'Suivante' : `${PHASES[page.kind].confirm}${page.qty > 1 ? `s (${page.qty})` : ''}`}
              </button>
            </>
          ) : page.kind === 'pause' ? (
            <button onClick={() => go(at + 1)} className="btn-primary px-4 py-2">
              Ranger les cartes reçues <ArrowRight size={15} />
            </button>
          ) : (
            <>
              <button onClick={onClose} className="btn-secondary px-3 py-2">
                Fermer
              </button>
              <button onClick={onComplete} className="btn-primary px-4 py-2">
                <PackageCheck size={15} />
                Mettre à jour mes fardes
              </button>
            </>
          )}
        </div>
      </div>
      <p className="hidden sm:block text-[11px] text-slate-600 text-center">Entrée : valider · ← → : précédente, suivante</p>
    </div>
  );
};

/** The guided pass through a validated trade (see WizardBody), mounted while open. */
const TradeWizard = ({ isOpen, onClose, owner, ...props }) => (
  <Modal isOpen={isOpen} onClose={onClose} title={`Échange avec ${owner} · mode guidé`} size="lg">
    <WizardBody onClose={onClose} owner={owner} {...props} />
  </Modal>
);

export default TradeWizard;
