const { extractProduct } = require('../lib/product');
const { dmProductUrl, extractDmProduct } = require('../lib/dm');
const { fetchPage, validateUrl } = require('../lib/fetch-page');
const SB = 'https://skudwfggpnbjsoymwlmm.supabase.co';
const KEY = 'sb_publishable_s7JKIJuHZFrqQC9YDCpytw_8Iqwy_jI';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const signal = AbortSignal.timeout(12000);
  try {
    const token = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return res.status(401).json({ error: 'Please sign in again' });
    const me = await fetch(SB + '/auth/v1/user', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + token }, signal
    });
    if (!me.ok) return res.status(401).json({ error: 'Please sign in again' });
    if (typeof req.query.url !== 'string') return res.status(400).json({ error: 'Add a product link' });
    validateUrl(req.query.url);
    const dmUrl = dmProductUrl(req.query.url);
    if (dmUrl) {
      try {
        const page = await fetchPage(dmUrl, signal, 0, 'json');
        const product = extractDmProduct(JSON.parse(page.html));
        if (product.title && product.image) return res.json(product);
      } catch (error) {
        if (signal.aborted) throw error;
        // Fall back to standard metadata if the shop changes its public API.
      }
    }
    const page = await fetchPage(req.query.url, signal);
    return res.json(extractProduct(page.html, page.url));
  } catch (error) {
    const timeout = signal.aborted;
    return res.status(timeout ? 504 : error.status || 502).json({
      error: timeout ? 'The shop took too long to respond. Add details manually.' :
        error.status ? error.message : 'Could not read this page. You can add details and a photo manually.'
    });
  }
};
