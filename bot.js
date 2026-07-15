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
  maxItems: Number(process.env.MAX_ITEMS || 200),
  minUsd: Number(process.env.MIN_USD || 0),
  minQuoteAmount: 1,
  // Only alert swaps younger than this (realtime). Stale txs after sleep/redeploy are ignored.
  maxAlertAgeMs: Number(process.env.MAX_ALERT_AGE_MS || 90_000),
  rpcSwapLookbackBlocks: Number(process.env.RPC_SWAP_LOOKBACK_BLOCKS || 100),
  dryRun: truthy(process.env.DRY_RUN),
  backfillOnStart: truthy(process.env.BACKFILL_ON_START),
  fetchTxDetails: truthy(process.env.FETCH_TX_DETAILS),
  buyWhenBaseLeavesPool:
    process.env.BUY_WHEN_BASE_LEAVES_POOL === undefined ? true : truthy(process.env.BUY_WHEN_BASE_LEAVES_POOL),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatIds: parseTelegramChatIds(process.env.TELEGRAM_CHAT_ID || ""),
  telegramChatId: parseTelegramChatIds(process.env.TELEGRAM_CHAT_ID || "")[0] || "",
  // Hardcoded brand — ignore stale Render BOT_TITLE env if set to old names.
  botTitle: "Treasure_tradingbot",
  botTagline: "",
  telegramUrl: "",
  twitterUrl: "",
  websiteUrl: "",
  tradeEnabled: truthy(process.env.TRADE_ENABLED),
  rpcUrl: process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  // Optional Alchemy/QuickNode WSS — when set, Swap alerts become near-realtime via subscription.
  rpcWsUrl: process.env.RPC_WS_URL || "",
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
  walletAddress: process.env.WALLET_ADDRESS || "",
  swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoterAddress: process.env.QUOTER_ADDRESS || "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  uniswapV3Fee: Number(process.env.UNISWAP_V3_FEE || 10000),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 200),
  buyAmountsQuote: parseAmountOptions(process.env.BUY_AMOUNTS_QUOTE || "0.01,0.05,0.1,0.2,0.25"),
  sellPercents: parseAmountOptions(process.env.SELL_PERCENTS || "25,50,70")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100),
  minPortfolioLiquidityUsd: Number(process.env.MIN_PORTFOLIO_LIQUIDITY_USD || 50),
  minPortfolioValueUsd: Number(process.env.MIN_PORTFOLIO_VALUE_USD || 3),
  portfolioMaxTokens: Number(process.env.PORTFOLIO_MAX_TOKENS || 25),
  lpWethAddress: normalizeAddress(process.env.QUOTE_TOKEN_ADDRESS || "0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
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

function parseTelegramChatIds(value) {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

function addressOf(value) {
  if (value && typeof value === "object") return normalizeAddress(value.hash);
  return normalizeAddress(value);
}

async function fetchJson(url, options = {}, retries = 3) {
  let lastError;
  const { timeoutMs: rawTimeoutMs, ...fetchOptions } = options;
  const timeoutMs = Number(rawTimeoutMs || 30000);

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          "user-agent": "robinhood-uniswap-telegram-bot/1.0",
          ...(fetchOptions.headers || {}),
        },
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
        if (response.status >= 500 && attempt < retries) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw error;
      }

      return response.json();
    } catch (error) {
      lastError = error?.name === "AbortError" ? new Error(`Request timed out after ${timeoutMs}ms: ${url}`) : error;
      const message = String(lastError?.message || "");
      const retryable =
        message.includes("timed out") ||
        message.includes("500") ||
        message.includes("502") ||
        message.includes("503") ||
        message.includes("504");
      if (retryable && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function fetchTokenTransfersForPair(pairAddress) {
  const pair = normalizeAddress(pairAddress);
  if (!pair) return [];
  const maxItems = Math.max(50, Number(config.maxItems || 200));
  const maxPages = Math.max(1, Number(process.env.TRANSFER_MAX_PAGES || 6));
  const collected = [];
  let query = "";

  for (let page = 0; page < maxPages && collected.length < maxItems; page += 1) {
    const url = `${config.blockscoutBaseUrl}/api/v2/addresses/${pair}/token-transfers${query}`;
    const payload = await fetchJson(url, {}, 2);
    const items = payload.items || [];
    if (!items.length) break;
    collected.push(...items);

    const next = payload.next_page_params;
    if (!next || typeof next !== "object") break;
    query = `?${new URLSearchParams(Object.entries(next).map(([key, value]) => [key, String(value)]))}`;
  }

  return collected.slice(0, maxItems);
}

async function fetchTokenTransfers() {
  const pairs = [...watchedPairSet()];
  if (!pairs.length) return fetchTokenTransfersForPair(config.pairAddress);

  const chunks = await Promise.all(pairs.map((pair) => fetchTokenTransfersForPair(pair)));
  const merged = [];
  const seenKey = new Set();
  for (const items of chunks) {
    for (const item of items) {
      const key = `${item.transaction_hash}:${item.log_index}:${addressOf(item.from)}:${addressOf(item.to)}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      merged.push(item);
    }
  }
  return merged;
}

const poolMetaCache = new Map();
let cachedRpcProvider = null;

function getRpcProvider() {
  const { ethers } = require("ethers");
  const url = config.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  if (!cachedRpcProvider || cachedRpcProvider._walletRpcUrl !== url) {
    cachedRpcProvider = new ethers.JsonRpcProvider(url);
    cachedRpcProvider._walletRpcUrl = url;
  }
  return cachedRpcProvider;
}

async function getPoolMeta(pairAddress, provider = null) {
  const { ethers } = require("ethers");
  const pair = normalizeAddress(pairAddress);
  if (poolMetaCache.has(pair)) return poolMetaCache.get(pair);
  const rpc = provider || getRpcProvider();
  const pool = new ethers.Contract(
    pair,
    [
      "function token0() view returns (address)",
      "function token1() view returns (address)",
      "function fee() view returns (uint24)",
    ],
    rpc,
  );
  const [token0, token1, fee] = await Promise.all([pool.token0(), pool.token1(), pool.fee()]);
  const meta = {
    token0: normalizeAddress(token0),
    token1: normalizeAddress(token1),
    fee: Number(fee),
  };
  poolMetaCache.set(pair, meta);
  return meta;
}

function tradeFromV3SwapLog({ amount0, amount1, token0, token1, quoteToken, baseToken, txHash, blockNumber, timestampMs, recipient }) {
  const quote = normalizeAddress(quoteToken);
  const base = normalizeAddress(baseToken);
  const t0 = normalizeAddress(token0);
  const t1 = normalizeAddress(token1);
  const quoteIs0 = t0 === quote;
  const baseIs0 = t0 === base;
  if (!(quoteIs0 || t1 === quote) || !(baseIs0 || t1 === base)) return null;

  const quoteDelta = quoteIs0 ? amount0 : amount1;
  const baseDelta = baseIs0 ? amount0 : amount1;
  if (quoteDelta === 0n) return null;

  // Pool received quote token => market BUY of base.
  const side = quoteDelta > 0n ? "BUY" : "SELL";
  const quoteRaw = quoteDelta < 0n ? -quoteDelta : quoteDelta;
  const baseRaw = baseDelta < 0n ? -baseDelta : baseDelta;
  const { ethers } = require("ethers");
  const quoteAmount = Number(ethers.formatUnits(quoteRaw, 18));
  const baseAmount = Number(ethers.formatUnits(baseRaw, 18));
  const minQuote = Number(config.minQuoteAmount);
  if (Number.isFinite(minQuote) && minQuote > 0 && quoteAmount < minQuote * 0.95) return null;

  return {
    txHash: String(txHash || "").toLowerCase(),
    blockNumber: Number(blockNumber || 0),
    timestamp: new Date(timestampMs || Date.now()).toISOString(),
    side,
    trader: normalizeAddress(recipient) || "",
    baseRaw,
    quoteRaw,
    baseDecimals: 18,
    quoteDecimals: 18,
    baseAmount,
    quoteAmount,
    quoteUsdValue: Number.NaN,
    priceUsd: Number.NaN,
  };
}

async function initRpcSwapCursors(state) {
  if (!state.swapBlocks || typeof state.swapBlocks !== "object") state.swapBlocks = {};
  const provider = getRpcProvider();
  const latest = Number(await provider.getBlockNumber());
  for (const pair of watchedPairSet()) {
    state.swapBlocks[pair] = latest;
  }
  saveState(state);
  return latest;
}

async function pollRpcSwaps(state) {
  const { ethers } = require("ethers");
  const provider = getRpcProvider();
  const latest = Number(await provider.getBlockNumber());
  if (!state.swapBlocks || typeof state.swapBlocks !== "object") state.swapBlocks = {};

  const iface = new ethers.Interface([
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  ]);
  const topic = iface.getEvent("Swap").topicHash;
  const seen = new Set(state.seen || []);
  const now = Date.now();
  const lookback = Math.max(20, Number(config.rpcSwapLookbackBlocks || 100));
  const alerted = [];

  for (const pair of watchedPairSet()) {
    let fromBlock = Number(state.swapBlocks[pair] || 0);
    if (!fromBlock || fromBlock < latest - lookback) fromBlock = latest - lookback;
    if (fromBlock >= latest) {
      state.swapBlocks[pair] = latest;
      continue;
    }

    let meta;
    try {
      meta = await getPoolMeta(pair, provider);
    } catch (error) {
      console.warn(`RPC pool meta failed for ${pair}: ${error.message}`);
      continue;
    }

    if (
      !(
        (meta.token0 === config.baseTokenAddress || meta.token0 === config.quoteTokenAddress) &&
        (meta.token1 === config.baseTokenAddress || meta.token1 === config.quoteTokenAddress)
      )
    ) {
      state.swapBlocks[pair] = latest;
      continue;
    }

    // Keep trading fee aligned with the live tracked pool.
    if (Number.isFinite(meta.fee) && meta.fee > 0) config.uniswapV3Fee = meta.fee;

    let logs = [];
    try {
      logs = await provider.getLogs({
        address: pair,
        fromBlock: fromBlock + 1,
        toBlock: latest,
        topics: [topic],
      });
    } catch (error) {
      console.warn(`RPC getLogs failed for ${pair}: ${error.message}`);
      continue;
    }

    const blockTs = new Map();
    for (const log of logs) {
      const blockNumber = Number(log.blockNumber);
      if (blockTs.has(blockNumber)) continue;
      try {
        const block = await provider.getBlock(blockNumber);
        blockTs.set(blockNumber, block?.timestamp ? Number(block.timestamp) * 1000 : now);
      } catch {
        blockTs.set(blockNumber, now);
      }
    }

    for (const log of logs) {
      const txHash = String(log.transactionHash || "").toLowerCase();
      if (!txHash || seen.has(txHash)) continue;
      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue;
      }
      const tsMs = blockTs.get(Number(log.blockNumber)) || now;
      if (now - tsMs > Number(config.maxAlertAgeMs || 90_000)) {
        seen.add(txHash);
        continue;
      }
      const trade = tradeFromV3SwapLog({
        amount0: parsed.args.amount0,
        amount1: parsed.args.amount1,
        token0: meta.token0,
        token1: meta.token1,
        quoteToken: config.quoteTokenAddress,
        baseToken: config.baseTokenAddress,
        txHash,
        blockNumber: Number(log.blockNumber),
        timestampMs: tsMs,
        recipient: parsed.args.recipient,
      });
      if (!trade) {
        seen.add(txHash);
        continue;
      }
      alerted.push(txHash);
      seen.add(txHash);
      // Non-blocking: enrich + Telegram queue so RPC poll stays fast.
      emitTradeAlertAsync(trade, state);
    }

    state.swapBlocks[pair] = latest;
  }

  if (alerted.length) addSeen(state, alerted);
  saveState(state);
  return alerted.length;
}

// ============ Fast alert path: Telegram queue + optional WebSocket Swap feed ============
const alertTgQueue = [];
let alertTgWorkerRunning = false;
const ALERT_TG_BACKOFFS_MS = [1000, 3000, 8000];

const wsRuntime = {
  provider: null,
  healthy: false,
  reconnectAttempts: 0,
  listenedPairs: new Set(),
  stateRef: null,
  reconnectTimer: null,
};
const WS_RECONNECT_BACKOFFS_MS = [1000, 2000, 5000, 10000, 10000];

function enqueueTelegramAlert(text, replyMarkup = null) {
  alertTgQueue.push({ text, replyMarkup, attempts: 0 });
  if (!alertTgWorkerRunning) {
    processAlertTelegramQueue().catch((error) => {
      console.error(`Alert Telegram queue crashed: ${error.message}`);
      alertTgWorkerRunning = false;
    });
  }
}

async function processAlertTelegramQueue() {
  alertTgWorkerRunning = true;
  while (alertTgQueue.length) {
    const item = alertTgQueue[0];
    try {
      await sendTelegram(item.text, item.replyMarkup);
      alertTgQueue.shift();
    } catch (error) {
      item.attempts += 1;
      if (item.attempts > ALERT_TG_BACKOFFS_MS.length) {
        console.error(`Dropping alert after retries: ${error.message}`);
        alertTgQueue.shift();
        continue;
      }
      const wait = ALERT_TG_BACKOFFS_MS[item.attempts - 1];
      console.warn(`Alert Telegram retry ${item.attempts}/${ALERT_TG_BACKOFFS_MS.length} in ${wait}ms: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  alertTgWorkerRunning = false;
}

function emitTradeAlertAsync(trade, state) {
  Promise.resolve()
    .then(async () => {
      let priced = trade;
      try {
        priced = await withTimeout(enrichTradePrices(trade), 2_500, "price enrich");
      } catch {
        // send without USD rather than delaying the alert
      }
      enqueueTelegramAlert(tradeMessage(priced), alertTradeKeyboard());
    })
    .catch((error) => console.error(`emitTradeAlertAsync failed: ${error.message}`));
}

function claimSwapAlert(state, txHash) {
  const hash = String(txHash || "").toLowerCase();
  if (!hash) return false;
  const seen = new Set(state.seen || []);
  if (seen.has(hash)) return false;
  addSeen(state, [hash]);
  saveState(state);
  return true;
}

async function handleLiveSwapEvent({ pair, amount0, amount1, recipient, txHash, blockNumber }, state) {
  const hash = String(txHash || "").toLowerCase();
  if (!claimSwapAlert(state, hash)) return;

  let meta;
  try {
    meta = await getPoolMeta(pair);
  } catch (error) {
    console.warn(`WS pool meta failed for ${pair}: ${error.message}`);
    return;
  }

  if (
    !(
      (meta.token0 === config.baseTokenAddress || meta.token0 === config.quoteTokenAddress) &&
      (meta.token1 === config.baseTokenAddress || meta.token1 === config.quoteTokenAddress)
    )
  ) {
    return;
  }
  if (Number.isFinite(meta.fee) && meta.fee > 0) config.uniswapV3Fee = meta.fee;

  const trade = tradeFromV3SwapLog({
    amount0,
    amount1,
    token0: meta.token0,
    token1: meta.token1,
    quoteToken: config.quoteTokenAddress,
    baseToken: config.baseTokenAddress,
    txHash: hash,
    blockNumber: Number(blockNumber || 0),
    timestampMs: Date.now(),
    recipient,
  });
  if (!trade) return;

  if (!state.swapBlocks || typeof state.swapBlocks !== "object") state.swapBlocks = {};
  const bn = Number(blockNumber || 0);
  if (bn > 0) state.swapBlocks[normalizeAddress(pair)] = Math.max(Number(state.swapBlocks[normalizeAddress(pair)] || 0), bn);
  saveState(state);

  emitTradeAlertAsync(trade, state);
}

function isWsAlertHealthy() {
  return Boolean(config.rpcWsUrl && wsRuntime.healthy && wsRuntime.provider);
}

function destroyWsProvider() {
  try {
    wsRuntime.provider?.destroy?.();
  } catch {
    // ignore
  }
  wsRuntime.provider = null;
  wsRuntime.healthy = false;
  wsRuntime.listenedPairs.clear();
}

function scheduleWsReconnect(reason) {
  if (!config.rpcWsUrl) return;
  if (wsRuntime.reconnectTimer) return;

  if (wsRuntime.reconnectAttempts >= WS_RECONNECT_BACKOFFS_MS.length) {
    console.error(
      `WS reconnect failed after ${WS_RECONNECT_BACKOFFS_MS.length} tries (${reason}). Falling back to HTTP poll.`,
    );
    destroyWsProvider();
    wsRuntime.reconnectAttempts = 0;
    return;
  }

  const wait = WS_RECONNECT_BACKOFFS_MS[wsRuntime.reconnectAttempts];
  wsRuntime.reconnectAttempts += 1;
  console.warn(
    `WS down (${reason}). Reconnect ${wsRuntime.reconnectAttempts}/${WS_RECONNECT_BACKOFFS_MS.length} in ${wait}ms…`,
  );
  wsRuntime.healthy = false;
  wsRuntime.reconnectTimer = setTimeout(() => {
    wsRuntime.reconnectTimer = null;
    try {
      destroyWsProvider();
      startWsSwapListener(wsRuntime.stateRef || loadState());
    } catch (error) {
      console.error(`WS reconnect error: ${error.message}`);
      scheduleWsReconnect(error.message);
    }
  }, wait);
}

function startWsSwapListener(state) {
  if (!config.rpcWsUrl) return false;
  wsRuntime.stateRef = state;

  const { ethers } = require("ethers");
  destroyWsProvider();

  const safeUrl = String(config.rpcWsUrl).replace(/\/v2\/[^/]+$/i, "/v2/***");
  console.log(`Connecting Swap WebSocket: ${safeUrl}`);
  const provider = new ethers.WebSocketProvider(config.rpcWsUrl);
  wsRuntime.provider = provider;

  const abi = [
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  ];

  for (const pair of watchedPairSet()) {
    const pool = new ethers.Contract(pair, abi, provider);
    pool.on("Swap", (sender, recipient, amount0, amount1, _sqrt, _liq, _tick, event) => {
      const st = wsRuntime.stateRef || state;
      const txHash = event?.log?.transactionHash || event?.transactionHash || "";
      const blockNumber = event?.log?.blockNumber || event?.blockNumber || 0;
      handleLiveSwapEvent(
        { pair, amount0, amount1, recipient: recipient || sender, txHash, blockNumber },
        st,
      ).catch((error) => console.error(`WS Swap handler error: ${error.message}`));
    });
    wsRuntime.listenedPairs.add(pair);
  }

  const rawSocket = provider.websocket;
  if (rawSocket?.on) {
    rawSocket.on("close", () => scheduleWsReconnect("socket closed"));
    rawSocket.on("error", (err) => scheduleWsReconnect(err?.message || "socket error"));
  } else {
    console.warn("WS raw socket hooks unavailable — auto-reconnect may not fire.");
  }

  wsRuntime.healthy = true;
  wsRuntime.reconnectAttempts = 0;
  console.log(`✅ WS Swap listener active on ${wsRuntime.listenedPairs.size} pool(s).`);
  return true;
}

function refreshWsSwapListener(state) {
  if (!config.rpcWsUrl) return;
  if (!wsRuntime.healthy) {
    startWsSwapListener(state);
    return;
  }
  const wanted = [...watchedPairSet()];
  const same =
    wanted.length === wsRuntime.listenedPairs.size && wanted.every((pair) => wsRuntime.listenedPairs.has(pair));
  if (!same) {
    console.log("Tracked pools changed — refreshing WS subscriptions.");
    startWsSwapListener(state);
  } else {
    wsRuntime.stateRef = state;
  }
}

function isTransientHttpError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("timed out") ||
    message.includes("HTTP 500") ||
    message.includes("HTTP 502") ||
    message.includes("HTTP 503") ||
    message.includes("HTTP 504")
  );
}

async function fetchTransaction(txHash) {
  return fetchJson(`${config.blockscoutBaseUrl}/api/v2/transactions/${txHash}`);
}

async function fetchDexPair() {
  return fetchDexPairByAddress(config.pairAddress);
}

async function fetchDexPairByAddress(pairAddress) {
  const pair = normalizeAddress(pairAddress);
  if (!isEvmAddress(pair)) return null;
  const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${pair}`;
  const payload = await fetchJson(url);
  return payload.pair || payload.pairs?.[0] || null;
}

const dexTradePriceCache = { at: 0, priceUsd: Number.NaN, ethUsd: Number.NaN };

function applyTradeUsd(trade, { priceUsd, ethUsd } = {}) {
  const quoteAmount = Number(trade?.quoteAmount);
  const baseAmount = Number(trade?.baseAmount);
  const quoteUsdValue =
    Number.isFinite(ethUsd) && quoteAmount > 0
      ? quoteAmount * ethUsd
      : Number(trade?.quoteUsdValue);

  // Prefer Dexscreener spot so alerts match the chart; fall back to execution price.
  let displayPrice = Number(priceUsd);
  if (!Number.isFinite(displayPrice) && Number.isFinite(quoteUsdValue) && baseAmount > 0) {
    displayPrice = quoteUsdValue / baseAmount;
  }

  return {
    ...trade,
    quoteUsdValue: Number.isFinite(quoteUsdValue) ? quoteUsdValue : Number.NaN,
    priceUsd: Number.isFinite(displayPrice) ? displayPrice : Number.NaN,
  };
}

async function enrichTradePrices(trade) {
  const now = Date.now();
  let priceUsd = Number.NaN;
  let ethUsd = Number.NaN;

  if (now - dexTradePriceCache.at < 15_000) {
    priceUsd = dexTradePriceCache.priceUsd;
    ethUsd = dexTradePriceCache.ethUsd;
  } else {
    try {
      const pair = await fetchDexPair();
      priceUsd = Number(pair?.priceUsd);
      const priceNative = Number(pair?.priceNative);
      if (Number.isFinite(priceUsd) && Number.isFinite(priceNative) && priceNative > 0) {
        ethUsd = priceUsd / priceNative;
      }
    } catch {
      // ignore — fall back below
    }
    if (!Number.isFinite(ethUsd)) {
      try {
        ethUsd = await fetchEthPriceUsd();
      } catch {
        ethUsd = Number.NaN;
      }
    }
    dexTradePriceCache.at = now;
    dexTradePriceCache.priceUsd = priceUsd;
    dexTradePriceCache.ethUsd = ethUsd;
  }

  return applyTradeUsd(trade, { priceUsd, ethUsd });
}

async function fetchTokenPairs(tokenAddress) {
  return fetchJson(`https://api.dexscreener.com/token-pairs/v1/robinhood/${tokenAddress}`);
}

async function fetchWalletTokenBalances(walletAddress) {
  const url = `${config.blockscoutBaseUrl}/api/v2/addresses/${walletAddress}/token-balances`;
  const payload = await fetchJson(url);
  return Array.isArray(payload) ? payload : payload.items || [];
}

async function fetchDexTokens(tokenAddresses) {
  const addresses = [...new Set((tokenAddresses || []).map(normalizeAddress).filter(isEvmAddress))];
  if (!addresses.length) return [];

  const pairs = [];
  for (let index = 0; index < addresses.length; index += 30) {
    const chunk = addresses.slice(index, index + 30);
    const payload = await fetchJson(`https://api.dexscreener.com/tokens/v1/robinhood/${chunk.join(",")}`);
    if (Array.isArray(payload)) pairs.push(...payload);
  }
  return pairs;
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
  fs.writeFileSync(
    config.stateFile,
    `${JSON.stringify(state, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
  );
}

function startHealthServer() {
  const port = Number(process.env.PORT || 0);
  if (!port) {
    console.log("No PORT set; health server disabled (Background Worker mode).");
    return;
  }

  const server = http.createServer((req, res) => {
    const pathName = String(req.url || "/").split("?")[0];
    if (pathName === "/healthz" || pathName === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "robinhood-telegram-bot" }));
      return;
    }

    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Telegram bot is running.\n");
  });

  // Render Web Services probe 0.0.0.0:$PORT — binding localhost makes deploy hang.
  server.listen(port, "0.0.0.0", () => {
    console.log(`Health server listening on 0.0.0.0:${port}.`);
  });
}

function addSeen(state, hashes) {
  state.seen = [...new Set([...hashes, ...(state.seen || [])])].slice(0, 500);
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function shouldTradeImmediately() {
  return true;
}

function sniperTradeKeyboard() {
  return { inline_keyboard: tradeActionRows() };
}

async function quoteExactInputSingleAmount(provider, tokenIn, tokenOut, amountIn, preferredFee) {
  const { ethers } = require("ethers");
  const quoter = new ethers.Contract(
    config.quoterAddress,
    [
      "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
    ],
    provider,
  );
  const feeCandidates = [preferredFee, config.uniswapV3Fee, 10000, 3000, 500, 100].filter(
    (value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index,
  );
  let lastError = "";
  for (const fee of feeCandidates) {
    try {
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0,
      });
      const amountOut = BigInt(result.amountOut ?? result[0]);
      if (amountOut > 0n) return { amountOut, fee };
      lastError = "zero amount out";
    } catch (error) {
      lastError = error.shortMessage || error.message || String(error);
    }
  }
  throw new Error(lastError || "quoter failed");
}

async function assertNativeEthForBuy(wallet, amountIn) {
  const { ethers } = require("ethers");
  // Robinhood gas is cheap; keep a small reserve so buy amount + gas still fit.
  const gasReserve = ethers.parseEther("0.001");
  const nativeBal = await wallet.provider.getBalance(wallet.address);
  if (nativeBal < amountIn + gasReserve) {
    throw new Error(
      [
        `Not enough ETH for buy.`,
        `Need ${ethers.formatEther(amountIn)} ETH (+~0.001 gas).`,
        `Have ${ethers.formatEther(nativeBal)} ETH.`,
      ].join(" "),
    );
  }
  return amountIn;
}

async function assertEthForGas(wallet, label = "trade") {
  const { ethers } = require("ethers");
  const gasReserve = ethers.parseEther("0.001");
  const nativeBal = await wallet.provider.getBalance(wallet.address);
  if (nativeBal < gasReserve) {
    throw new Error(
      `Not enough ETH for gas (${label}). Need ~0.001 ETH, have ${ethers.formatEther(nativeBal)} ETH.`,
    );
  }
}

function formatSwapError(error) {
  const raw = String(error?.shortMessage || error?.reason || error?.message || error || "");
  if (/STF|transfer amount exceeds|insufficient allowance/i.test(raw)) {
    return "Token transfer/approve failed (balance hoặc allowance). Thử Sell lại hoặc Approve.";
  }
  if (/AS|amount|slippage|Too little|TOO_LITTLE|Price slippage/i.test(raw)) {
    return `Slippage/price moved. Tăng SLIPPAGE_BPS hoặc thử lại. (${raw.slice(0, 80)})`;
  }
  if (/insufficient funds/i.test(raw)) {
    return "Not enough ETH for value + gas.";
  }
  if (/execution reverted/i.test(raw) && raw.length > 160) {
    return `Swap reverted: ${raw.slice(0, 120)}…`;
  }
  return raw;
}

function isQuoteWethToken(tokenAddress) {
  return normalizeAddress(tokenAddress) === normalizeAddress(config.quoteTokenAddress || config.lpWethAddress);
}

function displayQuoteSymbol(symbol = config.quoteSymbol) {
  const upper = String(symbol || "").toUpperCase();
  return upper === "WETH" ? "ETH" : symbol || "ETH";
}

async function readTokenDecimals(tokenAddress, provider, fallback = 18) {
  try {
    const { ethers } = require("ethers");
    const token = new ethers.Contract(tokenAddress, ["function decimals() view returns (uint8)"], provider);
    const decimals = Number(await token.decimals());
    if (Number.isFinite(decimals) && decimals >= 0 && decimals <= 36) return decimals;
  } catch {
    // keep fallback
  }
  return fallback;
}

async function executeSwap(side, amountText, overrides = {}) {
  if (!config.tradeEnabled) {
    throw new Error("TRADE_ENABLED=0. Bật TRADE_ENABLED=1 sau khi cấu hình RPC_URL và WALLET_PRIVATE_KEY.");
  }

  if (!config.rpcUrl || !config.walletPrivateKey) {
    throw new Error("Missing RPC_URL or WALLET_PRIVATE_KEY.");
  }

  const baseTokenAddress = normalizeAddress(overrides.baseTokenAddress || config.baseTokenAddress);
  const baseSymbol = overrides.baseSymbol || config.baseSymbol;
  const quoteTokenAddress = normalizeAddress(overrides.quoteTokenAddress || config.quoteTokenAddress);
  const quoteSymbol = overrides.quoteSymbol || config.quoteSymbol;
  let swapFee = Number(overrides.fee || config.uniswapV3Fee);
  let decimalsIn = Number.isFinite(Number(overrides.decimals)) ? Number(overrides.decimals) : 18;
  const decimalsOut = 18;

  const { ethers } = require("ethers");
  const provider = getRpcProvider();
  const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
  const tokenIn = side === "BUY" ? quoteTokenAddress : baseTokenAddress;
  const tokenOut = side === "BUY" ? baseTokenAddress : quoteTokenAddress;
  const tokenInSymbol = side === "BUY" ? displayQuoteSymbol(quoteSymbol) : baseSymbol;
  const tokenOutSymbol = side === "BUY" ? baseSymbol : displayQuoteSymbol(quoteSymbol);
  const buyWithNativeEth = side === "BUY" && isQuoteWethToken(tokenIn);
  const sellToNativeEth = side === "SELL" && isQuoteWethToken(tokenOut);

  if (!buyWithNativeEth && side === "SELL" && !Number.isFinite(Number(overrides.decimals))) {
    decimalsIn = await readTokenDecimals(tokenIn, provider, 18);
  }

  const erc20Abi = [
    "function allowance(address owner,address spender) view returns (uint256)",
    "function approve(address spender,uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
  ];
  const routerAbi = [
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
    "function multicall(bytes[] data) payable returns (bytes[] results)",
  ];
  const inputToken = new ethers.Contract(tokenIn, erc20Abi, wallet);
  const pairAddress = normalizeAddress(overrides.pairAddress || config.pairAddress || "");

  let amountIn;
  const sellPercent = side === "SELL" ? parseSellPercent(amountText) : null;
  if (side === "SELL" && sellPercent !== null) {
    const balance = await inputToken.balanceOf(wallet.address);
    amountIn = balancePercent(balance, sellPercent);
    // Leave 1 wei dust on 100% sells so fee-on-transfer / rounding can't brick the swap.
    if (sellPercent >= 100 && amountIn > 1n) amountIn -= 1n;
    if (amountIn <= 0n) throw new Error(`No ${baseSymbol} balance to sell.`);
    amountText = ethers.formatUnits(amountIn, decimalsIn);
  } else {
    amountIn = ethers.parseUnits(String(amountText), decimalsIn);
  }

  const metaPromise = isEvmAddress(pairAddress)
    ? getPoolMeta(pairAddress, provider).catch(() => null)
    : Promise.resolve(null);

  const meta = await metaPromise;
  if (meta) {
    const matches =
      (meta.token0 === tokenIn && meta.token1 === tokenOut) ||
      (meta.token0 === tokenOut && meta.token1 === tokenIn);
    if (matches && Number.isFinite(meta.fee) && meta.fee > 0) swapFee = meta.fee;
  }

  const [quoted] = await Promise.all([
    quoteExactInputSingleAmount(provider, tokenIn, tokenOut, amountIn, swapFee),
    buyWithNativeEth ? assertNativeEthForBuy(wallet, amountIn) : assertEthForGas(wallet, side),
  ]);

  swapFee = quoted.fee;
  const minOut = (quoted.amountOut * BigInt(10000 - config.slippageBps)) / 10000n;
  if (minOut <= 0n) throw new Error("Quote minOut is zero — amount too small or pool illiquid.");
  const payValue = buyWithNativeEth ? amountIn : 0n;

  if (!buyWithNativeEth) {
    const balance = await inputToken.balanceOf(wallet.address);
    if (balance < amountIn) {
      throw new Error(
        `Not enough ${tokenInSymbol}. Need ${amountText}, wallet has ${ethers.formatUnits(balance, decimalsIn)} ${tokenInSymbol}`,
      );
    }

    const allowance = await inputToken.allowance(wallet.address, config.swapRouterAddress);
    if (allowance < amountIn) {
      const approveTx = await inputToken.approve(config.swapRouterAddress, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait(1);
      if (!approveReceipt || approveReceipt.status !== 1) {
        throw new Error("Approve transaction failed.");
      }
    }
  }

  const router = new ethers.Contract(config.swapRouterAddress, routerAbi, wallet);
  const swapParams = {
    tokenIn,
    tokenOut,
    fee: swapFee,
    recipient: wallet.address,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0,
  };

  let tx;
  try {
    if (sellToNativeEth) {
      swapParams.recipient = config.swapRouterAddress;
      tx = await router.multicall([
        router.interface.encodeFunctionData("exactInputSingle", [swapParams]),
        router.interface.encodeFunctionData("unwrapWETH9", [minOut, wallet.address]),
      ]);
    } else if (buyWithNativeEth) {
      tx = await router.exactInputSingle(swapParams, { value: payValue });
    } else {
      tx = await router.exactInputSingle(swapParams);
    }
  } catch (error) {
    throw new Error(formatSwapError(error));
  }

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Swap reverted on-chain. Tx: ${tx.hash}`);
  }

  return {
    hash: tx.hash,
    wallet: wallet.address,
    tokenInSymbol,
    tokenOutSymbol: sellToNativeEth ? "ETH" : tokenOutSymbol,
    minOut: ethers.formatUnits(minOut, decimalsOut),
    paidNative: buyWithNativeEth ? ethers.formatEther(payValue) : "",
    receivedNative: sellToNativeEth ? ethers.formatUnits(minOut, decimalsOut) : "",
  };
}

function parseBuyAmountText(text) {
  const value = String(text || "").trim();
  if (!/^[0-9]*\.?[0-9]+$/.test(value)) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return value;
}

function getPendingBuyPrompt(state, chatId) {
  const pending = state?.pendingBuyPrompt;
  if (!pending || String(pending.chatId) !== String(chatId)) return null;
  if (Date.now() - Number(pending.createdAt || 0) > 300_000) return null;
  return pending;
}

function clearPendingBuyPrompt(state) {
  if (state?.pendingBuyPrompt) {
    delete state.pendingBuyPrompt;
    saveState(state);
  }
}

function parseQuickTradeCallback(data) {
  if (!String(data || "").startsWith("qtrade:")) return null;
  const parts = String(data).split(":");
  if (parts.length < 3) return null;
  const side = String(parts[1] || "").toUpperCase();
  const amount = parts.slice(2).join(":").trim();
  if (!["BUY", "SELL"].includes(side) || !amount) return null;
  if (side === "BUY") {
    if (!/^[0-9]*\.?[0-9]+$/.test(amount)) return null;
    return { side, amount };
  }
  if (parseSellPercent(amount) !== null) return { side, amount: amount.toUpperCase() };
  if (/^[0-9]*\.?[0-9]+$/.test(amount)) return { side, amount };
  return null;
}

async function ensureRouterApprovals(state = null) {
  if (!config.tradeEnabled || !config.walletPrivateKey || !config.rpcUrl) return;

  const { ethers } = require("ethers");
  const wallet = new ethers.Wallet(config.walletPrivateKey, getRpcProvider());
  const erc20Abi = [
    "function allowance(address owner,address spender) view returns (uint256)",
    "function approve(address spender,uint256 amount) returns (bool)",
  ];
  const snapshot = state || loadState();
  const bagTokens = (snapshot?.portfolioSnapshot?.bagItems || [])
    .map((item) => normalizeAddress(item?.address))
    .filter(isEvmAddress);
  const tokens = [...new Set([config.baseTokenAddress, ...bagTokens].map(normalizeAddress).filter(isEvmAddress))];

  for (const token of tokens) {
    try {
      const tokenContract = new ethers.Contract(token, erc20Abi, wallet);
      const allowance = await tokenContract.allowance(wallet.address, config.swapRouterAddress);
      if (allowance >= ethers.MaxUint256 / 2n) continue;
      console.log(`Pre-approving router for ${compactAddress(token)}...`);
      const tx = await tokenContract.approve(config.swapRouterAddress, ethers.MaxUint256);
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) {
        console.warn(`Pre-approve failed for ${token}`);
      }
    } catch (error) {
      console.warn(`Pre-approve skipped for ${token}: ${error.message}`);
    }
  }
}

