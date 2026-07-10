const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function loadDotenv(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;

    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotenv();

const config = {
  blockscoutBaseUrl: (process.env.BLOCKSCOUT_BASE_URL || "https://robinhoodchain.blockscout.com").replace(/\/$/, ""),
  dexscreenPairUrl:
    process.env.DEXSCREENER_PAIR_URL ||
    "https://dexscreener.com/robinhood/0xb541c2936982dd5c4090783d8f395d3e613c8016",
  pairAddress: normalizeAddress(process.env.PAIR_ADDRESS || "0xb541c2936982dd5c4090783d8f395d3e613c8016"),
  baseTokenAddress: normalizeAddress(process.env.BASE_TOKEN_ADDRESS || "0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7"),
  quoteTokenAddress: normalizeAddress(process.env.QUOTE_TOKEN_ADDRESS || "0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
  baseSymbol: process.env.BASE_SYMBOL || "REPE",
  quoteSymbol: process.env.QUOTE_SYMBOL || "WETH",
  pollSeconds: Number(process.env.POLL_SECONDS || 3),
  stateFile: process.env.STATE_FILE || "state.json",
  maxItems: Number(process.env.MAX_ITEMS || 50),
  minUsd: Number(process.env.MIN_USD || 0),
  minQuoteAmount: Number(process.env.MIN_QUOTE_AMOUNT || 0),
  dryRun: truthy(process.env.DRY_RUN),
  backfillOnStart: truthy(process.env.BACKFILL_ON_START),
  fetchTxDetails: truthy(process.env.FETCH_TX_DETAILS),
  buyWhenBaseLeavesPool:
    process.env.BUY_WHEN_BASE_LEAVES_POOL === undefined ? true : truthy(process.env.BUY_WHEN_BASE_LEAVES_POOL),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  botTitle: process.env.BOT_TITLE || "REPETradingBot",
  botTagline: process.env.BOT_TAGLINE || "Your Gateway to Robinhood DeFi",
  telegramUrl: process.env.PROJECT_TELEGRAM_URL || "",
  twitterUrl: process.env.PROJECT_TWITTER_URL || "",
  websiteUrl: process.env.PROJECT_WEBSITE_URL || "",
  tradeEnabled: truthy(process.env.TRADE_ENABLED),
  rpcUrl: process.env.RPC_URL || "",
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
  walletAddress: process.env.WALLET_ADDRESS || "",
  swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || "0xCaf681a66D020601342297493863E78C959E5cb2",
  uniswapV3Fee: Number(process.env.UNISWAP_V3_FEE || 10000),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 200),
  oneTapTrade: truthy(process.env.ONE_TAP_TRADE),
  buyAmountsQuote: parseAmountOptions(process.env.BUY_AMOUNTS_QUOTE || "0.01,0.05,0.1,0.25"),
  sellAmountsBase: parseAmountOptions(process.env.SELL_AMOUNTS_BASE || "1000,5000,10000,25000"),
};

function truthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").toLowerCase());
}

function parseAmountOptions(value) {
  return String(value || "")
    .split(",")
    .map((amount) => amount.trim())
    .filter(Boolean);
}

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

