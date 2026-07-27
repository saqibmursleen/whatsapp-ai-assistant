/**
 * Lightweight abuse protection for the public demo link.
 *
 * The demo tunnel is a real URL anyone can find and hammer. Without limits, a bot or a
 * curious stranger could burn through your OpenAI credit in minutes. This is NOT meant
 * for production multi-tenant traffic (use a DB-backed rate limiter + per-client billing
 * for that) - it's just enough to make a sales-demo link safe to hand out.
 */

const PER_IP_WINDOW_MS = 60_000;
const PER_IP_MAX_REQUESTS = 8; // ~1 message every 7.5s per visitor - plenty for a real conversation
const MAX_MESSAGE_LENGTH = 400;
const DAILY_GLOBAL_LIMIT = Number(process.env.DEMO_DAILY_MESSAGE_LIMIT || 150);

const ipHits = new Map(); // ip -> [timestamps]
let dayKey = todayKey();
let dailyCount = 0;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // resets at UTC midnight
}

function clientIp(req) {
  // behind cloudflared/ngrok the real visitor IP is the first entry in x-forwarded-for
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** Express middleware: caps per-visitor rate, message length, and a global daily budget. */
export function demoGuard(req, res, next) {
  const key = todayKey();
  if (key !== dayKey) {
    dayKey = key;
    dailyCount = 0;
  }

  if (dailyCount >= DAILY_GLOBAL_LIMIT) {
    return res.status(429).json({
      error: "Demo limit reached for today",
      reply: "This demo has reached its daily message limit. Please contact us directly, or try again tomorrow.",
      handoff: false,
    });
  }

  const message = req.body?.message;
  if (typeof message === "string" && message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
  }

  const ip = clientIp(req);
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < PER_IP_WINDOW_MS);
  if (hits.length >= PER_IP_MAX_REQUESTS) {
    return res.status(429).json({
      error: "Too many messages",
      reply: "You're sending messages a bit fast — please wait a few seconds and try again.",
      handoff: false,
    });
  }
  hits.push(now);
  ipHits.set(ip, hits);

  dailyCount += 1;
  next();
}
