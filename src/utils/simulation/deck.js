import { abilityCount, compileAbilities } from './abilities.js';

/**
 * A deck as the simulation plays it: one entry per card with its stats, keywords and the
 * abilities the engine knows (from cardAbilities.json), the copies to shuffle, what the engine
 * leaves out, and the deck's style. Pure functions (no browser APIs), so the MCP server can share
 * them.
 */

// Keyword lines the engine plays
const PLAYED_KEYWORD = /^(Evasive|Bodyguard|Rush|Ward|Reckless|Support|Alert|Vanish|Resist \+\d+|Challenger \+\d+|Singer \d+|Sing Together \d+|Boost \d+)\b/;
const SHIFT_LINE = /^(?:[A-Z][\w-]* )*Shift(?::| \d+)/;
// Any keyword line, played or not: the abilities in cardAbilities.json are the other lines
const KEYWORD_LINE = /^(?:Evasive|Bodyguard|Rush|Ward|Reckless|Support|Alert|Vanish|Resist|Challenger|Singer|Sing Together|Boost|(?:[A-Z][\w-]* )*Shift)\b/;

// A card's worth for each ability it keeps using while in play (lore)
const ABILITY_WORTH = 0.4;

const keywordValue = (text, name) => {
  const m = text.match(new RegExp(`^${name} \\+?(\\d+)`, 'm'));
  return m ? parseInt(m[1], 10) : 0;
};

const hasKeyword = (text, name) => new RegExp(`^${name}\\b`, 'm').test(text);

const kindOf = (card) => {
  if (card.types.includes('Character')) return 'character';
  if (card.types.includes('Location')) return 'location';
  return card.types.includes('Item') ? 'item' : 'action';
};

const keywordsOf = (text) => ({
  Evasive: +hasKeyword(text, 'Evasive'),
  Bodyguard: +hasKeyword(text, 'Bodyguard'),
  Rush: +hasKeyword(text, 'Rush'),
  Ward: +hasKeyword(text, 'Ward'),
  Reckless: +hasKeyword(text, 'Reckless'),
  Support: +hasKeyword(text, 'Support'),
  Alert: +hasKeyword(text, 'Alert'),
  Vanish: +hasKeyword(text, 'Vanish'),
  Resist: keywordValue(text, 'Resist'),
  Challenger: keywordValue(text, 'Challenger'),
  Singer: keywordValue(text, 'Singer'),
  // Boost: its ink cost
  Boost: keywordValue(text, 'Boost'),
});

// Reminder texts and the choices of a modal ability belong to the line before
const ruleLines = (card) =>
  (card.text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('(') && !l.startsWith('-'));

/** Key of a card in cardAbilities.json: the catalog key with straight apostrophes. */
const abilityKey = (key) => key.replace(/’/g, "'");

/**
 * What the engine leaves out of a card: uncovered is 'action' or 'item' (none of its effects
 * are known: it goes to the inkwell), 'ability' (a character or location whose abilities are
 * unknown: its stats and keywords are played), 'partial' (some abilities or keywords are left
 * out, named in unsupported) or null.
 */
const coverageOf = (card, kind, shift, compiled, noBase) => {
  const lines = ruleLines(card);
  // Shift is played onto a base of the deck; with no base in the deck, it never comes up
  const played = (line) => PLAYED_KEYWORD.test(line) || (SHIFT_LINE.test(line) && (shift?.cost != null || noBase));
  const missingKeywords = lines.filter((l) => KEYWORD_LINE.test(l) && !played(l)).map((l) => l.match(KEYWORD_LINE)[0]);
  const hasAbilities = lines.some((l) => !KEYWORD_LINE.test(l));
  const unsupported = [...missingKeywords, ...(compiled?.unsupported ?? [])];
  if (hasAbilities && !compiled) return { uncovered: kind === 'action' || kind === 'item' ? kind : 'ability', unsupported };
  if (kind === 'action' && !compiled?.action) return { uncovered: 'action', unsupported };
  if (kind === 'item' && compiled && !abilityCount(compiled)) return { uncovered: 'item', unsupported };
  return { uncovered: unsupported.length ? 'partial' : null, unsupported };
};

