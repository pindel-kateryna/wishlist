const decode = value => String(value ?? '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
  const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
}).trim();

function attributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
  }
  return attrs;
}

function httpUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function extractProduct(html, pageUrl) {
  const metadata = new Map();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (attrs.content && !metadata.has(key)) metadata.set(key, attrs.content);
  }
  const meta = (...keys) => keys.map(key => metadata.get(key)).find(Boolean) || '';
  const products = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if ([].concat(node['@type'] || []).some(type => /(^|[/#])Product(?:Group)?$/i.test(type))) products.push(node);
    Object.values(node).forEach(visit);
  };
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if ((attributes(script[1]).type || '').toLowerCase() !== 'application/ld+json') continue;
    try { visit(JSON.parse(script[2])); } catch { /* A malformed script must not hide other metadata. */ }
  }
  const product = products[0] || {};
  const offer = [].concat(product.offers || [])[0] || {};
  const pricing = [].concat(offer.priceSpecification || [])[0] || {};
  let price = offer.price ?? offer.lowPrice ?? pricing.price ?? meta('product:price:amount', 'og:price:amount', 'price');
  const currency = offer.priceCurrency || pricing.priceCurrency || meta('product:price:currency', 'og:price:currency', 'pricecurrency');
  price = decode(price);
  if (price) {
    if (/^\d+\.\d{1,2}$/.test(price)) price = price.replace('.', ',');
    if (currency) price += ' ' + (currency === 'EUR' ? '€' : currency);
  }
  const image = [].concat(product.image || [])[0];
  const imageValue = typeof image === 'string' ? image : image?.contentUrl || image?.url;
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return {
    title: decode(product.name || meta('og:title', 'twitter:title') || titleTag?.[1]),
    image: httpUrl(imageValue || meta('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src', 'image'), pageUrl),
    price
  };
}

module.exports = { extractProduct, httpUrl };
