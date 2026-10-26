import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Loader2, Share2, SlidersHorizontal, Upload, X } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { usePrices } from '../../hooks/usePrices';
import { useCardLang } from '../../hooks/useCardLang';
import { useTradeSide, DEFAULT_TRADE_WANTS } from '../../hooks/useTradeSide';
import { useToast } from '../ui/toastContext';
import { readCollectionShare, resolveShare } from '../../utils/tradeShare';
import {
  TRADE_RULES,
  getPointsScale,
  describePointsScale,
  getRuleHint,
  formatPoints,
  matchWants,
  proposeTrade,
  summarizeSide,
  getTradeBalance,
  getTradeClass,
  getTradeClassLabel,
  compareTradeClasses,
  buildPartnerTradeText,
} from '../../utils/tradeMatch';
import { Segmented } from '../Collection/CollectionParts';
import CopyButton from '../ui/CopyButton';
import TradeRow from './TradeRow';
import PointsScaleModal from './PointsScaleModal';

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

const plural = (n, word) => `${n.toLocaleString('fr-BE')} ${word}${n > 1 ? 's' : ''}`;

const sumQty = (items) => items.reduce((s, i) => s + i.qty, 0);
const sumValue = (items) => items.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0);

const TierName = ({ tier }) => {
  const { label, foil } = getTradeClassLabel(tier);
  return (
    <>
      {label}
      {foil && <span className="foil-text font-semibold"> foil</span>}
    </>
  );
};

/** What a rule's trade amounts to: the cards of each side and what the rule weighs. */
const RuleMetric = ({ rule, received, given, format }) => {
  if (rule === 'points') return `${formatPoints(received.points)} pts ↔ ${formatPoints(given.points)} pts`;
  return `${format(received.value)} ↔ ${format(given.value)}`;
};

/** One of the trade rules, with the trade it proposes. */
const RuleOption = ({ rule, active, received, given, format, scale, onSelect }) => {
  const empty = received.cards + given.cards === 0;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      title={rule.key === 'points' ? describePointsScale(scale) : undefined}
      className={`flex flex-col text-left rounded-2xl p-4 ring-1 ring-inset transition-colors ${
        active ? 'bg-indigo-500/10 ring-indigo-400/50' : 'bg-white/[0.02] ring-white/5 hover:ring-white/15'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-3.5 h-3.5 rounded-full ring-2 ring-inset flex-shrink-0 ${
            active ? 'ring-indigo-300 bg-indigo-400 shadow-[inset_0_0_0_2px_rgb(15_23_42)]' : 'ring-slate-600'
          }`}
        />
        <span className="text-sm font-semibold text-white">{rule.label}</span>
      </div>
      <p className="text-xs text-slate-500 mt-1.5 mb-3 leading-relaxed">{getRuleHint(rule, scale)}</p>
      {empty ? (
        <p className="text-xs text-slate-500 mt-auto">Pas d’échange possible avec cette règle.</p>
      ) : (
        <div className="mt-auto tabular-nums">
          <div className="text-lg font-bold text-white leading-tight">
            {received.cards} <span className="text-slate-500 font-normal">⇄</span> {given.cards}
          </div>
          <div className="text-[11px] text-slate-500">cartes reçues ⇄ données</div>
          <div className="text-xs text-slate-300 mt-1">
            <RuleMetric rule={rule.key} received={received} given={given} format={format} />
          </div>
        </div>
      )}
    </button>
  );
};

