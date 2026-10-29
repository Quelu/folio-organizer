import { useMemo } from 'react';
import { Sparkles, Layers } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { Panel, CompletionRow, CardGrid } from './CollectionParts';
import { INKS } from '../../utils/catalog';
import { LORCANA_RARITIES, getLorcanaSetName } from '../../data/games';
import { getPocketPrintings, getPlaysetCards, matchesCard } from '../../utils/collectionFilters';

const PLAYSET = 4;

const Empty = ({ children }) => <p className="text-sm text-slate-400">{children}</p>;

/**
 * Different cards owned in the chapters, one pocket per number (art variants count once),
 * by chapter, rarity and ink. Each bar opens the explorer on the cards still missing there.
 */
export const CompletionTab = ({ ctx, onExploreMissing }) => {
  const { index, scopeSets, filters, query, owned } = ctx;

  const completion = useMemo(() => {
    const sets = new Map();
    const rarities = new Map();
    const inks = new Map();
    let has = 0;
    let count = 0;
    const bump = (map, key, isOwned) => {
      const row = map.get(key) ?? { owned: 0, total: 0 };
      row.total++;
      if (isOwned) row.owned++;
      map.set(key, row);
    };
    for (const set of scopeSets) {
      for (const card of getPocketPrintings(index, set)) {
        if (!matchesCard(card, filters, query, ctx)) continue;
        const isOwned = owned.has(card.id);
        count++;
        if (isOwned) has++;
        bump(sets, set, isOwned);
        bump(rarities, card.rarity, isOwned);
        for (const ink of card.inks) bump(inks, ink, isOwned);
      }
    }
    return { sets, rarities, inks, owned: has, count };
  }, [index, scopeSets, filters, query, owned, ctx]);

  if (completion.count === 0) return <Empty>Aucune carte ne correspond à ces filtres.</Empty>;

  const rarityRows = [
    ...LORCANA_RARITIES.filter((r) => completion.rarities.has(r.key)),
    ...[...completion.rarities.keys()]
      .filter((key) => !LORCANA_RARITIES.some((r) => r.key === key))
      .map((key) => ({ key, label: key ?? 'Inconnue' })),
  ];

  return (
    <Panel
      icon={Sparkles}
      title="Complétion"
      hint="Cartes différentes possédées, une poche par numéro (les variantes d'illustration comptent une fois). Clique une ligne pour voir ce qui manque."
      action={
        <span className="text-sm text-slate-400 tabular-nums whitespace-nowrap">
          <b className="text-white">{completion.owned}</b>/{completion.count}
        </span>
      }
    >
      <div className="flex items-center gap-3 mb-6">
        <ProgressBar value={completion.owned / completion.count} className="flex-1 h-2" />
        <span className="text-xs text-white font-bold tabular-nums">{Math.floor((completion.owned / completion.count) * 100)} %</span>
      </div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-6">
        {completion.sets.size > 1 && (
          <div className="space-y-1 md:col-span-2">
            <span className="label">Par chapitre</span>
            {[...completion.sets.entries()].map(([set, row]) => (
              <CompletionRow
                key={set}
                label={`${set} · ${getLorcanaSetName(set) ?? `Set ${set}`}`}
                {...row}
                onClick={() => onExploreMissing({ sets: [set] })}
              />
            ))}
          </div>
        )}
        <div className="space-y-1">
          <span className="label">Par rareté</span>
          {rarityRows.map((r) => (
            <CompletionRow
              key={r.key ?? 'unknown'}
              label={r.label}
              {...completion.rarities.get(r.key)}
              onClick={r.key ? () => onExploreMissing({ rarities: [r.key] }) : undefined}
            />
          ))}
        </div>
        <div className="space-y-1">
          <span className="label">Par encre</span>
          {INKS.filter((ink) => completion.inks.has(ink.key)).map((ink) => (
            <CompletionRow
              key={ink.key}
              label={ink.label}
              dot={ink.color}
              {...completion.inks.get(ink.key)}
              onClick={() => onExploreMissing({ inks: [ink.key] })}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
};

/** 4 copies of each regular card of the chapters, counted by full name across binders and reprints. */
export const PlaysetsTab = ({ ctx }) => {
  const { index, scopeSets, filters, query, collection } = ctx;

  const playsets = useMemo(() => {
    let have = 0;
    let complete = 0;
    let total = 0;
    const incomplete = [];
    for (const [key, card] of getPlaysetCards(index, scopeSets)) {
      if (!matchesCard(card, filters, query, ctx)) continue;
      total++;
      const owned = collection.entries.get(key)?.total ?? 0;
      have += Math.min(owned, PLAYSET);
      if (owned >= PLAYSET) complete++;
      else incomplete.push({ key, card, owned, missing: PLAYSET - owned });
    }
    incomplete.sort((a, b) => b.missing - a.missing || a.card.id.localeCompare(b.card.id, undefined, { numeric: true }));
    return { total, have, complete, incomplete, progress: total ? have / (total * PLAYSET) : 0 };
  }, [index, scopeSets, filters, query, collection, ctx]);

  if (playsets.total === 0) return <Empty>Aucune carte ne correspond à ces filtres.</Empty>;

  // Missing copies stay in English for Cardmarket
  const playsetText = playsets.incomplete.map((p) => `${p.missing} ${p.card.fullName}`).join('\n');

  return (
    <Panel
      icon={Layers}
      title="Playsets"
      hint={`4 exemplaires de chaque carte (hors Épiques, Enchantées et Iconiques), toutes fardes et rééditions confondues. ${playsets.complete}/${playsets.total} complets.`}
      action={
        playsets.incomplete.length > 0 && <CopyButton text={playsetText} label="Copier les manques" toast="Copies manquantes copiées" />
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <ProgressBar value={playsets.progress} className="flex-1 h-2" />
        <span className="text-xs text-slate-400 tabular-nums">
          <b className="text-white">{Math.floor(playsets.progress * 100)} %</b> · {playsets.have}/{playsets.total * PLAYSET} copies
        </span>
      </div>
      {playsets.incomplete.length === 0 ? (
        <Empty>Tous les playsets sont complets 🎉</Empty>
      ) : (
        <CardGrid
          items={playsets.incomplete}
          render={(p) => (
            <div key={p.key} className="min-w-0">
              <CardThumb card={p.card} dimmed={p.owned === 0} />
              <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
                <span className="text-slate-500 tabular-nums">{p.card.id}</span>
                <span className="font-semibold text-amber-300 tabular-nums" title={`${p.owned} possédée(s)`}>
                  {p.owned}/4 · +{p.missing}
                </span>
              </div>
            </div>
          )}
        />
      )}
    </Panel>
  );
};
