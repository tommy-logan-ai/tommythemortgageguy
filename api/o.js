// Vercel Serverless Function: /o/<token>.gif  (vercel.json route: /o/(.*) -> /api/o.js?t=$1)
//
// Boosters email-open pixel (ISA boosters_open_pixel, 2026-11-03). Returns a 1x1 transparent GIF, never cached,
// and records an "email_open" event in Supabase Cloud ttmg_events with slug = token (same table and pattern as
// api/pv.js / api/go.js). Best-effort: logging never delays or breaks the image. Tokens map to messages on the Studio.
//
// Env vars required: SUPABASE_URL, SUPABASE_KEY

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const raw = req.query?.t || url.searchParams.get("t") || "";
  const token = String(raw).replace(/\.gif$/i, "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  const h = req.headers;
  const clean = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
  const ua = h["user-agent"] || "";
  const event = {
    event_type: "email_open",
    slug:       token || null,
    dest_url:   null,
    page_path:  `/o/${token}`,
    referrer:   clean(h.referer || h.referrer, 500),
    ip_country: h["x-vercel-ip-country"] || null,
    ip_region:  h["x-vercel-ip-country-region"] || null,
    ip_city:    h["x-vercel-ip-city"] || null,
    user_agent: clean(ua, 400),
    is_bot:     /bot|crawl|spider|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense/i.test(ua),
    is_mobile:  /mobile|android|iphone/i.test(ua),
  };
  const log = (async () => {
    try {
      const su = process.env.SUPABASE_URL, sk = process.env.SUPABASE_KEY;
      if (token && su && sk) {
        await fetch(`${su}/rest/v1/ttmg_events`, {
          method: "POST",
          headers: { "apikey": sk, "Authorization": `Bearer ${sk}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(event),
        });
      }
    } catch (e) { /* swallow: the pixel must always render */ }
  })();
  await Promise.race([log, new Promise((r) => setTimeout(r, 1500))]);
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", String(GIF.length));
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.status(200).end(GIF);
}