function addressOf(value) {
  if (value && typeof value === "object") return normalizeAddress(value.hash);
  return normalizeAddress(value);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "robinhood-uniswap-telegram-bot/1.0",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchTokenTransfers() {
  const url = `${config.blockscoutBaseUrl}/api/v2/addresses/${config.pairAddress}/token-transfers`;
  const payload = await fetchJson(url);
  return (payload.items || []).slice(0, config.maxItems);
}

async function fetchTransaction(txHash) {
  return fetchJson(`${config.blockscoutBaseUrl}/api/v2/transactions/${txHash}`);
}

async function fetchDexPair() {
  const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${config.pairAddress}`;
  const payload = await fetchJson(url);
  return payload.pair || payload.pairs?.[0] || null;
}

async function fetchTokenPairs(tokenAddress) {
  return fetchJson(`https://api.dexscreener.com/token-pairs/v1/robinhood/${tokenAddress}`);
}

function loadState() {
  if (!fs.existsSync(config.stateFile)) return { seen: [] };

  try {
    return JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  } catch {
    return { seen: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(config.stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function startHealthServer() {
  const port = Number(process.env.PORT || 0);
  if (!port) return;

  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Telegram bot is running.\n");
  });

  server.listen(port, () => {
    console.log(`Health server listening on port ${port}.`);
  });
}

function addSeen(state, hashes) {
  state.seen = [...new Set([...hashes, ...(state.seen || [])])].slice(0, 500);
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function shouldTradeImmediately(side, amount) {
  return config.oneTapTrade || (side === "SELL" && amount === "ALL");
}

function chooseBestPairForToken(pairs, tokenAddress) {
  const token = normalizeAddress(tokenAddress);
  const validPairs = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => normalizeAddress(pair.chainId) === "robinhood")
    .filter((pair) => {
      const base = normalizeAddress(pair.baseToken?.address);
      const quote = normalizeAddress(pair.quoteToken?.address);
      return base === token || quote === token;
    });

  validPairs.sort((a, b) => {
    const aQuote = normalizeAddress(a.quoteToken?.address) === config.quoteTokenAddress || a.quoteToken?.symbol === "WETH";
    const bQuote = normalizeAddress(b.quoteToken?.address) === config.quoteTokenAddress || b.quoteToken?.symbol === "WETH";
    if (aQuote !== bQuote) return aQuote ? -1 : 1;
    return Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0);
  });

  return validPairs[0] || null;
}

function trackedPairFromDexPair(pair, tokenAddress = pair?.baseToken?.address) {
  const token = normalizeAddress(tokenAddress);
  const base = normalizeAddress(pair.baseToken?.address);
  const quote = normalizeAddress(pair.quoteToken?.address);
  const trackedIsQuote = quote === token && base !== token;
  const baseToken = trackedIsQuote ? pair.quoteToken : pair.baseToken;
  const quoteToken = trackedIsQuote ? pair.baseToken : pair.quoteToken;

  return {
    pairAddress: normalizeAddress(pair.pairAddress),
    pairUrl: pair.url || `https://dexscreener.com/robinhood/${pair.pairAddress}`,
    baseTokenAddress: normalizeAddress(baseToken?.address),
    baseSymbol: baseToken?.symbol || "TOKEN",
    quoteTokenAddress: normalizeAddress(quoteToken?.address),
    quoteSymbol: quoteToken?.symbol || "QUOTE",
  };
}

function applyTrackedPair(trackedPair) {
  if (!trackedPair?.pairAddress || !trackedPair?.baseTokenAddress || !trackedPair?.quoteTokenAddress) return;

  config.pairAddress = normalizeAddress(trackedPair.pairAddress);
  config.dexscreenPairUrl = trackedPair.pairUrl || `https://dexscreener.com/robinhood/${trackedPair.pairAddress}`;
  config.baseTokenAddress = normalizeAddress(trackedPair.baseTokenAddress);
  config.baseSymbol = trackedPair.baseSymbol || config.baseSymbol;
  config.quoteTokenAddress = normalizeAddress(trackedPair.quoteTokenAddress);
  config.quoteSymbol = trackedPair.quoteSymbol || config.quoteSymbol;
}

function applyStateConfig(state) {
  applyTrackedPair(state.trackedPair);
}

function groupHashes(transfers) {
  return groupTransfers(transfers).map((group) => group.hash);
}

function groupTransfers(transfers) {
  const groups = new Map();

  for (const transfer of transfers) {
    const hash = transfer.transaction_hash;
    if (!hash) continue;
    if (!groups.has(hash)) groups.set(hash, { hash, transfers: [] });
    groups.get(hash).transfers.push(transfer);
  }

  return [...groups.values()];
}

function transferTokenAddress(transfer) {
  return normalizeAddress(transfer.token?.address_hash);
}

function transferAmount(transfer) {
  return BigInt(transfer.total?.value || "0");
}

function transferDecimals(transfer, fallback = 18) {
  return Number(transfer.total?.decimals || transfer.token?.decimals || fallback);
}

function formatUnits(raw, decimals, maxPlaces = 6) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  if (fraction === 0n || maxPlaces === 0) return `${negative ? "-" : ""}${whole}`;

  let fractionText = fraction.toString().padStart(decimals, "0").slice(0, maxPlaces);
  fractionText = fractionText.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fractionText ? `.${fractionText}` : ""}`;
}

function unitsToNumber(raw, decimals) {
  return Number(formatUnits(raw, decimals, Math.min(decimals, 12)));
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(4)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function compactAddress(address) {
  if (!address || address.length < 12) return address || "n/a";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function telegramUrl(method) {
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

function isAuthorizedChat(chatId) {
  return String(chatId) === String(config.telegramChatId);
}

function chunkButtons(buttons, size = 2) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }
  return rows;
}

function sniperTradeKeyboard() {
  const buyButtons = config.buyAmountsQuote.map((amount) => ({
    text: `Buy ${amount} ${config.quoteSymbol}`,
    callback_data: `qtrade:BUY:${amount}`,
  }));
  const sellButtons = config.sellAmountsBase.map((amount) => ({
    text: `Sell ${amount} ${config.baseSymbol}`,
    callback_data: `qtrade:SELL:${amount}`,
  }));

  return {
    inline_keyboard: [
      ...chunkButtons(buyButtons, 2),
      ...chunkButtons(sellButtons, 2),
      [{ text: `Sell All ${config.baseSymbol}`, callback_data: "qtrade:SELL:ALL" }],
      [
        { text: "Refresh", callback_data: "menu" },
        { text: "Chart", url: config.dexscreenPairUrl },
      ],
    ],
  };
}

function confirmKeyboard(side, amount) {
  const inputSymbol = side === "BUY" ? config.quoteSymbol : config.baseSymbol;
  const amountLabel = amount === "ALL" ? `ALL ${inputSymbol}` : `${amount} ${inputSymbol}`;
  return {
    inline_keyboard: [
      [{ text: `Confirm ${side} ${amountLabel}`, callback_data: `confirm:${side}:${amount}` }],
      [
        { text: "Cancel", callback_data: "menu" },
        { text: "Chart", url: config.dexscreenPairUrl },
      ],
    ],
  };
}

function alertTradeKeyboard() {
  return sniperTradeKeyboard();
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Buy & Sell", callback_data: "panel:trade" },
        { text: "Sniper", callback_data: "panel:trade" },
      ],
      [
        { text: "Limit Orders", callback_data: "soon:Limit Orders" },
        { text: "Copy Trades", callback_data: "soon:Copy Trades" },
      ],
      [
        { text: "Profile", callback_data: "panel:profile" },
        { text: "Wallets", callback_data: "panel:wallets" },
        { text: "Trades", callback_data: "panel:trades" },
      ],
    ],
  };
}

function tradePanelText(title = `${config.baseSymbol} Sniper`) {
  return [
    `<b>${escapeHtml(title)}</b>`,
    `Buy uses <b>${escapeHtml(config.quoteSymbol)}</b>. Sell uses <b>${escapeHtml(config.baseSymbol)}</b>.`,
    `One-tap: <b>${config.oneTapTrade ? "ON" : "OFF"}</b> | Trading: <b>${config.tradeEnabled ? "ON" : "OFF"}</b>`,
    `Slippage: <b>${config.slippageBps / 100}%</b>`,
  ].join("\n");
}

function linkLine() {
  const links = [
    ["Telegram", config.telegramUrl],
    ["Twitter", config.twitterUrl],
    ["Website", config.websiteUrl],
  ]
    .filter(([, url]) => url)
    .map(([label, url]) => `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);

  return links.length > 0 ? links.join(" | ") : `<a href="${escapeHtml(config.dexscreenPairUrl)}">Dexscreener</a>`;
}

