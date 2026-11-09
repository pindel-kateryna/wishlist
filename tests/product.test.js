const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractProduct, httpUrl } = require('../lib/product');
const { validateUrl, isPublicIPv4 } = require('../lib/fetch-page');
const { dmProductUrl, extractDmProduct } = require('../lib/dm');

test('reads metadata regardless of attribute order, quote style and apostrophes', () => {
  assert.deepEqual(extractProduct(`<meta content="L'Oreal &amp; care" property="og:title"><meta content='/image.jpg?a=1&amp;b=2' property='og:image'><meta content=24.90 itemprop=price><meta itemprop=priceCurrency content=EUR>`, 'https://shop.example/product'), {
    title: "L'Oreal & care", image: 'https://shop.example/image.jpg?a=1&b=2', price: '24,90 €'
  });
});
test('reads a nested JSON-LD product with image objects and offer arrays', () => {
  const ld = { '@graph': [{ '@type': 'Product', name: 'Cream', image: [{ contentUrl: './cream.jpg' }], offers: [{ price: 0, priceCurrency: 'EUR' }] }] };
  assert.deepEqual(extractProduct(`<script type='application/ld+json'>${JSON.stringify(ld)}</script>`, 'https://shop.example/path/product'), {
    title: 'Cream', image: 'https://shop.example/path/cream.jpg', price: '0 €'
  });
});
test('ignores unrelated prices and malformed JSON-LD', () => {
  assert.deepEqual(extractProduct(`<script type="application/ld+json">invalid</script><script>{"price":123}</script><title>A &#x26; B</title>`, 'https://shop.example'), {
    title: 'A & B', image: '', price: ''
  });
});
test('reads aggregate offers and protocol-relative Twitter images', () => {
  const product = { '@type': ['Thing', 'https://schema.org/Product'], name: 'Shoes', offers: { lowPrice: '19.99', priceCurrency: 'USD' } };
  const result = extractProduct(`<script type="application/ld+json">${JSON.stringify(product)}</script><meta name=twitter:image content=//cdn.example/shoes.png>`, 'https://shop.example');
  assert.equal(result.price, '19,99 USD');assert.equal(result.image, 'https://cdn.example/shoes.png');
});
test('never invents an image URL when metadata is missing', () => {
  assert.equal(httpUrl('', 'https://shop.example/product'), '');
  assert.equal(httpUrl(undefined, 'https://shop.example/product'), '');
  assert.equal(httpUrl('javascript:alert(1)'), '');
  assert.equal(httpUrl('https://user:password@shop.example/photo'), '');
});
test('rejects private networks, unusual IP representations and unsafe schemes', () => {
  for (const url of ['file:///etc/passwd','ftp://shop.example','http://127.1','http://0x7f000001','http://10.1.1.1','http://192.168.1.1','http://169.254.169.254','http://172.16.0.1','http://[::1]','http://localhost','http://test.internal','https://shop.example:3000','https://a:b@shop.example']) {
    assert.throws(() => validateUrl(url), { status: 400 }, url);
  }
  assert.equal(validateUrl('https://shop.example/product').hostname, 'shop.example');
  assert.equal(isPublicIPv4('100.64.0.1'), false);
  assert.equal(isPublicIPv4('8.8.8.8'), true);
});
test('recognizes only supported dm hosts and exact product ID paths', () => {
  const expected = 'https://products.dm.de/product/products/detail/DE/dan/3062664';
  assert.equal(dmProductUrl('https://www.dm.de/applink/p/d/3062664/primer?appProductId=123'), expected);
  assert.equal(dmProductUrl('https://dm.de/p/d/3062664/primer'), expected);
  assert.equal(dmProductUrl('https://www.dm.de.evil.example/p/d/3062664/primer'), '');
  assert.equal(dmProductUrl('https://www.dm.de/p/d/3062664evil/primer'), '');
});
test('maps dm public product data to the existing response contract', () => {
  assert.deepEqual(extractDmProduct({brand:{name:'MAYBELLINE NEW YORK'},title:{headline:'Primer Serum Grippy, 30 ml'},metadata:{price:11.95,currency:'EUR'},images:[{src:'https://products.dm-static.com/primer.jpg'}]}), {
    title:'MAYBELLINE NEW YORK Primer Serum Grippy, 30 ml',image:'https://products.dm-static.com/primer.jpg',price:'11,95\u00a0€'
  });
});
