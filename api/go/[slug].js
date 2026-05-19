// Vercel Edge Function: /api/go/[slug]
//
// Resolves slug → destination URL, logs the click to Supabase Cloud (ttmg_events table),
// fires a real-time Telegram ping for the pre-approval slug only,
// then 302-redirects the visitor.
//
// File path in repo: /api/go/[slug].js
// Runtime: Edge (fast, low-latency, runs at Vercel's nearest POP)
//
// Required Vercel environment variables (set via dashboard or `vercel env add`):
//   SUPABASE_URL        e.g. https://xxxx.supabase.co
//   SUPABASE_KEY        the service_role key (NOT the anon key)
//   TELEGRAM_BOT_TOKEN  the bot token Logan uses
//   TELEGRAM_CHAT_ID    Tommy's Telegram chat id

export const config = { runtime: "edge" };

// Slug → destination URL. Source of truth for where each /go/<slug> sends.
const DESTINATIONS = {
  "pre-approval":  "https://www.rocketmortgage.com/local-loan-officers/profile/31194",
  "call-tommy":    "tel:+15863154507",
  "ruuster-list":  "https://seehome.ai/zRfWP5",
  "ruuster-map":   "https://seehome.ai/oS1UgE",
  "homebot":       "https://tommythemortgageguy.com/rochester-community-schools-market-report#homebot_homeowner",
};

// Slugs that trigger a real-time Telegram ping when clicked.
// Per Logan's recommendation: pre-approval only. The rest go to weekly digest.
const REAL_TIME_PING_SLUGS = new Set(["pre-approval"]);

export default async function handler(req) {
  const url = new URL(req.url);
  // Vercel routes /api/go/<slug> here; the slug comes via query param "slug"
  // when using the [slug].js convention, OR can be parsed from pathname.
  const segments = url.pathname.split("/").filter(Boolean);
  // /api/go/<slug>  → segments = ["api", "go", "<slug>"]
  // OR /go/<slug>   → segments = ["go", "<slug>"] (if rewritten in vercel.json)
  const slug = segments[segments.length - 1];

  const dest = DESTINATIONS[slug];
  if (!dest) {
    return new Response("Not found", { status: 404 });
  }

  // Build the event row. Best-effort, never block the redirect on logging.
  const headers = req.headers;
  const event = {
    event_type:    "redirect",
    slug:          slug,
    dest_url:      dest,
    page_path:     headers.get("referer")
                     ? new URL(headers.get("referer")).pathname
                     : null,
    referrer:      headers.get("referer"),
    utm_source:    url.searchParams.get("utm_source"),
    utm_medium:    url.searchParams.get("utm_medium"),
    utm_campaign:  url.searchParams.get("utm_campaign"),
    utm_term:      url.searchParams.get("utm_term"),
    utm_content:   url.searchParams.get("utm_content"),
    ip_country:    headers.get("x-vercel-ip-country"),
    ip_region:     headers.get("x-vercel-ip-country-region"),
    ip_city:       headers.get("x-vercel-ip-city"),
    user_agent:    headers.get("user-agent"),
    is_bot:        /bot|crawl|spider|preview/i.test(headers.get("user-agent") || ""),
    is_mobile:     /mobile|android|iphone/i.test(headers.get("user-agent") || ""),
  };

  // Fire-and-forget: log event + maybe send Telegram ping, then redirect.
  // Edge runtime supports waitUntil-style background work via ctx.waitUntil,
  // but a simple Promise.allSettled before redirect with a tight timeout
  // is reliable and adds <100ms in practice.
  const tasks = [logToSupabase(event)];
  if (REAL_TIME_PING_SLUGS.has(slug)) {
    tasks.push(sendTelegramPing(slug, event));
  }
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise((r) => setTimeout(r, 800)), // never block redirect more than 800ms
  ]);

  return Response.redirect(dest, 302);
}

async function logToSupabase(event) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return; // misconfigured env → never block redirect
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
  } catch (e) {
    // Swallow: redirect is the user's experience, logging is best-effort.
  }
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