async function getDisplayWallet() {
  if (config.walletAddress) return config.walletAddress;
  if (!config.walletPrivateKey) return "";

  try {
    const { ethers } = require("ethers");
    return new ethers.Wallet(config.walletPrivateKey).address;
  } catch {
    return "";
  }
}

async function getNativeBalance(walletAddress) {
  if (!config.rpcUrl || !walletAddress) return "";

  try {
    const { ethers } = require("ethers");
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const balance = await provider.getBalance(walletAddress);
    return ethers.formatEther(balance);
  } catch {
    return "";
  }
}

async function mainPanelText() {
  let pair = null;
  try {
    pair = await fetchDexPair();
  } catch {
    pair = null;
  }

  const priceUsd = Number(pair?.priceUsd);
  const priceText = Number.isFinite(priceUsd) ? `$${priceUsd.toPrecision(4)}` : "n/a";
  const wallet = await getDisplayWallet();
  const balance = await getNativeBalance(wallet);
  const walletText = wallet ? compactAddress(wallet) : "Not configured";
  const balanceText = balance ? `${Number(balance).toPrecision(6)} ETH` : "n/a";

  return [
    `🚀 <b>${escapeHtml(config.botTitle)}: ${escapeHtml(config.botTagline)}</b>`,
    "",
    `💰 <b>${escapeHtml(config.baseSymbol)} Price:</b> <code>${escapeHtml(priceText)}</code>`,
    "",
    `💳 <b>Your First Wallet</b>`,
    `↳ <code>${escapeHtml(walletText)}</code>`,
    `↳ <b>Balance:</b> <code>${escapeHtml(balanceText)}</code>`,
    "",
    linkLine(),
  ].join("\n");
}

