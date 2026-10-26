import { useMemo } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Hexagon } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { MoreButton, Segmented } from './CollectionParts';
import { useChunks } from '../../hooks/useChunks';
import { useCardLang } from '../../hooks/useCardLang';
import { useDeckColor } from '../../hooks/useDeckColor';
import { CARD_TYPES, getInk, getMainType } from '../../utils/catalog';
import { LORCANA_RARITIES, getLorcanaSetName } from '../../data/games';
import { SORTS, GROUPS, groupItems } from '../../utils/collectionFilters';

const MODES = [
  { value: 'owned', label: 'Possédées' },
  { value: 'missing', label: 'Manquantes' },
  { value: 'all', label: 'Toutes' },
];

const SIZES = {
  s: 'grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2',
  m: 'grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-3',
  l: 'grid-cols-[repeat(auto-fill,minmax(172px,1fr))] gap-4',
};

const rarityLabel = (key) => LORCANA_RARITIES.find((r) => r.key === key)?.label ?? key ?? '?';

const groupLabel = (groupKey, key) => {
  switch (groupKey) {
    case 'set':
      return `${key} · ${getLorcanaSetName(key) ?? `Set ${key}`}`;
    case 'ink':
      return key === 'dual' ? 'Bicolores' : getInk(key).label;
    case 'cost':
      return `Coût ${key}`;
    case 'rarity':
      return rarityLabel(key);
    case 'type':
      return CARD_TYPES.find((t) => t.key === key)?.label ?? key;
    default:
      return null;
  }
};

/** Small colored dots for the decks playing a card. */
const DeckDots = ({ uses, deckColor }) =>
  uses.length > 0 && (
    <span className="flex items-center -space-x-0.5" title={uses.map((u) => `${u.deck.name} ×${u.qty}`).join('\n')}>
      {uses.slice(0, 4).map((u) => (
        <span key={u.deck.id} className="w-2 h-2 rounded-full ring-1 ring-slate-950" style={{ background: deckColor(u.deck.id) }} />
      ))}
    </span>
  );

const Tile = ({ item, uses, deckColor }) => (
  <div className="min-w-0">
    <CardThumb card={item.card} dimmed={item.total === 0} foil={item.foil > 0} />
    <div className="mt-1 flex items-center justify-between gap-1 text-[11px] leading-none">
      <span className="text-slate-500 tabular-nums truncate">{item.card.id}</span>
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <DeckDots uses={uses} deckColor={deckColor} />
        {item.foil > 0 && <span className="foil-text font-semibold tabular-nums">✦{item.foil}</span>}
        {item.total > 0 ? (
          <span className="font-semibold text-white tabular-nums">×{item.total}</span>
        ) : (
          item.keyTotal > 0 && (
            <span className="text-slate-500" title={`${item.keyTotal} dans une autre édition`}>
              ↺{item.keyTotal}
            </span>
          )
        )}
      </span>
    </div>
  </div>
);

const Row = ({ item, uses, deckColor, format }) => {
  const cardLang = useCardLang();
  const { card } = item;
  const type = CARD_TYPES.find((t) => t.key === getMainType(card))?.label;
  return (
    <li className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
      <CardThumb card={card} dimmed={item.total === 0} foil={item.foil > 0} className="w-10 flex-shrink-0" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className={`text-sm truncate ${item.total ? 'text-slate-100' : 'text-slate-400'}`}>{cardLang.fullName(card)}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0">
          {card.inks.map((ink) => (
            <span key={ink} className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: getInk(ink).color }} />
          ))}
          <span className="flex items-center gap-0.5 flex-shrink-0 tabular-nums">
            <Hexagon size={10} className={card.inkwell ? 'fill-sky-300/40 text-sky-300' : 'text-slate-500'} />
            {card.cost}
          </span>
          <span className="truncate">
            · {type} · {rarityLabel(card.rarity)} · <span className="tabular-nums">{card.id}</span>
          </span>
        </div>
      </div>
      <div className="hidden 2xl:block w-44 text-[11px] text-slate-500 truncate">
        {getLorcanaSetName(card.set) ?? `Set ${card.set}`} · n° {card.number}
      </div>
      <div className="hidden xl:block w-40 text-[11px] text-slate-500 truncate" title={item.copies.map((c) => c.binder.name).join(', ')}>
        {item.copies.map((c) => `${c.binder.name} p.${c.location.page}`).join(' · ')}
      </div>
      <div className="hidden sm:flex w-12 justify-end">
        <DeckDots uses={uses} deckColor={deckColor} />
      </div>
      <div className="w-14 text-right text-xs tabular-nums">
        {item.total > 0 ? (
          <>
            <b className="text-white">×{item.total}</b>
            {item.foil > 0 && <div className="foil-text text-[10px] font-semibold">{item.foil} foil</div>}
          </>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </div>
      <div className={`w-16 text-right text-xs tabular-nums ${item.price == null ? 'text-slate-600' : 'text-slate-300'}`}>
        {format(item.price)}
      </div>
    </li>
  );
};

