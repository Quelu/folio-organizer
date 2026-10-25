import { useMemo, useState } from 'react';
import { Menu as MenuIcon, Loader2, RotateCcw, Sparkles, Layers, Repeat } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { getDeckUsage } from '../../utils/collection';
import { INKS, SPECIAL_RARITIES, baseNumber } from '../../utils/catalog';
import { LORCANA_RARITIES, getLorcanaSetName } from '../../data/games';
import ProgressBar from '../ui/ProgressBar';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import { useCardLang } from '../../hooks/useCardLang';

const ALL = 'all';
const PLAYSET = 4;
const LIST_STEP = 48;

const Section = ({ icon: Icon, title, hint, action, children }) => (
  <section data-preview-group className="rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={15} className="text-indigo-300" />
          {title}
        </h2>
        {hint && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const CompletionRow = ({ label, dot, owned, total }) => (
  <div className="flex items-center gap-3">
    <span className="flex items-center gap-2 text-xs text-slate-300 w-28 flex-shrink-0 truncate">
      {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />}
      {label}
    </span>
    <ProgressBar value={total ? owned / total : 0} className="flex-1 h-1.5" />
    <span className="text-xs text-slate-400 tabular-nums w-20 text-right">
      <b className="text-white">{owned}</b>/{total}
      <span className="text-slate-500"> · {total ? Math.floor((owned / total) * 100) : 0} %</span>
    </span>
  </div>
);

/** Shows a long card grid by chunks. */
const CardGrid = ({ items, render }) => {
  const [limit, setLimit] = useState(LIST_STEP);
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">{items.slice(0, limit).map(render)}</div>
      {items.length > limit && (
        <button onClick={() => setLimit((l) => l + LIST_STEP * 2)} className="btn-secondary w-full mt-3 py-2">
          Afficher plus ({items.length - limit} restantes)
        </button>
      )}
    </>
  );
};

/** Printings of a chapter grouped by pocket: art variants 4a–4e share pocket 4. */
const getPocketGroups = (index, setCode) => {
  const groups = new Map();
  for (const card of index.bySet.get(setCode) ?? []) {
    const n = baseNumber(card.number);
    if (!groups.has(n)) groups.set(n, card);
  }
  return [...groups.entries()].map(([number, card]) => ({ number, card }));
};

const CollectionStatsView = ({ onOpenSidebar }) => {
  const { binders, decks, prefs, setPref } = useStore();
  const { index, status, loaded, total, refresh } = useCatalog();
  const collection = useCollection();
  const cardLang = useCardLang();

  const chapters = useMemo(
    () =>
      [...new Set(binders.filter((b) => b.gameType === 'lorcana' && b.setCode).map((b) => b.setCode))].sort(
        (a, b) => Number(a) - Number(b)
      ),
    [binders]
  );
  const [chapter, setChapter] = useState(null);
  const selected = chapter && (chapter === ALL || chapters.includes(chapter)) ? chapter : (chapters[0] ?? null);
  const selectedSets = useMemo(() => (selected === ALL ? chapters : selected ? [selected] : []), [selected, chapters]);

  // Filled pockets per chapter, all binders of that chapter together
  const filledPockets = useMemo(() => {
    const map = new Map();
    for (const b of binders) {
      if (b.gameType !== 'lorcana' || !b.setCode) continue;
      const set = map.get(b.setCode) ?? new Set();
      for (const [num, data] of Object.entries(b.cards)) if (data.quantity > 0) set.add(baseNumber(num));
      map.set(b.setCode, set);
    }
    return map;
  }, [binders]);

  const completion = useMemo(() => {
    if (!index) return null;
    const rarities = new Map();
    const inks = new Map();
    let owned = 0;
    let count = 0;
    for (const set of selectedSets) {
      const filled = filledPockets.get(set) ?? new Set();
      for (const { number, card } of getPocketGroups(index, set)) {
        const has = filled.has(number);
        count++;
        if (has) owned++;
        const r = rarities.get(card.rarity) ?? { owned: 0, total: 0 };
        r.total++;
        if (has) r.owned++;
        rarities.set(card.rarity, r);
        for (const ink of card.inks) {
          const i = inks.get(ink) ?? { owned: 0, total: 0 };
          i.total++;
          if (has) i.owned++;
          inks.set(ink, i);
        }
      }
    }
    return { rarities, inks, owned, count };
  }, [index, selectedSets, filledPockets]);

  // Playsets: 4 copies of each regular card of the chapter(s), counted by full name across binders
  const playsets = useMemo(() => {
    if (!index) return null;
    const cards = new Map();
    for (const set of selectedSets) {
      for (const card of index.bySet.get(set) ?? []) {
        if (SPECIAL_RARITIES.includes(card.rarity) || cards.has(card.key)) continue;
        cards.set(card.key, card);
      }
    }
    let have = 0;
    let complete = 0;
    const incomplete = [];
    for (const [key, card] of cards) {
      const owned = collection.entries.get(key)?.total ?? 0;
      have += Math.min(owned, PLAYSET);
      if (owned >= PLAYSET) complete++;
      else incomplete.push({ key, card, owned, missing: PLAYSET - owned });
    }
    incomplete.sort((a, b) => b.missing - a.missing || a.card.id.localeCompare(b.card.id, undefined, { numeric: true }));
    return { total: cards.size, have, complete, incomplete, progress: cards.size ? have / (cards.size * PLAYSET) : 0 };
  }, [index, selectedSets, collection]);

  // Copies beyond what is kept: one in the binder plus the decks' copies, or a playset that covers the decks
  const keep = prefs.tradeKeep ?? 1;
  const doubles = useMemo(() => {
    const usage = getDeckUsage(decks);
    const sets = new Set(selectedSets);
    return [...collection.entries.values()]
      .filter((e) => selected === ALL || e.copies.some((c) => sets.has(c.binder.setCode)))
      .map((e) => {
        const used = (usage.get(e.key) ?? []).reduce((s, u) => s + u.qty, 0);
        const reserved = keep >= PLAYSET ? Math.max(keep, used) : keep + used;
        return { ...e, used, surplus: e.total - reserved };
      })
      .filter((e) => e.surplus > 0)
      .sort((a, b) => b.surplus - a.surplus || cardLang.fullName(a.card).localeCompare(cardLang.fullName(b.card)));
  }, [collection, decks, keep, selected, selectedSets, cardLang]);

  const playsetText = playsets?.incomplete.map((p) => `${p.missing} ${p.card.fullName}`).join('\n') ?? '';
  // Doubles go to other players: in the card language. Missing playset copies stay in English for Cardmarket
  const doublesText = doubles.map((d) => `${d.surplus} ${cardLang.fullName(d.card)}`).join('\n');

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 sm:px-6 pt-4 pb-3">
        <div className="max-w-5xl mx-auto flex items-start gap-3">
          <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
            <MenuIcon size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/25">
              Lorcana
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">Collection</h1>
            <p className="text-xs text-slate-500 mt-0.5">Complétion, playsets et doubles, toutes fardes confondues.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 pb-8">
        <div className="max-w-5xl mx-auto space-y-4">
          {chapters.length === 0 ? (
            <p className="text-sm text-slate-500 text-center mt-10">
              Crée une farde Lorcana liée à un chapitre pour voir les statistiques de ta collection.
            </p>
          ) : !index ? (
            <div className="flex flex-col items-center gap-3 mt-10 text-sm text-slate-400">
              {status === 'error' ? (
                <>
                  <p>Impossible de charger le catalogue des cartes depuis Lorcast.</p>
                  <button onClick={refresh} className="btn-secondary">
                    <RotateCcw size={15} />
                    Réessayer
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-2.5">
                  <Loader2 size={16} className="animate-spin" />
                  Chargement du catalogue… {total > 0 && `${loaded}/${total} chapitres`}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Chapitre">
                {[...chapters, ALL].map((code) => {
                  const active = code === selected;
                  return (
                    <button
                      key={code}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setChapter(code)}
                      className={`px-3 py-1.5 rounded-lg text-sm ring-1 ring-inset transition-all ${
                        active
                          ? 'bg-indigo-500/15 ring-indigo-400/60 text-white'
                          : 'bg-white/[0.03] ring-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {code === ALL ? 'Tous' : `${code} · ${getLorcanaSetName(code) ?? `Set ${code}`}`}
                    </button>
                  );
                })}
              </div>

              {completion && (
                <Section
                  icon={Sparkles}
                  title="Complétion"
                  hint="Cartes différentes possédées, une poche par numéro (les variantes d'illustration comptent une fois)."
                  action={
                    <span className="text-sm text-slate-400 tabular-nums whitespace-nowrap">
                      <b className="text-white">{completion.owned}</b>/{completion.count}
                    </span>
                  }
                >
                  <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
                    <div className="space-y-2.5">
                      <span className="label">Par rareté</span>
                      {LORCANA_RARITIES.filter((r) => completion.rarities.has(r.key)).map((r) => (
                        <CompletionRow key={r.key} label={r.label} {...completion.rarities.get(r.key)} />
                      ))}
                      {[...completion.rarities.keys()]
                        .filter((key) => !LORCANA_RARITIES.some((r) => r.key === key))
                        .map((key) => (
                          <CompletionRow key={key ?? 'unknown'} label={key ?? 'Inconnue'} {...completion.rarities.get(key)} />
                        ))}
                    </div>
                    <div className="space-y-2.5">
                      <span className="label">Par encre</span>
                      {INKS.filter((ink) => completion.inks.has(ink.key)).map((ink) => (
                        <CompletionRow key={ink.key} label={ink.label} dot={ink.color} {...completion.inks.get(ink.key)} />
                      ))}
                    </div>
                  </div>
                </Section>
              )}

              {playsets && (
                <Section
                  icon={Layers}
                  title="Playsets"
                  hint={`4 exemplaires de chaque carte (hors Épiques, Enchantées et Iconiques), toutes fardes et rééditions confondues. ${playsets.complete}/${playsets.total} complets.`}
                  action={
                    playsets.incomplete.length > 0 && (
                      <CopyButton text={playsetText} label="Copier les manques" toast="Copies manquantes copiées" />
                    )
                  }
                >
                  <div className="flex items-center gap-3 mb-4">
                    <ProgressBar value={playsets.progress} className="flex-1 h-2" />
                    <span className="text-xs text-slate-400 tabular-nums">
                      <b className="text-white">{Math.floor(playsets.progress * 100)} %</b> · {playsets.have}/
                      {playsets.total * PLAYSET} copies
                    </span>
                  </div>
                  {playsets.incomplete.length === 0 ? (
                    <p className="text-sm text-slate-400">Tous les playsets sont complets 🎉</p>
                  ) : (
                    <CardGrid
                      items={playsets.incomplete}
                      render={(p) => (
                        <div key={p.key} className="min-w-0">
                          <CardThumb card={p.card} dimmed={p.owned === 0} />
                          <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
                            <span className="text-slate-500 tabular-nums">{p.card.id}</span>
                            <span className="font-semibold text-amber-300 tabular-nums" title={`${p.owned} possédée(s)`}>
                              +{p.missing}
                            </span>
                          </div>
                        </div>
                      )}
                    />
                  )}
                </Section>
              )}

              <Section
                icon={Repeat}
                title="Doubles à échanger"
                hint={
                  keep >= PLAYSET
                    ? 'Au-delà d’un playset par carte (tes decks puisent dedans).'
                    : 'Au-delà d’un exemplaire gardé en farde, plus les copies utilisées par tes decks.'
                }
                action={doubles.length > 0 && <CopyButton text={doublesText} label="Copier" toast="Doubles copiés" />}
              >
                <div className="flex items-center rounded-lg ring-1 ring-inset ring-white/10 p-0.5 w-fit mb-4">
                  {[
                    { value: 1, label: 'Collection · garder 1' },
                    { value: PLAYSET, label: 'Playset · garder 4' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPref('tradeKeep', opt.value)}
                      aria-pressed={keep === opt.value}
                      className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                        keep === opt.value ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {doubles.length === 0 ? (
                  <p className="text-sm text-slate-400">Aucun double à échanger pour l’instant.</p>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {doubles.map((d) => (
                      <li key={d.key} className="flex items-center gap-3 py-2">
                        <CardThumb card={d.card} className="w-10 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white truncate">{cardLang.fullName(d.card)}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {d.copies
                              .map((c) => `${c.binder.name} · p. ${c.location.page} (${c.normal + c.foil})`)
                              .join(' · ')}
                            {d.used > 0 && ` · ${d.used} en deck`}
                          </div>
                        </div>
                        {d.foil > 0 && (
                          <span className="foil-text text-[11px] font-semibold whitespace-nowrap">
                            {d.foil} foil{d.foil > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-sm font-bold text-emerald-300 tabular-nums whitespace-nowrap">
                          ×{d.surplus}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollectionStatsView;
