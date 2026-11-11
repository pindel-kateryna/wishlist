(function (root) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STORAGE_KEY = 'wl_reservations_v1';
  function receiptLink(origin, receipt) {
    const url = new URL('/', origin);
    url.searchParams.set('l', receipt.share_slug);
    url.hash = new URLSearchParams(receipt.receipt_key
      ? { reservation: receipt.item_id, key: receipt.receipt_key }
      : { item: receipt.item_id }).toString();
    return url.href;
  }
  function parseReceiptFragment(fragment) {
    const params = new URLSearchParams(String(fragment).replace(/^#/, ''));
    const itemId = params.get('reservation'), key = params.get('key');
    return UUID.test(itemId || '') && UUID.test(key || '') ? { itemId, key } : null;
  }
  function createStore(storage, origin) {
    let entries = [];
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) entries = saved.filter(e => e && UUID.test(e.item_id || '') && typeof e.share_slug === 'string');
    } catch { /* Keep this session usable when storage is unavailable. */ }
    function persist() {
      try { if (!storage) return false; storage.setItem(STORAGE_KEY, JSON.stringify(entries)); return true; }
      catch { return false; }
    }
    return {
      list(slug) { return entries.filter(e => !slug || e.share_slug === slug).map(e => ({ ...e, link: receiptLink(origin, e) })); },
      save(receipt) {
        if (!UUID.test(receipt.item_id || '') || typeof receipt.share_slug !== 'string') throw new Error('Invalid reservation receipt');
        const previous = entries.find(e => e.item_id === receipt.item_id);
        // Persist only the fields needed to return to this gift, never a guest name or browser token.
        const entry = { item_id: receipt.item_id, share_slug: receipt.share_slug, name: String(receipt.name || ''),
          price: String(receipt.price || ''), list_name: String(receipt.list_name || ''),
          receipt_key: UUID.test(receipt.receipt_key || '') ? receipt.receipt_key : previous?.receipt_key || null };
        entries = [entry, ...entries.filter(e => e.item_id !== entry.item_id)];
        return { ...entry, link: receiptLink(origin, entry), persisted: persist() };
      },
      remove(itemId) { entries = entries.filter(e => e.item_id !== itemId); return persist(); }
    };
  }
  function createService(client) {
    const busy = new Set();
    async function run(itemId, action) {
      if (busy.has(itemId)) throw new Error('This reservation is already being processed');
      busy.add(itemId);
      try { return await action(); } finally { busy.delete(itemId); }
    }
    return {
      reserve(itemId, token, reload) {
        return run(itemId, async () => {
          const { error } = await client.rpc('reserve_item', { p_item: itemId, p_name: 'Guest', p_token: token });
          if (error) throw error;
          const list = await reload();
          const item = list.items.find(i => i.id === itemId);
          if (!item?.reserved || !item.mine) throw new Error('Could not confirm the reservation. Refresh the list before trying again.');
          return item;
        });
      },
      cancel(itemId, token, key, reload) {
        return run(itemId, async () => {
          const { error } = await client.rpc(key ? 'cancel_reservation_receipt' : 'cancel_reservation',
            key ? { p_item: itemId, p_key: key } : { p_item: itemId, p_token: token });
          if (error) throw error;
          const list = await reload();
          const item = list.items.find(i => i.id === itemId);
          if (item?.reserved && item.mine) throw new Error('Could not confirm cancellation. Refresh to check the reservation.');
          return item;
        });
      }
    };
  }
  const api = { receiptLink, parseReceiptFragment, createStore, createService };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WishlistReservations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