function parseSellPercent(amountText) {
  const value = String(amountText || "").trim().toUpperCase();
  if (value === "ALL" || value === "100%") return 100;
  const match = value.match(/^(\d{1,3})%$/);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return percent;
}

function balancePercent(balance, percent) {
  const pct = BigInt(Math.floor(Number(percent)));
  if (pct <= 0n) return 0n;
  if (pct >= 100n) return BigInt(balance);
  return (BigInt(balance) * pct) / 100n;
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
    watchPairAddresses: [],
  };
}

function isV3Pair(pair) {
  const labels = (pair?.labels || []).map((item) => String(item).toLowerCase());
  if (labels.includes("v4")) return false;
  return labels.includes("v3") || labels.length === 0;
}

function chooseWatchPairAddresses(pairs, tokenAddress, primaryPairAddress = "") {
  const token = normalizeAddress(tokenAddress);
  const primary = normalizeAddress(primaryPairAddress);
  const watched = [];
  if (primary) watched.push(primary);

  const ranked = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => normalizeAddress(pair.chainId) === "robinhood")
    .filter((pair) => {
      const base = normalizeAddress(pair.baseToken?.address);
      const quote = normalizeAddress(pair.quoteToken?.address);
      if (!(base === token || quote === token)) return false;
      const quoteSym = String(pair.quoteToken?.symbol || "").toUpperCase();
      const baseSym = String(pair.baseToken?.symbol || "").toUpperCase();
      const isWeth =
        quoteSym === "WETH" ||
        quoteSym === "ETH" ||
        baseSym === "WETH" ||
        baseSym === "ETH" ||
        quote === config.quoteTokenAddress ||
        base === config.quoteTokenAddress;
      return isWeth && isV3Pair(pair) && Number(pair.liquidity?.usd || 0) >= 1000;
    })
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));

  for (const pair of ranked.slice(0, 4)) {
    const address = normalizeAddress(pair.pairAddress);
    if (address && !watched.includes(address)) watched.push(address);
  }
  return watched;
}