function staticMainPanelText() {
  return [
    `🚀 <b>${escapeHtml(config.botTitle)}: ${escapeHtml(config.botTagline)}</b>`,
    "",
    `💰 <b>${escapeHtml(config.baseSymbol)} Price:</b> <code>n/a</code>`,
    "",
    `💳 <b>Your First Wallet</b>`,
    `↳ <code>${escapeHtml(config.walletAddress ? compactAddress(config.walletAddress) : "Not configured")}</code>`,
    `↳ <b>Balance:</b> <code>n/a</code>`,
    "",
    linkLine(),
  ].join("\n");
}

async function telegramRequest(method, payload) {
  if (config.dryRun) {
    console.log(`[telegram:${method}] ${JSON.stringify(payload)}`);
    return { ok: true, result: [] };
  }

  if (!config.telegramBotToken) throw new Error("Missing TELEGRAM_BOT_TOKEN.");

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    body.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  const result = await fetchJson(telegramUrl(method), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!result.ok) throw new Error(`Telegram error: ${JSON.stringify(result)}`);
  return result;
}

async function sendTradeMenu(chatId = config.telegramChatId) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text: tradePanelText(),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: sniperTradeKeyboard(),
  });
}

async function sendMainMenu(chatId = config.telegramChatId) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text: await mainPanelText(),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(),
  });
}

async function followTokenAddress(tokenAddress, state, chatId) {
  const pairs = await fetchTokenPairs(tokenAddress);
  const pair = chooseBestPairForToken(pairs, tokenAddress);
  if (!pair) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Không tìm thấy pool Robinhood cho contract:\n<code>${escapeHtml(tokenAddress)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
    return;
  }

  const trackedPair = trackedPairFromDexPair(pair, tokenAddress);
  applyTrackedPair(trackedPair);
  state.trackedPair = trackedPair;
  state.seen = [];

  try {
    const groups = groupTransfers(await fetchTokenTransfers());
    addSeen(
      state,
      groups.map((group) => group.hash),
    );
  } catch (error) {
    console.warn(`Could not warm seen transactions for ${trackedPair.baseSymbol}: ${error.message}`);
  }

  saveState(state);

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      `<b>Now tracking ${escapeHtml(trackedPair.baseSymbol)}</b>`,
      `Pair: <code>${escapeHtml(compactAddress(trackedPair.pairAddress))}</code>`,
      `Quote: <b>${escapeHtml(trackedPair.quoteSymbol)}</b>`,
      `Alert min: <b>${config.minQuoteAmount} ${escapeHtml(trackedPair.quoteSymbol)}</b>`,
      `<a href="${escapeHtml(trackedPair.pairUrl)}">Dexscreener</a>`,
    ].join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(),
  });
}

async function editTradeMessage(callbackQuery, text, replyMarkup = null) {
  const payload = {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    return await telegramRequest("editMessageText", payload);
  } catch (error) {
    if (isMessageNotModifiedError(error)) return { ok: false, ignored: true };
    throw error;
  }
}

async function answerCallback(callbackQuery, text = "") {
  try {
    return await telegramRequest("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text,
      show_alert: text.length > 80 ? "true" : "false",
    });
  } catch (error) {
    if (isExpiredCallbackError(error)) return { ok: false, ignored: true };
    throw error;
  }
}

function isExpiredCallbackError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("query is too old") ||
    message.includes("query ID is invalid") ||
    message.includes("response timeout expired")
  );
}

function isMessageNotModifiedError(error) {
  return String(error?.message || "").includes("message is not modified");
}

