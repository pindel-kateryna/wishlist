const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractProductLink, formatPrice, euroAmount } = require('../client-utils');

test('extracts a URL from app sharing text, including multiple lines', () => {
  assert.equal(extractProductLink('Gerade bei dm entdeckt: Primer Serum Grippy\nhttps://www.dm.de/applink/p/d/3062664/primer?utm_source=dm&appProductId=3062664\nJetzt ansehen!'), 'https://www.dm.de/applink/p/d/3062664/primer?utm_source=dm&appProductId=3062664');
  assert.equal(extractProductLink('Рекомендую цей товар: (https://shop.example/item?variant=1278132).'), 'https://shop.example/item?variant=1278132');
});
test('preserves encoded queries and balanced URL parentheses', () => {
  assert.equal(extractProductLink('https://shop.example/item_(pink)?a=1&amp;b=2'), 'https://shop.example/item_(pink)?a=1&b=2');
  assert.equal(extractProductLink('https://shop.example/item_(pink)'), 'https://shop.example/item_(pink)');
  assert.equal(extractProductLink('Сайт www.shop.example/item'), 'https://www.shop.example/item');
});
test('rejects missing, unsafe and credential-bearing links', () => {
  for (const text of ['', 'Just a product name', 'javascript:alert(1)', 'ftp://shop.example/item', 'https://user:secret@shop.example/item']) assert.equal(extractProductLink(text), '');
});
test('adds euro to numeric prices without duplicating currency', () => {
  for (const [value, expected] of [['10','10,00 €'],['9.95','9,95 €'],['9,95','9,95 €'],['9,95 €','9,95 €'],['EUR 9.95','9,95 €'],['0','0,00 €'],['','']]) assert.equal(formatPrice(value),expected);
});
test('handles thousands separators and keeps other currencies and notes', () => {
  for (const value of ['1.299,90 €','1,299.90 EUR','1 299,90','1\u00a0299,90']) assert.equal(formatPrice(value),'1.299,90 €');
  assert.equal(formatPrice('1.299'),'1.299,00 €');
  assert.equal(formatPrice('19.99 USD'),'19.99 USD');
  assert.equal(formatPrice('ca. 20 €'),'ca. 20 €');
  assert.equal(euroAmount('19.99 USD'),null);
  assert.equal(euroAmount('1.299,90 €'),1299.9);
});
