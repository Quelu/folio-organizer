import ProgressBar from '../ui/ProgressBar';
import { useChunks } from '../../hooks/useChunks';

export const Panel = ({ icon: Icon, title, hint, action, children }) => (
  <section data-preview-group className="rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          {Icon && <Icon size={15} className="text-indigo-300" />}
          {title}
        </h2>
        {hint && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** A completion bar; clicking it opens the explorer on the cards still missing there. */
export const CompletionRow = ({ label, dot, owned, total, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick || owned === total}
    title={onClick && owned < total ? 'Voir les cartes manquantes' : undefined}
    className="w-full flex items-center gap-3 rounded-md -mx-1.5 px-1.5 py-1 text-left enabled:hover:bg-white/[0.04] transition-colors disabled:cursor-default"
  >
    <span className="flex items-center gap-2 text-xs text-slate-300 w-32 flex-shrink-0 truncate">
      {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />}
      <span className="truncate">{label}</span>
    </span>
    <ProgressBar value={total ? owned / total : 0} className="flex-1 h-1.5" />
    <span className="text-xs text-slate-400 tabular-nums w-24 text-right">
      <b className="text-white">{owned}</b>/{total}
      <span className="text-slate-500"> · {total ? Math.floor((owned / total) * 100) : 0} %</span>
    </span>
  </button>
);

/** Button loading the next chunk, also by itself once it comes into view (see useChunks). */
export const MoreButton = ({ remaining, showMore, setSentinel }) =>
  remaining > 0 && (
    <button ref={setSentinel} onClick={showMore} className="btn-secondary w-full mt-4 py-2">
      Afficher plus ({remaining} restantes)
    </button>
  );

/** A card grid shown by chunks. */
export const CardGrid = ({ items, render, className = 'grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3' }) => {
  const chunks = useChunks(items.length);
  return (
    <>
      <div className={className}>{items.slice(0, chunks.limit).map(render)}</div>
      <MoreButton {...chunks} />
    </>
  );
};

export const Segmented = ({ options, value, onChange, label }) => (
  <div className="flex items-center rounded-lg ring-1 ring-inset ring-white/10 p-0.5 w-fit" role="group" aria-label={label}>
    {options.map((opt) => (
      <button
        key={String(opt.value)}
        onClick={() => onChange(opt.value)}
        aria-pressed={value === opt.value}
        title={opt.title}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap ${
          value === opt.value ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
        }`}
      >
        {opt.icon && <opt.icon size={14} />}
        {opt.label}
      </button>
    ))}
  </div>
);
