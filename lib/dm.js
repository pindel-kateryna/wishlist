const { httpUrl } = require('./product');

// dm app links return a JavaScript shell. Use the same public product endpoint
// as dm's product UI; keep this adapter isolated because the API can change.
function dmProductUrl(value) {
  const url = new URL(value);
  if (!['dm.de', 'www.dm.de'].includes(url.hostname)) return '';
  const id = url.pathname.match(/^\/(?:applink\/)?p\/d\/(\d{3,12})(?:\/|$)/)?.[1];
  return id ? `https://products.dm.de/product/products/detail/DE/dan/${id}` : '';
}
function extractDmProduct(data) {
  const structured = data.seoInformation?.structuredData || {};
  const name = data.title?.headline || structured.name || '';
  const brand = data.brand?.name || structured.brand || '';
  const amount = data.metadata?.price ?? structured.price;
  const currency = data.metadata?.currency || structured.priceCurrency;
  const price = typeof amount === 'number' && currency ? new Intl.NumberFormat('de-DE', {
    style: 'currency', currency
  }).format(amount) : '';
  return {
    title: [brand, name].filter(Boolean).join(' '),
    image: httpUrl(data.images?.[0]?.src || structured.image),
    price
  };
}
module.exports = { dmProductUrl, extractDmProduct };
