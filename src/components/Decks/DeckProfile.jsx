import { ArrowUpFromLine, Music, Tags, Users, Link2 } from 'lucide-react';
import CardThumb from '../ui/CardThumb';
import { Panel } from '../Collection/CollectionParts';
import { useCardLang } from '../../hooks/useCardLang';
import { keywordLabel } from '../../utils/deckProfile';

const Empty = ({ children }) => <p className="text-sm text-slate-500">{children}</p>;

const Stat = ({ label, value, hint }) => (
  <div className="rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/5 px-3 py-2" title={hint}>
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-sm font-bold text-white tabular-nums">{value}</div>
  </div>
);

const formatAverage = (n) => (n == null ? '—' : n.toLocaleString('fr-BE', { maximumFractionDigits: 1 }));

/** "4 Elsa - Reine des neiges, 2 Elsa - Esprit de l'hiver" */
const listCopies = (entries, cardLang) => entries.map((e) => `${e.qty} ${cardLang.fullName(e.card, e.name)}`).join(', ');

const Row = ({ entry, children, warn }) => {
  const cardLang = useCardLang();
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
      <CardThumb card={entry.card} className="w-8 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 truncate">
          <b className="tabular-nums">{entry.qty}×</b> {cardLang.fullName(entry.card, entry.name)}
        </div>
        <div className={`text-[11px] truncate ${warn ? 'text-amber-300' : 'text-slate-500'}`}>{children}</div>
      </div>
    </div>
  );
};

/** What a Shift card goes on: "sur Elsa", "sur un personnage Chiot", "sur n'importe quel personnage". */
const describeTarget = (shift, card, classLabel, cardLang) => {
  const names = cardLang.localize(card).name.split(' & ');
  switch (shift.kind) {
    case 'universal':
      return "sur n'importe quel personnage";
    case 'class':
      return `sur un personnage ${classLabel(shift.classification)}`;
    case 'item':
      return `sur un objet ${shift.names.join(' ou ')}`;
    case 'duo':
      return `sur ${names.join(' et ')} ensemble`;
    default:
      return `sur ${names.join(' ou ')}`;
  }
};

const ShiftPanel = ({ profile, lang }) => {
  const cardLang = useCardLang();
  const shiftLabel = keywordLabel('Shift', lang);
  const classLabel = (key) => profile.classifications.find((c) => c.key === key)?.label ?? key;
  return (
    <Panel
      icon={ArrowUpFromLine}
      title={lang === 'fr' ? 'Alter (Shift)' : 'Shift'}
      hint="Chaque carte avec Alter et les personnages du deck sur lesquels la poser."
    >
      {profile.shifts.length === 0 ? (
        <Empty>Aucune carte avec {shiftLabel} dans ce deck.</Empty>
      ) : (
        <div data-preview-group className="space-y-0.5 -mx-2">
          {profile.shifts.map(({ entry, shift, bases, baseCopies }) => (
            <Row key={entry.key} entry={entry} warn={baseCopies === 0}>
              <span title={baseCopies ? listCopies(bases, cardLang) : undefined}>
                {shiftLabel} {shift.cost != null ? `${shift.cost} ⬡` : '(défausse)'} {describeTarget(shift, entry.card, classLabel, cardLang)} ·{' '}
                {baseCopies ? `${baseCopies} base${baseCopies > 1 ? 's' : ''} : ${listCopies(bases, cardLang)}` : 'aucune base dans le deck'}
              </span>
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
};

const SongsPanel = ({ profile, lang }) => {
  const cardLang = useCardLang();
  return (
    <Panel
      icon={Music}
      title="Chansons"
      hint={`Les personnages du deck assez chers (ou ${keywordLabel('Singer', lang)}) pour chanter chaque chanson gratuitement.`}
    >
      {profile.songs.length === 0 ? (
        <Empty>Aucune chanson dans ce deck.</Empty>
      ) : (
        <div data-preview-group className="space-y-0.5 -mx-2">
          {profile.songs.map(({ entry, cost, together, singers, singerCopies }) => (
            <Row key={entry.key} entry={entry} warn={singerCopies === 0 && !together}>
              <span title={singerCopies ? listCopies(singers, cardLang) : undefined}>
                {together != null ? `${keywordLabel('Sing Together', lang)} ${together}` : `Coût ${cost} ou plus`} ·{' '}
                {singerCopies
                  ? `${singerCopies} chanteur${singerCopies > 1 ? 's' : ''} possible${singerCopies > 1 ? 's' : ''}`
                  : together != null
                    ? 'à chanter à plusieurs'
                    : 'personne ne peut la chanter'}
              </span>
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
};

const ClassificationsPanel = ({ profile }) => {
  const cardLang = useCardLang();
  return (
    <Panel
      icon={Tags}
      title="Classifications"
      hint="Copies de personnages par classification. Celles que les textes du deck réclament (« vos personnages Pirate ») sont mises en avant."
    >
      {profile.classifications.length === 0 ? (
        <Empty>Aucun personnage dans ce deck.</Empty>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {profile.classifications.map((c) => {
            const cited = c.citedBy.length > 0;
            const tone = !cited
              ? 'bg-white/[0.04] text-slate-300 ring-white/10'
              : c.copies
                ? 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/40'
                : 'bg-amber-500/10 text-amber-200 ring-amber-400/40';
            return (
              <span
                key={c.key}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ring-1 ring-inset ${tone}`}
                title={cited ? `Demandée par ${c.citedBy.map((e) => cardLang.fullName(e.card, e.name)).join(', ')}` : undefined}
              >
                {cited && <Link2 size={11} className="flex-shrink-0" />}
                {c.label}
                <b className="tabular-nums">{c.copies}</b>
              </span>
            );
          })}
        </div>
      )}
    </Panel>
  );
};

const CharactersPanel = ({ profile }) => {
  const { characters, keywords } = profile;
  return (
    <Panel icon={Users} title="Personnages" hint="Moyennes par copie de personnage, et mots-clés de toutes les cartes.">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Personnages" value={characters.copies} />
        <Stat label="Lore moyen" value={`${formatAverage(characters.lore)} ◊`} hint="Lore gagné par quête, en moyenne" />
        <Stat label="Force" value={formatAverage(characters.strength)} hint="Force moyenne" />
        <Stat label="Volonté" value={formatAverage(characters.willpower)} hint="Volonté moyenne" />
      </div>
      {keywords.length > 0 && (
        <div className="mt-4">
          <span className="label">Mots-clés</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {keywords.map((k) => (
              <span key={k.key} className="text-xs text-slate-300">
                <b className="text-white tabular-nums">{k.copies}</b> {k.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
};

/** Lorcana mechanics of a deck: Shift, songs, classifications and characters (analyzeDeck's profile). */
const DeckProfile = ({ analysis }) => {
  const { lang } = useCardLang();
  const { profile } = analysis;
  if (!profile) return <Empty>Chargement du catalogue…</Empty>;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <CharactersPanel profile={profile} />
      <ClassificationsPanel profile={profile} />
      <ShiftPanel profile={profile} lang={lang} />
      <SongsPanel profile={profile} lang={lang} />
    </div>
  );
};

export default DeckProfile;
