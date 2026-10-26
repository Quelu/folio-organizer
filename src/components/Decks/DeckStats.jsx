import { motion } from 'motion/react';
import { AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getInk, CARD_TYPES } from '../../utils/catalog';
import { MIN_DECK_SIZE } from '../../utils/deckRules';

/** Cost curve: one bar per cost, 7+ grouped, the uninkable copies on top. */
const CostCurve = ({ curve, uninkable }) => {
  const max = Math.max(1, ...curve);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="label">Courbe de coût</span>
        {uninkable.some(Boolean) && (
          <span className="flex items-center gap-2.5 text-[10px] text-slate-500 mb-1.5">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-violet-400/80" />
              encrables
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-slate-500/70" />
              non encrables
            </span>
          </span>
        )}
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {curve.map((count, cost) => (
          <div key={cost} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <span className="text-[10px] tabular-nums text-slate-400">{count || ''}</span>
            <motion.div
              className="w-full rounded-t-md overflow-hidden flex flex-col gap-0.5"
              initial={false}
              animate={{ height: `${(count / max) * 100}%` }}
              transition={{ type: 'spring', stiffness: 160, damping: 22 }}
              style={{ minHeight: count ? 3 : 0 }}
              title={uninkable[cost] ? `${uninkable[cost]} non encrable${uninkable[cost] > 1 ? 's' : ''} sur ${count}` : undefined}
            >
              {uninkable[cost] > 0 && <div className="bg-slate-500/70" style={{ flexGrow: uninkable[cost] }} />}
              {count > uninkable[cost] && (
                <div className="bg-gradient-to-t from-indigo-500/60 to-violet-400/80" style={{ flexGrow: count - uninkable[cost] }} />
              )}
            </motion.div>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{cost === 7 ? '7+' : cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Size, inks, types, inkable share, warnings and rule errors of a deck. */
const DeckStats = ({ analysis }) => {
  const { total, inks, curve, uninkableCurve, types, inkable, averageCost, errors, warnings } = analysis;
  const inkableShare = total ? inkable / total : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Cartes</div>
          <div className={`text-sm font-bold tabular-nums ${total >= MIN_DECK_SIZE ? 'text-white' : 'text-amber-300'}`}>
            {total}/{MIN_DECK_SIZE}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Encrables</div>
          <div className={`text-sm font-bold tabular-nums ${inkableShare >= 0.6 || !total ? 'text-white' : 'text-amber-300'}`}>
            {inkable} <span className="text-slate-500 font-medium">({Math.round(inkableShare * 100)} %)</span>
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Coût moyen</div>
          <div className="text-sm font-bold text-white tabular-nums">{averageCost.toFixed(2)}</div>
        </div>
      </div>

      <CostCurve curve={curve} uninkable={uninkableCurve} />

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <div>
          <span className="label">Encres</span>
          <div className="flex gap-2">
            {inks.length === 0 && <span className="text-xs text-slate-500">—</span>}
            {inks.map((ink) => (
              <span key={ink} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: getInk(ink).color }} />
                {getInk(ink).label}
              </span>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Types</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {CARD_TYPES.filter((t) => types[t.key]).map((t) => (
              <span key={t.key} className="text-xs text-slate-300">
                <b className="text-white tabular-nums">{types[t.key]}</b> {t.label.toLowerCase()}
                {types[t.key] > 1 ? 's' : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        {errors.map((e, i) => (
          <p key={`e${i}`} className="flex gap-2 text-xs text-rose-300 leading-relaxed">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            {e.message}
          </p>
        ))}
        {warnings.map((w, i) => (
          <p key={`w${i}`} className="flex gap-2 text-xs text-amber-300/90 leading-relaxed">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            {w.message}
          </p>
        ))}
        {errors.length === 0 && (
          <p className="flex gap-2 text-xs text-emerald-300 leading-relaxed">
            <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
            Deck valide.
          </p>
        )}
      </div>
    </div>
  );
};

export default DeckStats;
