import { normalizeName } from './catalog.js';

/**
 * Collection file a player sends to another one to find trades: what they own, the surplus
 * copies they can give and the cards they look for, card ids being Lorcast printings ("12-42").
 * Names and rarities are only there for whoever opens the file, and to name cards a catalog
 * does not know yet.
 */
export const SHARE_TYPE = 'collection';
export const SHARE_VERSION = 1;

/**
 * @param {{ owner: string, scope: string, keep: number,
 *   owned: { card, normal, foil }[], haves: { card, foil, qty }[], wants: { card, qty, for }[] }} data
 */
export const buildCollectionShare = ({ owner, scope, keep, owned, haves, wants }) => ({
  app: 'folio',
  type: SHARE_TYPE,
  version: SHARE_VERSION,
  owner,
  scope,
  keep,
  exportedAt: new Date().toISOString(),
  cards: owned.map(({ card, normal, foil }) => ({ id: card.id, normal, foil })),
  haves: haves.map(({ card, foil, qty }) => ({ id: card.id, name: card.fullName, rarity: card.rarity, foil, qty })),
  wants: wants.map((w) => ({ id: w.card.id, name: w.card.fullName, rarity: w.card.rarity, qty: w.qty, for: w.for })),
});

export const isCollectionShare = (data) => data?.app === 'folio' && data?.type === SHARE_TYPE;

const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Checks a parsed collection file and keeps its known fields, or returns null.
 * @returns {{ owner, scope, keep, exportedAt, cards, haves, wants } | null}
 */
export const parseCollectionShare = (data) => {
  if (!isCollectionShare(data) || !Array.isArray(data.haves) || !Array.isArray(data.wants)) return null;
  const valid = (e) => typeof e?.id === 'string';
  return {
    owner: String(data.owner ?? '').trim().slice(0, 40) || 'Joueur',
    scope: String(data.scope ?? ''),
    keep: count(data.keep) || 1,
    exportedAt: data.exportedAt ?? null,
    cards: (data.cards ?? []).filter(valid).map((c) => ({ id: c.id, normal: count(c.normal), foil: count(c.foil) })),
    haves: data.haves
      .filter(valid)
      .map((h) => ({ id: h.id, name: h.name ?? null, foil: Boolean(h.foil), qty: count(h.qty) }))
      .filter((h) => h.qty > 0),
    wants: data.wants
      .filter(valid)
      .map((w) => ({ id: w.id, name: w.name ?? null, qty: count(w.qty), for: w.for === 'deck' ? 'deck' : 'binder' }))
      .filter((w) => w.qty > 0),
  };
};

/** Reads a collection file picked or dropped by the user. Resolves to null when it is not one. */
export const readCollectionShare = async (file) => {
  try {
    return parseCollectionShare(JSON.parse(await file.text()));
  } catch {
    return null;
  }
};

/**
 * Catalog cards of a stored collection file.
 * @returns {{ haves: { id, key, card, foil, qty }[], wants: object[], owned: { copies: number, cards: number },
 *   unknown: number }} unknown: cards the catalog does not know (chapter not loaded yet)
 */
export const resolveShare = (share, index) => {
  let unknown = 0;
  const resolve = (entries, fn) =>
    entries.flatMap((e) => {
      const card = index.byId.get(e.id);
      if (!card) {
        unknown++;
        return [];
      }
      return [fn(e, card)];
    });
  return {
    haves: resolve(share.haves, (h, card) => ({
      id: `${card.id}${h.foil ? '-foil' : ''}`,
      key: card.key,
      card,
      foil: h.foil,
      qty: h.qty,
    })),
    wants: resolve(share.wants, (w, card) => ({ id: card.id, key: card.key, card, qty: w.qty, for: w.for })),
    owned: {
      cards: share.cards.length,
      copies: share.cards.reduce((s, c) => s + c.normal + c.foil, 0),
    },
    unknown,
  };
};

const slug = (s) =>
  normalizeName(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const getShareFilename = (owner) =>
  `folio-collection${owner ? `-${slug(owner)}` : ''}-${new Date().toISOString().slice(0, 10)}.json`;
