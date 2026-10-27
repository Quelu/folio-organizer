import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin, PackageCheck, Pencil, X } from 'lucide-react';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { usePrices } from '../../hooks/usePrices';
import { useCardLang } from '../../hooks/useCardLang';
import { useToast } from '../ui/toastContext';
import { getLorcanaSetName } from '../../data/games';
import { getTradePullList, getTradeDestination } from '../../utils/trades';
import {
  TRADE_RULES,
  formatPoints,
  summarizeSide,
  getTradeBalance,
  describeBalance,
  getTradeClassLabel,
  buildPartnerTradeText,
} from '../../utils/tradeMatch';
import CardThumb from '../ui/CardThumb';
import CopyButton from '../ui/CopyButton';
import ConfirmDialog from '../ui/ConfirmDialog';
import ProgressBar from '../ui/ProgressBar';

const plural = (n, word) => `${n.toLocaleString('fr-BE')} ${word}${n > 1 ? 's' : ''}`;

const formatDate = (ms) => new Date(ms).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' });

/** "Page 3 · feuille 2 recto · rangée 1, col. 2" */
const describeLocation = (loc) => `Page ${loc.page} · feuille ${loc.sheet} ${loc.side} · rangée ${loc.row}, col. ${loc.col}`;

/** Stored copies of a trade ({ id: card id, foil, qty, price }) with their catalog card, as trade items. */
const resolveCopies = (list, index) =>
  list.flatMap((t) => {
    const card = index.byId.get(t.id);
    return card ? [{ ...t, id: `${t.id}${t.foil ? '-foil' : ''}`, key: card.key, card }] : [];
  });

/** Rows of one binder, under its name. */
const groupByBinder = (rows) => {
  const groups = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.binder?.id === row.binder?.id) last.rows.push(row);
    else groups.push({ binder: row.binder, rows: [row] });
  }
  return groups;
};

/** One copy line of the trade: checkbox, card, where it is or goes, and a way to open the binder there. */
const TradeLine = ({ row, checked, onCheck, checkLabel, where, onLocate, format }) => {
  const cardLang = useCardLang();
  const { card, foil, qty, price } = row;
  return (
    <li
      className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ring-1 ring-inset transition-colors ${
        checked ? 'bg-emerald-500/[0.07] ring-emerald-400/20' : 'bg-white/[0.02] ring-white/5'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheck(e.target.checked)}
        className="w-4 h-4 accent-emerald-500 flex-shrink-0"
        aria-label={`${checkLabel} : ${cardLang.fullName(card)}`}
        title={checkLabel}
      />
      <CardThumb card={card} foil={foil} className={`w-9 flex-shrink-0 transition-opacity ${checked ? 'opacity-50' : ''}`} />
      <div className="flex-1 min-w-0 leading-tight">
        <div className={`text-sm truncate ${checked ? 'text-slate-400 line-through decoration-slate-500' : 'text-slate-100'}`}>
          <b className="tabular-nums">{qty}×</b> {cardLang.fullName(card)}
          {foil && <span className="foil-text font-semibold text-xs"> foil</span>}
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          {getTradeClassLabel(card.rarity ?? '?').label} · {getLorcanaSetName(card.set) ?? `Set ${card.set}`} n° {card.number}
          {price != null && <> · {format(price * qty)}</>}
        </div>
        {where && <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{where}</div>}
      </div>
      {onLocate && (
        <button onClick={onLocate} className="btn-icon flex-shrink-0" title="Voir dans la farde" aria-label="Voir dans la farde">
          <MapPin size={16} />
        </button>
      )}
    </li>
  );
};

/** A side of the trade, its copies grouped by binder. */
const TradeColumn = ({ title, subtitle, groups, done, total, extra }) => (
  <section className="rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-3 sm:p-4 min-w-0">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <span className="text-xs text-slate-400 tabular-nums">
        <b className={done === total ? 'text-emerald-300' : 'text-white'}>{done}</b>/{total}
      </span>
    </div>
    <p className="text-xs text-slate-500 mt-0.5 mb-2">{subtitle}</p>
    <ProgressBar value={total ? done / total : 0} className="h-1 mb-3" />
    <div className="space-y-3">
      {groups.map(({ label, rows }) => (
        <div key={label}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5 px-1">{label}</h3>
          <ul className="space-y-1">{rows}</ul>
        </div>
      ))}
    </div>
    {extra}
  </section>
);

/**
 * A trade validated with another player: who gives what, where to fetch the user's cards in the
 * binders (in page order) and where the received ones go. Once done, the binders are updated.
 */