/** Trade items of one side, by rarity tier, each copy checkable. */
const TradeSide = ({ title, hint, items, selection, onSelect, format, reasons, empty }) => {
  const tiers = useMemo(() => {
    const groups = new Map();
    for (const item of items) {
      const tier = getTradeClass(item.card, item.foil);
      groups.set(tier, [...(groups.get(tier) ?? []), item]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => compareTradeClasses(a, b))
      .map(([tier, list]) => ({ tier, items: list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1)) }));
  }, [items]);
  const chosen = summarizeSide(items, selection);

  return (
    <section data-preview-group className="rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-3 sm:p-4 flex flex-col min-h-0 min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="text-xs text-slate-400 tabular-nums">
          {plural(chosen.cards, 'carte')} · <b className="text-white">{format(chosen.value)}</b>
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-2">{hint}</p>
      {items.length > 0 && (
        <div className="flex gap-3 mb-1 px-2 text-[11px]">
          <button onClick={() => onSelect(Object.fromEntries(items.map((i) => [i.id, i.qty])))} className="text-indigo-300 hover:text-white">
            Tout
          </button>
          <button onClick={() => onSelect({})} className="text-slate-500 hover:text-white">
            Aucune
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">{empty}</p>
      ) : (
        <div className="overflow-y-auto scrollbar-thin max-h-[55vh] -mx-1 px-1">
          {tiers.map(({ tier, items: list }) => (
            <div key={tier} className="mb-2">
              <div className="flex items-center justify-between px-2 pt-2 pb-1 text-[11px] uppercase tracking-wider text-slate-500">
                <span>
                  <TierName tier={tier} />
                </span>
                <span className="tabular-nums">
                  <b className="text-slate-300">{chosen.tiers.get(tier) ?? 0}</b>/{sumQty(list)}
                </span>
              </div>
              <ul className="space-y-0.5">
                {list.map((item) => (
                  <TradeRow
                    key={item.id}
                    item={item}
                    selected={selection[item.id] ?? 0}
                    onChange={(n) => onSelect({ ...selection, [item.id]: n })}
                    format={format}
                    detail={<> · {item.for.map((f) => reasons[f]).join(', ')}</>}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

/** What the chosen trade looks like under the rule: even, or which side gets more. */
const balanceText = (rule, balance, partner, format) => {
  if (rule === 'rarity') {
    if (balance.even) return 'Équilibré : même rareté des deux côtés';
    return balance.tiers
      .slice(0, 3)
      .map(({ tier, diff }) => {
        const { label, foil } = getTradeClassLabel(tier);
        return `${label}${foil ? ' foil' : ''} +${Math.abs(diff)} ${diff > 0 ? 'pour toi' : `pour ${partner}`}`;
      })
      .join(' · ');
  }
  if (rule === 'points') {
    if (balance.even) return 'Équilibré en points de rareté';
    const points = plural(Math.abs(balance.diff), 'point');
    return balance.diff > 0 ? `Tu reçois ${points} de plus` : `Tu donnes ${points} de plus`;
  }
  if (balance.even) return 'Équilibré à 5 % près';
  return balance.diff > 0 ? `Tu reçois ${format(balance.diff)} de plus` : `Tu donnes ${format(-balance.diff)} de plus`;
};

/** Trades with one player: the cards each one can give the other, the rules' proposals, the chosen trade. */
const PartnerMatch = ({ partner, toolbar }) => {
  const { prefs, setPref } = useStore();
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const { status, getPrice, format, source: priceSource } = usePrices();
  const mine = useTradeSide();
  const [rule, setRule] = useState('rarity');
  // Copies the user picked by hand; null follows the rule's proposal
  const [custom, setCustom] = useState(null);
  const [pointsOpen, setPointsOpen] = useState(false);
  const keep = prefs.tradeKeep ?? 1;
  const scale = useMemo(() => getPointsScale(prefs.tradePoints), [prefs.tradePoints]);
  const wantsPrefs = { ...DEFAULT_TRADE_WANTS, ...prefs.tradeWants };
  const owner = partner.owner;

  const theirs = useMemo(() => resolveShare(partner, index), [partner, index]);
  const receiveItems = useMemo(
    () => (mine ? matchWants(mine.wants, theirs.haves.map((h) => ({ ...h, price: getPrice(h.card, h.foil) }))) : []),
    [mine, theirs, getPrice]
  );
  const giveItems = useMemo(() => (mine ? matchWants(theirs.wants, mine.haves) : []), [mine, theirs]);
  const proposals = useMemo(
    () => Object.fromEntries(TRADE_RULES.map((r) => [r.key, proposeTrade(r.key, receiveItems, giveItems, scale)])),
    [receiveItems, giveItems, scale]
  );

  const selection = custom ?? proposals[rule];
  const received = summarizeSide(receiveItems, selection.receive, scale);
  const given = summarizeSide(giveItems, selection.give, scale);
  const balance = getTradeBalance(rule, received, given);

  const chooseRule = (key) => {
    setRule(key);
    setCustom(null);
  };
  const select = (side) => (next) => setCustom({ ...selection, [side]: next });
  // A change to what the user looks for or gives changes the candidates: back to the proposal
  const setWants = (changes) => {
    setPref('tradeWants', { ...wantsPrefs, ...changes });
    setCustom(null);
  };

  const picked = (items, chosen) =>
    items.filter((i) => chosen[i.id] > 0).map((i) => ({ card: i.card, foil: i.foil, qty: chosen[i.id], price: i.price }));
  const text =
    received.cards + given.cards > 0
      ? buildPartnerTradeText({
          me: prefs.traderName,
          partner: owner,
          rule,
          receive: picked(receiveItems, selection.receive),
          give: picked(giveItems, selection.give),
          format,
          nameOf: cardLang.fullName,
          scale,
        })
      : '';

  const nothing = receiveItems.length === 0 && giveItems.length === 0;

  return (
    <>
      <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 pt-4 pb-28">
        <div className="max-w-5xl mx-auto space-y-4">
          {toolbar}

          <p className="text-xs text-slate-500">
            {partner.scope || 'Collection'} · {plural(theirs.owned.copies, 'exemplaire')} · fichier du {formatDate(partner.exportedAt)} ·{' '}
            {owner} garde {plural(partner.keep, 'exemplaire')} par carte
          </p>
          {theirs.unknown > 0 && (
            <p className="flex items-start gap-2 text-xs text-amber-300/90">
              <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
              {plural(theirs.unknown, 'carte')} du fichier ne sont pas dans ton catalogue (chapitre pas encore chargé) : mets
              le catalogue à jour en bas du menu.
            </p>
          )}

          {!mine ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Préparation de ta collection…
            </p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  {
                    title: `${owner} peut te donner`,
                    items: receiveItems,
                    note: `parmi ses ${plural(sumQty(theirs.haves), 'double')}, les cartes que tu cherches`,
                  },
                  {
                    title: `Tu peux donner à ${owner}`,
                    items: giveItems,
                    note: `parmi tes ${plural(sumQty(mine.haves), 'double')}, les cartes que ${owner} cherche`,
                  },
                ].map((s) => (
                  <div key={s.title} className="rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 px-4 py-3">
                    <div className="text-xs text-slate-400">{s.title}</div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-2xl font-bold text-white tabular-nums">{sumQty(s.items)}</span>
                      <span className="text-sm text-slate-400">
                        carte{sumQty(s.items) > 1 ? 's' : ''} · {status === 'ready' ? format(sumValue(s.items)) : '…'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{s.note}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
                <span>Tu cherches aussi :</span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={wantsPrefs.decks}
                    onChange={(e) => setWants({ decks: e.target.checked })}
                    className="w-3.5 h-3.5 accent-indigo-500"
                  />
                  les manques de tes decks
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={wantsPrefs.specials}
                    onChange={(e) => setWants({ specials: e.target.checked })}
                    className="w-3.5 h-3.5 accent-indigo-500"
                  />
                  Épiques, Enchantées et Iconiques
                </label>
                <span className="sm:ml-auto">
                  <Segmented
                    label="Exemplaires gardés"
                    value={keep}
                    onChange={(n) => {
                      setPref('tradeKeep', n);
                      setCustom(null);
                    }}
                    options={[
                      { value: 1, label: 'Garder 1' },
                      { value: 4, label: 'Garder 4 (playset)' },
                    ]}
                  />
                </span>
              </div>

              {nothing ? (
                <p className="text-sm text-slate-500 py-10 text-center leading-relaxed max-w-md mx-auto">
                  Pas d’échange possible pour l’instant : aucun double de {owner} ne fait partie de tes recherches, et aucun
                  des tiens ne fait partie des siennes.
                </p>
              ) : (
                <>
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
                      <h2 className="text-sm font-semibold text-white">Options d’échange</h2>
                      {custom && (
                        <button onClick={() => setCustom(null)} className="text-[11px] text-indigo-300 hover:text-white">
                          Ajusté à la main · revenir à la proposition
                        </button>
                      )}
                      <button
                        onClick={() => setPointsOpen(true)}
                        className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white"
                      >
                        <SlidersHorizontal size={12} />
                        Régler les points de rareté
                      </button>
                    </div>
                    <div role="radiogroup" aria-label="Règle d’échange" className="grid sm:grid-cols-3 gap-3">
                      {TRADE_RULES.map((r) => (
                        <RuleOption
                          key={r.key}
                          rule={r}
                          active={rule === r.key}
                          received={summarizeSide(receiveItems, proposals[r.key].receive, scale)}
                          given={summarizeSide(giveItems, proposals[r.key].give, scale)}
                          format={format}
                          scale={scale}
                          onSelect={() => chooseRule(r.key)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-4 items-start">
                    <TradeSide
                      title={`Tu reçois de ${owner}`}
                      hint="Ses doubles qui manquent à tes fardes ou à tes decks."
                      items={receiveItems}
                      selection={selection.receive}
                      onSelect={select('receive')}
                      format={format}
                      reasons={{ binder: 'pour ta farde', deck: 'pour tes decks' }}
                      empty={`${owner} n’a aucun double que tu cherches.`}
                    />
                    <TradeSide
                      title={`Tu donnes à ${owner}`}
                      hint={`Tes doubles qui manquent à ses fardes ou à ses decks.`}
                      items={giveItems}
                      selection={selection.give}
                      onSelect={select('give')}
                      format={format}
                      reasons={{ binder: 'pour sa farde', deck: 'pour ses decks' }}
                      empty={`Aucun de tes doubles ne manque à ${owner}.`}
                    />
                  </div>
                </>
              )}

              <p className="text-[11px] text-slate-600">
                {priceSource === 'Cardmarket'
                  ? 'Prix Cardmarket (tendance), en euros.'
                  : 'Cardmarket injoignable : prix Lorcast (TCGplayer) en dollars, à prendre comme ordre de grandeur.'}{' '}
                Points de rareté : {describePointsScale(scale)}.{' '}
                <button onClick={() => setPointsOpen(true)} className="text-slate-400 underline underline-offset-2 hover:text-white">
                  Régler
                </button>
              </p>
            </>
          )}
        </div>
      </div>

      {mine && !nothing && (
        <div className="absolute inset-x-0 bottom-0 px-4 sm:px-6 pb-4 pointer-events-none">
          <div className="surface max-w-5xl mx-auto rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 pointer-events-auto">
            <div className="text-sm tabular-nums">
              <span className="text-slate-500">Tu reçois</span> <b className="text-white">{received.cards}</b>
              <span className="text-slate-600 mx-2">·</span>
              <span className="text-slate-500">Tu donnes</span> <b className="text-white">{given.cards}</b>
              <span className="text-slate-600 mx-2">·</span>
              <span className="text-slate-400">
                <RuleMetric rule={rule} received={received} given={given} format={format} />
              </span>
            </div>
            {received.cards + given.cards > 0 && (
              <span className={`text-xs font-semibold ${balance.even ? 'text-emerald-300' : 'text-amber-300'}`}>
                {balanceText(rule, balance, owner, format)}
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              <CopyButton text={text} label="Copier la proposition" toast="Proposition d'échange copiée" className="btn-primary px-3 py-1.5" />
            </div>
          </div>
        </div>
      )}

      <PointsScaleModal isOpen={pointsOpen} onClose={() => setPointsOpen(false)} />
    </>
  );
};

/** Steps shown before any collection is imported. */
const Onboarding = ({ onShare, onImport }) => (
  <div className="grid md:grid-cols-3 gap-3">
    {[
      {
        title: 'Partage ta collection',
        text: 'Toute ta collection ou quelques fardes, dans un fichier à envoyer à l’autre joueur.',
        action: (
          <button onClick={onShare} className="btn-secondary px-3 py-1.5">
            <Share2 size={15} /> Partager ma collection
          </button>
        ),
      },
      {
        title: 'Importe la sienne',
        text: 'Choisis le fichier reçu, ou glisse-le sur cette page.',
        action: (
          <button onClick={onImport} className="btn-primary px-3 py-1.5">
            <Upload size={15} /> Importer une collection
          </button>
        ),
      },
      {
        title: 'Choisis un échange équitable',
        text: 'Même rareté, points de rareté ou valeur égale : Folio propose, tu ajustes, puis tu copies la proposition.',
      },
    ].map((step, i) => (
      <div key={step.title} className="rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/5 p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-indigo-300 tabular-nums">0{i + 1}</span>
          <span className="text-sm font-semibold text-white">{step.title}</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed flex-1">{step.text}</p>
        {step.action && <div>{step.action}</div>}
      </div>
    ))}
  </div>
);

/**
 * Trades with other players: their shared collections, imported from a file, against the user's.
 * @param {() => void} onShare opens the export of the user's collection
 */
const PartnerTrade = ({ onShare }) => {
  const { partners, savePartner, deletePartner, restorePartner, view, setView } = useStore();
  const { index } = useCatalog();
  const notify = useToast();
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  // The player chosen last, kept in the view so it survives a tab change
  const partner = partners.find((p) => p.id === view.partnerId) ?? partners.at(-1) ?? null;
  const setSelectedId = (partnerId) => setView({ kind: 'trades', tab: 'partner', partnerId });

  const importFile = async (file) => {
    const share = await readCollectionShare(file);
    if (!share) {
      notify({ tone: 'error', message: "Ce fichier n'est pas une collection Folio partagée" });
      return;
    }
    const known = partners.some((p) => p.owner.toLowerCase() === share.owner.toLowerCase());
    setSelectedId(savePartner(share));
    notify({ tone: 'success', message: known ? `Collection de ${share.owner} mise à jour` : `Collection de ${share.owner} importée` });
  };

  const remove = (p) => {
    const snapshot = deletePartner(p.id);
    if (!snapshot) return;
    notify({
      message: `Collection de ${p.owner} retirée`,
      action: { label: 'Annuler', onClick: () => restorePartner(snapshot) },
      duration: 7000,
    });
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {partners.map((p) => {
        const active = p.id === partner?.id;
        return (
          <div
            key={p.id}
            className={`flex items-center rounded-full ring-1 ring-inset transition-colors ${
              active ? 'bg-indigo-500/15 ring-indigo-400/50 text-white' : 'ring-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <button onClick={() => setSelectedId(p.id)} aria-pressed={active} className="flex items-center gap-2 pl-1.5 pr-2 py-1 text-sm">
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-[11px] font-bold flex items-center justify-center">
                {p.owner.slice(0, 1).toUpperCase()}
              </span>
              {p.owner}
            </button>
            <button onClick={() => remove(p)} className="btn-icon p-1 mr-1" aria-label={`Retirer la collection de ${p.owner}`}>
              <X size={13} />
            </button>
          </div>
        );
      })}
      <div className="flex gap-2 ml-auto">
        <button onClick={onShare} className="btn-secondary px-3 py-1.5">
          <Share2 size={15} />
          Partager ma collection
        </button>
        <button onClick={() => fileRef.current?.click()} className="btn-secondary px-3 py-1.5">
          <Upload size={15} />
          Importer
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="relative flex-1 flex flex-col min-h-0"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) importFile(file);
      }}
    >
      {partner && index ? (
        <PartnerMatch key={partner.id} partner={partner} toolbar={toolbar} />
      ) : (
        <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 pt-4 pb-10">
          <div className="max-w-5xl mx-auto space-y-4">
            {partners.length > 0 && toolbar}
            {!index ? (
              <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 size={16} className="animate-spin" /> Chargement du catalogue de cartes…
              </p>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <ArrowLeftRight size={18} className="text-indigo-300 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Échange avec un autre joueur pour compléter vos collections : chacun envoie la sienne, Folio croise vos
                    doubles avec ce qui vous manque et propose des échanges équitables, carte pour carte de même rareté, au
                    poids de la rareté ou à valeur égale.
                  </p>
                </div>
                <Onboarding onShare={onShare} onImport={() => fileRef.current?.click()} />
              </>
            )}
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importFile(file);
          e.target.value = '';
        }}
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 m-3 rounded-3xl border-2 border-dashed border-indigo-400/60 bg-indigo-500/10 flex items-center justify-center">
          <span className="surface rounded-xl px-4 py-2 text-sm text-white">Dépose le fichier de collection ici</span>
        </div>
      )}
    </div>
  );
};

export default PartnerTrade;