/**
 * @param {{ entries: object[], profile: object }} analysis a deck analysis (analyzeDeck)
 * @param {Function} nameOf card => name shown in the results and the game logs
 * @param {Object<string, object[]>|null} abilities the cards of cardAbilities.json (null: not
 *   loaded, only stats and keywords are played)
 * @returns {{ cards: object[], copies: number[], coverage: { total: number, played: number,
 *   ignored: { index: number, qty: number, reason: string, unsupported: string[] }[] } }}
 *   cards[i]: { key, name, title, cost, inkwell, kind, song, singTogether, strength, willpower,
 *   lore, classifications, inks, moveCost, keywords, shift: { cost, bases: key[] } | null,
 *   abilities, worth, hereWorth, uncovered, unsupported }; copies: one card index per copy
 */
export const prepareSimDeck = (analysis, nameOf, abilities = null) => {
  const shiftsByKey = new Map(
    (analysis.profile?.shifts ?? [])
      .filter((s) => s.shift.cost != null && s.bases.length)
      .map((s) => [s.entry.key, { cost: s.shift.cost, bases: s.bases.map((b) => b.key) }])
  );
  const noBase = new Set((analysis.profile?.shifts ?? []).filter((s) => s.shift.cost != null && !s.bases.length).map((s) => s.entry.key));
  const known = analysis.entries.filter((e) => e.card && e.qty > 0);
  const cards = known.map(({ key, card }) => {
    const text = card.text ?? '';
    const kind = kindOf(card);
    const shift = shiftsByKey.get(key) ?? null;
    const raw = abilities?.[abilityKey(key)];
    const compiled = raw ? compileAbilities(raw) : null;
    const playTriggers = compiled?.triggered.play?.filter((a) => a.trigger.on === 'SELF').length ?? 0;
    // A location's abilities for the characters at it: worth moving there
    const hereAbilities = Object.values(compiled?.triggered ?? {}).flat().filter((a) => a.trigger.on === 'CHARACTERS_HERE').length;
    return {
      key,
      name: nameOf(card),
      // The English name, as abilities name the cards they look for
      title: card.name,
      cost: card.cost,
      inkwell: card.inkwell,
      kind,
      song: card.types.includes('Song'),
      singTogether: keywordValue(text, 'Sing Together'),
      strength: card.strength ?? 0,
      willpower: card.willpower ?? 0,
      lore: card.lore ?? 0,
      classifications: card.classifications ?? [],
      inks: card.inks ?? [],
      moveCost: card.moveCost ?? null,
      keywords: keywordsOf(text),
      shift,
      abilities: compiled,
      worth: ABILITY_WORTH * (abilityCount(compiled) - playTriggers),
      hereWorth: ABILITY_WORTH * hereAbilities,
      ...coverageOf(card, kind, shift, compiled, noBase.has(key)),
    };
  });
  const copies = known.flatMap((e, i) => Array.from({ length: e.qty }, () => i));
  const ignored = known
    .map((e, index) => ({ index, qty: e.qty, reason: cards[index].uncovered, unsupported: cards[index].unsupported }))
    .filter((x) => x.reason);
  return {
    cards,
    copies,
    coverage: { total: copies.length, played: copies.length - ignored.reduce((s, x) => s + x.qty, 0), ignored },
  };
};

// Removal read from the rules texts: tells the style
const REMOVAL = /\b(?:banish|return) chosen (?:opposing )?(?:character|item|location)|\bdeal \d+ damage to (?:chosen|each)|\bbanish all\b/i;

/**
 * Style a deck plays by: 'aggro' (cheap, quests fast), 'control' (removal or a high curve) or
 * 'midrange', with the figures it was told from.
 * @returns {{ style: string, avgCost: number, cheapShare: number, removal: number }}
 */
export const detectStyle = (analysis) => {
  const known = analysis.entries.filter((e) => e.card && e.qty > 0);
  const total = known.reduce((s, e) => s + e.qty, 0) || 1;
  const avgCost = known.reduce((s, e) => s + e.card.cost * e.qty, 0) / total;
  const cheapShare = known.filter((e) => e.card.cost <= 2).reduce((s, e) => s + e.qty, 0) / total;
  const removal = known.filter((e) => REMOVAL.test(e.card.text ?? '')).reduce((s, e) => s + e.qty, 0);
  let style = 'midrange';
  if (avgCost <= 3 && cheapShare >= 0.3) style = 'aggro';
  else if (removal >= 8 || avgCost >= 3.8) style = 'control';
  return { style, avgCost, cheapShare, removal };
};
