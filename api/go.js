// Vercel Serverless Function: /api/go
//
// Reads ?slug=<x> from the query string, logs the click to Supabase Cloud,
// fires a Telegram ping for the pre-approval slug only, then 302-redirects.
//
// Wired by vercel.json route: /go/(.*) → /api/go?slug=$1
//
// Env vars required: SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const DESTINATIONS = {
  "pre-approval":  "https://www.rocketmortgage.com/local-loan-officers/profile/31194",
  "call-tommy":    "tel:+15863154507",
  "ruuster-list":  "https://seehome.ai/zRfWP5",
  "ruuster-map":   "https://seehome.ai/oS1UgE",
  "ruuster-list-chippewa-valley": "https://seehome.ai/Mj1_7W",
  "ruuster-map-chippewa-valley":  "https://seehome.ai/yLhs4a",
  "homebot":       "https://tommythemortgageguy.com/rochester-community-schools-market-report#homebot_homeowner",
};

const REAL_TIME_PING_SLUGS = new Set(["pre-approval"]);

export default async function handler(req, res) {
  const slug = req.query?.slug || (new URL(req.url, `https://${req.headers.host}`).searchParams.get("slug"));

  const dest = DESTINATIONS[slug];
  if (!dest) {
    res.status(404).send("Not found");
    return;
  }

  // Build event row (best-effort; never block redirect on logging)
  const headers = req.headers;
  const referrerStr = headers.referer || headers.referrer || null;
  let pagePath = null;
  if (referrerStr) {
    try { pagePath = new URL(referrerStr).pathname; } catch { /* swallow */ }
  }
  const url = new URL(req.url, `https://${req.headers.host}`);
  const event = {
    event_type:   "redirect",
    slug:         slug,
    dest_url:     dest,
    page_path:    pagePath,
    referrer:     referrerStr,
    utm_source:   url.searchParams.get("utm_source"),
    utm_medium:   url.searchParams.get("utm_medium"),
    utm_campaign: url.searchParams.get("utm_campaign"),
    utm_term:     url.searchParams.get("utm_term"),
    utm_content:  url.searchParams.get("utm_content"),
    ip_country:   headers["x-vercel-ip-country"] || null,
    ip_region:    headers["x-vercel-ip-country-region"] || null,
    ip_city:      headers["x-vercel-ip-city"] || null,
    user_agent:   headers["user-agent"] || null,
    is_bot:       /bot|crawl|spider|preview/i.test(headers["user-agent"] || ""),
    is_mobile:    /mobile|android|iphone/i.test(headers["user-agent"] || ""),
  };

  const tasks = [logToSupabase(event)];
  if (REAL_TIME_PING_SLUGS.has(slug)) {
    tasks.push(sendTelegramPing(slug, event));
  }
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise((r) => setTimeout(r, 800)),
  ]);

  res.writeHead(302, { Location: dest });
  res.end();
}

async function logToSupabase(event) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/ttmg_events`, {
      method: "POST",
      headers: {
        "apikey":        key,
        "Authorization": `Bearer ${key}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify(event),
    });
  } catch (e) { /* swallow */ }
}

async function sendTelegramPing(slug, event) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const where = [event.ip_city, event.ip_region, event.ip_country]
    .filter(Boolean).join(", ") || "unknown location";
  const source = event.utm_source ? `[${event.utm_source}]` : "";
  const txt = `\u{1F3AF} *Pre-approval CTA clicked*\n` +
              `${source} from ${where}\n` +
              `Referrer: ${event.referrer || "direct"}\n` +
              `UA: ${(event.user_agent || "").slice(0, 60)}`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: txt,
        parse_mode: "Markdown",
      }),
    });
  } catch (e) { /* swallow */ }
}
