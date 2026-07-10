# Robinhood Uniswap Telegram Bot

Bot Node.js theo doi buy/sell nhanh tren pair Uniswap Robinhood, gui tin Telegram, va co inline button de buy/sell.

Mac dinh dang cau hinh cho pair REPE/WETH:

- Pair: `0xb541c2936982dd5c4090783d8f395d3e613c8016`
- Base: `REPE` `0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7`
- Quote: `WETH` `0x0bd7d308f8e1639fab988df18a8011f41eacad73`
- Explorer: `https://robinhoodchain.blockscout.com`

## Chay nhanh

```powershell
Copy-Item .env.example .env
notepad .env
npm.cmd install
```

Sua `TELEGRAM_BOT_TOKEN` va `TELEGRAM_CHAT_ID`, roi chay:

```powershell
npm.cmd start
```

Test khong gui Telegram:

```powershell
$env:DRY_RUN="1"
$env:BACKFILL_ON_START="1"
$env:MAX_ITEMS="6"
node bot.js --once
```

Chay test:

```powershell
npm.cmd test
```

## Alert filter

Bot chi gui alert buy/sell lon hon nguong quote token. Với pair nay quote la WETH, nen mac dinh:

```env
MIN_QUOTE_AMOUNT=2
```

Nghia la chi theo doi giao dich co gia tri tu 2 WETH tro len. Neu muon bat tat ca giao dich, doi thanh `0`.

## Telegram UI

Trong Telegram chat voi bot, go:

```text
/start
```

Bot se hien dashboard giong sniper bot:

- Token price
- Wallet hien tai
- Balance neu da cau hinh RPC
- Link Telegram/Twitter/Website
- Nut `Buy & Sell`, `Sniper`, `Limit Orders`, `Copy Trades`, `Profile`, `Wallets`, `Trades`

Gui dashboard ngay tu terminal:

```powershell
npm.cmd run send-menu
```

Neu muon vao thang panel trade:

```text
/trade
```

Gui panel trade tu terminal:

```powershell
npm.cmd run send-trade
```

Panel trade gom:

- `Buy 0.01 WETH`, `Buy 0.05 WETH`, ...
- `Sell 1000 REPE`, `Sell 5000 REPE`, ...
- `Sell All REPE` - bam 1 lan la ban het balance token neu `TRADE_ENABLED=1`
- `Refresh`, `Chart`

Sua preset trong `.env`:

```env
BUY_AMOUNTS_QUOTE=0.01,0.05,0.1,0.25
SELL_AMOUNTS_BASE=1000,5000,10000,25000
ONE_TAP_TRADE=0
```

`ONE_TAP_TRADE=0` thi bam amount se hien confirm ngan. Doi thanh `ONE_TAP_TRADE=1` neu muon bam amount la gui lenh ngay.

Rieng nut `Sell All` luon one-click, khong can bat `ONE_TAP_TRADE`.

Mac dinh `TRADE_ENABLED=0`, nen button khong gui trade that. De bat lenh swap on-chain, can them:

```env
TRADE_ENABLED=1
RPC_URL=https://...
WALLET_PRIVATE_KEY=private_key_vi_phu
SWAP_ROUTER_ADDRESS=0xCaf681a66D020601342297493863E78C959E5cb2
UNISWAP_V3_FEE=10000
SLIPPAGE_BPS=200
```

`SLIPPAGE_BPS=200` la slippage 2%.

Bot chi trade bang token ERC-20, khong tu wrap native ETH. Dung vi phu it tien, vi private key trong `.env` co the dung de ky lenh swap.

Khi mua/ban, bot tu check allowance. Neu router chua du allowance, bot se tu gui approve truoc, doi approve mined xong moi gui lenh swap.

## Auto follow token

Paste contract token EVM vao Telegram, vi du:

```text
0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7
```

Bot se tim pool tren Robinhood bang Dexscreener, chon pair thanh khoan cao nhat uu tien WETH, roi tu dong chuyen sang theo doi token do. Pair dang theo doi duoc luu trong `state.json`, nen restart van giu token moi.

Token vua paste se luon duoc coi la token chinh: token do ra khoi pool = BUY, token do vao pool = SELL. Quy tac nay ap dung cho moi token, khong rieng REPE.

## Deploy

- Google Cloud VM: xem `deploy/README_GCP.md`.
- Render Background Worker: xem `deploy/README_RENDER.md`.

## Buy/sell mode

Bot dang de mac dinh theo goc nhin token dang theo doi:

- `BUY_WHEN_BASE_LEAVES_POOL=1`: base token ra pool = BUY, base token vao pool = SELL.
- `BUY_WHEN_BASE_LEAVES_POOL=0`: base token vao pool = BUY, base token ra pool = SELL.

Neu thay tin Telegram bi nguoc voi cach mày goi buy/sell tren Dexscreener, doi bien nay roi chay lai.

## Cach bot hoat dong

Bot poll endpoint Blockscout:

```text
https://robinhoodchain.blockscout.com/api/v2/addresses/<PAIR_ADDRESS>/token-transfers
```

Sau do gom cac transfer theo transaction hash, lay chi tiet transaction qua:

```text
https://robinhoodchain.blockscout.com/api/v2/transactions/<tx_hash>
```

Tin da gui se duoc luu trong `state.json` de khong spam lai sau khi restart.

Mac dinh bot dung endpoint `token-transfers` cua pair de bat tin nhanh. Neu muon lay transaction detail day du hon, set:

```powershell
$env:FETCH_TX_DETAILS="1"
```
