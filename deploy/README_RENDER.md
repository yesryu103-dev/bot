# Render deploy

This bot is a long-running Node process, so deploy it as a Render Background Worker, not as a Static Site.

## Option A: Blueprint

1. Push this repo to GitHub.
2. In Render, create a new Blueprint.
3. Select the GitHub repo.
4. Render reads `render.yaml` and creates `robinhood-telegram-bot`.
5. Fill the secret env vars Render prompts for:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
RPC_URL
WALLET_PRIVATE_KEY
WALLET_ADDRESS
```

`RPC_URL`, `WALLET_PRIVATE_KEY`, and `WALLET_ADDRESS` are only required for real trading. For alert-only mode, leave `TRADE_ENABLED=0`.

## Option B: Manual Background Worker

Do not use Static Site.

1. Render Dashboard -> New -> Background Worker.
2. Connect the GitHub repo.
3. Runtime: Node.
4. Build Command:

```bash
npm ci
```

5. Start Command:

```bash
npm start
```

6. Add Environment Variables from `.env.example`.
7. Deploy.

## Notes

- `.env` is not committed. Put secrets in Render Environment Variables.
- Render restarts the worker automatically if it exits.
- Because the bot polls Telegram with `getUpdates`, only run one live instance at a time. Stop the local `npm.cmd start` when Render is live.
- Runtime `state.json` on Render is ephemeral. If Render restarts, the bot marks current transactions as seen on boot when `BACKFILL_ON_START=0`, so it should not spam old swaps.

## Important: use Background Worker, not Web Service

If Render shows a public URL like `https://bot-xxxx.onrender.com` and a banner about the free instance spinning down after inactivity, you deployed the wrong service type.

This bot must run 24/7 to poll Telegram. A free Web Service sleeps when idle and the bot stops responding.

Fix:

1. Render Dashboard -> delete the Web Service if you created one by mistake.
2. Create **Background Worker** (or use the Blueprint from `render.yaml`, which already sets `type: worker`).
3. Redeploy with the same environment variables.

The health server in `bot.js` only exists when Render sets `PORT`. Background Workers do not need a public URL.

## TELEGRAM_CHAT_ID must match your chat

The bot only responds in chats listed in `TELEGRAM_CHAT_ID`.

- If you message the bot in a private chat, use your personal chat ID (positive number).
- If you use a group, use the group ID (usually starts with `-100`).
- You can allow multiple chats: `TELEGRAM_CHAT_ID=123456789,-1001234567890`

If the ID is wrong, the bot used to stay silent. After the latest fix it replies once with your chat ID so you can copy it into Render Environment.
