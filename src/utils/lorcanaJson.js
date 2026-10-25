/**
 * LorcanaJSON (lorcanajson.org): community card data taken from the official Disney Lorcana
 * app, in several languages, with the official card pictures, foil masks and Cardmarket ids.
 * Pure helpers, shared with the MCP server.
 */

export const LORCANAJSON_LANGUAGES = ['fr', 'en'];

/** Path of a language's card file, behind the dev / preview proxy (the site sends no CORS header). */
export const getLorcanaJsonPath = (lang) => `/lorcanajson/files/current/${lang}/allCards.json`;

/** Printed line breaks follow the card layout: rules read better as one line per ability. */
const unwrap = (text) => text?.replace(/\s*\n\s*/g, ' ').trim() || null;

/**
 * Keeps what Folio shows from a LorcanaJSON card, under the catalog's id ("12-42", "3-4a").
 * @returns {{ id, name, version, fullName, text, flavor, classifications, image, thumb, foilMask, cardmarketId }}
 */
export const slimLorcanaJsonCard = (c) => ({
  id: `${c.setCode}-${c.number}${c.variant ? c.variant.toLowerCase() : ''}`,
  name: c.name,
  version: c.version ?? null,
  fullName: c.fullName,
  text: (c.fullTextSections ?? []).map(unwrap).filter(Boolean).join('\n') || null,
  flavor: unwrap(c.flavorText),
  classifications: c.subtypes ?? [],
  image: c.images?.full ?? null,
  thumb: c.images?.thumbnail ?? null,
  foilMask: c.images?.foilMask ?? null,
  cardmarketId: c.externalLinks?.cardmarketId ?? null,
});

/**
 * Cards of the numbered chapters (the ones binders hold), by catalog id. Promos are left out:
 * they are filed under a chapter with their own numbering ("20/P1"), which would hide the
 * chapter's card 20.
 */
export const buildLocalizedCards = (data) =>
  Object.fromEntries(
    (data.cards ?? [])
      .filter((c) => /^\d+$/.test(c.setCode) && !c.promoGrouping)
      .map((c) => {
        const card = slimLorcanaJsonCard(c);
        return [card.id, card];
      })
  );