function watchedPairSet(settings = config) {
  const list = settings.watchPairAddresses?.length
    ? settings.watchPairAddresses
    : [settings.pairAddress];
  return new Set((list || []).map(normalizeAddress).filter(Boolean));
}

function applyTrackedPair(trackedPair) {
  if (!trackedPair?.pairAddress || !trackedPair?.baseTokenAddress || !trackedPair?.quoteTokenAddress) return;

  config.pairAddress = normalizeAddress(trackedPair.pairAddress);
  config.dexscreenPairUrl = trackedPair.pairUrl || `https://dexscreener.com/robinhood/${trackedPair.pairAddress}`;
  config.baseTokenAddress = normalizeAddress(trackedPair.baseTokenAddress);
  config.baseSymbol = trackedPair.baseSymbol || config.baseSymbol;
  config.quoteTokenAddress = normalizeAddress(trackedPair.quoteTokenAddress);
  config.quoteSymbol = trackedPair.quoteSymbol || config.quoteSymbol;
  config.watchPairAddresses = (trackedPair.watchPairAddresses || [])
    .map(normalizeAddress)
    .filter(Boolean);
  if (!config.watchPairAddresses.includes(config.pairAddress)) {
    config.watchPairAddresses = [config.pairAddress, ...config.watchPairAddresses];
  }
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

function formatTokenAmount(value) {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toPrecision(4);
}

function formatPriceUsd(value) {
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  if (value >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `$${value.toPrecision(4)}`;
}

function getPortfolioWallet(state = {}) {
  const configured = normalizeAddress(state.portfolioWallet || config.walletAddress || "");
  if (configured) return configured;
  if (!config.walletPrivateKey) return "";

  try {
    const { ethers } = require("ethers");
    return normalizeAddress(new ethers.Wallet(config.walletPrivateKey).address);
  } catch {
    return "";
  }
}

function parseWalletBalanceEntry(entry) {
  const token = entry?.token || {};
  const address = normalizeAddress(token.address_hash || token.address);
  const decimals = Number(token.decimals ?? 18);
  const raw = BigInt(entry?.value || "0");
  const amount = unitsToNumber(raw, Number.isFinite(decimals) ? decimals : 18);
  const type = String(token.type || "ERC-20").toUpperCase();

  return {
    address,
    symbol: token.symbol || "TOKEN",
    name: token.name || "",
    decimals: Number.isFinite(decimals) ? decimals : 18,
    amount,
    raw,
    type,
    exchangeRate: Number(token.exchange_rate),
  };
}

function bestPairMapForTokens(pairs, tokenAddresses) {
  const wanted = new Set((tokenAddresses || []).map(normalizeAddress));
  const bestByToken = new Map();

  for (const address of wanted) {
    const pair = chooseBestPairForToken(pairs, address);
    if (pair) bestByToken.set(address, pair);
  }

  return bestByToken;
}

function isTradeablePortfolioItem(item, options = {}) {
  const minLiquidityUsd = Number(options.minLiquidityUsd ?? config.minPortfolioLiquidityUsd);
  const minValueUsd = Number(options.minValueUsd ?? config.minPortfolioValueUsd);
  if (!item) return false;
  if (!(item.amount > 0)) return false;
  if (!Number.isFinite(item.priceUsd) || item.priceUsd <= 0) return false;
  if (!Number.isFinite(item.liquidityUsd) || item.liquidityUsd < minLiquidityUsd) return false;
  if (!Number.isFinite(item.valueUsd) || item.valueUsd < minValueUsd) return false;
  return true;
}

function serializePortfolioItem(item) {
  if (!item) return null;
  return {
    address: normalizeAddress(item.address),
    symbol: item.symbol || "TOKEN",
    name: item.name || "",
    decimals: Number(item.decimals) || 18,
    amount: Number(item.amount) || 0,
    type: item.type || "ERC-20",
    priceUsd: Number(item.priceUsd),
    liquidityUsd: Number(item.liquidityUsd),
    valueUsd: Number(item.valueUsd),
    pairAddress: normalizeAddress(item.pairAddress || ""),
    pairUrl: item.pairUrl || "",
  };
}

function isBagSellableItem(item) {
  if (!item || !isEvmAddress(item.address)) return false;
  if (item.address === normalizeAddress(config.quoteTokenAddress || config.lpWethAddress)) return false;
  if (!(Number(item.amount) > 0)) return false;
  if (!Number.isFinite(Number(item.priceUsd)) || Number(item.priceUsd) <= 0) return false;
  if (!isEvmAddress(item.pairAddress)) return false;
  // Show bag buttons even for small bags (portfolio text still uses stricter tradeable filter).
  return Number.isFinite(Number(item.valueUsd)) && Number(item.valueUsd) >= 0.01;
}

function buildPortfolioFromBalances(balances, pairs, options = {}) {
  const minLiquidityUsd = Number(options.minLiquidityUsd ?? config.minPortfolioLiquidityUsd);
  const minValueUsd = Number(options.minValueUsd ?? config.minPortfolioValueUsd);
  const maxTokens = Number(options.maxTokens ?? config.portfolioMaxTokens);
  const filterOptions = { minLiquidityUsd, minValueUsd };
  const parsed = (balances || [])
    .map(parseWalletBalanceEntry)
    .filter((item) => item.address && item.type.includes("ERC-20") && item.amount > 0);

  const bestByToken = bestPairMapForTokens(pairs, parsed.map((item) => item.address));
  const tradeable = [];
  const bagCandidates = [];
  let skipped = 0;
  let totalUsd = 0;

  for (const item of parsed) {
    const pair = bestByToken.get(item.address);
    const priceUsd = Number(pair?.priceUsd);
    const liquidityUsd = Number(pair?.liquidity?.usd);
    const valueUsd = Number.isFinite(priceUsd) ? item.amount * priceUsd : NaN;
    const enriched = {
      address: item.address,
      symbol: item.symbol,
      name: item.name,
      decimals: item.decimals,
      amount: item.amount,
      type: item.type,
      priceUsd,
      liquidityUsd,
      valueUsd,
      pairAddress: normalizeAddress(pair?.pairAddress || ""),
      pairUrl: pair?.url || (pair?.pairAddress ? `https://dexscreener.com/robinhood/${pair.pairAddress}` : ""),
    };

    if (Number.isFinite(valueUsd) && valueUsd > 0) totalUsd += valueUsd;
    if (isBagSellableItem(enriched)) bagCandidates.push(enriched);

    if (isTradeablePortfolioItem(enriched, filterOptions)) {
      tradeable.push(enriched);
    } else {
      skipped += 1;
    }
  }

  tradeable.sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0));
  bagCandidates.sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0));
  const items = tradeable.slice(0, maxTokens).map(serializePortfolioItem);
  const bagItems = bagCandidates.slice(0, 6).map(serializePortfolioItem);

  return {
    items,
    bagItems,
    skipped,
    totalUsd,
    updatedAt: new Date().toISOString(),
  };
}

