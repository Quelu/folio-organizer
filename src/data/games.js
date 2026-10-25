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

/**
 * Numbered Lorcana chapters. French names from disneylorcana.com/fr-FR; the list is refreshed
 * from Lorcast at runtime (see useLorcanaSets) so new chapters show up without a release.
 */
export const LORCANA_SETS = [
  { code: '1', name: 'The First Chapter', nameFr: 'Premier Chapitre' },
  { code: '2', name: 'Rise of the Floodborn', nameFr: "L'Ascension des Floodborn" },
  { code: '3', name: 'Into the Inklands', nameFr: "Les Terres d'Encres" },
  { code: '4', name: "Ursula's Return", nameFr: "Le Retour d'Ursula" },
  { code: '5', name: 'Shimmering Skies', nameFr: 'Ciel Scintillant' },
  { code: '6', name: 'Azurite Sea', nameFr: 'La Mer Azurite' },
  { code: '7', name: "Archazia's Island", nameFr: "L'Île d'Archazia" },
  { code: '8', name: 'Reign of Jafar', nameFr: 'Le Règne de Jafar' },
  { code: '9', name: 'Fabled', nameFr: 'Fabuleux' },
  { code: '10', name: 'Whispers in the Well', nameFr: 'Lueurs dans les Profondeurs' },
  { code: '11', name: 'Winterspell', nameFr: 'Givresort' },
  { code: '12', name: 'Wilds Unknown', nameFr: 'Contrées Inconnues' },
  { code: '13', name: 'Attack of the Vine!', nameFr: 'Invasion Épineuse' },
  { code: '14', name: 'Hyperia City', nameFr: 'Hyperia City' },
];

/** Lorcana rarities as Lorcast names them, from the most common to the rarest. */
export const LORCANA_RARITIES = [
  { key: 'Common', label: 'Commune' },
  { key: 'Uncommon', label: 'Peu commune' },
  { key: 'Rare', label: 'Rare' },
  { key: 'Super_rare', label: 'Super rare' },
  { key: 'Legendary', label: 'Légendaire' },
  { key: 'Epic', label: 'Épique' },
  { key: 'Enchanted', label: 'Enchantée' },
  { key: 'Iconic', label: 'Iconique' },
];

const FR_NAMES =Object.fromEntries(LORCANA_SETS.map((s) => [s.code, s.nameFr]));

// French names of chapters released after the list above, from LorcanaJSON (see CatalogProvider)
const laterFrenchNames = {};
export const addFrenchSetNames = (names) => Object.assign(laterFrenchNames, names);
const getFrenchName = (code) => FR_NAMES[code] ?? laterFrenchNames[code] ?? null;

/** Merges a fetched set list with the known French names. */
export const withFrenchNames = (sets) => sets.map((s) => ({ ...s, nameFr: getFrenchName(s.code) ?? s.nameFr ?? null }));

let knownSets = LORCANA_SETS;
export const setKnownLorcanaSets = (sets) => {
  knownSets = sets;
};

/** French name when known, English otherwise. */
export const getLorcanaSetName = (code) => {
  const set = knownSets.find((s) => s.code === code) ?? LORCANA_SETS.find((s) => s.code === code);
  return getFrenchName(code) ?? (set ? (set.nameFr ?? set.name) : null);
};

export const GRID_PRESETS = [
  { cols: 3, rows: 3, label: '3×3', hint: '9 poches · standard' },
  { cols: 4, rows: 3, label: '4×3', hint: '12 poches' },
  { cols: 4, rows: 4, label: '4×4', hint: '16 poches' },
  { cols: 2, rows: 2, label: '2×2', hint: '4 poches' },
];
