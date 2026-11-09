const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const zlib = require('node:zlib');

// Resolve and pin a public IPv4 address for each request, including redirects.
// IPv6 literals are rejected; dual-stack domains can still use their public IPv4.
function isPublicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)));
}
function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid product link'), { status: 400 }); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      /(^localhost$|\.(local|internal)$)/i.test(url.hostname) ||
      (net.isIP(url.hostname) && !isPublicIPv4(url.hostname)) || url.hostname.includes(':')) {
    throw Object.assign(new Error('Only public HTTP or HTTPS links are supported'), { status: 400 });
  }
  return url;
}
async function fetchPage(value, signal, redirects = 0, format = 'html') {
  const url = validateUrl(value);
  const records = await dns.lookup(url.hostname, { family: 4, all: true });
  signal.throwIfAborted();
  if (!records.length || records.some(record => !isPublicIPv4(record.address))) {
    throw Object.assign(new Error('This address is not supported'), { status: 400 });
  }
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal,
      // Do not reuse a connection or resolve the host again after validation.
      agent: false,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [records[0]]) : callback(null, records[0].address, 4),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Wishlist/1.0)',
        Accept: format === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
        'Accept-Language': 'uk,en;q=0.9,de;q=0.8',
        'Accept-Encoding': 'identity'
      }
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location || redirects >= 4) return reject(new Error('Too many redirects'));
        let destination;
        try { destination = new URL(response.headers.location, url).href; } catch (error) { return reject(error); }
        resolve(fetchPage(destination, signal, redirects + 1, format));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        return reject(Object.assign(new Error('The shop could not be read. You can add details manually.'), { status: 422 }));
      }
      if (!(format === 'json' ? /^application\/json\b/i : /^(text\/html|application\/xhtml\+xml)\b/i).test(response.headers['content-type'] || '')) {
        response.resume();
        return reject(Object.assign(new Error('The link did not return readable product data'), { status: 422 }));
      }
      const chunks = [];
      let size = 0;
      const encoding = response.headers['content-encoding'];
      const body = encoding === 'gzip' || encoding === 'deflate' ? response.pipe(zlib.createUnzip()) :
        encoding === 'br' ? response.pipe(zlib.createBrotliDecompress()) : response;
      body.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) {
          body.destroy();response.destroy();
          reject(Object.assign(new Error('The product page is too large. Add details manually.'), { status: 422 }));
        } else chunks.push(chunk);
      });
      response.on('error', reject);
      body.on('error', reject);
      body.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), url: url.href }));
    });
    request.on('error', reject);
  });
}
module.exports = { fetchPage, validateUrl, isPublicIPv4 };
