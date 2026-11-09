// Reads photo, title and price from a product link. Only works for a signed-in owner.
const SB = "https://skudwfggpnbjsoymwlmm.supabase.co";
const KEY = "sb_publishable_s7JKIJuHZFrqQC9YDCpytw_8Iqwy_jI";
const bad = h => /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.(local|internal)$/i.test(h);
const dec = s => s && s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const meta = (h, k) => {
  const m = h.match(new RegExp("<meta[^>]+(?:property|name|itemprop)=[\"']" + k + "[\"'][^>]*>", "i"));
  const c = m && m[0].match(/content=["']([^"']*)["']/i);
  return c && dec(c[1]);
};
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const tok = (req.headers.authorization || "").replace(/^Bearer /, "");
    const me = tok && await fetch(SB + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + tok } });
    if (!me || !me.ok) return res.status(401).json({ error: "Not signed in" });
    const url = new URL(req.query.url);
    if (!/^https?:$/.test(url.protocol) || bad(url.hostname)) return res.status(400).json({ error: "Bad link" });
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "Accept-Language": "en,de;q=0.8", Accept: "text/html" },
      signal: AbortSignal.timeout(8000), redirect: "follow"
    });
    const h = (await r.text()).slice(0, 600000);
    const ld = h.match(/"price"\s*:\s*"?([\d.,]+)/), lc = h.match(/"priceCurrency"\s*:\s*"(\w{3})"/);
    let price = meta(h, "product:price:amount") || meta(h, "og:price:amount") || meta(h, "price") || (ld && ld[1]);
    const cur = meta(h, "product:price:currency") || meta(h, "og:price:currency") || meta(h, "priceCurrency") || (lc && lc[1]) || "";
    if (price) {
      if (/^\d+\.\d{1,2}$/.test(price)) price = price.replace(".", ",");
      price += cur ? " " + (cur === "EUR" ? "€" : cur) : "";
    }
    const t = h.match(/<title[^>]*>([^<]*)<\/title>/i);
    let image = meta(h, "og:image") || meta(h, "twitter:image");
    if (image) { try { image = new URL(image, url).href } catch (e) { image = "" } }
    res.json({ title: meta(h, "og:title") || (t && dec(t[1])) || "", image: image || "", price: price || "" });
  } catch (e) {
    res.status(500).json({ error: "Could not read page" });
  }
};
