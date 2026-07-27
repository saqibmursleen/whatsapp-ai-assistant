# WhatsApp AI Assistant (multi-business)

An AI assistant that answers customer WhatsApp messages instantly using each business's own
information (rooms, prices, policies, FAQs), and hands off to a human when it genuinely can't help.
Built to be sold as a service: one server runs many businesses; each client is just a JSON profile.

Read [CASE_STUDY.md](CASE_STUDY.md) for the why behind it and real conversations from the demo.
This file below is just the setup guide.

## Quick start (local demo)

1. Copy `.env.example` to `.env` and paste your OpenAI API key into `OPENAI_API_KEY`.
2. `npm install` (already done if you cloned with node_modules)
3. `npm start`
4. Open http://localhost:3010. A WhatsApp-style chat demo opens, ask about rooms, prices, booking.

## Switching AI provider

Set `AI_PROVIDER` in `.env` to `openai` (default) or `anthropic`, and fill in that provider's key.
The bot's behaviour, handoff logic, and WhatsApp wiring don't change either way.
Model per provider: `OPENAI_MODEL` (default `gpt-4o-mini`) or `CLAUDE_MODEL`.

## Adding a client business

Copy `businesses/sunrise-hotel.json`, change `id`, `name`, `type`, and rewrite `info` with the
client's real details (services, prices, timings, policies, contact). Restart the server.
The demo page picks up a dropdown entry for each business automatically, so build a client's demo
before the sales meeting and let the owner text it live.

## Sharing a public demo link

`demo-guard.js` protects `/api/chat` when it's exposed to the internet: max 8 messages/minute per
visitor, 400-char message cap, and a global daily message limit (`DEMO_DAILY_MESSAGE_LIMIT` in
`.env`, default 150) so a bot or stranger finding the link can't burn your OpenAI credit. This is
demo-grade protection, not production multi-tenant billing.

To get a public link:

```bash
cloudflared tunnel --url http://localhost:3010
```

(If `cloudflared` isn't on PATH, use its full install path, e.g.
`"C:\Program Files (x86)\cloudflared\cloudflared.exe"`.)

It prints a random `https://xxxx.trycloudflare.com` URL. This URL changes every time you restart
the tunnel, so it's meant for one demo session, not a permanent link. For a stable URL to send a
paying client, deploy the server itself (Railway, Render, a VPS) instead of tunneling from your
laptop, see "Going live" below.

Open a specific client's demo directly with `?b=<id>`, e.g. http://localhost:3010/?b=bright-smile-dental,
so you can hand your phone straight to the owner without fiddling with a dropdown in front of them.

The bot knows the current time (`BUSINESS_TIMEZONE` in `.env`), so outside opening hours it answers
the question **and** says when the team will be back. That after-hours reply is the demo that sells.

Always include a "WE DO NOT HAVE / DO NOT OFFER" list in `info`, covering the things customers
commonly ask for that this client doesn't provide. Without it the bot has to hand off every such
question to staff; with it, the bot answers "no" confidently and correctly. Ask every new client
"what do customers ask for that you don't offer?" It's the highest-value onboarding question.

## What triggers human handoff

The AI ends its reply with a hidden `[HANDOFF]` token when:
- the customer wants to actually book/pay (AI collects details, staff confirms),
- the question isn't covered by the business info,
- the customer asks for a human, is angry, or complains.

The server logs `[HANDOFF]` lines; in production, wire that to a staff notification
(WhatsApp group message, dashboard, email) and pause the bot for that conversation.

## Going live on real WhatsApp (per client)

1. Create a Meta Business Portfolio + app at developers.facebook.com (type: Business).
2. Add the WhatsApp product; register a phone number NOT already on WhatsApp.
3. Put the number's `phone_number_id` into the client's JSON under `whatsapp.phoneNumberId`.
4. Create a System User in Meta Business Settings and generate a permanent token -> `WHATSAPP_TOKEN` in `.env`.
5. Deploy this server anywhere with HTTPS (VPS + nginx/caddy, or a PaaS). For local testing use an ngrok tunnel.
6. In the Meta app's WhatsApp > Configuration, set the webhook URL to `https://your-domain/webhook`
   and the verify token to your `WHATSAPP_VERIFY_TOKEN`, then subscribe to the `messages` field.
7. Message the number from any phone. Replies come from this server.

## Costs (per client, rough)

- WhatsApp Cloud API: free for replying to customer-initiated chats within 24h (this bot's whole job).
- AI API: roughly a quarter of a cent per reply on `gpt-4o`, a few dollars a month for a typical
  small business. Use a paid key, not a free tier. Free tiers may train on submitted data and cap
  daily requests, neither of which is acceptable once real customer conversations flow through it.
- Hosting: one small VPS serves all clients.
