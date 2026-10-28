import { okCondition, okEffect, okHandStatic, okStaticEffect, okTrigger } from './effects.js';

/**
 * A card's abilities sorted for the engine: triggered by event, static, activated, and the
 * effect of an action. An ability the engine does not fully know is left out and named in
 * unsupported, so the deck's coverage tells how far a result can be trusted.
 * Pure functions, so the MCP server can share them.
 */

const ABILITY_KEYS = {
  triggered: ['type', 'name', 'text', 'id', 'trigger', 'effect', 'condition', 'sourceZones', 'autoResolve'],
  static: ['type', 'name', 'effect', 'condition', 'sourceZones'],
  activated: ['type', 'name', 'text', 'id', 'cost', 'effect', 'condition', 'restrictions', 'usesPerTurn'],
  action: ['type', 'name', 'effect', 'condition'],
};

const COST_KEYS = new Set(['exert', 'ink', 'banishSelf', 'discardCards', 'discardChosen', 'banishCharacter']);

/**
 * The events a trigger listens to: event and events together. "banish" already covers the
 * banishes in a challenge: "banish-in-challenge", which watches the banisher, would fire twice.
 */
export const triggerEvents = (trigger) => {
  const events = new Set([trigger.event, ...(trigger.events ?? [])].filter(Boolean));
  if (events.has('banish')) events.delete('banish-in-challenge');
  return [...events];
};

// A static ability that works from the hand: the card's own cost
const isHandStatic = (a) => a.type === 'static' && a.sourceZones?.length === 1 && a.sourceZones[0] === 'hand';

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
      return (a.sourceZones ?? ['play']).every((z) => z === 'play') && okStaticEffect(a.effect);
    case 'activated':
      return (
        Object.keys(a.cost ?? {}).every((k) => COST_KEYS.has(k)) &&
        (a.restrictions ?? []).every((r) => r.type === 'once-per-turn' || (r.type === 'during-turn' && r.whose === 'your')) &&
        (a.cost?.discardChosen == null || a.cost.discardChosen === true) &&
        (a.usesPerTurn == null || a.usesPerTurn === 1) &&
        okEffect(a.effect)
      );
    case 'action':
      return okEffect(a.effect);
    default:
      return false;
  }
};

/**
 * @param {object[]} raw the abilities of a card in cardAbilities.json
 * @returns {{ triggered: Object<string, object[]>, statics: object[], handStatics: object[],
 *   activated: object[], action: object|null, unsupported: string[] }} handStatics: what the card
 *   saves on its own cost from the hand; action: one ability for all the effects of an action
 *   card; unsupported: the names of the abilities left out
 */
export const compileAbilities = (raw) => {
  const out = { triggered: {}, statics: [], handStatics: [], activated: [], action: null, unsupported: [] };
  const actions = [];
  for (const ability of raw) {
    if (!isSupported(ability)) {
      out.unsupported.push(ability.name ?? (ability.type === 'action' ? 'effet' : ability.type));
      continue;
    }
    if (ability.type === 'triggered') {
      for (const event of triggerEvents(ability.trigger)) (out.triggered[event] ??= []).push(ability);
    } else if (isHandStatic(ability)) out.handStatics.push(ability);
    else if (ability.type === 'static') out.statics.push(ability);
    else if (ability.type === 'activated') out.activated.push(ability);
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
  compiled ? Object.values(compiled.triggered).reduce((s, list) => s + list.length, 0) + compiled.statics.length + compiled.activated.length : 0;
