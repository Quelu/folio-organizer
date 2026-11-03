/**
 * Corrections to cardAbilities.json, by card key: where Lorcanito's description of a card leaves
 * out part of its text, writes a condition in plain words, or puts its steps in an order the
 * engine cannot follow. Applied when a deck is prepared (deck.js), so a new sync keeps them: a
 * fix replaces the abilities it names, the others stay as synced.
 * Pure functions, so the MCP server can share them.
 */

const CHOSEN_CHARACTER_OF_YOURS = { selector: 'chosen', count: 1, owner: 'you', zones: ['play'], cardTypes: ['character'] };

const nameOf = (a) => a.name ?? (a.type === 'action' ? 'effet' : a.type);

/** Leaves out abilities that are not printed on the card (Lorcanito's combos with other cards). */
const drop = (names) => (abilities) => abilities.filter((a) => !names.includes(nameOf(a)));

/** Replaces the abilities named in fixed (by name; an action's effect: 'effet'), adds the new ones. */
const replace = (fixed) => (abilities) => {
  const kept = abilities.filter((a) => !fixed.some((f) => nameOf(f) === nameOf(a)));
  return [...kept, ...fixed];
};

const FIXES = {
  // "Draw cards equal to the damage on chosen character of yours, then banish them": the character first
  'dinner bell': replace([
    {
      type: 'activated',
      name: 'YOU KNOW WHAT HAPPENS',
      cost: { exert: true, ink: 2 },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'select-target', target: CHOSEN_CHARACTER_OF_YOURS },
          { type: 'draw', amount: { type: 'target-attribute', attribute: 'damage' }, target: 'CONTROLLER' },
          { type: 'banish', target: { ref: 'previous-target' } },
        ],
      },
    },
  ]),
  // "If you have a character or location in play with a card under them"
  'lena sabrewing - mysterious duck': replace([
    {
      type: 'triggered',
      name: 'ARCANE CONNECTION',
      trigger: { event: 'play', on: 'SELF', timing: 'when' },
      condition: {
        type: 'target-query',
        query: { selector: 'all', owner: 'you', zones: ['play'], cardTypes: ['character', 'location'], filters: [{ type: 'cards-under', comparison: 'gte', value: 1 }] },
        comparison: { operator: 'gte', value: 1 },
      },
      effect: { type: 'gain-lore', amount: 1, target: 'CONTROLLER' },
    },
  ]),
  // "If you've played a character with cost 5 or more this turn"
  'ichabod crane - bookish schoolmaster': replace([
    {
      type: 'triggered',
      name: 'WELL-READ',
      trigger: { event: 'quest', on: 'SELF', timing: 'whenever' },
      condition: { type: 'turn-metric', metric: 'played-cards', filters: [{ cardType: 'character', minCost: 5 }], comparison: { operator: 'gte', value: 1 } },
      effect: { type: 'put-into-inkwell', source: 'top-of-deck', target: 'CONTROLLER', exerted: true, facedown: true },
    },
  ]),
  // "Play an action with cost 5 or less from your discard for free, then put that action card on the bottom of your deck"
  'lady tremaine - sinister socialite': replace([
    {
      type: 'triggered',
      name: 'EXPEDIENT SCHEMES',
      trigger: { event: 'quest', on: 'SELF', timing: 'whenever' },
      condition: { type: 'put-card-under-self-this-turn' },
      effect: {
        type: 'optional',
        chooser: 'CONTROLLER',
        effect: {
          type: 'play-card',
          from: 'discard',
          cardType: 'action',
          cost: 'free',
          costRestriction: { comparison: 'less-or-equal', value: 5 },
          afterPlay: 'bottom-of-deck',
        },
      },
    },
  ]),
  // "At the end of your turn, if an opponent has 0 lore, you gain 1 lore"
  'scrooge mcduck - ebenezer scrooge': replace([
    {
      type: 'triggered',
      name: 'FORECLOSURE',
      trigger: { event: 'end-turn', on: 'YOU', timing: 'at' },
      condition: { type: 'resource-count', what: 'lore', controller: 'opponent', comparison: 'equal', value: 0 },
      effect: { type: 'gain-lore', amount: 1, target: 'CONTROLLER' },
    },
  ]),
  // "Each player may put up to 5 cards from their discard into their inkwell": both players, not only the opponent
  'kida - crystal scion': replace([
    {
      type: 'triggered',
      name: 'FLOOD OF POWER',
      trigger: { event: 'play', on: 'SELF', timing: 'when' },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'put-into-inkwell', source: { selector: 'chosen', count: { upTo: 5 }, owner: 'you', zones: ['discard'] }, target: 'CONTROLLER', exerted: true, facedown: true },
          {
            type: 'put-into-inkwell',
            source: { selector: 'chosen', count: { upTo: 5 }, owner: 'opponent', zones: ['discard'] },
            target: 'OPPONENT',
            chosenBy: 'opponent',
            exerted: true,
            facedown: true,
          },
        ],
      },
    },
  ]),
  // "Chosen character gets +{S} equal to their {W} this turn": their own {W}
  'ranger team-up': replace([
    {
      type: 'action',
      effect: {
        type: 'sequence',
        steps: [
          { type: 'select-target', target: 'CHOSEN_CHARACTER' },
          { type: 'modify-stat', stat: 'strength', duration: 'this-turn', target: { ref: 'previous-target' }, modifier: { type: 'willpower-of', target: { ref: 'previous-target' } } },
        ],
      },
    },
  ]),
  // "Whenever one of your actions deals damage to an opposing character": the opposing character takes it
  'merida - formidable archer': replace([
    {
      type: 'triggered',
      name: 'STEADY AIM',
      trigger: { event: 'damage', on: { controller: 'opponent', cardType: 'character' }, timing: 'whenever', sourceFilter: { cardType: ['action'], sourceController: 'you' } },
      effect: { type: 'deal-damage', amount: 2, target: { ref: 'trigger-subject' } },
    },
  ]),
  // "If you discarded a card this turn, this character gains Challenger +2 and can challenge ready characters this turn"
  'maximus - relentless stallion': replace([
    {
      type: 'static',
      name: 'NO ESCAPE',
      condition: { type: 'turn-metric', metric: 'cards-discarded-from-hand', ownerScope: 'you', comparison: { operator: 'gte', value: 1 } },
      effect: { type: 'gain-keyword', keyword: 'Challenger', value: 2, target: 'SELF' },
    },
    {
      type: 'static',
      name: 'NO ESCAPE (READY)',
      condition: { type: 'turn-metric', metric: 'cards-discarded-from-hand', ownerScope: 'you', comparison: { operator: 'gte', value: 1 } },
      effect: { type: 'grant-ability', ability: 'can-challenge-ready', target: 'SELF' },
    },
  ]),
  // "You can shift any character on top of this character": the deck profile finds its Shift cards
  'morph - little imitator': replace([{ type: 'static', name: 'ADVANCED MIMICRY', effect: { type: 'property-modification', property: 'shift-base', operation: 'any' } }]),

  'morph - space goo': replace([{ type: 'static', name: 'MIMICRY', effect: { type: 'property-modification', property: 'shift-base', operation: 'any' } }]),
  // "If you used Shift to play them"
  'bucky - squirrel squeak tutor': replace([
    {
      type: 'triggered',
      name: 'SQUEAK',
      trigger: { event: 'play', on: { controller: 'you', cardType: 'character', classification: 'Floodborn' }, timing: 'whenever' },
      condition: { type: 'play-context', context: 'used-shift' },
      effect: { type: 'discard', amount: 1, chosen: true, target: 'EACH_OPPONENT' },
    },
  ]),
  // "If an opponent has an item in play"
  'alistair krei - ambitious entrepreneur': replace([
    {
      type: 'triggered',
      name: 'AN EYE FOR TECH',
      trigger: { event: 'play', on: 'SELF', timing: 'when' },
      condition: { type: 'has-item-count', controller: 'opponent', comparison: 'greater-or-equal', count: 1 },
      effect: { type: 'gain-lore', amount: 1, target: 'CONTROLLER' },
    },
  ]),
  // "Your characters can't be challenged": the characters, not the player
  'restoring atlantis': replace([
    { type: 'action', effect: { type: 'restriction', restriction: 'cant-be-challenged', duration: 'until-start-of-next-turn', target: 'YOUR_CHARACTERS' } },
  ]),
  // The second FULL BREACH is a combo with another card, not printed on Monstro
  'monstro - infamous whale': drop(['FULL BREACH + COMBO']),
  'baymax - amped up': replace([{ type: 'replacement', name: 'Supercharge', replaces: 'gain-ink-drop', replacement: 'inkwell-top-card' }]),

  // ---------- Cards Lorcanito has no abilities for ----------

  // "You may have up to 99 copies in your deck": a deck rule, nothing to play
  'dalmatian puppy - tail wagger': () => [],
  'te ka - heartless': replace([
    {
      type: 'triggered',
      name: 'SEEK THE HEART',
      trigger: { event: 'banish-in-challenge', on: 'SELF', timing: 'whenever', restrictions: [{ type: 'during-turn', whose: 'your' }] },
      effect: { type: 'gain-lore', amount: 2, target: 'CONTROLLER' },
    },
  ]),
  'te ka - elemental terror': replace([
    {
      type: 'triggered',
      name: 'ANCIENT RAGE',
      trigger: { event: 'exert', on: 'OPPOSING_CHARACTERS', timing: 'whenever', restrictions: [{ type: 'during-turn', whose: 'your' }] },
      effect: { type: 'banish', target: { ref: 'trigger-subject' } },
    },
  ]),
  'russel - finding adventure': replace([
    {
      type: 'activated',
      name: 'HIDE AND SEEK',
      cost: { exert: true },
      effect: {
        type: 'scry',
        amount: 2,
        target: 'CONTROLLER',
        destinations: [
          { zone: 'hand', min: 0, max: 2, reveal: true, filter: { type: 'card-type', cardType: 'character' } },
          { zone: 'deck-bottom', remainder: true },
        ],
      },
    },
  ]),
  "mama imelda's blessing": replace([
    {
      type: 'activated',
      name: 'FAMILIAL DUTY',
      cost: { exert: true, ink: 1 },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'modify-stat', stat: 'strength', modifier: -1, duration: 'until-start-of-next-turn', target: 'CHOSEN_CHARACTER' },
          { type: 'restriction', restriction: 'cant-sing', duration: 'until-start-of-next-turn', target: { ref: 'previous-target' } },
        ],
      },
    },
  ]),
  'tia victoria - disapproving ancestor': replace([
    {
      type: 'triggered',
      name: 'WITHERING GLARE',
      trigger: { event: 'play', on: 'SELF', timing: 'when' },
      effect: { type: 'restriction', restriction: 'cant-ready-at-start-of-turn', duration: 'their-next-turn', target: 'CHOSEN_OPPOSING_CHARACTER' },
    },
  ]),
  'mama coco - visiting the park': replace([
    {
      type: 'triggered',
      name: 'DISTANT MEMORY',
      trigger: { event: 'mill', on: 'YOU', timing: 'whenever' },
      effect: { type: 'modify-stat', stat: 'lore', modifier: 1, duration: 'this-turn', target: 'SELF' },
    },
  ]),
  'mama imelda - no-nonsense ancestor': replace([
    {
      type: 'triggered',
      name: 'LET ME THROUGH',
      trigger: { event: 'play', on: 'SELF', timing: 'when' },
      effect: {
        type: 'choice',
        options: [
          { type: 'put-on-bottom', target: { selector: 'chosen', count: 3, owner: 'you', zones: ['discard'] } },
          { type: 'banish', target: 'SELF' },
        ],
      },
    },
  ]),
  "merlin's shop and smithy - magical markey": replace([
    {
      type: 'triggered',
      name: 'OPEN FOR BUSINESS',
      trigger: { event: 'move', on: 'CHARACTERS_HERE', timing: 'whenever', restrictions: [{ type: 'during-turn', whose: 'your' }, { type: 'once-per-turn' }] },
      effect: { type: 'sequence', steps: [{ type: 'draw', amount: 1, target: 'CONTROLLER' }, { type: 'gain-lore', amount: 1, target: 'CONTROLLER' }] },
    },
  ]),
  'hector rivera - worldwide sensation': replace(
    [
      { event: 'quest', name: 'BIG HIT', restrictions: [] },
      { event: 'sing', name: 'BIG HIT (SONG)', restrictions: [{ type: 'first-time-each-turn' }] },
    ].map(({ event, name, restrictions }) => ({
      type: 'triggered',
      name,
      trigger: { event, on: 'SELF', timing: 'whenever', restrictions },
      effect: {
        type: 'scry',
        amount: 3,
        target: 'CONTROLLER',
        destinations: [
          { zone: 'hand', min: 0, max: 1, reveal: true, filter: { type: 'is-song' } },
          { zone: 'discard', remainder: true },
        ],
      },
    }))
  ),
  'hector rivera - street musician': replace([
    {
      type: 'triggered',
      name: 'STRIKE A CHORD',
      trigger: { event: 'play', on: 'SELF', timing: 'when' },
      effect: { type: 'optional', chooser: 'CONTROLLER', effect: { type: 'mill', amount: 1, target: 'CONTROLLER' } },
    },
  ]),
  'hector rivera - gone to pieces': replace(
    [
      { name: 'FEEL THE MUSIC', effect: { type: 'modify-stat', stat: 'lore', modifier: 1, target: 'SELF' } },
      { name: 'FEEL THE MUSIC (EVASIVE)', effect: { type: 'gain-keyword', keyword: 'Evasive', target: 'SELF' } },
    ].map(({ name, effect }) => ({
      type: 'static',
      name,
      condition: { type: 'target-query', query: { selector: 'all', owner: 'you', zones: ['discard'], filters: [{ type: 'is-song' }] } },
      effect,
    }))
  ),
};

/** A card's abilities with its corrections (key: as in cardAbilities.json). */
export const fixAbilities = (key, raw) => (FIXES[key] ? FIXES[key](raw ?? []) : raw);