async function buildPortfolio(walletAddress, options = {}) {
  const wallet = normalizeAddress(walletAddress);
  if (!isEvmAddress(wallet)) {
    throw new Error("Portfolio wallet chưa được cấu hình. Gửi /wallet 0x... hoặc set WALLET_ADDRESS.");
  }

  const balances = await fetchWalletTokenBalances(wallet);
  const tokenAddresses = balances
    .map(parseWalletBalanceEntry)
    .filter((item) => item.address && item.type.includes("ERC-20") && item.amount > 0)
    .map((item) => item.address);
  const pairs = await fetchDexTokens(tokenAddresses);
  const portfolio = buildPortfolioFromBalances(balances, pairs, options);
  return { wallet, ...portfolio };
}

function portfolioSectionText(portfolio) {
  if (!portfolio?.wallet) {
    return [
      `<b>📦 Portfolio</b>`,
      "Chưa có ví. Gửi <code>/wallet 0x...</code> hoặc cấu hình WALLET_ADDRESS.",
    ].join("\n");
  }

  if (portfolio.error) {
    return [
      `<b>📦 Portfolio</b>`,
      `Wallet: <code>${escapeHtml(compactAddress(portfolio.wallet))}</code>`,
      `Không lấy được giá: ${escapeHtml(portfolio.error)}`,
      "<i>Bấm Update Price để thử lại.</i>",
    ].join("\n");
  }

  const items = Array.isArray(portfolio.items) ? portfolio.items : [];
  const bagItems = Array.isArray(portfolio.bagItems) ? portfolio.bagItems : [];
  const displayItems = bagItems.length ? bagItems : items;
  const lines = [
    `<b>📦 Portfolio</b>`,
    `Bags: <b>${displayItems.length}</b> · Hidden: <b>${Number(portfolio.skipped) || 0}</b>`,
  ];

  if (!displayItems.length) {
    lines.push(`Không còn token ≥ $0.01 với pair WETH để bán.`);
  } else {
    for (const item of displayItems) {
      const chart = item.pairUrl ? ` <a href="${escapeHtml(item.pairUrl)}">chart</a>` : "";
      lines.push(
        `↳ <b>${escapeHtml(item.symbol)}</b> ${escapeHtml(formatTokenAmount(item.amount))} · ${escapeHtml(formatPriceUsd(item.priceUsd))} · <b>${escapeHtml(formatUsd(item.valueUsd))}</b>${chart}`,
      );
    }
  }

  lines.push("<i>Bấm token bên dưới để Sell bag · Update Price để quét lại.</i>");
  return lines.join("\n");
}

