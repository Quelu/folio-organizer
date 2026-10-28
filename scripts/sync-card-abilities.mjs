#!/usr/bin/env node
/**
 * The rules of every Lorcana card as data, for the simulation (src/utils/simulation): taken from
 * Lorcanito (github.com/TheCardGoat/tcg-engines, MIT), whose card definitions describe each
 * ability as a trigger, a condition, targets and effects. Writes src/data/cardAbilities.json,
 * keyed like the catalog (card.key): only the cards with abilities beyond their keywords.
 *
 * Usage: node scripts/sync-card-abilities.mjs [commit]   (default: the commit below)
 * Needs git and a network connection; the cards are bundled with rolldown (from Vite).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const REPO = 'https://github.com/TheCardGoat/tcg-engines.git';
const COMMIT = process.argv[2] ?? '6de59de1c203827edc1bc6faa1bc6184cd126a5f';
const CARDS_DIR = 'submodules/lorcana/packages/lorcana/lorcana-cards/src';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/data/cardAbilities.json');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

// Only the card definitions are checked out
const checkout = join(tmpdir(), `folio-lorcanito-${COMMIT.slice(0, 12)}`);
if (!existsSync(join(checkout, CARDS_DIR))) {
  mkdirSync(checkout, { recursive: true });
  git(checkout, 'init', '--quiet');
  git(checkout, 'remote', 'add', 'origin', REPO);
  git(checkout, 'sparse-checkout', 'set', CARDS_DIR);
  git(checkout, 'fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', COMMIT);
  git(checkout, 'checkout', '--quiet', 'FETCH_HEAD');
}

// The definitions are TypeScript modules: bundled into one file, then imported
const tsconfig = join(checkout, 'tsconfig.folio.json');
writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler' } }));
const bundle = join(checkout, 'catalog-data.mjs');
await build({
  input: join(checkout, CARDS_DIR, 'cards/catalog-data.ts'),
  platform: 'node',
  tsconfig,
  logLevel: 'warn',
  output: { file: bundle, format: 'esm', codeSplitting: false },
});
const { allCards } = await import(pathToFileURL(bundle).href);

// Same key as the catalog: "name - version" in lower case, straight apostrophes
const keyOf = (card) => (card.version ? `${card.name} - ${card.version}` : card.name).toLowerCase().replace(/’/g, "'");
// What the engine does not read: ids, the printed text, translations
const slim = ({ id: _id, text: _text, i18n: _i18n, ...ability }) => ability;

const cards = {};
for (const card of allCards) {
  const abilities = (card?.abilities ?? []).filter((a) => a.type !== 'keyword').map(slim);
  if (abilities.length) cards[keyOf(card)] = abilities;
}
const sorted = Object.fromEntries(Object.entries(cards).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify({ source: `TheCardGoat/tcg-engines@${COMMIT}`, cards: sorted })}\n`);
console.log(`${Object.keys(sorted).length} cards with abilities → ${OUT}`);
