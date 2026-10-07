export const GAMES = {
  lorcana: {
    label: 'Lorcana',
    fullLabel: 'Disney Lorcana',
    dot: 'bg-sky-400',
    badge: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/25',
    pocket: 'from-sky-950/80 to-slate-900/60 text-sky-200',
    defaultSetSize: 204,
  },
  pokemon: {
    label: 'Pokémon',
    fullLabel: 'Pokémon TCG',
    dot: 'bg-amber-400',
    badge: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/25',
    pocket: 'from-amber-950/70 to-slate-900/60 text-amber-200',
    defaultSetSize: null,
  },
  magic: {
    label: 'Magic',
    fullLabel: 'Magic: The Gathering',
    dot: 'bg-fuchsia-400',
    badge: 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/25',
    pocket: 'from-fuchsia-950/70 to-slate-900/60 text-fuchsia-200',
    defaultSetSize: null,
  },
  other: {
    label: 'Autre',
    fullLabel: 'Autre',
    dot: 'bg-slate-400',
    badge: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-400/25',
    pocket: 'from-slate-800/70 to-slate-900/60 text-slate-300',
    defaultSetSize: null,
  },
};

export const getGame = (gameType) => GAMES[gameType] ?? GAMES.other;

export const LORCANA_SETS = [
  { code: '1', name: 'The First Chapter' },
  { code: '2', name: 'Rise of the Floodborn' },
  { code: '3', name: 'Into the Inklands' },
  { code: '4', name: "Ursula's Return" },
  { code: '5', name: 'Shimmering Skies' },
  { code: '6', name: 'Azurite Sea' },
  { code: '7', name: "Archazia's Island" },
  { code: '8', name: 'Reign of Jafar' },
  { code: '9', name: 'Fabled' },
  { code: '10', name: 'Whispers in the Well' },
  { code: '11', name: 'Winterspell' },
  { code: '12', name: 'Wilds Unknown' },
];

export const getLorcanaSetName = (code) => LORCANA_SETS.find((s) => s.code === code)?.name ?? null;

export const GRID_PRESETS = [
  { cols: 3, rows: 3, label: '3×3', hint: '9 poches · standard' },
  { cols: 4, rows: 3, label: '4×3', hint: '12 poches' },
  { cols: 4, rows: 4, label: '4×4', hint: '16 poches' },
  { cols: 2, rows: 2, label: '2×2', hint: '4 poches' },
];
