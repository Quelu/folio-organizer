import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { INKS, CARD_TYPES, getInk } from '../../utils/catalog';
import { LORCANA_RARITIES, getLorcanaSetName } from '../../data/games';
import { COPY_BUCKETS, EMPTY_FILTERS, countFilters } from '../../utils/collectionFilters';
import { useDeckColor } from '../../hooks/useDeckColor';

const COSTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9+'];
const RARITIES = LORCANA_RARITIES.map((r) => ({ value: r.key, label: r.label }));
const TYPES = CARD_TYPES.map((t) => ({ value: t.key, label: t.label }));

const toggle = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

const Chip = ({ active, onClick, title, children, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    title={title}
    className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md text-xs ring-1 ring-inset transition-colors ${
      active ? 'bg-indigo-500/15 ring-indigo-400/60 text-white' : 'ring-white/10 text-slate-400 hover:text-white hover:bg-white/5'
    } ${className}`}
  >
    {children}
  </button>
);

const CheckRow = ({ checked, onChange, children, count }) => (
  <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs text-slate-300 hover:bg-white/[0.04] cursor-pointer">
    <input type="checkbox" checked={checked} onChange={onChange} className="w-3.5 h-3.5 accent-indigo-500 flex-shrink-0" />
    <span className="flex-1 min-w-0 flex items-center gap-2 truncate">{children}</span>
    {count != null && <span className="text-[11px] tabular-nums text-slate-500 flex-shrink-0">{count}</span>}
  </label>
);

const Section = ({ title, active, onClear, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen || active > 0);
  return (
    <section className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
          {title}
          {active > 0 && (
            <span className="ml-1 px-1.5 rounded-full bg-indigo-500/20 text-indigo-200 text-[10px] tabular-nums normal-case tracking-normal">
              {active}
            </span>
          )}
        </button>
        {active > 0 && (
          <button type="button" onClick={onClear} className="text-[11px] text-slate-500 hover:text-white">
            Effacer
          </button>
        )}
      </div>
      {open && <div className="mt-2.5">{children}</div>}
    </section>
  );
};

/**
 * Filters of the collection explorer. Only the filters the current tab uses are shown.
 * @param {{ [setCode]: { owned: number, total: number } }} setCounts pockets owned per chapter
 */
const FilterPanel = ({ filters, onChange, applicable, sets, setCounts, collectedSets, decks, binders }) => {
  const deckColor = useDeckColor();
  const set = (name, value) => onChange({ ...filters, [name]: value });
  const shown = (name) => applicable.includes(name);
  const multi = (name) => ({
    active: filters[name].length,
    onClear: () => set(name, []),
  });

  return (
    <div className="px-4">
      {shown('sets') && (
        <Section title="Chapitres" {...multi('sets')}>
          <div className="-mx-2">
            {sets.map((code) => (
              <CheckRow
                key={code}
                checked={filters.sets.includes(code)}
                onChange={() => set('sets', toggle(filters.sets, code))}
                count={setCounts[code] ? `${setCounts[code].owned}/${setCounts[code].total}` : null}
              >
                <span className="w-5 text-right tabular-nums text-slate-500 flex-shrink-0">{code}</span>
                <span className={`truncate ${collectedSets.includes(code) ? '' : 'text-slate-500'}`}>
                  {getLorcanaSetName(code) ?? `Set ${code}`}
                </span>
              </CheckRow>
            ))}
          </div>
        </Section>
      )}

      {shown('inks') && (
        <Section title="Encre" {...multi('inks')}>
          <div className="grid grid-cols-2 gap-1.5">
            {INKS.map((ink) => (
              <Chip
                key={ink.key}
                active={filters.inks.includes(ink.key)}
                onClick={() => set('inks', toggle(filters.inks, ink.key))}
                className="justify-start"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: ink.color }} />
                {ink.label}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {shown('costs') && (
        <Section title="Coût" {...multi('costs')}>
          <div className="grid grid-cols-5 gap-1.5">
            {COSTS.map((cost) => (
              <Chip
                key={cost}
                active={filters.costs.includes(cost)}
                onClick={() => set('costs', toggle(filters.costs, cost))}
                className="tabular-nums font-semibold px-0"
              >
                {cost}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {shown('rarities') && (
        <Section title="Rareté" {...multi('rarities')}>
          <div className="flex flex-wrap gap-1.5">
            {RARITIES.map((r) => (
              <Chip key={r.value} active={filters.rarities.includes(r.value)} onClick={() => set('rarities', toggle(filters.rarities, r.value))}>
                {r.label}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {shown('types') && (
        <Section title="Type" {...multi('types')}>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => (
              <Chip key={t.value} active={filters.types.includes(t.value)} onClick={() => set('types', toggle(filters.types, t.value))}>
                {t.label}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {shown('inkwell') && (
        <Section title="Encrier" active={filters.inkwell === null ? 0 : 1} onClear={() => set('inkwell', null)}>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { value: null, label: 'Toutes' },
              { value: true, label: 'Encrables' },
              { value: false, label: 'Non' },
            ].map((opt) => (
              <Chip key={String(opt.value)} active={filters.inkwell === opt.value} onClick={() => set('inkwell', opt.value)}>
                {opt.label}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {(shown('copies') || shown('foil') || shown('core')) && (
        <Section
          title="Exemplaires et format"
          active={(shown('copies') ? filters.copies.length : 0) + (shown('foil') && filters.foil ? 1 : 0) + (shown('core') && filters.core ? 1 : 0)}
          onClear={() => onChange({ ...filters, copies: [], foil: false, core: false })}
        >
          {shown('copies') && (
            <>
              <p className="text-[11px] text-slate-500 mb-1.5">Copies possédées, toutes éditions confondues</p>
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {COPY_BUCKETS.map((b) => (
                  <Chip key={b} active={filters.copies.includes(b)} onClick={() => set('copies', toggle(filters.copies, b))} className="tabular-nums px-0">
                    {b}
                  </Chip>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            {shown('foil') && (
              <Chip active={filters.foil} onClick={() => set('foil', !filters.foil)}>
                <span className={filters.foil ? 'foil-text font-semibold' : ''}>Avec foil</span>
              </Chip>
            )}
            {shown('core') && (
              <Chip active={filters.core} onClick={() => set('core', !filters.core)} title="Cartes jouables en format Core">
                Légales en Core
              </Chip>
            )}
          </div>
        </Section>
      )}

      {shown('decks') && decks.length > 0 && (
        <Section title="Utilisées dans" {...multi('decks')}>
          <div className="-mx-2">
            {decks.map((deck) => (
              <CheckRow key={deck.id} checked={filters.decks.includes(deck.id)} onChange={() => set('decks', toggle(filters.decks, deck.id))}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: deckColor(deck.id) }} />
                <span className="truncate">{deck.name}</span>
              </CheckRow>
            ))}
          </div>
        </Section>
      )}

      {shown('binders') && binders.length > 1 && (
        <Section title="Rangées dans" {...multi('binders')} defaultOpen={false}>
          <div className="-mx-2">
            {binders.map((binder) => (
              <CheckRow
                key={binder.id}
                checked={filters.binders.includes(binder.id)}
                onChange={() => set('binders', toggle(filters.binders, binder.id))}
              >
                <span className="truncate">{binder.name}</span>
              </CheckRow>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

/** One removable chip per active filter; those the current tab ignores are dimmed. */
export const ActiveFilters = ({ filters, onChange, applicable, decks, binders }) => {
  if (countFilters(filters) === 0) return null;
  const chips = [];
  const add = (name, value, label, dot) =>
    chips.push({
      id: `${name}:${value}`,
      label,
      dot,
      ignored: !applicable.includes(name),
      remove: () =>
        onChange({ ...filters, [name]: Array.isArray(filters[name]) ? filters[name].filter((v) => v !== value) : EMPTY_FILTERS[name] }),
    });

  for (const code of filters.sets) add('sets', code, `Ch. ${code}`);
  for (const key of filters.inks) add('inks', key, getInk(key).label, getInk(key).color);
  for (const cost of filters.costs) add('costs', cost, `Coût ${cost}`);
  for (const key of filters.rarities) add('rarities', key, RARITIES.find((r) => r.value === key)?.label ?? key);
  for (const key of filters.types) add('types', key, TYPES.find((t) => t.value === key)?.label ?? key);
  if (filters.inkwell !== null) add('inkwell', filters.inkwell, filters.inkwell ? 'Encrables' : 'Non encrables');
  for (const b of filters.copies) add('copies', b, `${b} ex.`);
  if (filters.foil) add('foil', true, 'Avec foil');
  if (filters.core) add('core', true, 'Core');
  for (const id of filters.decks) add('decks', id, decks.find((d) => d.id === id)?.name ?? 'Deck supprimé');
  for (const id of filters.binders) add('binders', id, binders.find((b) => b.id === id)?.name ?? 'Farde supprimée');

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.id}
          onClick={chip.remove}
          title={chip.ignored ? 'Ne s’applique pas à cet onglet · cliquer pour retirer' : 'Retirer ce filtre'}
          className={`group inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full text-[11px] ring-1 ring-inset transition-colors ${
            chip.ignored
              ? 'ring-white/5 text-slate-600 line-through decoration-slate-600/60'
              : 'bg-indigo-500/10 ring-indigo-400/30 text-indigo-100 hover:bg-indigo-500/20'
          }`}
        >
          {chip.dot && <span className="w-2 h-2 rounded-full" style={{ background: chip.dot }} />}
          {chip.label}
          <X size={11} className="opacity-60 group-hover:opacity-100" />
        </button>
      ))}
      <button onClick={() => onChange(EMPTY_FILTERS)} className="text-[11px] text-slate-500 hover:text-white px-1.5">
        Tout effacer
      </button>
    </div>
  );
};

export default FilterPanel;
