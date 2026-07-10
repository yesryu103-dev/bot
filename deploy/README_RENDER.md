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
