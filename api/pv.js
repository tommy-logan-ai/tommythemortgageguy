// Vercel Serverless Function: /api/pv
//
// Records a "page_view" event to Supabase Cloud ttmg_events. Called by a
// client-side beacon (fetch keepalive POST) on window load. No redirect, no
// key in the browser. Returns 204. Mirrors api/go.js's insert + bot pattern.
//
// Env vars required: SUPABASE_URL, SUPABASE_KEY
// NOTE: do NOT set ingested_at — leave it null so ttmg_analytics_ingester
// (polls WHERE ingested_at IS NULL) picks the row up. event_type is forced
// server-side; client input is never trusted for it.

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  let pagePath = typeof b.page_path === "string" ? b.page_path : null;
  if (!pagePath || pagePath[0] !== "/" || pagePath.length > 300) {
    res.status(204).end(); return;            // ignore malformed, never error the page
  }

  const h = req.headers;
  const clean = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

  const event = {
    event_type:   "page_view",                // forced; never from client
    slug:         null,
    dest_url:     null,
    page_path:    pagePath.slice(0, 300),
    referrer:     clean(b.referrer, 500),
    utm_source:   clean(b.utm_source, 120),
    utm_medium:   clean(b.utm_medium, 120),
    utm_campaign: clean(b.utm_campaign, 120),
    utm_term:     clean(b.utm_term, 120),
    utm_content:  clean(b.utm_content, 120),
    ip_country:   h["x-vercel-ip-country"] || null,
    ip_region:    h["x-vercel-ip-country-region"] || null,
    ip_city:      h["x-vercel-ip-city"] || null,
    user_agent:   clean(h["user-agent"], 400),
    is_bot:       /bot|crawl|spider|preview|facebookexternalhit|slurp|bingpreview|embed/i.test(h["user-agent"] || ""),
    is_mobile:    /mobile|android|iphone/i.test(h["user-agent"] || ""),
  };

  try {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
    if (url && key) {
      await fetch(`${url}/rest/v1/ttmg_events`, {
        method: "POST",
        headers: {
          "apikey": key, "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json", "Prefer": "return=minimal",
        },
        body: JSON.stringify(event),
      });
    }
  } catch (e) { /* swallow — never error the page */ }

  res.status(204).end();
}
