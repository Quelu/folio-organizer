/**
 * Cardmarket sales, kept in step between Folio and the user's Cardmarket stock.
 *
 * A listing (state.listings, keyed by pocket copy id, see getPocketCopyId) is
 * { qty, at, cardmarket?: { qty, price, syncedAt }, sold? }:
 * - qty: copies Folio puts on sale; 0 once taken off sale while still on Cardmarket;
 * - cardmarket.qty: copies on Cardmarket at the last sync, at cardmarket.price each;
 * - sold: copies sold on Cardmarket, still to take out of the binder.
 *
 * The MCP server (Claude, driving Cardmarket in Chrome) never writes the backup: it appends events
 * to a journal file next to it, which the app reads from the auto-backup folder and applies once
 * (events numbered by seq; the state keeps the last applied one). The server applies the pending
 * events to the backup it reads, so both sides see the same listings.
 */

/** The journal, in the backup folder. */
export const CARDMARKET_SYNC_FILE = 'folio-cardmarket-sync.json';

/**
 * What an event says happened on Cardmarket:
 * - listed: copies put on sale there, at price;
 * - removed: copies taken off sale there, as Folio asked;
 * - sold: copies sold there (an order);
 * - delisted: copies the user took off sale on Cardmarket themself: Folio stops selling them too.
 */
export const CARDMARKET_ACTIONS = ['listed', 'removed', 'sold', 'delisted'];

/** Copies still to sell: on sale in Folio, not sold yet. */
const toSell = (listing) => Math.max(0, listing.qty - (listing.sold ?? 0));

/**
 * Applies journal events to the listings, in seq order. Events on unknown listings are skipped
 * (the copies left the binder in the meantime).
 * @param {object} listings
 * @param {{ seq: number, at: number, listingId: string, action: string, qty: number, price?: number }[]} events
 * @returns {object} new listings
 */
export const applyCardmarketEvents = (listings, events) => {
  const next = { ...listings };
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!event.listingId) continue;
    const listing = next[event.listingId];
    if (!listing) continue;
    const online = listing.cardmarket?.qty ?? 0;
    const cardmarket = { ...listing.cardmarket, qty: online, syncedAt: event.at };
    let { qty } = listing;
    let sold = listing.sold ?? 0;
    switch (event.action) {
      case 'listed':
        cardmarket.qty = online + event.qty;
        if (event.price != null) cardmarket.price = event.price;
        break;
      case 'removed':
        cardmarket.qty = Math.max(0, online - event.qty);
        break;
      case 'sold':
        cardmarket.qty = Math.max(0, online - event.qty);
        sold += event.qty;
        break;
      case 'delisted':
        cardmarket.qty = Math.max(0, online - event.qty);
        qty = Math.max(sold, qty - event.qty);
        break;
      default:
        continue;
    }
    // Nothing left on sale, on Cardmarket or to take out: the listing is done
    if (qty === 0 && cardmarket.qty === 0 && sold === 0) delete next[event.listingId];
    else next[event.listingId] = { ...listing, qty, sold, cardmarket };
  }
  return next;
};

/**
 * What to do on Cardmarket so it matches Folio.
 * @returns {{ toList: { id, qty }[], toRemove: { id, qty }[], online: { id, qty, price }[], sold: { id, qty }[] }}
 *   online: copies Cardmarket should show, to check against the stock and the orders
 */
export const getCardmarketPlan = (listings) => {
  const plan = { toList: [], toRemove: [], online: [], sold: [] };
  for (const [id, listing] of Object.entries(listings)) {
    const online = listing.cardmarket?.qty ?? 0;
    const diff = toSell(listing) - online;
    if (diff > 0) plan.toList.push({ id, qty: diff });
    if (diff < 0) plan.toRemove.push({ id, qty: -diff });
    if (online > 0) plan.online.push({ id, qty: online, price: listing.cardmarket.price ?? null });
    if (listing.sold) plan.sold.push({ id, qty: listing.sold });
  }
  return plan;
};

/** Copies of a listing kept out of trades: on sale in Folio, or still on Cardmarket. */
export const getListedQty = (listing) => (listing ? Math.max(listing.qty, listing.cardmarket?.qty ?? 0) : 0);

/** Takes copies off sale in Folio: dropped when Cardmarket has none, else kept to remove them there. */
export const unlist = (listings, ids) => {
  const next = { ...listings };
  for (const id of ids) {
    const listing = next[id];
    if (!listing) continue;
    if ((listing.cardmarket?.qty ?? 0) > 0 || listing.sold) next[id] = { ...listing, qty: listing.sold ?? 0 };
    else delete next[id];
  }
  return next;
};

/**
 * Purchases: copies the user bought (on Cardmarket or elsewhere) and is waiting for, so the want
 * list stops asking for them. state.purchases is { [id]: { cardId, key, qty, at, status, orderId?, source } }:
 * status 'ordered' until the parcel arrives ('arrived', seen on Cardmarket), then the user puts
 * the copies in their pockets and the purchase is done.
 *
 * Journal events about purchases carry purchaseId instead of listingId:
 * - ordered: copies bought (cardId, key, qty, orderId);
 * - arrived: the order was received (Cardmarket shows it arrived);
 * - cancelled: the order was cancelled.
 */
export const PURCHASE_ACTIONS = ['ordered', 'arrived', 'cancelled'];

/** Applies the purchase events of the journal, in seq order. */
export const applyPurchaseEvents = (purchases, events) => {
  const next = { ...purchases };
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!event.purchaseId) continue;
    const purchase = next[event.purchaseId];
    if (event.action === 'ordered') {
      next[event.purchaseId] = {
        cardId: event.cardId,
        key: event.key,
        qty: (purchase?.qty ?? 0) + event.qty,
        at: event.at,
        status: 'ordered',
        orderId: event.orderId ?? null,
        source: 'cardmarket',
      };
    } else if (purchase && event.action === 'arrived') {
      next[event.purchaseId] = { ...purchase, status: 'arrived' };
    } else if (purchase && event.action === 'cancelled') {
      delete next[event.purchaseId];
    }
  }
  return next;
};
