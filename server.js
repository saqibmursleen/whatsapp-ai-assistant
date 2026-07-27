import "dotenv/config";
import express from "express";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { generateReply, providerInfo } from "./ai.js";
import { loadBusinesses, getBusiness, listBusinesses, getBusinessByPhoneNumberId } from "./businesses.js";
import { sendWhatsAppText } from "./whatsapp.js";
import { demoGuard } from "./demo-guard.js";

const app = express();
const PORT = process.env.PORT || 3010;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.set("trust proxy", true); // needed so demoGuard sees the real visitor IP through the tunnel
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

loadBusinesses();

// ---- Conversation memory (in-memory for the demo; swap for a DB in production) ----
const conversations = new Map(); // key: `${businessId}:${sessionId}` -> [{role, content}]
const HISTORY_LIMIT = 20;

function getHistory(businessId, sessionId) {
  const key = `${businessId}:${sessionId}`;
  if (!conversations.has(key)) conversations.set(key, []);
  return conversations.get(key);
}

async function handleIncomingMessage(business, sessionId, text) {
  const history = getHistory(business.id, sessionId);
  history.push({ role: "user", content: text });
  while (history.length > HISTORY_LIMIT) history.shift();

  const { reply, handoff } = await generateReply(business, history);
  history.push({ role: "assistant", content: reply });

  if (handoff) {
    // In production: notify staff (dashboard, WhatsApp group, email) and pause the bot for this chat.
    console.log(`[HANDOFF] ${business.name} / ${sessionId} needs a human.`);
  }
  return { reply, handoff };
}

// ---- Demo chat API (used by the local WhatsApp-style demo page) ----
app.get("/api/businesses", (_req, res) => {
  res.json({ businesses: listBusinesses(), ai: providerInfo() });
});

app.post("/api/chat", demoGuard, async (req, res) => {
  const { businessId, sessionId, message } = req.body || {};
  const business = getBusiness(businessId);
  if (!business) return res.status(404).json({ error: "Unknown business" });
  if (!sessionId || !message?.trim()) return res.status(400).json({ error: "sessionId and message are required" });

  try {
    const result = await handleIncomingMessage(business, sessionId, message.trim());
    res.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "AI request failed", detail: String(err.message || err) });
  }
});

// ---- WhatsApp Cloud API webhook (goes live once a Meta app + number are connected) ----

// Meta verifies the webhook with a GET challenge on setup.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming customer messages arrive here as POSTs.
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Ack immediately; Meta retries if we're slow.
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const business = getBusinessByPhoneNumberId(value.metadata?.phone_number_id);
    if (!business) {
      console.warn("Webhook message for unknown phone_number_id:", value.metadata?.phone_number_id);
      return;
    }

    const from = message.from; // customer's phone number = session id
    const { reply } = await handleIncomingMessage(business, from, message.text.body);
    await sendWhatsAppText(business.whatsapp.phoneNumberId, from, reply);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

app.listen(PORT, () => {
  const ai = providerInfo();
  console.log(`WhatsApp AI bot running at http://localhost:${PORT}`);

  // Print the address a phone on the same Wi-Fi (or this laptop's hotspot) can open.
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal && !name.toLowerCase().includes("vmware")) {
        console.log(`  On your phone (same Wi-Fi): http://${a.address}:${PORT}`);
      }
    }
  }

  console.log(`AI provider: ${ai.provider} (${ai.model})`);
  console.log(
    ai.configured
      ? "API key: found"
      : `API key: MISSING - add ${ai.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} to .env and restart`,
  );
});