const ValidatedTrade = ({ partner, toolbar, scale, onEdit, onLocate }) => {
  const { binders, prefs, setPartnerTrade, completePartnerTrade, undoPartnerTrade, setView } = useStore();
  const { index } = useCatalog();
  const collection = useCollection();
  const cardLang = useCardLang();
  const notify = useToast();
  const { format } = usePrices();
  const [confirm, setConfirm] = useState(null);
  const { trade, owner } = partner;
  const found = new Set(trade.found ?? []);

  const give = useMemo(() => resolveCopies(trade.give, index), [trade.give, index]);
  const receive = useMemo(() => resolveCopies(trade.receive, index), [trade.receive, index]);

  const pull = useMemo(() => getTradePullList(give, collection, binders), [give, collection, binders]);
  const incoming = useMemo(() => {
    const rows = receive.map((item) => ({ ...item, rowId: `in:${item.id}`, dest: getTradeDestination(item.card, binders) }));
    const order = new Map(binders.map((b, i) => [b.id, i]));
    return rows.sort(
      (a, b) =>
        (a.dest ? order.get(a.dest.binder.id) : Infinity) - (b.dest ? order.get(b.dest.binder.id) : Infinity) ||
        (a.dest?.location.page ?? 0) - (b.dest?.location.page ?? 0) ||
        Number(a.card.set) - Number(b.card.set) ||
        parseInt(a.card.number, 10) - parseInt(b.card.number, 10)
    );
  }, [receive, binders]);

  const selection = (items) => Object.fromEntries(items.map((i) => [i.id, i.qty]));
  const received = summarizeSide(receive, selection(receive), scale);
  const given = summarizeSide(give, selection(give), scale);
  const balance = getTradeBalance(trade.rule, received, given);
  const rule = TRADE_RULES.find((r) => r.key === trade.rule);

  const toggle = (id, on) => {
    const next = new Set(found);
    if (on) next.add(id);
    else next.delete(id);
    setPartnerTrade(partner.id, { found: [...next] }, true);
  };

  const pulledDone = pull.rows.filter((r) => found.has(r.id)).reduce((s, r) => s + r.take, 0);
  const pulledTotal = pull.rows.reduce((s, r) => s + r.take, 0);
  const inDone = incoming.filter((r) => found.has(r.rowId)).reduce((s, r) => s + r.qty, 0);
  const homeless = incoming.filter((r) => !r.dest);

  const giveGroups = groupByBinder(pull.rows).map(({ binder, rows }) => ({
    label: `${binder.name} · ${plural(rows.reduce((s, r) => s + r.take, 0), 'carte')}`,
    rows: rows.map((row) => (
      <TradeLine
        key={row.id}
        row={{ ...row, qty: row.take, price: give.find((g) => g.card.id === row.card.id && g.foil === row.foil)?.price ?? null }}
        checked={found.has(row.id)}
        onCheck={(on) => toggle(row.id, on)}
        checkLabel="Trouvée dans la farde"
        where={<>n° {row.cardNumber} · {describeLocation(row.location)}</>}
        onLocate={() => onLocate(row.binder.id, parseInt(row.cardNumber, 10))}
        format={format}
      />
    )),
  }));

  const receiveGroups = groupByBinder(incoming.map((r) => ({ ...r, binder: r.dest?.binder ?? null }))).map(({ binder, rows }) => ({
    label: binder ? `À ranger dans ${binder.name}` : 'Sans farde de leur chapitre',
    rows: rows.map((row) => (
      <TradeLine
        key={row.rowId}
        row={row}
        checked={found.has(row.rowId)}
        onCheck={(on) => toggle(row.rowId, on)}
        checkLabel="Reçue"
        where={row.dest ? <>n° {row.dest.cardNumber} · {describeLocation(row.dest.location)}</> : 'À ranger à la main'}
        onLocate={row.dest ? () => onLocate(row.dest.binder.id, parseInt(row.dest.cardNumber, 10)) : null}
        format={format}
      />
    )),
  }));

  const text = buildPartnerTradeText({
    me: prefs.traderName,
    partner: owner,
    rule: trade.rule,
    receive,
    give,
    format,
    nameOf: cardLang.fullName,
    scale,
  });

  // Stay on this player once the trade is gone (back from a binder, the view forgot them)
  const keepPartner = () => setView({ kind: 'trades', tab: 'partner', partnerId: partner.id });

  const complete = () => {
    keepPartner();
    const remove = pull.rows.map((r) => ({ binderId: r.binder.id, cardNumber: r.cardNumber, foil: r.foil, qty: r.take }));
    const add = incoming.filter((r) => r.dest).map((r) => ({ binderId: r.dest.binder.id, cardNumber: r.dest.cardNumber, foil: r.foil, qty: r.qty }));
    const snapshot = completePartnerTrade(partner.id, { remove, add });
    const left = homeless.reduce((s, r) => s + r.qty, 0);
    notify({
      tone: 'success',
      message: `Échange avec ${owner} enregistré dans tes fardes${left ? ` · ${plural(left, 'carte')} à ajouter à la main` : ''}`,
      action: { label: 'Annuler', onClick: () => undoPartnerTrade(snapshot) },
      duration: 8000,
    });
  };

  const cancel = () => {
    const saved = trade;
    keepPartner();
    setPartnerTrade(partner.id, null);
    notify({
      message: `Échange avec ${owner} annulé`,
      action: { label: 'Annuler', onClick: () => setPartnerTrade(partner.id, saved) },
      duration: 7000,
    });
  };

  return (
    <div className="flex-1 overflow-auto scrollbar-thin px-4 sm:px-6 pt-4 pb-10">
      <div className="max-w-5xl mx-auto space-y-4">
        {toolbar}

        <section className="rounded-2xl bg-emerald-500/[0.05] ring-1 ring-inset ring-emerald-400/25 p-4">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <CheckCircle2 size={20} className="text-emerald-300 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-white">Échange validé avec {owner}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Le {formatDate(trade.validatedAt)} · {rule?.label ?? 'Règle libre'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={text} label="Copier le récapitulatif" toast="Récapitulatif copié" className="btn-secondary px-3 py-1.5" />
              <button onClick={onEdit} className="btn-secondary px-3 py-1.5">
                <Pencil size={14} />
                Modifier
              </button>
              <button onClick={cancel} className="btn-secondary px-3 py-1.5">
                <X size={14} />
                Annuler
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 tabular-nums">
            {[
              { label: 'tu donnes', value: plural(given.cards, 'carte') },
              { label: `${owner} te donne`, value: plural(received.cards, 'carte') },
              { label: 'points de rareté', value: `${formatPoints(given.points)} ↔ ${formatPoints(received.points)}` },
              { label: 'valeur', value: `${format(given.value)} ↔ ${format(received.value)}` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2">
                <div className="text-sm font-bold text-white leading-tight truncate">{s.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{s.label}</div>
              </div>
            ))}
          </div>
          <p className={`text-xs font-semibold mt-3 ${balance.even ? 'text-emerald-300' : 'text-amber-300'}`}>
            {describeBalance(trade.rule, balance, owner, format)}
          </p>
        </section>

        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <TradeColumn
            title={`Tu donnes à ${owner}`}
            subtitle="À sortir de tes fardes, dans l’ordre des pages : coche chaque carte trouvée."
            groups={giveGroups}
            done={pulledDone}
            total={pulledTotal}
            extra={
              pull.short.length > 0 && (
                <div className="mt-3 rounded-xl bg-amber-500/[0.06] ring-1 ring-inset ring-amber-400/20 p-3">
                  <p className="flex gap-2 text-xs text-amber-200 mb-1.5">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
                    Plus dans tes fardes depuis la validation :
                  </p>
                  <ul className="text-xs text-slate-300 space-y-0.5 pl-6 list-disc">
                    {pull.short.map((s) => (
                      <li key={`${s.card.id}-${s.foil}`}>
                        {s.missing}× {cardLang.fullName(s.card)}
                        {s.foil && ' (foil)'}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            }
          />
          <TradeColumn
            title={`${owner} te donne`}
            subtitle="Coche chaque carte reçue : sa place dans tes fardes est indiquée."
            groups={receiveGroups}
            done={inDone}
            total={received.cards}
          />
        </div>

        <div className="rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-4 flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-400 leading-relaxed flex-1 min-w-[14rem]">
            Une fois l’échange fait, Folio retire de tes fardes les cartes données et range les cartes reçues
            {homeless.length > 0 && ' (sauf celles sans farde de leur chapitre)'}.
          </p>
          <button onClick={() => setConfirm(true)} className="btn-primary px-3 py-2">
            <PackageCheck size={15} />
            Échange fait : mettre à jour mes fardes
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={complete}
        title="Mettre à jour tes fardes ?"
        message={`${plural(pulledTotal, 'carte')} quitteront tes fardes et ${plural(
          received.cards - homeless.reduce((s, r) => s + r.qty, 0),
          'carte'
        )} y seront rangées. Tu pourras annuler pendant quelques secondes.`}
        confirmLabel="Échange fait"
      />
    </div>
  );
};

export default ValidatedTrade;
