import { okAlternative, okCondition, okEffect, okHandStatic, okReplacement, okStaticEffect, okTrigger } from './effects.js';

/**
 * A card's abilities sorted for the engine: triggered by event, static, activated, replacement
 * ("if this would happen, that happens instead"), alternative costs and the effect of an action.
 * An ability the engine does not fully know is left out and named in unsupported, so the deck's
 * coverage tells how far a result can be trusted.
 * Pure functions, so the MCP server can share them.
 */

const ABILITY_KEYS = {
  triggered: ['type', 'name', 'text', 'id', 'trigger', 'effect', 'condition', 'sourceZones', 'autoResolve'],
  static: ['type', 'name', 'effect', 'condition', 'sourceZones'],
  activated: ['type', 'name', 'text', 'id', 'cost', 'effect', 'condition', 'restrictions', 'usesPerTurn'],
  action: ['type', 'name', 'effect', 'condition', 'alternativeCost'],
  replacement: ['type', 'name', 'replaces', 'replacement', 'condition'],
};

// "You may put a Toy character card from your discard on the bottom of your deck to play this character for free"
const isAlternative = (a) => a.type === 'action' && typeof a.alternativeCost === 'string';

const COST_KEYS = new Set([
  'exert',
  'ink',
  'banishSelf',
  'discardCards',
  'discardChosen',
  'discardCardType',
  'banishCharacter',
  'banishCharacterTarget',
  'banishItem',
  'banishItemTarget',
  'exertCharacters',
  'exertCharactersClassification',
  'exertItems',
  'revealCards',
  'revealSameName',
]);

/**
 * The events a trigger listens to: event and events together. "banish" already covers the
 * banishes in a challenge: "banish-in-challenge", which watches the banisher, would fire twice.
 */
export const triggerEvents = (trigger) => {
  const events = new Set([trigger.event, ...(trigger.events ?? [])].filter(Boolean));
  if (events.has('banish')) events.delete('banish-in-challenge');
  return [...events];
};

// A static ability that works from the hand: the card's own cost, "you can't play this unless..."
const isHandStatic = (a) => a.type === 'static' && ((a.sourceZones?.length === 1 && a.sourceZones[0] === 'hand') || a.effect?.type === 'self-play-condition');

// A static ability with several effects ("can't challenge and must quest"): one static ability for each;
// with its effect under a condition ("while you have 10 or more cards in your inkwell"): the condition on the ability
const staticSteps = (a) => {
  const e = a.effect;
  if (e?.type === 'sequence') return (e.steps ?? e.effects ?? []).flatMap((effect) => staticSteps({ ...a, effect }));
  if (e?.type === 'conditional' && e.then && !e.else && e.condition) {
    return staticSteps({ ...a, condition: a.condition ? { type: 'and', conditions: [a.condition, e.condition] } : e.condition, effect: e.then });
  }
  return [a];
};

const knownKeys = (ability) => Object.keys(ability).every((k) => ABILITY_KEYS[ability.type].includes(k));

/** Whether the engine plays an ability as printed. */
export const isSupported = (a) => {
  if (!ABILITY_KEYS[a.type] || !knownKeys(a)) return false;
  if (a.condition && !okCondition(a.condition)) return false;
  switch (a.type) {
    case 'triggered': {
      // A card leaving play sets off its own "when banished" from the discard
      const zones = a.sourceZones ?? ['play'];
      if (!zones.every((z) => z === 'play' || z === 'discard')) return false;
      return okTrigger(a.trigger) && okEffect(a.effect);
    }
    case 'static':
      if (isHandStatic(a)) return okHandStatic(a.effect);
      return (a.sourceZones ?? ['play']).every((z) => z === 'play') && staticSteps(a).every((x) => okStaticEffect(x.effect));
    case 'activated':
      return (
        Object.keys(a.cost ?? {}).every((k) => COST_KEYS.has(k)) &&
        (a.restrictions ?? []).every((r) => r.type === 'once-per-turn' || (r.type === 'during-turn' && r.whose === 'your')) &&
        (a.cost?.discardChosen == null || a.cost.discardChosen === true) &&
        (a.usesPerTurn == null || a.usesPerTurn === 1) &&
        okEffect(a.effect)
      );
    case 'action':
      return isAlternative(a) ? okAlternative(a) : a.alternativeCost == null && okEffect(a.effect);
    case 'replacement':
      return okReplacement(a);
    default:
      return false;
  }
};

/**
 * @param {object[]} raw the abilities of a card in cardAbilities.json
 * @returns {{ triggered: Object<string, object[]>, statics: object[], handStatics: object[],
 *   activated: object[], replacements: object[], altCosts: object[], action: object|null,
 *   unsupported: string[] }} handStatics: what the card asks or saves on its own cost from the
 *   hand; altCosts: what may be paid instead of its ink (shift: to shift it); action: one ability
 *   for all the effects of an action card; unsupported: the names of the abilities left out
 */
export const compileAbilities = (raw) => {
  const out = { triggered: {}, statics: [], handStatics: [], activated: [], replacements: [], altCosts: [], action: null, unsupported: [] };
  const actions = [];
  for (const ability of raw) {
    if (!isSupported(ability)) {
      out.unsupported.push(ability.name ?? (ability.type === 'action' ? 'effet' : ability.type));
      continue;
    }
    if (ability.type === 'triggered') {
      for (const event of triggerEvents(ability.trigger)) (out.triggered[event] ??= []).push(ability);
    } else if (isHandStatic(ability)) out.handStatics.push(ability);
    else if (ability.type === 'static') out.statics.push(...staticSteps(ability));
    else if (ability.type === 'activated') out.activated.push(ability);
    else if (ability.type === 'replacement') out.replacements.push(ability);
    else if (isAlternative(ability)) out.altCosts.push({ ...ability, shift: ability.alternativeCost.includes('shift') });
    else actions.push(ability);
  }
  // An action's abilities resolve in printed order
  if (actions.length === 1) out.action = actions[0];
  else if (actions.length) {
    const steps = actions.map((a) => (a.condition ? { type: 'conditional', condition: a.condition, then: a.effect } : a.effect));
    out.action = { type: 'action', effect: { type: 'sequence', steps } };
  }
  return out;
};

/** How many abilities a card plays, beyond the effect of an action: they add to its worth. */
export const abilityCount = (compiled) =>
  compiled
    ? Object.values(compiled.triggered).reduce((s, list) => s + list.length, 0) + compiled.statics.length + compiled.activated.length + compiled.replacements.length
    : 0;