function classifyFromTransaction(tx, overrides = {}) {
  const settings = { ...config, ...overrides };
  let baseNet = 0n;
  let quoteNet = 0n;
  let baseDecimals = 18;
  let quoteDecimals = 18;
  let baseUsd = Number.NaN;
  let quoteUsd = Number.NaN;

  for (const transfer of tx.token_transfers || []) {
    const token = transferTokenAddress(transfer);
    if (token !== settings.baseTokenAddress && token !== settings.quoteTokenAddress) continue;

    const src = addressOf(transfer.from);
    const dst = addressOf(transfer.to);
    let direction = 0n;
    if (dst === settings.pairAddress) direction += 1n;
    if (src === settings.pairAddress) direction -= 1n;
    if (direction === 0n) continue;

    const amount = transferAmount(transfer);
    const decimals = transferDecimals(transfer);
    const exchangeRate = Number(transfer.token?.exchange_rate);

    if (token === settings.baseTokenAddress) {
      baseDecimals = decimals;
      baseNet += amount * direction;
      if (Number.isFinite(exchangeRate)) baseUsd = exchangeRate;
    }

    if (token === settings.quoteTokenAddress) {
      quoteDecimals = decimals;
      quoteNet += amount * direction;
      if (Number.isFinite(exchangeRate)) quoteUsd = exchangeRate;
    }
  }

  if (baseNet === 0n) return null;

  const side = settings.buyWhenBaseLeavesPool ? (baseNet < 0n ? "BUY" : "SELL") : baseNet > 0n ? "BUY" : "SELL";
  const baseRaw = baseNet < 0n ? -baseNet : baseNet;
  const quoteRaw = quoteNet < 0n ? -quoteNet : quoteNet;
  const baseAmount = unitsToNumber(baseRaw, baseDecimals);
  const quoteAmount = unitsToNumber(quoteRaw, quoteDecimals);
  const quoteUsdValue = Number.isFinite(quoteUsd) ? quoteAmount * quoteUsd : baseAmount * baseUsd;
  const priceUsd = baseAmount > 0 ? quoteUsdValue / baseAmount : baseUsd;

  if (Number.isFinite(settings.minQuoteAmount) && quoteAmount < settings.minQuoteAmount) return null;
  if (Number.isFinite(quoteUsdValue) && quoteUsdValue < settings.minUsd) return null;

  return {
    txHash: tx.hash,
    blockNumber: Number(tx.block_number || 0),
    timestamp: String(tx.timestamp || ""),
    side,
    trader: addressOf(tx.from),
    baseRaw,
    quoteRaw,
    baseDecimals,
    quoteDecimals,
    baseAmount,
    quoteAmount,
    quoteUsdValue,
    priceUsd,
  };
}

function guessTrader(transfers, settings = config) {
  for (const transfer of transfers) {
    if (transferTokenAddress(transfer) !== settings.baseTokenAddress) continue;
    const src = addressOf(transfer.from);
    const dst = addressOf(transfer.to);

    if (dst === settings.pairAddress && src !== settings.pairAddress) return src;
    if (src === settings.pairAddress && dst !== settings.pairAddress) return dst;
  }

  for (const transfer of transfers) {
    const src = addressOf(transfer.from);
    const dst = addressOf(transfer.to);
    if (src && src !== settings.pairAddress) return src;
    if (dst && dst !== settings.pairAddress) return dst;
  }

  return "";
}

function transactionFromTransferGroup(group) {
  const first = group.transfers[0] || {};
  return {
    hash: group.hash,
    block_number: first.block_number,
    timestamp: first.timestamp,
    from: { hash: guessTrader(group.transfers) },
    token_transfers: group.transfers,
  };
}

function tradeMessage(trade) {
  const txUrl = `${config.blockscoutBaseUrl}/tx/${trade.txHash}`;
  return [
    `<b>${escapeHtml(trade.side)} ${escapeHtml(config.baseSymbol)}</b> on Robinhood Uniswap`,
    `Amount: <b>${escapeHtml(formatUnits(trade.baseRaw, trade.baseDecimals, 4))} ${escapeHtml(config.baseSymbol)}</b>`,
    `Quote: <b>${escapeHtml(formatUnits(trade.quoteRaw, trade.quoteDecimals, 6))} ${escapeHtml(config.quoteSymbol)}</b> (${escapeHtml(formatUsd(trade.quoteUsdValue))})`,
    `Price: <b>${escapeHtml(formatUsd(trade.priceUsd))}</b>`,
    `Trader: <code>${escapeHtml(compactAddress(trade.trader))}</code>`,
    `Block: <code>${trade.blockNumber}</code>`,
    `<a href="${escapeHtml(txUrl)}">Tx</a> | <a href="${escapeHtml(config.dexscreenPairUrl)}">Dexscreener</a>`,
  ].join("\n");
}

