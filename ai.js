import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const HANDOFF_TOKEN = "[HANDOFF]";

// Which AI service answers customer messages: "openai" or "anthropic".
const PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

let openaiClient = null;
let anthropicClient = null;

export function aiConfigured() {
  return PROVIDER === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY);
}

export function providerInfo() {
  return {
    provider: PROVIDER,
    model: PROVIDER === "openai" ? OPENAI_MODEL : CLAUDE_MODEL,
    configured: aiConfigured(),
  };
}

const TIMEZONE = process.env.BUSINESS_TIMEZONE || "Asia/Karachi";

/**
 * Current local time where the business is.
 * Goes at the END of the system prompt so the long, stable part above it stays cacheable.
 */
function currentTimeNote() {
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());

  return (
    `\n\nRIGHT NOW IT IS: ${now} (local time where the business is).\n` +
    `Use this to work out whether the business is currently open or closed. If a customer messages ` +
    `while you are closed, still answer their question fully and helpfully — then tell them naturally ` +
    `when the team will be back (e.g. "our team will get back to you when we open tomorrow at ..."). ` +
    `Never leave someone thinking they have been ignored. Do not state the time or date unless it is relevant.`
  );
}

/** The instructions that define how the assistant behaves for one business. */
function buildInstructions(business) {
  return (
    `You are the official WhatsApp assistant for "${business.name}" (${business.type}). ` +
    `You reply to customers on WhatsApp, so keep answers short and natural: 1-4 sentences, ` +
    `no headers, no bullet lists unless listing prices or options. ${business.language_note || "Reply in the customer's language."}\n\n` +
    `Rules:\n` +
    `- Answer ONLY from the business information below. Never invent prices, availability, discounts, or policies.\n` +
    `- Never deny that the business has something unless you can point to a sentence below that says so.\n` +
    `- Be warm and helpful. Greet back if greeted. Never mention that you are an AI unless asked directly; if asked, answer honestly.\n\n` +
    `HANDOFF RULE — read carefully, this matters:\n` +
    `Most messages need NO handoff. Handing off unnecessarily wastes staff time and is a failure.\n` +
    `Add the marker ${HANDOFF_TOKEN} at the very end of your reply ONLY when one of these is true:\n` +
    `  1. The customer is actually trying to book, reserve, pay, or cancel — not merely asking what something costs.\n` +
    `  2. The answer genuinely is not in the business information below.\n` +
    `  3. The customer explicitly asks for a human, or is complaining, upset, or reporting a problem.\n` +
    `  4. The customer asks about live availability for specific dates ("is a room free on Friday?").\n` +
    `Do NOT add ${HANDOFF_TOKEN} when you have fully answered from the business information. ` +
    `Examples that need NO marker: asking a price, asking check-in or check-out time, asking whether a facility exists ` +
    `(answering "no, we don't have that" IS a complete answer), asking about policies, asking the address or phone number, or greeting you.\n` +
    `When you do use it, ${HANDOFF_TOKEN} goes at the very end only, never mid-reply, and never inside a sentence.\n\n` +
    `CRITICAL — "not mentioned" is NOT the same as "not available".\n` +
    `When a customer asks whether the business has or offers something, first search the information below for it:\n` +
    `  - If the information says the business HAS it, say yes and give the details. No marker.\n` +
    `  - If the information says the business does NOT have it (including anything under a "do not have" ` +
    `or "do not offer" heading), say no plainly and confidently. No marker.\n` +
    `  - If the information does not mention it at all, you genuinely do not know. Do NOT guess "no" — ` +
    `guessing wrong loses the business a real customer. Reply "Let me confirm that with our staff and ` +
    `get right back to you." followed by ${HANDOFF_TOKEN}\n` +
    `Before writing any sentence that denies a service, find the words in the information that state it. ` +
    `If you cannot find them, hand off instead of denying.`
  );
}

async function replyWithOpenAI(business, history) {
  if (!openaiClient) openaiClient = new OpenAI();

  const completion = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: "system",
        content:
          `${buildInstructions(business)}\n\nBUSINESS INFORMATION:\n${business.info}` +
          currentTimeNote(),
      },
      ...history,
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "";
}

async function replyWithClaude(business, history) {
  if (!anthropicClient) anthropicClient = new Anthropic();

  const response = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: [
      { type: "text", text: buildInstructions(business) },
      {
        type: "text",
        text: `BUSINESS INFORMATION:\n${business.info}`,
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: currentTimeNote() },
    ],
    messages: history,
  });

  if (response.stop_reason === "refusal") return "";

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Generate a reply for a conversation.
 * history: [{role: "user"|"assistant", content: string}, ...] ending with the customer's latest message.
 * Returns {reply, handoff}.
 */
export async function generateReply(business, history) {
  if (!aiConfigured()) {
    const keyName = PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    return {
      reply: `(Demo not connected yet: add your ${keyName} to the .env file and restart the server.)`,
      handoff: false,
    };
  }

  let text =
    PROVIDER === "openai"
      ? await replyWithOpenAI(business, history)
      : await replyWithClaude(business, history);

  // Empty reply means the model declined or returned nothing — always hand to a human.
  if (!text) {
    return {
      reply: "Sorry, I can't help with that here. A staff member will follow up with you shortly.",
      handoff: true,
    };
  }

  const handoff = text.includes(HANDOFF_TOKEN);
  if (handoff) text = text.replaceAll(HANDOFF_TOKEN, "").trim();

  return { reply: text, handoff };
}
