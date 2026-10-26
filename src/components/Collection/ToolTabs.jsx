import { useMemo, useState } from 'react';
import { Sparkles, Layers, Repeat, Swords } from 'lucide-react';
import ProgressBar from '../ui/ProgressBar';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { Panel, CompletionRow, CardGrid, Segmented } from './CollectionParts';
import { useStore } from '../../hooks/storeContext';
import { useCardLang } from '../../hooks/useCardLang';
import { useDeckColor } from '../../hooks/useDeckColor';
import { INKS, getMainPrinting } from '../../utils/catalog';
import { LORCANA_RARITIES, getLorcanaSetName } from '../../data/games';
import { getPocketPrintings, getPlaysetCards, matchesCard } from '../../utils/collectionFilters';
import { getDeckWantsLines } from '../../utils/cardmarketExport';

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

/** Copies beyond what is kept: one in the binder plus the decks' copies, or a playset that covers the decks. */
export const DoublesTab = ({ ctx }) => {
  const { prefs, setPref } = useStore();
  const cardLang = useCardLang();
  const { collection, usage, filters, query } = ctx;
  const keep = prefs.tradeKeep ?? 1;

  const doubles = useMemo(() => {
    // The chapters and binders filters keep a card when one of its copies is there
    const cardFilters = { ...filters, sets: [] };
    return [...collection.entries.values()]
      .filter(
        (e) =>
          matchesCard(e.card, cardFilters, query, ctx) &&
          (!filters.sets.length || e.copies.some((c) => filters.sets.includes(c.card.set))) &&
          (!filters.binders.length || e.copies.some((c) => filters.binders.includes(c.binder.id))) &&
          (!filters.foil || e.foil > 0)
      )
      .map((e) => {
        const used = (usage.get(e.key) ?? []).reduce((s, u) => s + u.qty, 0);
        const reserved = keep >= PLAYSET ? Math.max(keep, used) : keep + used;
        return { ...e, used, surplus: e.total - reserved };
      })
      .filter((e) => e.surplus > 0)
      .sort((a, b) => b.surplus - a.surplus || cardLang.fullName(a.card).localeCompare(cardLang.fullName(b.card)));
  }, [collection, usage, keep, filters, query, ctx, cardLang]);

  // Doubles go to other players: in the card language
  const doublesText = doubles.map((d) => `${d.surplus} ${cardLang.fullName(d.card)}`).join('\n');
  const copies = doubles.reduce((s, d) => s + d.surplus, 0);

  return (
    <Panel
      icon={Repeat}
      title="Doubles à échanger"
      hint={
        keep >= PLAYSET
          ? 'Au-delà d’un playset par carte (tes decks puisent dedans).'
          : 'Au-delà d’un exemplaire gardé en farde, plus les copies utilisées par tes decks.'
      }
      action={doubles.length > 0 && <CopyButton text={doublesText} label="Copier" toast="Doubles copiés" />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented
          label="Copies gardées"
          value={keep}
          onChange={(value) => setPref('tradeKeep', value)}
          options={[
            { value: 1, label: 'Collection · garder 1' },
            { value: PLAYSET, label: 'Playset · garder 4' },
          ]}
        />
        {doubles.length > 0 && (
          <span className="text-xs text-slate-400 tabular-nums">
            <b className="text-white">{copies}</b> copie{copies > 1 ? 's' : ''} · {doubles.length} carte{doubles.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {doubles.length === 0 ? (
        <Empty>Aucun double à échanger pour l’instant.</Empty>
      ) : (
        <ul className="divide-y divide-white/5">
          {doubles.map((d) => (
            <li key={d.key} className="flex items-center gap-3 py-2">
              <CardThumb card={d.card} className="w-10 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{cardLang.fullName(d.card)}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {d.copies.map((c) => `${c.binder.name} · p. ${c.location.page} (${c.normal + c.foil})`).join(' · ')}
                  {d.used > 0 && ` · ${d.used} en deck`}
                </div>
              </div>
              {d.foil > 0 && (
                <span className="foil-text text-[11px] font-semibold whitespace-nowrap">
                  {d.foil} foil{d.foil > 1 ? 's' : ''}
                </span>
              )}
              <span className="text-sm font-bold text-emerald-300 tabular-nums whitespace-nowrap">×{d.surplus}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

/**
 * What the user's decks need from the collection, card by card: copies owned against the copies
 * the decks play, all decks built at once or one at a time.
 */
export const DecksTab = ({ ctx, prices, onOpenDeck }) => {
  const cardLang = useCardLang();
  const deckColor = useDeckColor();
  const { index, collection, usage, filters, query, decks } = ctx;
  const [together, setTogether] = useState(true);
  const [missingOnly, setMissingOnly] = useState(false);

  const rows = useMemo(() => {
    const chosen = filters.decks.length ? new Set(filters.decks) : null;
    const cardFilters = { ...filters, decks: [] };
    const list = [];
    for (const [key, allUses] of usage) {
      const uses = chosen ? allUses.filter((u) => chosen.has(u.deck.id)) : allUses;
      if (uses.length === 0) continue;
      const card = getMainPrinting(index, key);
      if (card && !matchesCard(card, cardFilters, query, ctx)) continue;
      if (!card && (query || Object.values(cardFilters).some((v) => (Array.isArray(v) ? v.length : v)))) continue;
      const needed = together ? uses.reduce((s, u) => s + u.qty, 0) : Math.max(...uses.map((u) => u.qty));
      const owned = collection.entries.get(key)?.total ?? 0;
      const name = uses[0].deck.cards.find((c) => c.key === key)?.name ?? key;
      list.push({ key, card, name, uses, needed, owned, missing: Math.max(0, needed - owned) });
    }
    return list.sort(
      (a, b) => b.missing - a.missing || cardLang.keyName(a.key, a.name).localeCompare(cardLang.keyName(b.key, b.name))
    );
  }, [index, collection, usage, filters, query, ctx, together, cardLang]);

  if (decks.length === 0) return <Empty>Crée un deck pour voir ici les cartes qu’il prend dans ta collection.</Empty>;

  const short = rows.filter((r) => r.missing > 0);
  const shown = missingOnly ? short : rows;
  const copies = short.reduce((s, r) => s + r.missing, 0);
  const cost = short.reduce((s, r) => s + (prices.getPrice(r.card) ?? 0) * r.missing, 0);
  const wants = getDeckWantsLines(
    short.map((r) => ({ key: r.key, qty: r.missing })),
    index,
    getMainPrinting,
    false
  ).join('\n');

  return (
    <Panel
      icon={Swords}
      title="Besoins des decks"
      hint="Les cartes que jouent tes decks, face aux copies de ta collection (toutes éditions confondues)."
      action={short.length > 0 && <CopyButton text={wants} label="Copier les manques" toast="Liste Cardmarket copiée" />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Construction des decks"
            value={together}
            onChange={setTogether}
            options={[
              { value: true, label: 'Tous montés', title: 'Les decks montés en même temps se partagent les copies' },
              { value: false, label: 'Un à la fois', title: 'Un seul deck monté à la fois' },
            ]}
          />
          <Segmented
            label="Cartes affichées"
            value={missingOnly}
            onChange={setMissingOnly}
            options={[
              { value: false, label: 'Toutes' },
              { value: true, label: 'À compléter' },
            ]}
          />
        </div>
        <span className="text-xs text-slate-400">
          {short.length === 0 ? (
            <span className="text-emerald-300">Rien ne manque 🎉</span>
          ) : (
            <>
              <b className="text-white tabular-nums">{copies}</b> copie{copies > 1 ? 's' : ''} à trouver · environ{' '}
              <b className="text-white">{prices.format(cost)}</b>
            </>
          )}
        </span>
      </div>
      {shown.length === 0 ? (
        <Empty>Aucune carte ne correspond à ces filtres.</Empty>
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-2">
              {r.card ? <CardThumb card={r.card} className="w-10 flex-shrink-0" dimmed={r.owned === 0} /> : <div className="w-10" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{cardLang.keyName(r.key, r.name)}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {r.uses.map((u) => (
                    <button
                      key={u.deck.id}
                      onClick={() => onOpenDeck(u.deck.id)}
                      className="inline-flex items-center gap-1.5 px-1.5 py-px rounded text-[10px] text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 hover:text-white"
                      title="Ouvrir le deck"
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: deckColor(u.deck.id) }} />
                      {u.deck.name} ×{u.qty}
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                <b className="text-white">{r.owned}</b>/{r.needed}
              </span>
              <span
                className={`w-10 text-right text-sm font-bold tabular-nums ${r.missing ? 'text-amber-300' : 'text-emerald-400'}`}
              >
                {r.missing ? `+${r.missing}` : '✓'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