function numberToDecimalString(value, maxDecimals = 18) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid decimal value: ${value}`);
  return value.toFixed(maxDecimals).replace(/\.?0+$/, "") || "0";
}

async function getWalletTokenBalance(tokenAddress) {
  if (!config.rpcUrl || !config.walletPrivateKey) {
    throw new Error("Missing RPC_URL or WALLET_PRIVATE_KEY.");
  }

  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
  const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"];
  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);
  return {
    wallet,
    balance: await token.balanceOf(wallet.address),
  };
}

async function estimateMinimumOut(side, amountText) {
  if (amountText === "ALL") {
    throw new Error("Estimate for Sell All needs wallet balance and runs at confirmation.");
  }

  const pair = await fetchDexPair();
  const priceNative = Number(pair?.priceNative);
  if (!Number.isFinite(priceNative) || priceNative <= 0) {
    throw new Error("Cannot read current price from Dexscreener.");
  }

  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount.");

  const expectedOut = side === "BUY" ? amount / priceNative : amount * priceNative;
  const minOut = expectedOut * (10000 - config.slippageBps) / 10000;
  return {
    expectedOut,
    minOut,
    priceNative,
    priceUsd: Number(pair?.priceUsd),
  };
}

async function executeSwap(side, amountText) {
  if (!config.tradeEnabled) {
    throw new Error("TRADE_ENABLED=0. Bật TRADE_ENABLED=1 sau khi cấu hình RPC_URL và WALLET_PRIVATE_KEY.");
  }

  if (!config.rpcUrl || !config.walletPrivateKey) {
    throw new Error("Missing RPC_URL or WALLET_PRIVATE_KEY.");
  }

  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
  const tokenIn = side === "BUY" ? config.quoteTokenAddress : config.baseTokenAddress;
  const tokenOut = side === "BUY" ? config.baseTokenAddress : config.quoteTokenAddress;
  const tokenInSymbol = side === "BUY" ? config.quoteSymbol : config.baseSymbol;
  const tokenOutSymbol = side === "BUY" ? config.baseSymbol : config.quoteSymbol;
  const decimalsIn = 18;
  const decimalsOut = 18;
  let amountIn;
  if (side === "SELL" && amountText === "ALL") {
    const tokenBalance = await getWalletTokenBalance(config.baseTokenAddress);
    amountIn = tokenBalance.balance;
    if (amountIn <= 0n) throw new Error(`No ${config.baseSymbol} balance to sell.`);
    amountText = ethers.formatUnits(amountIn, decimalsIn);
  } else {
    amountIn = ethers.parseUnits(amountText, decimalsIn);
  }
  const quote = await estimateMinimumOut(side, amountText);
  const amountOutMinimum = ethers.parseUnits(numberToDecimalString(quote.minOut, decimalsOut), decimalsOut);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 5;

  const erc20Abi = [
    "function allowance(address owner,address spender) view returns (uint256)",
    "function approve(address spender,uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
  ];
  const routerAbi = [
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  ];

  const inputToken = new ethers.Contract(tokenIn, erc20Abi, wallet);
  const balance = await inputToken.balanceOf(wallet.address);
  if (balance < amountIn) {
    throw new Error(`Not enough ${tokenInSymbol}. Need ${amountText}, wallet has ${ethers.formatUnits(balance, decimalsIn)}.`);
  }

  const allowance = await inputToken.allowance(wallet.address, config.swapRouterAddress);
  if (allowance < amountIn) {
    const approveTx = await inputToken.approve(config.swapRouterAddress, amountIn);
    await approveTx.wait();
  }

  const router = new ethers.Contract(config.swapRouterAddress, routerAbi, wallet);
  const params = {
    tokenIn,
    tokenOut,
    fee: config.uniswapV3Fee,
    recipient: wallet.address,
    deadline,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0,
  };

  const tx = await router.exactInputSingle(params);
  return {
    hash: tx.hash,
    wallet: wallet.address,
    tokenInSymbol,
    tokenOutSymbol,
    minOut: numberToDecimalString(quote.minOut, 8),
  };
}

async function sendTelegram(text, replyMarkup = null) {
  if (config.dryRun) {
    console.log(text);
    if (replyMarkup) console.log(JSON.stringify(replyMarkup));
    console.log("-".repeat(40));
    return;
  }

  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID. Set DRY_RUN=1 to test locally.");
  }

  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: config.telegramChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
  });
  if (replyMarkup) body.set("reply_markup", JSON.stringify(replyMarkup));

  const payload = await fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!payload.ok) throw new Error(`Telegram error: ${JSON.stringify(payload)}`);
}

async function runConfirmedTrade(callbackQuery, side, amount) {
  const inputSymbol = side === "BUY" ? config.quoteSymbol : config.baseSymbol;
  await editTradeMessage(
    callbackQuery,
    `<b>Sending ${escapeHtml(side)} ${escapeHtml(config.baseSymbol)}...</b>\nAmount: ${escapeHtml(amount)} ${escapeHtml(inputSymbol)}`,
  );

  try {
    const result = await executeSwap(side, amount);
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>${escapeHtml(side)} sent</b>`,
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
        `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
      ].join("\n"),
      sniperTradeKeyboard(),
    );
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Trade not sent</b>\n${escapeHtml(error.message)}`,
      sniperTradeKeyboard(),
    );
  }
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  if (!isAuthorizedChat(chatId)) {
    await answerCallback(callbackQuery, "Unauthorized chat.");
    return;
  }

  const data = String(callbackQuery.data || "");
  await answerCallback(callbackQuery);

  if (data === "menu") {
    await editTradeMessage(
      callbackQuery,
      await mainPanelText(),
      mainMenuKeyboard(),
    );
    return;
  }

  if (data === "panel:trade") {
    await editTradeMessage(callbackQuery, tradePanelText(), sniperTradeKeyboard());
    return;
  }

  if (data === "panel:profile") {
    await editTradeMessage(
      callbackQuery,
      [
        `<b>Profile</b>`,
        `Trading: <b>${config.tradeEnabled ? "ON" : "OFF"}</b>`,
        `One-tap: <b>${config.oneTapTrade ? "ON" : "OFF"}</b>`,
        `Alert min: <b>${config.minQuoteAmount} ${escapeHtml(config.quoteSymbol)}</b>`,
      ].join("\n"),
      mainMenuKeyboard(),
    );
    return;
  }

  if (data === "panel:wallets") {
    const wallet = await getDisplayWallet();
    const balance = await getNativeBalance(wallet);
    await editTradeMessage(
      callbackQuery,
      [
        `<b>Wallets</b>`,
        `Main: <code>${escapeHtml(wallet ? compactAddress(wallet) : "Not configured")}</code>`,
        `Balance: <code>${escapeHtml(balance ? `${Number(balance).toPrecision(6)} ETH` : "n/a")}</code>`,
      ].join("\n"),
      mainMenuKeyboard(),
    );
    return;
  }

  if (data === "panel:trades") {
    await editTradeMessage(
      callbackQuery,
      [
        `<b>Trades</b>`,
        `Live alerts are filtered at <b>${config.minQuoteAmount} ${escapeHtml(config.quoteSymbol)}</b> or above.`,
        `Use Buy & Sell for quick actions.`,
      ].join("\n"),
      mainMenuKeyboard(),
    );
    return;
  }

  if (data.startsWith("soon:")) {
    const feature = data.slice("soon:".length);
    await answerCallback(callbackQuery, `${feature} coming soon.`);
    return;
  }

  if (data.startsWith("qtrade:")) {
    const [, side, amount] = data.split(":");
    if (shouldTradeImmediately(side, amount)) {
      await runConfirmedTrade(callbackQuery, side, amount);
      return;
    }

    const inputSymbol = side === "BUY" ? config.quoteSymbol : config.baseSymbol;
    const outputSymbol = side === "BUY" ? config.baseSymbol : config.quoteSymbol;
    let estimateText = "";
    try {
      const quote = await estimateMinimumOut(side, amount);
      estimateText = [
        `Expected out: ~<b>${escapeHtml(numberToDecimalString(quote.expectedOut, 6))} ${escapeHtml(outputSymbol)}</b>`,
        `Min out: <b>${escapeHtml(numberToDecimalString(quote.minOut, 6))} ${escapeHtml(outputSymbol)}</b>`,
        `Slippage: <b>${config.slippageBps / 100}%</b>`,
      ].join("\n");
    } catch (error) {
      estimateText = `Estimate unavailable: ${escapeHtml(error.message)}`;
    }

    await editTradeMessage(
      callbackQuery,
      [
        `<b>Confirm ${escapeHtml(side)} ${escapeHtml(config.baseSymbol)}</b>`,
        `Spend: <b>${escapeHtml(amount)} ${escapeHtml(inputSymbol)}</b>`,
        estimateText,
        `Trading: <b>${config.tradeEnabled ? "ON" : "OFF"}</b>`,
      ].join("\n"),
      confirmKeyboard(side, amount),
    );
    return;
  }

  if (data.startsWith("confirm:")) {
    const [, side, amount] = data.split(":");
    await runConfirmedTrade(callbackQuery, side, amount);
  }
}