function portfolioPanelText(portfolio) {
  return portfolioSectionText(portfolio);
}

function portfolioKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Update Price", callback_data: "portfolio:refresh" }],
      [{ text: "Main Menu", callback_data: "menu" }],
    ],
  };
}

function cachePortfolioSnapshot(state, portfolio) {
  if (!portfolio?.wallet) return null;
  const items = (Array.isArray(portfolio.items) ? portfolio.items : [])
    .map(serializePortfolioItem)
    .filter(Boolean);
  const bagItems = (Array.isArray(portfolio.bagItems) ? portfolio.bagItems : items)
    .map(serializePortfolioItem)
    .filter(Boolean);
  const snapshot = {
    wallet: portfolio.wallet,
    items,
    bagItems,
    skipped: Number(portfolio.skipped) || 0,
    totalUsd: Number(portfolio.totalUsd) || 0,
    updatedAt: portfolio.updatedAt || new Date().toISOString(),
    error: portfolio.error || "",
  };
  state.portfolioWallet = portfolio.wallet;
  state.portfolioSnapshot = snapshot;
  state.portfolioCache = {
    totalUsd: snapshot.totalUsd,
    count: snapshot.items.length,
    skipped: snapshot.skipped,
    updatedAt: snapshot.updatedAt,
  };
  saveState(state);
  return snapshot;
}

async function resolveMenuPortfolio(state = {}, { forceRefresh = false } = {}) {
  const wallet = getPortfolioWallet(state);
  if (!wallet) return null;

  const cached = state.portfolioSnapshot;
  if (
    !forceRefresh &&
    cached?.wallet === wallet &&
    Array.isArray(cached.items) &&
    !cached.error
  ) {
    return cached;
  }

  try {
    const portfolio = await withTimeout(buildPortfolio(wallet), 12_000, "Portfolio");
    return cachePortfolioSnapshot(state, portfolio);
  } catch (error) {
    if (cached?.wallet === wallet && Array.isArray(cached.items)) {
      console.warn(`Portfolio refresh failed, using cache: ${error.message}`);
      return cached;
    }
    return cachePortfolioSnapshot(state, {
      wallet,
      items: [],
      skipped: 0,
      totalUsd: 0,
      error: error.message,
    });
  }
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
  if (chatId === undefined || chatId === null) return false;
  return config.telegramChatIds.includes(String(chatId));
}

const unauthorizedReplyCache = new Set();

async function notifyUnauthorizedChat(chatId) {
  const key = String(chatId);
  if (unauthorizedReplyCache.has(key)) return;
  unauthorizedReplyCache.add(key);

  try {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        "Chat này chưa được phép dùng bot.",
        `Chat ID của bạn: <code>${escapeHtml(key)}</code>`,
        "Thêm ID này vào TELEGRAM_CHAT_ID trên Render (có thể nối nhiều ID bằng dấu phẩy).",
        `Bot hiện chỉ chấp nhận: <code>${escapeHtml(config.telegramChatIds.join(", ") || "(chưa cấu hình)")}</code>`,
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
    console.warn(`Ignored unauthorized chat ${key}; sent setup hint once.`);
  } catch (error) {
    console.warn(`Ignored unauthorized chat ${key}; could not send setup hint: ${error.message}`);
  }
}

function chunkButtons(buttons, size = 2) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }
  return rows;
}

function tradeActionRows() {
  const buyButtons = [
    ...config.buyAmountsQuote.map((amount) => ({
      text: `Buy ${amount}`,
      callback_data: `qtrade:BUY:${amount}`,
    })),
    { text: "Buy custom", callback_data: "buy:custom" },
  ];
  const sellButtons = [
    ...(config.sellPercents || [25, 50, 70]).map((percent) => ({
      text: `${percent}%`,
      callback_data: `qtrade:SELL:${percent}%`,
    })),
    { text: `All ${config.baseSymbol}`, callback_data: "qtrade:SELL:ALL" },
  ];

  return [...chunkButtons(buyButtons, 2), ...chunkButtons(sellButtons, 4)];
}

function alertTradeKeyboard() {
  return mainMenuKeyboard();
}

function mainMenuKeyboard(portfolio = null) {
  return {
    inline_keyboard: [
      ...tradeActionRows(),
      [
        { text: "Chart", url: config.dexscreenPairUrl },
        { text: "Update Price", callback_data: "portfolio:refresh" },
      ],
      ...bagButtonRows(portfolio),
    ],
  };
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

function bagButtonRows(portfolio, maxTokens = 6) {
  const source = Array.isArray(portfolio?.bagItems) && portfolio.bagItems.length
    ? portfolio.bagItems
    : Array.isArray(portfolio?.items)
      ? portfolio.items
      : [];
  const items = source.filter((item) => isEvmAddress(item?.address)).slice(0, maxTokens);
  const buttons = items.map((item) => ({
    text: formatBagButtonLabel(item),
    callback_data: `bag:${normalizeAddress(item.address)}`,
  }));
  return chunkButtons(buttons, 2);
}

function findBagItem(state, tokenAddress) {
  const token = normalizeAddress(tokenAddress);
  const lists = [
    ...(state?.portfolioSnapshot?.bagItems || []),
    ...(state?.portfolioSnapshot?.items || []),
  ];
  return lists.find((item) => normalizeAddress(item.address) === token) || null;
}

function bagSellPanelText(item, extras = {}) {
  if (!item?.address) {
    return [`<b>Sell bag</b>`, "Token không còn trong portfolio. Bấm Update Price rồi thử lại."].join("\n");
  }
  const chart = item.pairUrl ? `<a href="${escapeHtml(item.pairUrl)}">Dexscreener</a>` : "";
  return [
    `<b>Sell ${escapeHtml(item.symbol || "TOKEN")}</b>`,
    `Balance: <b>${escapeHtml(formatTokenAmount(item.amount))}</b> · Value: <b>${escapeHtml(formatUsd(item.valueUsd))}</b>`,
    `Price: <b>${escapeHtml(formatPriceUsd(item.priceUsd))}</b>`,
    chart ? `Pair: ${chart}` : "",
    extras.note || "",
    "",
    `Sniper đang track: <b>${escapeHtml(config.baseSymbol)}</b> (bán bag không đổi track).`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function bagSellKeyboard(item) {
  const token = normalizeAddress(item?.address);
  const symbol = item?.symbol || "TOKEN";
  const sellButtons = [
    ...(config.sellPercents || [25, 50, 70]).map((percent) => ({
      text: `${percent}%`,
      callback_data: `bagsell:${token}:${percent}%`,
    })),
    { text: `All`, callback_data: `bagsell:${token}:ALL` },
  ];
  return {
    inline_keyboard: [
      ...chunkButtons(sellButtons, 4),
      [
        { text: `Track ${symbol}`, callback_data: `bagtrack:${token}` },
        { text: "Main Menu", callback_data: "menu" },
      ],
    ],
  };
}

function formatBagButtonLabel(item) {
  const sym = String(item?.symbol || "TOKEN").slice(0, 10);
  const value = Number(item?.valueUsd);
  if (!Number.isFinite(value)) return sym;
  if (value >= 100) return `${sym} $${Math.round(value)}`;
  if (value >= 1) return `${sym} $${value.toFixed(2)}`;
  return `${sym} $${Number(value.toPrecision(3))}`;
}

const ethPriceCache = { at: 0, value: Number.NaN };
let nativeBalanceCache = { at: 0, wallet: "", value: "" };

async function getNativeBalance(walletAddress) {
  if (!config.rpcUrl || !walletAddress) return "";
  const wallet = normalizeAddress(walletAddress);
  if (nativeBalanceCache.wallet === wallet && Date.now() - nativeBalanceCache.at < 10_000) {
    return nativeBalanceCache.value;
  }

  try {
    const provider = getRpcProvider();
    const balance = await provider.getBalance(wallet);
    const { ethers } = require("ethers");
    const value = ethers.formatEther(balance);
    nativeBalanceCache = { at: Date.now(), wallet, value };
    return value;
  } catch {
    return "";
  }
}

async function fetchEthPriceUsd() {
  if (Date.now() - ethPriceCache.at < 30_000 && Number.isFinite(ethPriceCache.value)) {
    return ethPriceCache.value;
  }
  try {
    const weth = normalizeAddress(config.quoteTokenAddress || config.lpWethAddress);
    const pairs = await fetchTokenPairs(weth);
    const list = (Array.isArray(pairs) ? pairs : []).filter(
      (pair) => normalizeAddress(pair.chainId) === "robinhood" && Number(pair.liquidity?.usd || 0) > 0,
    );

    // Prefer WETH priced against a stable quote.
    const stable = list
      .filter((pair) => {
        const base = normalizeAddress(pair.baseToken?.address);
        const quoteSym = String(pair.quoteToken?.symbol || "").toUpperCase();
        return base === weth && (quoteSym.includes("USD") || quoteSym === "USDC" || quoteSym === "USDG");
      })
      .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
    if (stable && Number(stable.priceUsd) > 0) {
      ethPriceCache.at = Date.now();
      ethPriceCache.value = Number(stable.priceUsd);
      return ethPriceCache.value;
    }

    // Fallback: any liquid pair involving WETH — derive ETH from token USD / native.
    for (const pair of list.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))) {
      const priceUsd = Number(pair.priceUsd);
      const priceNative = Number(pair.priceNative);
      const base = normalizeAddress(pair.baseToken?.address);
      const quote = normalizeAddress(pair.quoteToken?.address);
      if (base === weth && priceUsd > 0) {
        ethPriceCache.at = Date.now();
        ethPriceCache.value = priceUsd;
        return priceUsd;
      }
      if (quote === weth && priceUsd > 0 && priceNative > 0) {
        ethPriceCache.at = Date.now();
        ethPriceCache.value = priceUsd / priceNative;
        return ethPriceCache.value;
      }
    }
  } catch {
    // ignore
  }
  return Number.isFinite(ethPriceCache.value) ? ethPriceCache.value : Number.NaN;
}

async function mainPanelText(options = {}) {
  const portfolioPromise =
    options.portfolio !== undefined
      ? Promise.resolve(options.portfolio)
      : options.state
        ? resolveMenuPortfolio(options.state, { forceRefresh: Boolean(options.refreshPortfolio) })
        : Promise.resolve(null);

  const wallet = await getDisplayWallet();
  const [ethUsd, balance, portfolio] = await Promise.all([
    fetchEthPriceUsd(),
    getNativeBalance(wallet),
    portfolioPromise,
  ]);
  const priceText = Number.isFinite(ethUsd) ? `$${ethUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "n/a";
  const walletText = wallet ? compactAddress(wallet) : "Not configured";
  const balanceText = balance ? `${Number(balance).toPrecision(6)} ETH` : "n/a";

  const portfolioTotal =
    Number.isFinite(Number(portfolio?.totalUsd)) && Number(portfolio.totalUsd) > 0
      ? Number(portfolio.totalUsd)
      : null;
  const totalUsdText = portfolioTotal != null ? formatUsd(portfolioTotal) : "n/a";

  return [
    `🚀 <b>${escapeHtml(config.botTitle)}</b>`,
    "",
    `💰 <b>ETH Price:</b> <code>${escapeHtml(priceText)}</code>`,
    `💵 <b>Total USD:</b> <code>${escapeHtml(totalUsdText)}</code>`,
    "",
    `💳 <b>Your Wallet</b>`,
    `↳ <code>${escapeHtml(walletText)}</code>`,
    `↳ <b>Balance:</b> <code>${escapeHtml(balanceText)}</code>`,
    "",
    portfolioSectionText(portfolio),
  ].join("\n");
}

function staticMainPanelText() {
  return [
    `🚀 <b>${escapeHtml(config.botTitle)}</b>`,
    "",
    `💰 <b>ETH Price:</b> <code>n/a</code>`,
    `💵 <b>Total USD:</b> <code>n/a</code>`,
    "",
    `💳 <b>Your Wallet</b>`,
    `↳ <code>${escapeHtml(config.walletAddress ? compactAddress(config.walletAddress) : "Not configured")}</code>`,
    `↳ <b>Balance:</b> <code>n/a</code>`,
    "",
    portfolioSectionText(null),
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

function isPlaceholderTelegramToken(token) {
  return !token || token === "123456:replace_me" || token.toLowerCase().includes("replace_me");
}

function maskToken(token) {
  if (!token) return "(empty)";
  const [botId, secret = ""] = token.split(":");
  return `${botId}:${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function isPollingConflictError(error) {
  const message = String(error?.message || "");
  return message.includes("409") || message.includes("Conflict") || message.includes("terminated by other getUpdates");
}

async function prepareTelegramPolling() {
  try {
    const info = await telegramRequest("getWebhookInfo", {});
    const webhookUrl = info.result?.url || "";
    if (webhookUrl) {
      console.log(`Telegram webhook was set (${webhookUrl}); removing it so polling can receive updates.`);
    }
  } catch (error) {
    console.warn(`Could not read Telegram webhook info: ${error.message}`);
  }

  try {
    await telegramRequest("deleteWebhook", { drop_pending_updates: false });
    console.log("Telegram polling ready (webhook cleared).");
  } catch (error) {
    console.warn(`Could not clear Telegram webhook: ${error.message}`);
  }
}

async function validateTelegramConfig() {
  if (config.dryRun) return;
  if (isPlaceholderTelegramToken(config.telegramBotToken)) {
    throw new Error(
      "Invalid TELEGRAM_BOT_TOKEN: value is empty or still uses 123456:replace_me. Set the real BotFather token in Render Environment.",
    );
  }
  if (!config.telegramChatIds.length) throw new Error("Missing TELEGRAM_CHAT_ID.");

  try {
    const payload = await telegramRequest("getMe", {});
    const username = payload.result?.username ? `@${payload.result.username}` : payload.result?.first_name || "unknown bot";
    console.log(`Telegram token OK for ${username}; token ${maskToken(config.telegramBotToken)}.`);
    console.log(`Telegram commands/alerts limited to chat ID(s): ${config.telegramChatIds.join(", ")}`);
  } catch (error) {
    if (String(error.message).includes("401") || String(error.message).includes("Unauthorized")) {
      throw new Error(
        `Telegram rejected TELEGRAM_BOT_TOKEN (${maskToken(config.telegramBotToken)}). Copy a fresh token from BotFather and update Render Environment.`,
      );
    }
    throw error;
  }

  await prepareTelegramPolling();
}

async function sendMainMenu(chatId = config.telegramChatId, state = loadState()) {
  const portfolio = state.portfolioSnapshot || {
    wallet: getPortfolioWallet(state),
    items: [],
    bagItems: [],
    skipped: 0,
    totalUsd: 0,
  };

  let text;
  try {
    text = await withTimeout(mainPanelText({ state, portfolio }), 3_500, "Main panel");
  } catch (error) {
    text = staticMainPanelText();
    text += `\n\n<i>Menu partial: ${escapeHtml(error.message)}</i>`;
  }

  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(portfolio),
  });
}

async function showPortfolio(chatId, state, { editCallback = null, announce = false, forceRefresh = true } = {}) {
  if (announce) {
    const wallet = getPortfolioWallet(state);
    if (wallet) {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: `Đang cập nhật giá portfolio cho:\n<code>${escapeHtml(wallet)}</code>`,
        parse_mode: "HTML",
        disable_web_page_preview: "true",
      });
    }
  }

  const text = await mainPanelText({ state, refreshPortfolio: forceRefresh }).catch((error) => {
    console.warn(`Portfolio panel failed: ${error.message}`);
    return `${staticMainPanelText()}\n\n<i>Portfolio lỗi: ${escapeHtml(error.message)}</i>`;
  });
  if (editCallback) {
    await editTradeMessage(editCallback, text, mainMenuKeyboard(state.portfolioSnapshot));
    return state.portfolioSnapshot || null;
  }

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
  });
  return state.portfolioSnapshot || null;
}

