const GRAPH_API = "https://graph.facebook.com/v21.0";

/**
 * Send a text message via the WhatsApp Cloud API.
 * Requires WHATSAPP_TOKEN in .env and the business's phoneNumberId.
 */
export async function sendWhatsAppText(phoneNumberId, to, text) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN is not set in .env");

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${body}`);
  }
  return res.json();
}