async function handleTelegramMessage(message, state) {
  const chatId = message.chat?.id;
  if (!isAuthorizedChat(chatId)) return;

  const text = String(message.text || "").trim();
  if (isEvmAddress(text)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Đang tìm pool Robinhood cho:\n<code>${escapeHtml(text)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
    await followTokenAddress(text, state, chatId);
    return;
  }

  if (text === "/start" || text === "/menu") {
    await sendMainMenu(chatId);
    return;
  }

  if (text === "/trade") {
    await sendTradeMenu(chatId);
    return;
  }

  const commandMatch = text.match(/^\/(buy|sell)\s+([0-9]*\.?[0-9]+)$/i);
  if (commandMatch) {
    const side = commandMatch[1].toUpperCase();
    const amount = commandMatch[2];
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `<b>Confirm ${escapeHtml(side)} ${escapeHtml(config.baseSymbol)}</b>\nAmount: <b>${escapeHtml(amount)}</b>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: confirmKeyboard(side, amount),
    });
  }
}

async function processTelegramUpdates(state) {
  if (!config.telegramBotToken || !config.telegramChatId || config.dryRun) return;

  const payload = await telegramRequest("getUpdates", {
    offset: Number(state.telegramOffset || 0),
    timeout: 0,
    allowed_updates: ["message", "callback_query"],
  });

  for (const update of payload.result || []) {
    state.telegramOffset = update.update_id + 1;
    try {
      if (update.message) await handleTelegramMessage(update.message, state);
      if (update.callback_query) await handleCallbackQuery(update.callback_query);
    } catch (error) {
      if (isExpiredCallbackError(error) || isMessageNotModifiedError(error)) {
        console.warn(`Ignored stale Telegram update ${update.update_id}.`);
      } else {
        console.error(`Telegram update ${update.update_id} failed: ${error.message}`);
      }
    }
  }

  saveState(state);
}

async function handleNewGroups(groups, state) {
  const seen = new Set(state.seen || []);
  const newGroups = groups.filter((group) => !seen.has(group.hash)).reverse();

  for (const group of newGroups) {
    try {
      const tx = config.fetchTxDetails ? await fetchTransaction(group.hash) : transactionFromTransferGroup(group);
      const trade = classifyFromTransaction(tx);
      if (trade) await sendTelegram(tradeMessage(trade), alertTradeKeyboard());
    } catch (error) {
      console.error(`Failed to process ${group.hash}: ${error.message}`);
    }
  }

  if (newGroups.length > 0) {
    addSeen(
      state,
      newGroups.map((group) => group.hash),
    );
    saveState(state);
  }
}

async function bootState(state) {
  const groups = groupTransfers(await fetchTokenTransfers());
  if (config.backfillOnStart) {
    await handleNewGroups(groups, state);
    return;
  }

  addSeen(
    state,
    groups.map((group) => group.hash),
  );
  saveState(state);
  console.log(`Booted. Marked ${groups.length} existing transactions as seen.`);
}

async function main() {
  startHealthServer();

  const state = loadState();
  applyStateConfig(state);

  if (process.argv.includes("--send-menu")) {
    await sendMainMenu();
    return;
  }

  if (process.argv.includes("--send-trade")) {
    await sendTradeMenu();
    return;
  }

  const once = process.argv.includes("--once");

  if (!state.seen?.length) {
    await bootState(state);
    if (once) return;
  }

  while (true) {
    try {
      await processTelegramUpdates(state);
      const groups = groupTransfers(await fetchTokenTransfers());
      await handleNewGroups(groups, state);
    } catch (error) {
      console.error(`Poll error: ${error.message}`);
    }

    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  classifyFromTransaction,
  config,
  formatUnits,
  groupHashes,
  groupTransfers,
  isExpiredCallbackError,
  isEvmAddress,
  isMessageNotModifiedError,
  normalizeAddress,
  mainMenuKeyboard,
  mainPanelText,
  chooseBestPairForToken,
  shouldTradeImmediately,
  sniperTradeKeyboard,
  staticMainPanelText,
  trackedPairFromDexPair,
  tradePanelText,
  tradeMessage,
};
