const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const https = require('node:https');
const dns = require('node:dns').promises;
const zlib = require('node:zlib');
const handler = require('../api/product');
const { fetchPage } = require('../lib/fetch-page');

function response() {
  return { code: 200, headers: {}, setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this} };
}
function mockTransport(t, replies) {
  const calls = [];
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(https, 'get', (url, options, callback) => {
    calls.push({url: url.href,options});
    const request = new EventEmitter();
    process.nextTick(() => {
      const next = replies.shift();
      if (!next) return request.emit('error', new Error('Unexpected network request'));
      const stream = Readable.from([Buffer.from(next.body || '')]);
      stream.statusCode = next.status || 200;
      stream.headers = next.headers || { 'content-type': 'text/html' };
      callback(stream);
    });
    return request;
  });
  return calls;
}
test('API requires GET and a valid authenticated session', async t => {
  let r = response();await handler({method:'POST',headers:{}},r);assert.equal(r.code,405);
  r=response();await handler({method:'GET',headers:{},query:{url:'https://shop.example'}},r);assert.equal(r.code,401);
  t.mock.method(globalThis,'fetch',async()=>({ok:false}));
  r=response();await handler({method:'GET',headers:{authorization:'Bearer invalid'},query:{url:'https://shop.example'}},r);assert.equal(r.code,401);
});
test('API returns parsed product data and does not cache it', async t => {
  t.mock.method(globalThis,'fetch',async()=>({ok:true}));
  mockTransport(t,[{body:'<meta property="og:title" content="Cream"><meta property="og:image" content="/photo.jpg">'}]);
  const r=response();await handler({method:'GET',headers:{authorization:'Bearer valid'},query:{url:'https://shop.example/product'}},r);
  assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.image,'https://shop.example/photo.jpg');
});
test('rejects redirect to private IP before another request', async t => {
  const calls=mockTransport(t,[{status:302,headers:{location:'http://169.254.169.254/latest/meta-data/'}}]);
  await assert.rejects(fetchPage('https://shop.example',AbortSignal.timeout(1000)),{status:400});
  assert.equal(calls.length,1);
});
test('uses the final redirect URL to resolve image paths', async t => {
  mockTransport(t,[{status:302,headers:{location:'/new/product'}},{body:'<meta property="og:image" content="image.jpg">'}]);
  const page=await fetchPage('https://shop.example/old',AbortSignal.timeout(1000));
  assert.equal(page.url,'https://shop.example/new/product');
});
test('handles gzip product JSON and the dm adapter end to end', async t => {
  t.mock.method(globalThis,'fetch',async()=>({ok:true}));
  const data={brand:{name:'MAYBELLINE'},title:{headline:'Grippy'},images:[{src:'https://cdn.example/photo.jpg'}],metadata:{price:11.95,currency:'EUR'}};
  const calls=mockTransport(t,[{headers:{'content-type':'application/json','content-encoding':'gzip'},body:zlib.gzipSync(JSON.stringify(data))}]);
  const r=response();await handler({method:'GET',headers:{authorization:'Bearer valid'},query:{url:'https://www.dm.de/applink/p/d/3062664/primer'}},r);
  assert.equal(r.code,200);assert.equal(r.body.title,'MAYBELLINE Grippy');assert.equal(r.body.price,'11,95\u00a0€');
  assert.equal(calls[0].url,'https://products.dm.de/product/products/detail/DE/dan/3062664');
});
test('rejects private DNS answers before making an HTTP request', async t => {
  t.mock.method(dns,'lookup',async()=>[{address:'10.0.0.1',family:4}]);
  await assert.rejects(fetchPage('https://shop.example',AbortSignal.timeout(1000)),{status:400});
});
test('does not parse upstream error pages as products', async t => {
  mockTransport(t,[{status:403,body:'<title>Access denied</title>'}]);
  await assert.rejects(fetchPage('https://shop.example',AbortSignal.timeout(1000)),{status:422});
});