async function setPortfolioWallet(walletAddress, state, chatId) {
  const wallet = normalizeAddress(walletAddress);
  if (!isEvmAddress(wallet)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "Địa chỉ ví không hợp lệ. Ví dụ: <code>/wallet 0x...</code>",
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
    return;
  }

  state.portfolioWallet = wallet;
  saveState(state);
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `Đã gắn portfolio wallet:\n<code>${escapeHtml(wallet)}</code>`,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
  });
  await showPortfolio(chatId, state);
}

async function withTimeout(promise, timeoutMs, label = "operation") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function followTokenAddress(tokenAddress, state, chatId) {
  const pairs = await fetchTokenPairs(tokenAddress);
  const pair = chooseBestPairForToken(pairs, tokenAddress);
  if (!pair) {
    try {
      const balances = await fetchWalletTokenBalances(tokenAddress);
      const hasTokens = balances.some((entry) => {
        const item = parseWalletBalanceEntry(entry);
        return item.address && item.amount > 0;
      });
      if (hasTokens) {
        await setPortfolioWallet(tokenAddress, state, chatId);
        return;
      }
    } catch (error) {
      console.warn(`Could not treat ${tokenAddress} as wallet: ${error.message}`);
    }

    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Không tìm thấy pool Robinhood cho contract:\n<code>${escapeHtml(tokenAddress)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  const trackedPair = trackedPairFromDexPair(pair, tokenAddress);
  trackedPair.watchPairAddresses = chooseWatchPairAddresses(pairs, tokenAddress, trackedPair.pairAddress);
  applyTrackedPair(trackedPair);
  state.trackedPair = trackedPair;
  state.seen = [];
  state.lp = null;

  try {
    // Mark current history as seen — do NOT backfill old buys/sells.
    const groups = groupTransfers(await fetchTokenTransfers());
    addSeen(
      state,
      groups.map((group) => group.hash),
    );
  } catch (error) {
    console.warn(`Could not warm seen transactions for ${trackedPair.baseSymbol}: ${error.message}`);
  }

  try {
    await initRpcSwapCursors(state);
  } catch (error) {
    console.warn(`Could not init RPC swap cursor: ${error.message}`);
  }

  try {
    const meta = await getPoolMeta(trackedPair.pairAddress);
    if (Number.isFinite(meta.fee) && meta.fee > 0) config.uniswapV3Fee = meta.fee;
  } catch (error) {
    console.warn(`Could not read pool fee: ${error.message}`);
  }

  saveState(state);
  refreshWsSwapListener(state);

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      `<b>Tracking ${escapeHtml(trackedPair.baseSymbol)}</b>`,
      `Chỉ theo dõi buy/sell realtime (≥${config.minQuoteAmount} ${escapeHtml(trackedPair.quoteSymbol)}).`,
      `Pair: <code>${escapeHtml(compactAddress(trackedPair.pairAddress))}</code>`,
      trackedPair.watchPairAddresses?.length > 1
        ? `Watching <b>${trackedPair.watchPairAddresses.length}</b> WETH pools`
        : "",
      `<a href="${escapeHtml(trackedPair.pairUrl)}">Dexscreener</a>`,
    ]
      .filter(Boolean)
      .join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
  });
}


const trackJobs = [];
let trackWorkerRunning = false;

async function enqueueFollowToken(tokenAddress, state, chatId) {
  trackJobs.push({ tokenAddress, state, chatId });
  if (trackWorkerRunning) return;
  trackWorkerRunning = true;
  try {
    while (trackJobs.length) {
      const job = trackJobs.shift();
      try {
        await followTokenAddress(job.tokenAddress, job.state, job.chatId);
      } catch (error) {
        console.error(`followTokenAddress failed: ${error.message}`);
        try {
          await telegramRequest("sendMessage", {
            chat_id: job.chatId,
            text: `Không theo dõi được token:\n<code>${escapeHtml(job.tokenAddress)}</code>\n${escapeHtml(error.message)}`,
            parse_mode: "HTML",
            disable_web_page_preview: "true",
            reply_markup: mainMenuKeyboard(job.state?.portfolioSnapshot),
          });
        } catch {
          // ignore
        }
      }
    }
  } finally {
    trackWorkerRunning = false;
  }
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
  const pairs = watchedPairSet(settings);
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
    if (pairs.has(dst)) direction += 1n;
    if (pairs.has(src)) direction -= 1n;
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
  let baseAmount = unitsToNumber(baseRaw, baseDecimals);
  let quoteAmount = unitsToNumber(quoteRaw, quoteDecimals);
  let quoteUsdValue = Number.isFinite(quoteUsd) ? quoteAmount * quoteUsd : baseAmount * baseUsd;
  const priceUsd = baseAmount > 0 ? quoteUsdValue / baseAmount : baseUsd;

  // If WETH transfer missing from this page, estimate size from token USD rate.
  if (quoteRaw === 0n && Number.isFinite(baseUsd) && baseUsd > 0 && Number.isFinite(quoteUsd) && quoteUsd > 0) {
    quoteAmount = (baseAmount * baseUsd) / quoteUsd;
    quoteUsdValue = baseAmount * baseUsd;
  }

  const minQuote = Number(settings.minQuoteAmount);
  // Soft floor: 0.95 ETH counts when threshold is 1 (fee/rounding near-1 buys).
  if (Number.isFinite(minQuote) && minQuote > 0 && quoteAmount < minQuote * 0.95) return null;
  if (Number.isFinite(quoteUsdValue) && quoteUsdValue < settings.minUsd) return null;

  return {
    txHash: tx.hash,
    blockNumber: Number(tx.block_number || 0),
    timestamp: String(tx.timestamp || ""),
    side,
    trader: addressOf(tx.from),
    baseRaw,
    quoteRaw: quoteRaw > 0n ? quoteRaw : 0n,
    baseDecimals,
    quoteDecimals,
    baseAmount,
    quoteAmount,
    quoteUsdValue,
    priceUsd,
  };
}

