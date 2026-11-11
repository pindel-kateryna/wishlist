(function (root) {
  function extractProductLink(value) {
    const text = String(value ?? '').trim();
    const candidates = text.match(/(?:https?:\/\/|www\.)[^\s<>"“”]+/gi) || [];
    for (let candidate of candidates) {
      candidate = candidate.replace(/&amp;/gi, '&').replace(/[.,!?;:'»”]+$/, '');
      // Sharing text often wraps links in parentheses; preserve balanced URL parentheses.
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        while (candidate.endsWith(close) && candidate.split(close).length > candidate.split(open).length) candidate = candidate.slice(0, -1);
      }
      try {
        const url = new URL(/^www\./i.test(candidate) ? 'https://' + candidate : candidate);
        if (/^https?:$/.test(url.protocol) && url.hostname && !url.username && !url.password) return url.href;
      } catch { /* Try the next link in the shared text. */ }
    }
    return '';
  }

  function priceAmount(value) {
    let number = String(value ?? '').trim().replace(/\s/g, '');
    if (!/^\d+(?:[.,]\d+)*$/.test(number)) return null;
    const comma = number.lastIndexOf(','), dot = number.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? ',' : '.';
      number = number.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
    } else if (comma >= 0 || dot >= 0) {
      const separator = comma >= 0 ? ',' : '.';
      // Three-digit groups are thousands; one/two trailing digits are decimals.
      if (new RegExp('^\\d{1,3}(?:\\' + separator + '\\d{3})+$').test(number)) number = number.split(separator).join('');
      else if (number.split(separator).length === 2 && number.split(separator)[1].length <= 2) number = number.replace(separator, '.');
      else return null;
    }
    const amount = Number(number);
    return Number.isFinite(amount) ? amount : null;
  }

  function euroAmount(value) {
    return priceAmount(String(value ?? '').replace(/€|\bEUR\b/gi, '').trim());
  }

  function formatPrice(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const amount = euroAmount(text);
    if (amount === null) return text; // Preserve explicitly entered other currencies and notes.
    return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' €';
  }

  const utils = { extractProductLink, priceAmount, euroAmount, formatPrice };
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  else root.WishlistUtils = utils;
})(typeof globalThis !== 'undefined' ? globalThis : this);
