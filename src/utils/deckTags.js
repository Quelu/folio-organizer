import { normalizeName } from './catalog.js';

/**
 * Tags the user puts on decks to sort them ("Préconstruit", "Compétitif", "À tester"…).
 * The tags are a list of the state { id, name, color }, in the user's order; a deck keeps the ids
 * of its tags in deck.tags (missing on decks saved before tags existed).
 */

export const TAG_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#f87171', '#94a3b8'];

/** Color of a new tag: the first one no tag uses yet, else the palette again. */
export const nextTagColor = (tags) => TAG_COLORS.find((c) => !tags.some((t) => t.color === c)) ?? TAG_COLORS[tags.length % TAG_COLORS.length];

/** The tag of that name, whatever its case and accents, so the same tag is not created twice. */
export const findTagByName = (tags, name) => tags.find((t) => normalizeName(t.name) === normalizeName(name)) ?? null;

/** Tags whose name contains the query, whatever its case and accents. */
export const searchTags = (tags, query) => tags.filter((t) => normalizeName(t.name).includes(normalizeName(query)));

/** A deck's tags, in the order of the tag list. */
export const getDeckTags = (deck, tags) => tags.filter((t) => deck.tags?.includes(t.id));

/** Whether a deck has the selected tags: one of them, or all of them with matchAll. No selection keeps every deck. */
export const matchesTags = (deck, tagIds, matchAll = false) =>
  tagIds.length === 0 || (matchAll ? tagIds.every((id) => deck.tags?.includes(id)) : tagIds.some((id) => deck.tags?.includes(id)));