/** Sorted, grouped results, rendered chunk by chunk across the groups. */
const Results = ({ items, group, layout, size, usage, format }) => {
  const deckColor = useDeckColor();
  const chunks = useChunks(items.length, 90);
  const sections = useMemo(() => groupItems(items, group), [items, group]);

  let budget = chunks.limit;
  const shown = [];
  for (const section of sections) {
    if (budget <= 0) break;
    shown.push({ ...section, visible: section.items.slice(0, budget) });
    budget -= section.items.length;
  }

  const usesOf = (item) => usage.get(item.key) ?? [];
  return (
    <div data-preview-group>
      {shown.map((section) => (
        <section key={section.key} className="mb-6 last:mb-0">
          {group !== 'none' && (
            <h3 className="sticky top-0 z-20 -mx-1 px-1 py-2 mb-1 flex items-baseline gap-2 text-sm font-semibold text-white bg-[#0b0d14]/90 backdrop-blur">
              {group === 'ink' && section.key !== 'dual' && (
                <span className="w-2.5 h-2.5 rounded-full self-center" style={{ background: getInk(section.key).color }} />
              )}
              {groupLabel(group, section.key)}
              <span className="text-xs font-normal text-slate-500 tabular-nums">{section.items.length}</span>
            </h3>
          )}
          {layout === 'grid' ? (
            <div className={`grid ${SIZES[size] ?? SIZES.m}`}>
              {section.visible.map((item) => (
                <Tile key={item.card.id} item={item} uses={usesOf(item)} deckColor={deckColor} />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {section.visible.map((item) => (
                <Row key={item.card.id} item={item} uses={usesOf(item)} deckColor={deckColor} format={format} />
              ))}
            </ul>
          )}
        </section>
      ))}
      <MoreButton {...chunks} />
    </div>
  );
};

/**
 * Every card of the collection, or the cards still missing from the chapters, with sorting,
 * grouping and a grid or list layout.
 * @param {{ items: object[], copies: number, foils: number, value: number }} results filtered and sorted
 */
const CardsExplorer = ({ explorer, onExplorer, results, resetKey, scopeHint, usage, prices }) => {
  const { items } = results;
  const sort = SORTS.find((s) => s.key === explorer.sort) ?? SORTS[0];
  const DirIcon = Boolean(sort.desc) !== explorer.reverse ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  const wants = explorer.mode === 'missing' ? items.map((i) => `1 ${i.card.fullName}`).join('\n') : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={MODES} value={explorer.mode} onChange={(mode) => onExplorer({ mode })} label="Cartes affichées" />
        <div className="flex items-center gap-1 ml-auto">
          <label className="sr-only" htmlFor="explorer-sort">
            Trier par
          </label>
          <select
            id="explorer-sort"
            value={explorer.sort}
            onChange={(e) => onExplorer({ sort: e.target.value, reverse: false })}
            className="field py-1.5 pl-2.5 pr-7 w-auto text-xs"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Tri : {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => onExplorer({ reverse: !explorer.reverse })}
            className="btn-icon"
            title="Inverser l’ordre"
            aria-label="Inverser l’ordre"
          >
            <DirIcon size={16} />
          </button>
          <label className="sr-only" htmlFor="explorer-group">
            Grouper par
          </label>
          <select
            id="explorer-group"
            value={explorer.group}
            onChange={(e) => onExplorer({ group: e.target.value })}
            className="field py-1.5 pl-2.5 pr-7 w-auto text-xs"
          >
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.key === 'none' ? 'Sans groupes' : `Par ${g.label.toLowerCase()}`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          {explorer.layout === 'grid' && (
            <Segmented
              label="Taille des cartes"
              value={explorer.size}
              onChange={(size) => onExplorer({ size })}
              options={[
                { value: 's', label: 'S', title: 'Petites cartes' },
                { value: 'm', label: 'M', title: 'Cartes moyennes' },
                { value: 'l', label: 'L', title: 'Grandes cartes' },
              ]}
            />
          )}
          <Segmented
            label="Affichage"
            value={explorer.layout}
            onChange={(layout) => onExplorer({ layout })}
            options={[
              { value: 'grid', icon: LayoutGrid, title: 'Grille' },
              { value: 'list', icon: List, title: 'Liste' },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-400">
        <p>
          <b className="text-white tabular-nums">{items.length}</b> carte{items.length > 1 ? 's' : ''}
          {explorer.mode === 'missing' ? (
            <>
              {' '}
              manquante{items.length > 1 ? 's' : ''} · environ <b className="text-white">{prices.format(results.value)}</b> pour
              compléter
            </>
          ) : (
            <>
              {' '}
              · <b className="text-white tabular-nums">{results.copies}</b> exemplaire{results.copies > 1 ? 's' : ''}
              {results.foils > 0 && <span className="foil-text font-semibold"> · {results.foils} foil{results.foils > 1 ? 's' : ''}</span>}
              {' '}
              · <b className="text-white">{prices.format(results.value)}</b>
            </>
          )}
          {scopeHint && <span className="text-slate-500"> · {scopeHint}</span>}
        </p>
        {explorer.mode === 'missing' && items.length > 0 && (
          <CopyButton text={wants} label="Copier la liste" toast="Cartes manquantes copiées" className="btn-secondary px-3 py-1 text-xs" />
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-16">
          {explorer.mode === 'missing' ? 'Rien ne manque ici 🎉' : 'Aucune carte ne correspond à ces filtres.'}
        </p>
      ) : (
        <Results
          key={resetKey}
          items={items}
          group={explorer.group}
          layout={explorer.layout}
          size={explorer.size}
          usage={usage}
          format={prices.format}
        />
      )}
    </div>
  );
};

export default CardsExplorer;