function guessTrader(transfers, settings = config) {
  const pairs = watchedPairSet(settings);
  for (const transfer of transfers) {
    if (transferTokenAddress(transfer) !== settings.baseTokenAddress) continue;
    const src = addressOf(transfer.from);
    const dst = addressOf(transfer.to);

    if (pairs.has(dst) && !pairs.has(src)) return src;
    if (pairs.has(src) && !pairs.has(dst)) return dst;
  }

  for (const transfer of transfers) {
    const src = addressOf(transfer.from);
    const dst = addressOf(transfer.to);
    if (src && !pairs.has(src)) return src;
    if (dst && !pairs.has(dst)) return dst;
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

function tradeSideLabel(side) {
  const value = String(side || "").toUpperCase();
  if (value === "BUY") return "🟢 BUY";
  if (value === "SELL") return "🔴 SELL";
  return value || "TRADE";
}

function tradeMessage(trade) {
  const txUrl = `${config.blockscoutBaseUrl}/tx/${trade.txHash}`;
  const sideLabel = tradeSideLabel(trade.side);
  return [
    `<b>${sideLabel} ${escapeHtml(config.baseSymbol)}</b> on Robinhood Uniswap`,
    `Amount: <b>${escapeHtml(formatUnits(trade.baseRaw, trade.baseDecimals, 4))} ${escapeHtml(config.baseSymbol)}</b>`,
    `Quote: <b>${escapeHtml(formatUnits(trade.quoteRaw, trade.quoteDecimals, 6))} ${escapeHtml(config.quoteSymbol)}</b> (${escapeHtml(formatUsd(trade.quoteUsdValue))})`,
    `Price: <b>${escapeHtml(formatUsd(trade.priceUsd))}</b>`,
    `Trader: <code>${escapeHtml(compactAddress(trade.trader))}</code>`,
    `Block: <code>${trade.blockNumber}</code>`,
    `<a href="${escapeHtml(txUrl)}">Tx</a> | <a href="${escapeHtml(config.dexscreenPairUrl)}">Dexscreener</a>`,
  ].join("\n");
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

async function resolveSellContext(tokenAddress, state = {}) {
  const token = normalizeAddress(tokenAddress);
  if (!isEvmAddress(token)) throw new Error("Invalid bag token address.");

  const fromBag = findBagItem(state, token);
  if (fromBag?.pairAddress) {
    let fee = config.uniswapV3Fee;
    try {
      const meta = await getPoolMeta(fromBag.pairAddress);
      if (Number.isFinite(meta.fee) && meta.fee > 0) fee = meta.fee;
    } catch {
      // keep fee
    }
    return {
      baseTokenAddress: token,
      baseSymbol: fromBag.symbol || "TOKEN",
      quoteTokenAddress: config.quoteTokenAddress,
      quoteSymbol: config.quoteSymbol,
      pairAddress: normalizeAddress(fromBag.pairAddress),
      pairUrl: fromBag.pairUrl || `https://dexscreener.com/robinhood/${fromBag.pairAddress}`,
      fee,
      priceNative: Number.NaN,
      priceUsd: Number(fromBag.priceUsd),
      decimals: Number(fromBag.decimals) || 18,
    };
  }

  let pairAddress = "";
  let baseSymbol = "TOKEN";
  let pairUrl = "";
  let priceNative = Number.NaN;
  let priceUsd = Number.NaN;
  let decimals = 18;

  const pairs = await fetchTokenPairs(token);
  const pair = chooseBestPairForToken(pairs, token);
  if (!pair?.pairAddress) {
    throw new Error(`Không tìm thấy pair WETH thanh khoản cho ${baseSymbol}.`);
  }

  const tracked = trackedPairFromDexPair(pair, token);
  pairAddress = tracked.pairAddress;
  baseSymbol = tracked.baseSymbol || baseSymbol;
  pairUrl = tracked.pairUrl || `https://dexscreener.com/robinhood/${pairAddress}`;
  priceNative = Number(pair.priceNative);
  priceUsd = Number(pair.priceUsd);
  const rawBase = normalizeAddress(pair.baseToken?.address);
  if (rawBase !== token && Number.isFinite(priceNative) && priceNative > 0) {
    priceNative = 1 / priceNative;
  }
  if (!Number.isFinite(priceNative) || priceNative <= 0) {
    throw new Error(`Cannot read priceNative for ${baseSymbol} from Dexscreener.`);
  }

  let fee = config.uniswapV3Fee;
  try {
    const meta = await getPoolMeta(pairAddress);
    if (Number.isFinite(meta.fee) && meta.fee > 0) fee = meta.fee;
  } catch {
    // keep current fee
  }

  return {
    baseTokenAddress: token,
    baseSymbol,
    quoteTokenAddress: config.quoteTokenAddress,
    quoteSymbol: config.quoteSymbol,
    pairAddress,
    pairUrl,
    fee,
    priceNative,
    priceUsd,
    decimals,
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

async function renderMainMenuFast(callbackQuery, state) {
  const portfolio = state.portfolioSnapshot || {
    wallet: getPortfolioWallet(state),
    items: [],
    bagItems: [],
    skipped: 0,
    totalUsd: 0,
  };
  let text;
  try {
    text = await withTimeout(mainPanelText({ state, portfolio }), 3_500, "Main panel");
  } catch {
    text = staticMainPanelText();
  }
  await editTradeMessage(callbackQuery, text, mainMenuKeyboard(portfolio));
}

async function runConfirmedTrade(callbackQuery, side, amount) {
  const inputSymbol = side === "BUY" ? displayQuoteSymbol() : config.baseSymbol;
  const pending = editTradeMessage(
    callbackQuery,
    `<b>Sending ${escapeHtml(side)} ${escapeHtml(config.baseSymbol)}...</b>\nAmount: ${escapeHtml(amount)} ${escapeHtml(inputSymbol)}`,
  ).catch(() => {});

  try {
    const result = await executeSwap(side, amount);
    await pending;
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    const state = loadState();
    nativeBalanceCache.at = 0;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>${escapeHtml(side)} sent</b>`,
        result.paidNative ? `Paid: <b>${escapeHtml(result.paidNative)} ETH</b>` : "",
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
        `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
        result.receivedNative ? `Received: <b>≥${escapeHtml(result.receivedNative)} ETH</b>` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    );
  } catch (error) {
    await pending;
    const state = loadState();
    await editTradeMessage(
      callbackQuery,
      `<b>Trade not sent</b>\n${escapeHtml(error.message)}`,
      mainMenuKeyboard(state.portfolioSnapshot),
    );
  }
}

async function runConfirmedBagSell(callbackQuery, tokenAddress, amount, state) {
  let ctx;
  try {
    ctx = await resolveSellContext(tokenAddress, state);
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Bag sell failed</b>\n${escapeHtml(error.message)}`,
      mainMenuKeyboard(state.portfolioSnapshot),
    );
    return;
  }

  const pending = editTradeMessage(
    callbackQuery,
    `<b>Sending SELL ${escapeHtml(ctx.baseSymbol)}...</b>\nAmount: ${escapeHtml(amount)} ${escapeHtml(ctx.baseSymbol)}`,
  ).catch(() => {});

  try {
    const result = await executeSwap("SELL", amount, ctx);
    await pending;
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    nativeBalanceCache.at = 0;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>SELL ${escapeHtml(ctx.baseSymbol)} sent</b>`,
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
        `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
        result.receivedNative ? `Received: <b>≥${escapeHtml(result.receivedNative)} ETH</b>` : "",
        `Track alerts vẫn: <b>${escapeHtml(config.baseSymbol)}</b>`,
      ].join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    );
  } catch (error) {
    await pending;
    const item = findBagItem(state, tokenAddress) || {
      address: ctx.baseTokenAddress,
      symbol: ctx.baseSymbol,
      pairUrl: ctx.pairUrl,
    };
    await editTradeMessage(
      callbackQuery,
      `<b>Bag sell not sent</b>\n${escapeHtml(error.message)}`,
      bagSellKeyboard(item),
    );
  }
}

async function handleCallbackQuery(callbackQuery, state) {
  const chatId = callbackQuery.message?.chat?.id;
  if (!isAuthorizedChat(chatId)) {
    await answerCallback(callbackQuery, `Unauthorized chat ${chatId}. Add it to TELEGRAM_CHAT_ID.`);
    await notifyUnauthorizedChat(chatId);
    return;
  }

  try {
    await handleCallbackQueryInner(callbackQuery, state);
  } catch (error) {
    if (isExpiredCallbackError(error) || isMessageNotModifiedError(error)) {
      console.warn(`Ignored stale callback: ${error.message}`);
      return;
    }
    console.error(`Callback failed: ${error.message}`);
    try {
      await editTradeMessage(
        callbackQuery,
        `<b>Lỗi bot</b>\n${escapeHtml(error.message)}\n\nThử /menu hoặc Update Price.`,
        mainMenuKeyboard(state.portfolioSnapshot),
      );
    } catch {
      // ignore secondary telegram errors
    }
  }
}

async function sendTextTrade(chatId, state, side, amount) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `<b>Sending ${escapeHtml(side)} ${escapeHtml(config.baseSymbol)}...</b>\nAmount: <b>${escapeHtml(amount)}</b>`,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
  });
  try {
    const result = await executeSwap(side, amount);
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    nativeBalanceCache.at = 0;
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        `<b>${escapeHtml(side)} sent</b>`,
        result.paidNative ? `Paid: <b>${escapeHtml(result.paidNative)} ETH</b>` : "",
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
        result.receivedNative ? `Received: <b>≥${escapeHtml(result.receivedNative)} ETH</b>` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
  } catch (error) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `<b>Trade not sent</b>\n${escapeHtml(error.message)}`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
  }
}

async function handleCallbackQueryInner(callbackQuery, state) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = String(callbackQuery.data || "");
  const toast =
    data.startsWith("qtrade:") || data.startsWith("bagsell:")
      ? "Sending…"
      : data === "portfolio:refresh"
        ? "Updating…"
        : data.startsWith("bag:")
          ? "Bag…"
          : data.startsWith("bagtrack:")
            ? "Tracking…"
            : data === "buy:custom"
              ? "Buy…"
              : "";
  await answerCallback(callbackQuery, toast);

  if (data === "buy:custom") {
    state.pendingBuyPrompt = { chatId: String(chatId), createdAt: Date.now() };
    saveState(state);
    await editTradeMessage(
      callbackQuery,
      [
        `<b>Buy ${escapeHtml(config.baseSymbol)}</b>`,
        `Gửi số ETH muốn mua (ví dụ <code>0.15</code> hoặc <code>1.5</code>).`,
        `<i>Hết hạn sau 5 phút · /menu để hủy</i>`,
      ].join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    );
    return;
  }

  if (data === "menu") {
    await renderMainMenuFast(callbackQuery, state);
    return;
  }

  if (data === "portfolio:refresh") {
    await editTradeMessage(
      callbackQuery,
      `${staticMainPanelText()}\n\n<i>Đang cập nhật portfolio…</i>`,
      mainMenuKeyboard(state.portfolioSnapshot),
    ).catch(() => {});
    await showPortfolio(chatId, state, { editCallback: callbackQuery, forceRefresh: true });
    return;
  }

  if (data.startsWith("bag:")) {
    const token = normalizeAddress(data.slice("bag:".length));
    const item = findBagItem(state, token);
    if (!item) {
      await editTradeMessage(callbackQuery, bagSellPanelText(null), mainMenuKeyboard(state.portfolioSnapshot));
      return;
    }
    await editTradeMessage(callbackQuery, bagSellPanelText(item), bagSellKeyboard(item));
    return;
  }

  if (data.startsWith("bagtrack:")) {
    const token = normalizeAddress(data.slice("bagtrack:".length));
    if (!isEvmAddress(token)) {
      await editTradeMessage(callbackQuery, "Token address không hợp lệ.", mainMenuKeyboard(state.portfolioSnapshot));
      return;
    }
    await editTradeMessage(
      callbackQuery,
      `Đang chuyển track sang:\n<code>${escapeHtml(token)}</code>`,
      mainMenuKeyboard(state.portfolioSnapshot),
    );
    enqueueFollowToken(token, state, chatId).catch((error) => {
      console.error(`bagtrack follow failed: ${error.message}`);
    });
    return;
  }

  if (data.startsWith("bagsell:")) {
    const parts = data.split(":");
    const token = normalizeAddress(parts[1] || "");
    const amount = parts.slice(2).join(":") || "";
    if (!isEvmAddress(token) || !amount) {
      await editTradeMessage(callbackQuery, "Bag sell callback không hợp lệ.", mainMenuKeyboard(state.portfolioSnapshot));
      return;
    }
    await runConfirmedBagSell(callbackQuery, token, amount, state);
    return;
  }

  const trade = parseQuickTradeCallback(data);
  if (trade) {
    await runConfirmedTrade(callbackQuery, trade.side, trade.amount);
    return;
  }

  await editTradeMessage(
    callbackQuery,
    "Nút không còn hỗ trợ. Bấm /menu để làm mới.",
    mainMenuKeyboard(state.portfolioSnapshot),
  );
}

async function handleTelegramMessage(message, state) {
  const chatId = message.chat?.id;
  if (!isAuthorizedChat(chatId)) {
    await notifyUnauthorizedChat(chatId);
    return;
  }

  try {
    await handleTelegramMessageInner(message, state);
  } catch (error) {
    console.error(`Telegram message failed: ${error.message}`);
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `<b>Lỗi bot</b>\n${escapeHtml(error.message)}\n\nThử /menu hoặc Update Price.`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    }).catch(() => {});
  }
}

async function handleTelegramMessageInner(message, state) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  console.log(`Telegram message from chat ${chatId}: ${text.slice(0, 80) || "(no text)"}`);

  const pendingBuy = getPendingBuyPrompt(state, chatId);
  const customBuyAmount = pendingBuy ? parseBuyAmountText(text) : null;
  if (pendingBuy && customBuyAmount) {
    clearPendingBuyPrompt(state);
    await sendTextTrade(chatId, state, "BUY", customBuyAmount);
    return;
  }
  if (pendingBuy && text && !text.startsWith("/")) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Số ETH không hợp lệ. Gửi lại (ví dụ <code>0.15</code>) hoặc /menu để hủy.`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  if (isEvmAddress(text)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Đang track buy/sell cho:\n<code>${escapeHtml(text)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    enqueueFollowToken(text, state, chatId).catch((error) => {
      console.error(`enqueueFollowToken failed: ${error.message}`);
    });
    return;
  }

  const walletMatch = text.match(/^\/wallet(?:@\w+)?\s+(0x[a-fA-F0-9]{40})$/i);
  if (walletMatch) {
    await setPortfolioWallet(walletMatch[1], state, chatId);
    return;
  }

  if (text === "/start" || text === "/menu" || text === "/trade") {
    clearPendingBuyPrompt(state);
    await sendMainMenu(chatId, state);
    return;
  }

  if (text === "/portfolio" || text.startsWith("/portfolio@")) {
    await showPortfolio(chatId, state, { announce: true });
    return;
  }

  const commandMatch = text.match(/^\/(buy|sell)\s+([0-9]*\.?[0-9]+%?|ALL)$/i);
  if (commandMatch) {
    clearPendingBuyPrompt(state);
    const side = commandMatch[1].toUpperCase();
    const amount = commandMatch[2].toUpperCase();
    await sendTextTrade(chatId, state, side, amount);
  }
}

async function processTelegramUpdates(state) {
  if (!config.telegramBotToken || !config.telegramChatIds.length || config.dryRun) return;

  const payload = await telegramRequest("getUpdates", {
    offset: Number(state.telegramOffset || 0),
    timeout: 10,
    allowed_updates: ["message", "callback_query"],
  });
  const updates = payload.result || [];
  if (updates.length > 0) {
    console.log(`Received ${updates.length} Telegram update(s).`);
  }

  for (const update of updates) {
    // Ack early so a hung handler cannot strand the offset forever across restarts.
    state.telegramOffset = update.update_id + 1;
    saveState(state);
    try {
      await withTimeout(
        (async () => {
          if (update.message) await handleTelegramMessage(update.message, state);
          if (update.callback_query) await handleCallbackQuery(update.callback_query, state);
        })(),
        60_000,
        `Telegram update ${update.update_id}`,
      );
    } catch (error) {
      if (isExpiredCallbackError(error) || isMessageNotModifiedError(error)) {
        console.warn(`Ignored stale Telegram update ${update.update_id}.`);
      } else {
        console.error(`Telegram update ${update.update_id} failed: ${error.message}`);
        try {
          const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
          if (chatId && isAuthorizedChat(chatId)) {
            await telegramRequest("sendMessage", {
              chat_id: chatId,
              text: `<b>Lỗi bot</b>\n${escapeHtml(error.message)}\n\nThử /menu hoặc Update Price.`,
              parse_mode: "HTML",
              disable_web_page_preview: "true",
              reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
            });
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

function tradeTimestampMs(txOrGroup) {
  const raw =
    txOrGroup?.timestamp ||
    txOrGroup?.transfers?.[0]?.timestamp ||
    txOrGroup?.token_transfers?.[0]?.timestamp ||
    "";
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isFreshTrade(txOrGroup, nowMs = Date.now(), maxAgeMs = config.maxAlertAgeMs) {
  const limit = Number(maxAgeMs);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  const ts = tradeTimestampMs(txOrGroup);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts <= limit;
}

async function handleNewGroups(groups, state) {
  const seen = new Set(state.seen || []);
  const newGroups = groups.filter((group) => !seen.has(group.hash)).reverse();
  const now = Date.now();

  for (const group of newGroups) {
    try {
      if (!isFreshTrade(group, now)) {
        continue;
      }

      let tx = config.fetchTxDetails ? await fetchTransaction(group.hash) : transactionFromTransferGroup(group);
      if (!isFreshTrade(tx, now)) {
        continue;
      }

      let trade = classifyFromTransaction(tx);

      // Partial page groups often miss the WETH leg — refetch full tx once.
      if (!trade && !config.fetchTxDetails) {
        const tokens = new Set((group.transfers || []).map((item) => transferTokenAddress(item)));
        const incomplete =
          (group.transfers || []).length < 2 ||
          !tokens.has(config.baseTokenAddress) ||
          !tokens.has(config.quoteTokenAddress);
        if (incomplete) {
          tx = await fetchTransaction(group.hash);
          if (!isFreshTrade(tx, now)) continue;
          trade = classifyFromTransaction(tx);
        }
      }

      if (trade) {
        emitTradeAlertAsync(trade, state);
      }
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
  try {
    try {
      await initRpcSwapCursors(state);
    } catch (error) {
      console.warn(`RPC swap cursor init failed: ${error.message}`);
    }

    const groups = groupTransfers(await fetchTokenTransfers());
    if (config.backfillOnStart) {
      await handleNewGroups(groups, state);
      return;
    }

    // Realtime only: mark everything currently on-chain as seen, never backfill old txs.
    addSeen(
      state,
      groups.map((group) => group.hash),
    );
    saveState(state);
    console.log(`Booted. Marked ${groups.length} existing transactions as seen (no backfill alerts).`);
  } catch (error) {
    if (!state.seen) state.seen = [];
    saveState(state);
    console.warn(`Blockscout unavailable during boot: ${error.message}`);
    console.warn("Telegram commands still work. RPC swap polling will still run.");
  }
}

async function main() {
  console.log("Starting robinhood-telegram-bot...");
  startHealthServer();

  const state = loadState();
  applyStateConfig(state);

  try {
    await validateTelegramConfig();
  } catch (error) {
    // Keep process alive so Render health checks can pass; Telegram loop will retry.
    console.error(`Telegram config validation failed: ${error.message}`);
    console.error("Health server stays up; bot will keep retrying Telegram access.");
  }

  if (process.argv.includes("--send-menu")) {
    await sendMainMenu();
    return;
  }

  const once = process.argv.includes("--once");

  if (!state.seen?.length) {
    try {
      await bootState(state);
    } catch (error) {
      console.error(`Boot failed: ${error.message}`);
    }
    if (once) return;
  }

  if (config.tradeEnabled && config.walletPrivateKey && config.rpcUrl) {
    ensureRouterApprovals(state).catch((error) => {
      console.warn(`Router pre-approve skipped: ${error.message}`);
    });
  }

  if (config.rpcWsUrl) {
    try {
      startWsSwapListener(state);
    } catch (error) {
      console.warn(`WS Swap listener failed to start: ${error.message}`);
    }
  } else {
    console.log("RPC_WS_URL not set — alerts use HTTP getLogs poll (slower).");
  }

  console.log("Entering poll loop.");
  let lastBlockscoutWarnAt = 0;
  let lastRpcWarnAt = 0;
  let lastHttpCatchupAt = 0;
  while (true) {
    try {
      await withTimeout(processTelegramUpdates(state), 90_000, "Telegram poll cycle");
    } catch (error) {
      if (isPollingConflictError(error)) {
        console.error(
          "Telegram polling conflict: another instance is already using getUpdates. Stop local npm start or any other deployment using the same bot token.",
        );
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        console.error(`Telegram poll error: ${error.message || error}`);
      }
    }

    const wsOk = isWsAlertHealthy();
    wsRuntime.stateRef = state;

    // HTTP catch-up: always when WS is down; rare safety net when WS is up.
    const now = Date.now();
    const shouldHttpCatchup = !wsOk || now - lastHttpCatchupAt > 45_000;
    if (shouldHttpCatchup) {
      try {
        await withTimeout(pollRpcSwaps(state), 20_000, "RPC swap poll");
        lastHttpCatchupAt = now;
      } catch (error) {
        if (now - lastRpcWarnAt > 60_000) {
          console.warn(`RPC swap poll failed: ${error.message || error}`);
          lastRpcWarnAt = now;
        }
      }
    }

    // Blockscout is secondary — skip while WS is healthy to keep the loop snappy.
    if (!wsOk) {
      try {
        const groups = groupTransfers(await withTimeout(fetchTokenTransfers(), 15_000, "Blockscout transfers"));
        await withTimeout(handleNewGroups(groups, state), 20_000, "Blockscout alerts");
      } catch (error) {
        const t = Date.now();
        if (isTransientHttpError(error) || String(error.message || "").includes("timed out")) {
          if (t - lastBlockscoutWarnAt > 60_000) {
            console.warn(`Blockscout temporarily unavailable: ${error.message || error}`);
            console.warn("Swap alerts continue via RPC logs.");
            lastBlockscoutWarnAt = t;
          }
        } else {
          console.error(`Swap poll error: ${error.message || error}`);
        }
      }
    }

    if (once) return;
    // Faster Telegram UI when WS owns alerts; keep 3s when relying on HTTP poll.
    const sleepMs = wsOk ? Math.min(1000, config.pollSeconds * 1000) : config.pollSeconds * 1000;
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  applyTradeUsd,
  balancePercent,
  buildPortfolioFromBalances,
  chooseBestPairForToken,
  chooseWatchPairAddresses,
  classifyFromTransaction,
  config,
  formatBagButtonLabel,
  formatUnits,
  getPortfolioWallet,
  groupHashes,
  groupTransfers,
  isAuthorizedChat,
  isEvmAddress,
  isExpiredCallbackError,
  isFreshTrade,
  isMessageNotModifiedError,
  isPollingConflictError,
  isTradeablePortfolioItem,
  mainMenuKeyboard,
  normalizeAddress,
  parseBuyAmountText,
  parseQuickTradeCallback,
  parseSellPercent,
  parseTelegramChatIds,
  parseWalletBalanceEntry,
  portfolioKeyboard,
  shouldTradeImmediately,
  sniperTradeKeyboard,
  staticMainPanelText,
  trackedPairFromDexPair,
  tradeFromV3SwapLog,
  tradeMessage,
  tradeTimestampMs,
  bagSellKeyboard,
};

