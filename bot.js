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

const { resolveChain } = require("./chains");
const activeChain = resolveChain(process.env.CHAIN);

const ROBINHOOD_PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

function truthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").toLowerCase());
}

function httpUrlFromWs(wsUrl) {
  const raw = String(wsUrl || "").trim();
  if (!raw) return "";
  return raw.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

function resolveHttpRpcUrl(rpcUrl, rpcWsUrl) {
  const explicit = String(rpcUrl || "").trim();
  const fromWs = httpUrlFromWs(rpcWsUrl);
  if (activeChain.id === "robinhood") {
    const isPublicRobinhood =
      !explicit || explicit === ROBINHOOD_PUBLIC_RPC || /rpc\.mainnet\.chain\.robinhood\.com/i.test(explicit);
    // Public Robinhood HTTP often times out on eth_getLogs; reuse Alchemy/QuickNode HTTP sibling of WSS.
    if (isPublicRobinhood && fromWs) return fromWs;
    return explicit || fromWs || ROBINHOOD_PUBLIC_RPC;
  }
  return explicit || fromWs || activeChain.rpcUrl;
}

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

/** UniversalRouter — only for Robinhood Uni V4 ETH single-hop (never USDG multi-hop). */
const UNIVERSAL_ROUTER_V4 = "0x8876789976decbfcbbbe364623c63652db8c0904";

function resolveSwapRouterAddress() {
  const fallback = normalizeAddress(activeChain.swapRouter);
  const raw = normalizeAddress(process.env.SWAP_ROUTER_ADDRESS || fallback);
  if (activeChain.id === "robinhood" && raw === UNIVERSAL_ROUTER_V4) {
    console.warn(`SWAP_ROUTER_ADDRESS is UniversalRouter; forcing SwapRouter v3 ${fallback}`);
    return fallback;
  }
  return raw || fallback;
}

function assertTradeTx(tx, mode = "v3") {
  const to = normalizeAddress(tx?.to);
  const selector = String(tx?.data || "").slice(0, 10).toLowerCase();
  if (mode === "v4") {
    if (!activeChain.enableV4) throw new Error("Trade abort: V4 disabled on this chain.");
    if (to !== UNIVERSAL_ROUTER_V4) {
      throw new Error(`Trade abort: v4 tx.to=${to || "?"} ≠ UniversalRouter ${UNIVERSAL_ROUTER_V4}`);
    }
    if (selector !== "0x3593564c") {
      throw new Error("Trade abort: v4 route must call UniversalRouter execute.");
    }
    if (String(tx?.data || "").toLowerCase().includes("5fc5360d0400a0fd4f2af552add042d716f1d168")) {
      throw new Error("Trade abort: blocked USDG hub path.");
    }
    return;
  }
  const expected = normalizeAddress(config.swapRouterAddress || activeChain.swapRouter);
  if (!to || to !== expected) {
    throw new Error(`Trade abort: tx.to=${to || "?"} is not SwapRouter ${expected}.`);
  }
  if (selector === "0x3593564c") {
    throw new Error("Trade abort: v3 path must not use UniversalRouter execute.");
  }
}

const config = {
  chainId: activeChain.id,
  chainName: activeChain.name,
  dexLabel: activeChain.dexLabel,
  enableV4: Boolean(activeChain.enableV4),
  feeTiers: Array.isArray(activeChain.feeTiers) ? activeChain.feeTiers : [10000, 3000, 500, 100],
  nativeSymbol: activeChain.nativeSymbol,
  wrappedSymbol: activeChain.wrappedSymbol,
  blockscoutBaseUrl: (
    process.env.BLOCKSCOUT_BASE_URL ||
    process.env.EXPLORER_BASE_URL ||
    activeChain.explorerBaseUrl
  ).replace(/\/$/, ""),
  dexscreenPairUrl:
    process.env.DEXSCREENER_PAIR_URL ||
    (activeChain.defaultPair
      ? `https://dexscreener.com/${activeChain.id}/${activeChain.defaultPair}`
      : `https://dexscreener.com/${activeChain.id}`),
  pairAddress: normalizeAddress(process.env.PAIR_ADDRESS || activeChain.defaultPair || ""),
  baseTokenAddress: normalizeAddress(process.env.BASE_TOKEN_ADDRESS || activeChain.defaultBase || ""),
  quoteTokenAddress: normalizeAddress(process.env.QUOTE_TOKEN_ADDRESS || activeChain.wrappedAddress),
  baseSymbol: process.env.BASE_SYMBOL || activeChain.defaultBaseSymbol || "TOKEN",
  quoteSymbol: process.env.QUOTE_SYMBOL || activeChain.wrappedSymbol,
  pollSeconds: Number(process.env.POLL_SECONDS || 3),
  stateFile: process.env.STATE_FILE || (activeChain.id === "bsc" ? "state.bsc.json" : "state.json"),
  maxItems: Number(process.env.MAX_ITEMS || 200),
  minUsd: Number(process.env.MIN_USD || 0),
  minQuoteAmount: 1,
  // Only alert swaps younger than this (realtime). Stale txs after sleep/redeploy are ignored.
  maxAlertAgeMs: Number(process.env.MAX_ALERT_AGE_MS || 90_000),
  rpcSwapLookbackBlocks: Number(process.env.RPC_SWAP_LOOKBACK_BLOCKS || 100),
  // Alchemy free tier caps eth_getLogs to 10-block windows.
  rpcGetLogsMaxBlockRange: Number(process.env.RPC_GETLOGS_MAX_BLOCK_RANGE || 10),
  dryRun: truthy(process.env.DRY_RUN),
  backfillOnStart: truthy(process.env.BACKFILL_ON_START),
  fetchTxDetails: truthy(process.env.FETCH_TX_DETAILS),
  buyWhenBaseLeavesPool:
    process.env.BUY_WHEN_BASE_LEAVES_POOL === undefined ? true : truthy(process.env.BUY_WHEN_BASE_LEAVES_POOL),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatIds: parseTelegramChatIds(process.env.TELEGRAM_CHAT_ID || ""),
  telegramChatId: parseTelegramChatIds(process.env.TELEGRAM_CHAT_ID || "")[0] || "",
  // Hardcoded brand — ignore stale BOT_TITLE env if set to old names.
  botTitle: "Treasure_tradingbot",
  tradeEnabled: truthy(process.env.TRADE_ENABLED),
  rpcUrl: resolveHttpRpcUrl(process.env.RPC_URL, process.env.RPC_WS_URL),
  // When set: all chain RPC (track + trade + reads) prefers WSS; HTTP only on WSS failure.
  rpcWsUrl: process.env.RPC_WS_URL || activeChain.rpcWsUrl || "",
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
  walletAddress: process.env.WALLET_ADDRESS || "",
  swapRouterAddress: resolveSwapRouterAddress(),
  quoterAddress: process.env.QUOTER_ADDRESS || activeChain.quoter,
  uniswapV3Fee: Number(process.env.UNISWAP_V3_FEE || activeChain.defaultFee),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 200),
  // Gas: buffer estimate + bump tip so txs land faster / avoid underpriced drops.
  gasLimitBufferBps: Number(process.env.GAS_LIMIT_BUFFER_BPS || 3000),
  gasFeeBumpBps: Number(process.env.GAS_FEE_BUMP_BPS || 2000),
  gasPriorityGwei: Number(process.env.GAS_PRIORITY_GWEI || (activeChain.id === "bsc" ? 1 : 0.001)),
  buyAmountsQuote: parseAmountOptions(process.env.BUY_AMOUNTS_QUOTE || "0.01,0.05,0.1,0.2,0.25"),
  sellPercents: parseAmountOptions(process.env.SELL_PERCENTS || "25,50,70")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100),
  minPortfolioLiquidityUsd: Number(process.env.MIN_PORTFOLIO_LIQUIDITY_USD || 50),
  minPortfolioValueUsd: Number(process.env.MIN_PORTFOLIO_VALUE_USD || 3),
  // Bag list / sell buttons: only show tokens above this USD value.
  minBagValueUsd: Number(process.env.MIN_BAG_VALUE_USD || 1),
  portfolioMaxTokens: Number(process.env.PORTFOLIO_MAX_TOKENS || 25),
  // Robinhood gas is cheap; default 0.0001 ETH reserve (was 0.001 and blocked real sells).
  gasReserveEth: Number(process.env.GAS_RESERVE_ETH || 0.0001),
  // Track up to N tokens at once; paste thêm contract sẽ thêm vào list thay vì thay thế.
  maxTrackedTokens: Math.max(1, Number(process.env.MAX_TRACKED_TOKENS || 3)),
  trackedPairs: [],
};

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
          "user-agent": "treasure-tradingbot/1.0",
          ...(fetchOptions.headers || {}),
        },
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
        error.status = response.status;
        if (isRetryableFetchError(error) && attempt < retries) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, retryBackoffMs(attempt, response.status)));
          continue;
        }
        throw error;
      }

      return response.json();
    } catch (error) {
      lastError = error?.name === "AbortError" ? new Error(`Request timed out after ${timeoutMs}ms: ${url}`) : error;
      if (isRetryableFetchError(lastError) && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryBackoffMs(attempt, lastError?.status)));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function retryBackoffMs(attempt, status) {
  const base = Number(status) === 429 ? 2000 : 700;
  return Math.min(12_000, base * attempt * attempt) + Math.floor(Math.random() * 250);
}

function isRetryableFetchError(error) {
  const parts = [];
  let cur = error;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    parts.push(String(cur.message || ""));
    parts.push(String(cur.code || ""));
    parts.push(String(cur.name || ""));
    if (Number.isFinite(Number(cur.status))) parts.push(String(cur.status));
    cur = cur.cause;
  }
  const blob = parts.join(" ").toLowerCase();
  return (
    blob.includes("timed out") ||
    blob.includes("timeout") ||
    blob.includes("fetch failed") ||
    blob.includes("network") ||
    blob.includes("econnreset") ||
    blob.includes("econnrefused") ||
    blob.includes("etimedout") ||
    blob.includes("enotfound") ||
    blob.includes("eai_again") ||
    blob.includes("socket") ||
    blob.includes("und_err") ||
    blob.includes("other side closed") ||
    /\b429\b/.test(blob) ||
    /\b500\b/.test(blob) ||
    /\b502\b/.test(blob) ||
    /\b503\b/.test(blob) ||
    /\b504\b/.test(blob)
  );
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
let cachedHttpRpcProvider = null;

/** Explicit HTTP JSON-RPC (fallback when WSS is down). */
function getHttpRpcProvider() {
  const { ethers } = require("ethers");
  const url = config.rpcUrl || ROBINHOOD_PUBLIC_RPC;
  if (!cachedHttpRpcProvider || cachedHttpRpcProvider._walletRpcUrl !== url) {
    // staticNetwork skips eth_chainId on every call; slightly faster + fewer CU.
    cachedHttpRpcProvider = new ethers.JsonRpcProvider(url, undefined, {
      staticNetwork: true,
      batchMaxCount: 3,
    });
    cachedHttpRpcProvider._walletRpcUrl = url;
  }
  return cachedHttpRpcProvider;
}

function isWsProviderReady() {
  return Boolean(config.rpcWsUrl && wsRuntime.provider && wsRuntime.healthy && !wsRuntime.httpFallback);
}

/**
 * Default RPC: prefer live WSS for everything (track/trade/reads).
 * Falls back to HTTP when WSS is unset, destroyed, or in httpFallback mode.
 */
function getRpcProvider() {
  if (isWsProviderReady()) return wsRuntime.provider;
  return getHttpRpcProvider();
}

function isRpcTransportError(error) {
  const message = String(error?.message || error || "");
  return /websocket|web socket|socket|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|network|provider destroyed|connection|closed before|bad response/i.test(
    message,
  );
}

/** Run an RPC action on preferred provider; one HTTP retry if WSS transport fails. */
async function withRpcFallback(label, fn) {
  const preferred = getRpcProvider();
  try {
    return await fn(preferred);
  } catch (error) {
    const http = getHttpRpcProvider();
    if (preferred !== http && isRpcTransportError(error)) {
      console.warn(`${label}: WSS failed (${error.message}); retrying via HTTP…`);
      markHttpFallback(`${label}: ${error.message}`);
      return await fn(http);
    }
    throw error;
  }
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

async function pollRpcSwaps(state, options = {}) {
  const { ethers } = require("ethers");
  // HTTP-only backup path — do not use the WSS socket for eth_getLogs catch-up.
  const provider = getHttpRpcProvider();
  const latest = Number(await provider.getBlockNumber());
  if (!state.swapBlocks || typeof state.swapBlocks !== "object") state.swapBlocks = {};

  const iface = new ethers.Interface([
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  ]);
  const topic = iface.getEvent("Swap").topicHash;
  const seen = new Set(state.seen || []);
  const now = Date.now();
  const configuredLookback = Number(config.rpcSwapLookbackBlocks || 100);
  const lookback = Math.max(20, Number(options.lookbackBlocks ?? configuredLookback));
  const light = Boolean(options.light);
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
      if (now - (pollRpcSwaps._lastMetaWarnAt || 0) > 60_000) {
        console.warn(`RPC pool meta failed for ${pair}: ${error.message}`);
        pollRpcSwaps._lastMetaWarnAt = now;
      }
      continue;
    }

    const tracked = findTrackedForPool(meta);
    if (!tracked) {
      state.swapBlocks[pair] = latest;
      continue;
    }

    // Keep trading fee aligned with the live pool of the ACTIVE token only.
    if (
      normalizeAddress(tracked.baseTokenAddress) === config.baseTokenAddress &&
      Number.isFinite(meta.fee) &&
      meta.fee > 0
    ) {
      config.uniswapV3Fee = meta.fee;
    }

    // Alchemy free: eth_getLogs max 10-block range — chunk so backup stays reliable.
    const maxRange = Math.max(1, Number(options.maxBlockRange || config.rpcGetLogsMaxBlockRange || 10));
    let logs = [];
    let scannedTo = fromBlock;
    try {
      for (let start = fromBlock + 1; start <= latest; start += maxRange) {
        const end = Math.min(latest, start + maxRange - 1);
        const chunk = await provider.getLogs({
          address: pair,
          fromBlock: start,
          toBlock: end,
          topics: [topic],
        });
        if (chunk.length) logs = logs.concat(chunk);
        scannedTo = end;
      }
    } catch (error) {
      if (scannedTo > fromBlock) state.swapBlocks[pair] = scannedTo;
      if (now - (pollRpcSwaps._lastLogsWarnAt || 0) > 60_000) {
        console.warn(`RPC getLogs failed for ${pair}: ${error.message}`);
        pollRpcSwaps._lastLogsWarnAt = now;
      }
      continue;
    }

    const blockTs = new Map();
    if (!light) {
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
      const tsMs = light ? now : blockTs.get(Number(log.blockNumber)) || now;
      if (now - tsMs > Number(config.maxAlertAgeMs || 90_000)) {
        seen.add(txHash);
        continue;
      }
      const trade = tradeFromV3SwapLog({
        amount0: parsed.args.amount0,
        amount1: parsed.args.amount1,
        token0: meta.token0,
        token1: meta.token1,
        quoteToken: tracked.quoteTokenAddress,
        baseToken: tracked.baseTokenAddress,
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
      emitTradeAlertAsync(tagTradeWithTracked(trade, tracked, pair));
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
// Longer backoffs so transient Telegram/network blips don't drop alerts.
const ALERT_TG_BACKOFFS_MS = [1000, 3000, 8000, 20_000, 60_000];
const TRADE_CONFIRM_TIMEOUT_MS = 120_000;
const TRADE_HANDLER_TIMEOUT_MS = 180_000;

let tradeBusy = false;

const wsRuntime = {
  provider: null,
  healthy: false,
  httpFallback: false,
  generation: 0,
  reconnectAttempts: 0,
  heartbeatFails: 0,
  listenedPairs: new Set(),
  stateRef: null,
  reconnectTimer: null,
  heartbeatTimer: null,
  lastFallbackLogAt: 0,
};
const WS_RECONNECT_BACKOFFS_MS = [1000, 2000, 5000, 10000, 15000];
// After hard fallback to HTTP, keep retrying WS occasionally.
const WS_RETRY_AFTER_FALLBACK_MS = 120_000;

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
        console.error(`Alert still failing after retries — re-queueing later: ${error.message}`);
        const deferred = alertTgQueue.shift();
        // Keep trying forever for alerts (don't silently drop); push to end with reset attempts after long wait.
        setTimeout(() => {
          if (deferred) {
            deferred.attempts = 0;
            alertTgQueue.push(deferred);
            if (!alertTgWorkerRunning) {
              processAlertTelegramQueue().catch((err) => {
                console.error(`Alert Telegram queue crashed: ${err.message}`);
                alertTgWorkerRunning = false;
              });
            }
          }
        }, 120_000);
        continue;
      }
      const wait = ALERT_TG_BACKOFFS_MS[item.attempts - 1];
      console.warn(`Alert Telegram retry ${item.attempts}/${ALERT_TG_BACKOFFS_MS.length} in ${wait}ms: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  alertTgWorkerRunning = false;
}

function resolveAlertEthUsd(cache) {
  if (Number.isFinite(cache?.ethUsd) && cache.ethUsd > 0) return cache.ethUsd;
  if (Number.isFinite(dexTradePriceCache.ethUsd) && dexTradePriceCache.ethUsd > 0) {
    return dexTradePriceCache.ethUsd;
  }
  if (Number.isFinite(ethPriceCache.value) && ethPriceCache.value > 0) return ethPriceCache.value;
  return Number.NaN;
}

function emitTradeAlertAsync(trade) {
  const cache = priceCacheFor(trade?.pairAddress || config.pairAddress);
  const ethUsdCached = resolveAlertEthUsd(cache);
  const warm =
    (Number.isFinite(cache.priceUsd) && cache.priceUsd > 0) ||
    (Number.isFinite(ethUsdCached) && ethUsdCached > 0);

  const sendPriced = (priced) => {
    if (!isSaneTradeAlert(priced)) {
      console.warn(
        `Skip junk alert ${priced?.txHash || ""} ${priced?.side} ${priced?.baseSymbol}: exec=${priced?.priceUsd} spot=${priced?.spotPriceUsd} quote=${priced?.quoteAmount}`,
      );
      return;
    }
    enqueueTelegramAlert(tradeMessage(priced), mainMenuKeyboard());
  };

  if (warm) {
    // Hot path: cached Dex/ETH price — do not block WS handler.
    sendPriced(
      applyTradeUsd(trade, {
        priceUsd: cache.priceUsd,
        ethUsd: ethUsdCached,
      }),
    );
    enrichTradePrices(trade).catch(() => {});
    return;
  }

  // Cold cache: fetch Dex/ETH price first so Quote USD + Price aren't n/a.
  withTimeout(enrichTradePrices(trade), 2_500, "Alert price enrich")
    .then((priced) => sendPriced(priced))
    .catch((error) => {
      console.warn(`Alert enrich failed: ${error.message}`);
      sendPriced(
        applyTradeUsd(trade, {
          priceUsd: cache.priceUsd,
          ethUsd: resolveAlertEthUsd(cache),
        }),
      );
    });
}

/** Drop aggregator mis-parses (e.g. GME/USDG hop labeled as GME/WETH at 10–100x chart price). */
function isSaneTradeAlert(trade) {
  const quote = Number(trade?.quoteAmount);
  const base = Number(trade?.baseAmount);
  const exec = Number(trade?.execPriceUsd ?? trade?.priceUsd);
  const spot = Number(trade?.spotPriceUsd);
  if (!(quote > 0) || !(base > 0)) return false;
  // Must look like a real ETH size for our min filter.
  const minQuote = Number(config.minQuoteAmount) || 1;
  if (quote < minQuote * 0.95) return false;
  if (Number.isFinite(spot) && spot > 0 && Number.isFinite(exec) && exec > 0) {
    const ratio = exec / spot;
    // Real pool swaps stay near spot; multi-hop mislabels often print 10x–100x.
    if (ratio > 8 || ratio < 1 / 8) return false;
  }
  return true;
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

function handleLiveSwapEvent({ pair, amount0, amount1, recipient, txHash, blockNumber }, state) {
  const hash = String(txHash || "").toLowerCase();
  if (!hash) return;
  if ((state.seen || []).includes(hash)) return;

  const cached = poolMetaCache.get(normalizeAddress(pair));
  const run = (meta) => {
    const tracked = findTrackedForPool(meta);
    if (!tracked) return;
    if (
      normalizeAddress(tracked.baseTokenAddress) === config.baseTokenAddress &&
      Number.isFinite(meta.fee) &&
      meta.fee > 0
    ) {
      config.uniswapV3Fee = meta.fee;
    }

    const trade = tradeFromV3SwapLog({
      amount0,
      amount1,
      token0: meta.token0,
      token1: meta.token1,
      quoteToken: tracked.quoteTokenAddress,
      baseToken: tracked.baseTokenAddress,
      txHash: hash,
      blockNumber: Number(blockNumber || 0),
      timestampMs: Date.now(),
      recipient,
    });
    if (!trade) {
      // Below threshold / invalid — mark seen so HTTP catch-up does not re-alert junk.
      claimSwapAlert(state, hash);
      return;
    }
    if (!claimSwapAlert(state, hash)) return;

    if (!state.swapBlocks || typeof state.swapBlocks !== "object") state.swapBlocks = {};
    const bn = Number(blockNumber || 0);
    const key = normalizeAddress(pair);
    if (bn > 0) state.swapBlocks[key] = Math.max(Number(state.swapBlocks[key] || 0), bn);
    saveState(state);

    emitTradeAlertAsync(tagTradeWithTracked(trade, tracked, pair));
  };

  if (cached) {
    run(cached);
    return;
  }

  getPoolMeta(pair)
    .then(run)
    .catch((error) => console.warn(`WS pool meta failed for ${pair}: ${error.message}`));
}

function isWsAlertHealthy() {
  return isWsProviderReady();
}

function markHttpFallback(reason) {
  wsRuntime.healthy = false;
  wsRuntime.httpFallback = true;
  const now = Date.now();
  if (now - wsRuntime.lastFallbackLogAt > 30_000) {
    const rpc = config.rpcUrl || activeChain.rpcUrl;
    console.warn(`⚠️  WSS sự cố (${reason}) — toàn bộ RPC fallback HTTP: ${rpc}`);
    wsRuntime.lastFallbackLogAt = now;
  }
}

function clearWsReconnectTimer() {
  if (wsRuntime.reconnectTimer) {
    clearTimeout(wsRuntime.reconnectTimer);
    wsRuntime.reconnectTimer = null;
  }
}

function clearWsHeartbeat() {
  if (wsRuntime.heartbeatTimer) {
    clearInterval(wsRuntime.heartbeatTimer);
    wsRuntime.heartbeatTimer = null;
  }
}

function destroyWsProvider() {
  // Bump generation FIRST so in-flight "close" handlers from the old socket are ignored.
  wsRuntime.generation += 1;
  clearWsHeartbeat();
  const old = wsRuntime.provider;
  wsRuntime.provider = null;
  wsRuntime.healthy = false;
  wsRuntime.listenedPairs.clear();
  try {
    old?.destroy?.();
  } catch {
    // ignore
  }
}

function scheduleWsReconnect(reason, generation) {
  if (!config.rpcWsUrl) return;
  if (generation !== wsRuntime.generation) return; // stale socket
  if (wsRuntime.reconnectTimer) return;

  // Instantly hand alerts to HTTP while reconnecting.
  wsRuntime.healthy = false;

  if (wsRuntime.reconnectAttempts >= WS_RECONNECT_BACKOFFS_MS.length) {
    destroyWsProvider();
    markHttpFallback(reason);
    wsRuntime.reconnectAttempts = 0;
    // Keep trying WS later; HTTP covers alerts in the meantime.
    wsRuntime.reconnectTimer = setTimeout(() => {
      wsRuntime.reconnectTimer = null;
      console.log("Retrying WSS after HTTP fallback…");
      try {
        startWsSwapListener(wsRuntime.stateRef || loadState());
      } catch (error) {
        markHttpFallback(error.message);
        scheduleWsReconnect(error.message, wsRuntime.generation);
      }
    }, WS_RETRY_AFTER_FALLBACK_MS);
    return;
  }

  const wait = WS_RECONNECT_BACKOFFS_MS[wsRuntime.reconnectAttempts];
  wsRuntime.reconnectAttempts += 1;
  console.warn(
    `WS down (${reason}). All RPC → HTTP backup (${config.rpcUrl || activeChain.rpcUrl}). Reconnect ${wsRuntime.reconnectAttempts}/${WS_RECONNECT_BACKOFFS_MS.length} in ${wait}ms…`,
  );
  wsRuntime.reconnectTimer = setTimeout(() => {
    wsRuntime.reconnectTimer = null;
    try {
      startWsSwapListener(wsRuntime.stateRef || loadState());
    } catch (error) {
      console.error(`WS reconnect error: ${error.message}`);
      scheduleWsReconnect(error.message, wsRuntime.generation);
    }
  }, wait);
}

function startWsSwapListener(state) {
  if (!config.rpcWsUrl) return false;
  wsRuntime.stateRef = state;
  clearWsReconnectTimer();

  const { ethers } = require("ethers");
  destroyWsProvider(); // bumps generation + closes previous socket safely
  const myGeneration = wsRuntime.generation;

  const safeUrl = String(config.rpcWsUrl).replace(/\/v2\/[^/]+$/i, "/v2/***");
  console.log(`Connecting Swap WebSocket: ${safeUrl}`);
  const provider = new ethers.WebSocketProvider(config.rpcWsUrl);
  wsRuntime.provider = provider;

  const abi = [
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  ];

  for (const pair of watchedPairSet()) {
    const pool = new ethers.Contract(pair, abi, provider);
    pool.on("Swap", (_sender, recipient, amount0, amount1, _sqrt, _liq, _tick, event) => {
      if (wsRuntime.generation !== myGeneration) return;
      const st = wsRuntime.stateRef || state;
      const txHash = event?.log?.transactionHash || event?.transactionHash || "";
      const blockNumber = event?.log?.blockNumber || event?.blockNumber || 0;
      try {
        handleLiveSwapEvent(
          { pair, amount0, amount1, recipient, txHash, blockNumber },
          st,
        );
      } catch (error) {
        console.error(`WS Swap handler error: ${error.message}`);
      }
    });
    wsRuntime.listenedPairs.add(pair);
    // Pre-warm meta on preferred RPC (WSS when healthy).
    getPoolMeta(pair).catch(() => {});
  }

  const rawSocket = provider.websocket;
  if (rawSocket?.on) {
    rawSocket.on("close", () => {
      if (wsRuntime.generation !== myGeneration) return;
      scheduleWsReconnect("socket closed", myGeneration);
    });
    rawSocket.on("error", (err) => {
      if (wsRuntime.generation !== myGeneration) return;
      scheduleWsReconnect(err?.message || "socket error", myGeneration);
    });
  } else {
    console.warn("WS raw socket hooks unavailable — auto-reconnect may not fire.");
  }

  // Keepalive + detect dead WS → switch to HTTP backup.
  clearWsHeartbeat();
  wsRuntime.heartbeatFails = 0;
  wsRuntime.heartbeatTimer = setInterval(() => {
    if (wsRuntime.generation !== myGeneration || !wsRuntime.provider) return;
    wsRuntime.provider
      .getBlockNumber()
      .then(() => {
        wsRuntime.heartbeatFails = 0;
      })
      .catch((error) => {
        wsRuntime.heartbeatFails += 1;
        if (wsRuntime.heartbeatFails >= 3) {
          console.warn(`WS heartbeat failed x3: ${error.message || error}`);
          scheduleWsReconnect("heartbeat failed", myGeneration);
        }
      });
  }, 25_000);

  wsRuntime.healthy = true;
  wsRuntime.httpFallback = false;
  wsRuntime.reconnectAttempts = 0;
  console.log(`✅ WS Swap listener active on ${wsRuntime.listenedPairs.size} pool(s).`);
  return true;
}

function refreshWsSwapListener(state) {
  if (!config.rpcWsUrl) return;
  wsRuntime.stateRef = state;
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
  }
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
  const url = `https://api.dexscreener.com/latest/dex/pairs/${config.chainId}/${pair}`;
  const payload = await fetchJson(url);
  return payload.pair || payload.pairs?.[0] || null;
}

// Keyed by pair address so 3 tracked tokens don't overwrite each other's price.
const dexTradePriceCacheMap = new Map();
const dexTradePriceCache = { at: 0, priceUsd: Number.NaN, ethUsd: Number.NaN };

function priceCacheFor(pairAddress) {
  const key = normalizeAddress(pairAddress) || "default";
  if (!dexTradePriceCacheMap.has(key)) {
    dexTradePriceCacheMap.set(key, { at: 0, priceUsd: Number.NaN, ethUsd: Number.NaN });
  }
  return dexTradePriceCacheMap.get(key);
}

function applyTradeUsd(trade, { priceUsd, ethUsd } = {}) {
  const quoteAmount = Number(trade?.quoteAmount);
  const baseAmount = Number(trade?.baseAmount);
  const quoteUsdValue =
    Number.isFinite(ethUsd) && quoteAmount > 0
      ? quoteAmount * ethUsd
      : Number(trade?.quoteUsdValue);

  // Execution price from this swap's amounts (what was actually paid).
  const execPriceUsd =
    Number.isFinite(quoteUsdValue) && Number.isFinite(baseAmount) && baseAmount > 0
      ? quoteUsdValue / baseAmount
      : Number.NaN;

  // Dexscreener spot for the pair (chart reference), when cached.
  const spotPriceUsd = Number(priceUsd);

  return {
    ...trade,
    quoteUsdValue: Number.isFinite(quoteUsdValue) ? quoteUsdValue : Number.NaN,
    // Keep priceUsd = execution so alert "Price" matches Amount/Quote on that message.
    priceUsd: Number.isFinite(execPriceUsd) ? execPriceUsd : spotPriceUsd,
    spotPriceUsd: Number.isFinite(spotPriceUsd) ? spotPriceUsd : Number.NaN,
    execPriceUsd: Number.isFinite(execPriceUsd) ? execPriceUsd : Number.NaN,
  };
}

async function enrichTradePrices(trade) {
  const now = Date.now();
  const pairAddress = trade?.pairAddress || config.pairAddress;
  const cache = priceCacheFor(pairAddress);
  let priceUsd = Number.NaN;
  let ethUsd = Number.NaN;

  if (now - cache.at < 15_000) {
    priceUsd = cache.priceUsd;
    ethUsd = cache.ethUsd;
  } else {
    try {
      const pair = await fetchDexPairByAddress(pairAddress);
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
    cache.at = now;
    cache.priceUsd = priceUsd;
    cache.ethUsd = ethUsd;
    // Keep legacy single-token cache in sync for the active pair.
    if (normalizeAddress(pairAddress) === normalizeAddress(config.pairAddress)) {
      dexTradePriceCache.at = now;
      dexTradePriceCache.priceUsd = priceUsd;
      dexTradePriceCache.ethUsd = ethUsd;
    }
  }

  return applyTradeUsd(trade, { priceUsd, ethUsd });
}

async function fetchTokenPairs(tokenAddress) {
  return fetchJson(`https://api.dexscreener.com/token-pairs/v1/${config.chainId}/${tokenAddress}`);
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
    const payload = await fetchJson(`https://api.dexscreener.com/tokens/v1/${config.chainId}/${chunk.join(",")}`);
    if (Array.isArray(payload)) pairs.push(...payload);
  }
  return pairs;
}


function loadState() {
  if (saveStatePending) return saveStatePending;
  if (!fs.existsSync(config.stateFile)) return { seen: [] };

  try {
    return JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  } catch {
    return { seen: [] };
  }
}

let saveStateTimer = null;
let saveStatePending = null;

function writeStateToDisk(state) {
  if (!state) return;
  fs.writeFileSync(
    config.stateFile,
    `${JSON.stringify(state, (_, value) => (typeof value === "bigint" ? value.toString() : value))}\n`,
  );
}

function saveState(state, { flush = false } = {}) {
  saveStatePending = state;
  if (flush) {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    writeStateToDisk(state);
    return;
  }
  if (saveStateTimer) return;
  // Debounce disk writes (OneDrive + hot WS/Telegram paths).
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    writeStateToDisk(saveStatePending);
  }, 300);
}

function flushStateSync() {
  if (saveStateTimer) {
    clearTimeout(saveStateTimer);
    saveStateTimer = null;
  }
  if (saveStatePending) writeStateToDisk(saveStatePending);
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
      res.end(JSON.stringify({ ok: true, service: "telegram-bot" }));
      return;
    }

    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Telegram bot is running.\n");
  });

  // Health probe on 0.0.0.0:$PORT when PORT is set (e.g. cloud VM / container).
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

/** Parse token/pair address or Dexscreener URL for the active chain. */
function parseTrackInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const urlMatch = raw.match(
    new RegExp(
      `(?:https?:\\/\\/)?(?:www\\.)?dexscreener\\.com\\/(?:${config.chainId}|robinhood|bsc)\\/(0x[a-fA-F0-9]{40}|0x[a-fA-F0-9]{64})\\b`,
      "i",
    ),
  );
  if (urlMatch) {
    return { kind: "pair", address: normalizeAddress(urlMatch[1]), forced: true };
  }

  if (isEvmAddress(raw)) return { kind: "address", address: normalizeAddress(raw), forced: false };
  if (/^0x[a-fA-F0-9]{64}$/i.test(raw)) {
    return { kind: "pair", address: normalizeAddress(raw), forced: true };
  }
  return null;
}

/** Prefer non-WETH/ETH side as the tradable meme token for a Dex pair. */
function tradeTokenFromDexPair(pair) {
  const weth = normalizeAddress(config.quoteTokenAddress);
  const zero = "0x0000000000000000000000000000000000000000";
  const base = normalizeAddress(pair?.baseToken?.address);
  const quote = normalizeAddress(pair?.quoteToken?.address);
  const baseSym = String(pair?.baseToken?.symbol || "").toUpperCase();
  const quoteSym = String(pair?.quoteToken?.symbol || "").toUpperCase();
  const isWethish = (addr, sym) =>
    addr === weth ||
    addr === zero ||
    sym === "WETH" ||
    sym === "ETH" ||
    sym === "WBNB" ||
    sym === "BNB";
  if (isWethish(quote, quoteSym) && base) return base;
  if (isWethish(base, baseSym) && quote) return quote;
  return base || quote || "";
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
  const feeCandidates = [preferredFee, config.uniswapV3Fee, ...(config.feeTiers || [])].filter(
    (value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index,
  );
  let lastError = "";
  for (const fee of feeCandidates) {
    try {
      const result = await rpcCall(`quote fee=${fee}`, () =>
        quoter.quoteExactInputSingle.staticCall({
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0,
        }),
      );
      const amountOut = BigInt(result.amountOut ?? result[0]);
      if (amountOut > 0n) return { amountOut, fee };
      lastError = "zero amount out";
    } catch (error) {
      lastError = error.shortMessage || error.message || String(error);
    }
  }
  throw new Error(lastError || "quoter failed");
}

async function rpcCall(label, fn, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isRetryableFetchError(error) && attempt < retries) {
        const wait = retryBackoffMs(attempt);
        console.warn(`RPC ${label} retry ${attempt}/${retries} in ${wait}ms: ${error.message || error}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function withTradeLock(fn) {
  if (tradeBusy) {
    throw new Error("Trade đang chạy. Đợi xong rồi bấm lại (tránh double-send).");
  }
  tradeBusy = true;
  try {
    return await fn();
  } finally {
    tradeBusy = false;
  }
}

function explorerTxUrl(hash) {
  return `${config.blockscoutBaseUrl}/tx/${hash}`;
}

function extractTxHash(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
    const fromText = String(value?.message || value?.shortMessage || value || "").match(/0x[a-fA-F0-9]{64}/);
    if (fromText) return fromText[0].toLowerCase();
    if (value?.hash && /^0x[a-fA-F0-9]{64}$/.test(value.hash)) return String(value.hash).toLowerCase();
    if (value?.transactionHash && /^0x[a-fA-F0-9]{64}$/.test(value.transactionHash)) {
      return String(value.transactionHash).toLowerCase();
    }
  }
  return "";
}

function formatTradeFailureMessage(error, broadcastHash = "") {
  const hash = extractTxHash(broadcastHash, error);
  const detail = escapeHtml(formatSwapError(error));
  if (hash) {
    const txUrl = explorerTxUrl(hash);
    return [
      `<b>Trade đã gửi lên chain nhưng thất bại / chưa confirm</b>`,
      `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(hash))}</a>`,
      detail,
      `<i>Mở link kiểm tra trước khi bấm lại — tránh mua/bán trùng.</i>`,
    ].join("\n");
  }
  return `<b>Trade not sent</b>\n${detail}`;
}

function gasReserveWei() {
  const { ethers } = require("ethers");
  // Robinhood gas is tiny; 0.001 was blocking sells when wallet had ~0.0008 ETH.
  const eth = Number(process.env.GAS_RESERVE_ETH || config.gasReserveEth || 0.0001);
  const safe = Number.isFinite(eth) && eth > 0 ? eth : 0.0001;
  return ethers.parseEther(String(safe));
}

async function resolveTradeGasOverrides(provider, partialTx) {
  const { ethers } = require("ethers");
  const request = {
    to: partialTx.to,
    data: partialTx.data,
    value: partialTx.value ?? 0n,
    from: partialTx.from,
  };
  const estimated = await rpcCall("estimateGas", () => provider.estimateGas(request));
  const bufferBps = Math.min(10_000, Math.max(1_000, Number(config.gasLimitBufferBps) || 3000));
  const overrides = {
    gasLimit: (estimated * BigInt(10_000 + bufferBps)) / 10_000n,
  };

  const feeData = await rpcCall("getFeeData", () => provider.getFeeData());
  const bumpBps = Math.min(5_000, Math.max(0, Number(config.gasFeeBumpBps) || 2000));
  const tipFloorGwei = Number(config.gasPriorityGwei);
  const tipFloor = ethers.parseUnits(
    String(Number.isFinite(tipFloorGwei) && tipFloorGwei > 0 ? tipFloorGwei : 0.001),
    "gwei",
  );

  if (feeData.maxFeePerGas != null) {
    const networkTip = feeData.maxPriorityFeePerGas != null ? feeData.maxPriorityFeePerGas : 0n;
    const tip = networkTip > tipFloor ? networkTip : tipFloor;
    const baseMax = feeData.maxFeePerGas > tip * 2n ? feeData.maxFeePerGas : tip * 2n;
    overrides.maxPriorityFeePerGas = tip;
    overrides.maxFeePerGas = (baseMax * BigInt(10_000 + bumpBps)) / 10_000n;
  } else if (feeData.gasPrice != null) {
    overrides.gasPrice = (feeData.gasPrice * BigInt(10_000 + bumpBps)) / 10_000n;
  }
  return overrides;
}

function formatEthShort(wei) {
  const { ethers } = require("ethers");
  const text = ethers.formatEther(wei);
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  if (num >= 0.01) return num.toFixed(4);
  if (num >= 0.0001) return num.toFixed(6);
  return text.replace(/0+$/, "").replace(/\.$/, "") || "0";
}

async function assertNativeEthForBuy(wallet, amountIn) {
  const gasReserve = gasReserveWei();
  const nativeBal = await rpcCall("getBalance(buy)", () => wallet.provider.getBalance(wallet.address));
  if (nativeBal < amountIn + gasReserve) {
    throw new Error(
      [
        `Không đủ ETH để mua.`,
        `Cần ${formatEthShort(amountIn)} ETH + ~${formatEthShort(gasReserve)} gas.`,
        `Wallet còn ${formatEthShort(nativeBal)} ETH.`,
      ].join(" "),
    );
  }
  return amountIn;
}

async function assertEthForGas(wallet, label = "trade") {
  const gasReserve = gasReserveWei();
  const nativeBal = await rpcCall("getBalance(gas)", () => wallet.provider.getBalance(wallet.address));
  if (nativeBal < gasReserve) {
    throw new Error(
      `Không đủ ETH gas để ${label}. Cần ~${formatEthShort(gasReserve)} ETH, còn ${formatEthShort(nativeBal)} ETH. Nạp thêm ETH rồi Sell lại.`,
    );
  }
}

function formatSwapError(error) {
  const raw = String(error?.shortMessage || error?.reason || error?.message || error || "");
  if (/Trade đang chạy|double-send/i.test(raw)) return raw;
  // Gas / balance first — never mislabel as slippage ("gas" used to match /AS/).
  if (/không đủ eth gas|not enough eth for gas|need ~.*gas|nạp thêm eth/i.test(raw)) {
    return raw;
  }
  if (/không đủ eth để mua|not enough eth for buy/i.test(raw)) {
    return raw;
  }
  if (/insufficient funds/i.test(raw)) {
    return "Không đủ ETH cho value + gas. Nạp thêm ETH rồi thử lại.";
  }
  if (/timed out|timeout|fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(raw)) {
    return `Mạng/RPC chập chờn: ${raw.slice(0, 120)}. Thử lại sau vài giây.`;
  }
  if (/nonce|replacement|already known/i.test(raw)) {
    return `Nonce/tx conflict — đợi tx cũ xong rồi thử lại. (${raw.slice(0, 100)})`;
  }
  if (/\bSTF\b|transfer amount exceeds|insufficient allowance/i.test(raw)) {
    return "Token transfer/approve failed (balance hoặc allowance). Thử Sell lại hoặc Approve.";
  }
  // Uniswap V3 quoter/pool: require(amountSpecified != 0, "AS") — NOT slippage.
  if (/\bAS\b/.test(raw) || /execution reverted:\s*"AS"/i.test(raw)) {
    return "Amount swap = 0 (dust / quote ra 0). Bán % lớn hơn, kiểm tra balance, hoặc paste lại token. Không cần tăng slippage.";
  }
  // Match Uniswap codes carefully — bare "AS" used to match the letters inside "gas".
  if (/INSUFFICIENT_OUTPUT_AMOUNT|Too little received|TOO_LITTLE|Price slippage|slippage/i.test(raw)) {
    return `Slippage/giá chạy quá nhanh. Tăng SLIPPAGE_BPS (vd 500–1000) rồi thử lại.`;
  }
  if (/no data present|require\(false\)|execution reverted|Swap reverted on-chain/i.test(raw)) {
    return "Swap bị revert (thường do slippage/giá chạy, thanh khoản mỏng, hoặc token có tax). Tăng SLIPPAGE_BPS rồi thử lại.";
  }
  if (/execution reverted/i.test(raw) && raw.length > 160) {
    return `Swap reverted: ${raw.slice(0, 120)}…`;
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

function isQuoteWethToken(tokenAddress) {
  return normalizeAddress(tokenAddress) === normalizeAddress(config.quoteTokenAddress);
}

function displayQuoteSymbol(symbol = config.quoteSymbol) {
  const upper = String(symbol || "").toUpperCase();
  if (upper === "WETH") return "ETH";
  if (upper === "WBNB") return "BNB";
  return symbol || config.nativeSymbol || "ETH";
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

async function pickBestTradeRoute({
  provider,
  side,
  baseTokenAddress,
  tokenIn,
  tokenOut,
  amountIn,
  preferredFee,
  buyWithNativeEth,
  sellToNativeEth,
}) {
  const { ethers } = require("ethers");
  const bestroute = require("./bestroute");

  let v3Quote = null;
  try {
    const quoted = await quoteExactInputSingleAmount(provider, tokenIn, tokenOut, amountIn, preferredFee);
    if (quoted?.amountOut > 0n) {
      v3Quote = {
        kind: "v3",
        label: `${config.dexLabel || "Uni"} V3 ${config.wrappedSymbol || config.quoteSymbol || "WETH"}`,
        amountOut: quoted.amountOut,
        fee: quoted.fee,
      };
    }
  } catch (error) {
    console.warn(`V3 quote failed: ${error.message}`);
  }

  let v4Meta = null;
  if (config.enableV4 && (buyWithNativeEth || sellToNativeEth)) {
    try {
      const pairs = await fetchTokenPairs(baseTokenAddress);
      const v4pool = bestroute.pickV4EthPool(pairs, baseTokenAddress);
      if (v4pool?.pairAddress && bestroute.isV4PoolId(v4pool.pairAddress)) {
        const key =
          bestroute.recoverV4PoolKey(v4pool.pairAddress, baseTokenAddress, bestroute.NATIVE_ETH) ||
          bestroute.recoverV4PoolKey(v4pool.pairAddress, bestroute.NATIVE_ETH, baseTokenAddress);
        if (key) {
          v4Meta = { poolId: v4pool.pairAddress, key };
        }
      }
    } catch (error) {
      console.warn(`V4 pool lookup failed: ${error.message}`);
    }
  }

  async function quoteV4Amount(partIn) {
    if (!v4Meta || partIn <= 0n) return 0n;
    let out = 0n;
    try {
      out = await bestroute.quoteViaDexPrice(v4Meta.poolId, baseTokenAddress, side, partIn);
    } catch {
      out = 0n;
    }
    if (out <= 0n) {
      const tokenIs0 = normalizeAddress(v4Meta.key.currency0) === normalizeAddress(baseTokenAddress);
      const zeroForOne = side === "SELL" ? tokenIs0 : !tokenIs0;
      try {
        out = await bestroute.quoteV4ExactInSpot(provider, v4Meta.poolId, zeroForOne, partIn);
      } catch {
        out = 0n;
      }
    }
    return out;
  }

  // Prefer straight Uni V3 WETH whenever it quotes — thick V3 pools are what users force-track.
  // V4 is fallback only (V3 quote missing/failed), not a "best price" contest with inflated Dex marks.
  if (v3Quote) {
    console.log(`Route Uni V3 out=${ethers.formatEther(v3Quote.amountOut)}`);
    return v3Quote;
  }

  if (v4Meta) {
    const out4 = await quoteV4Amount(amountIn);
    if (out4 > 0n) {
      const best = {
        kind: "v4",
        label: "Uni V4 ETH",
        amountOut: out4,
        poolId: v4Meta.poolId,
        key: v4Meta.key,
      };
      console.log(`Route Uni V4 ETH (V3 unavailable) out=${ethers.formatEther(out4)}`);
      return best;
    }
  }

  throw new Error("No V3/V4 quote available. Try again in a few seconds.");
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
  let baseDecimals = Number.isFinite(Number(overrides.decimals)) ? Number(overrides.decimals) : Number.NaN;
  const decimalsOut = 18;

  const { ethers } = require("ethers");
  const provider = getRpcProvider();
  console.log(`Trade ${side} via ${isWsProviderReady() ? "WSS" : "HTTP RPC"}…`);
  const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
  const tokenIn = side === "BUY" ? quoteTokenAddress : baseTokenAddress;
  const tokenOut = side === "BUY" ? baseTokenAddress : quoteTokenAddress;
  const tokenInSymbol = side === "BUY" ? displayQuoteSymbol(quoteSymbol) : baseSymbol;
  const tokenOutSymbol = side === "BUY" ? baseSymbol : displayQuoteSymbol(quoteSymbol);
  const buyWithNativeEth = side === "BUY" && isQuoteWethToken(tokenIn);
  const sellToNativeEth = side === "SELL" && isQuoteWethToken(tokenOut);

  if (!Number.isFinite(baseDecimals)) {
    baseDecimals = await readTokenDecimals(baseTokenAddress, provider, 18);
  }
  if (!buyWithNativeEth && side === "SELL") {
    decimalsIn = baseDecimals;
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
  const baseTokenContract = new ethers.Contract(baseTokenAddress, erc20Abi, wallet);
  const pairAddress = normalizeAddress(overrides.pairAddress || config.pairAddress || "");
  const preBaseBalance = await rpcCall("balanceOf(base)", () => baseTokenContract.balanceOf(wallet.address));

  const buildTradeResult = (tx, routeLabelFinal) => {
    const outDecimals = side === "BUY" ? baseDecimals : decimalsOut;
    return {
      hash: tx.hash,
      wallet: wallet.address,
      side,
      baseTokenAddress,
      baseSymbol,
      baseDecimals,
      preBaseBalance: preBaseBalance.toString(),
      soldTokenAmount: side === "SELL" ? ethers.formatUnits(amountIn, baseDecimals) : "",
      expectedTokenAmount:
        side === "BUY" ? ethers.formatUnits(best.amountOut, baseDecimals) : "",
      tokenInSymbol,
      tokenOutSymbol: sellToNativeEth ? "ETH" : tokenOutSymbol,
      minOut: ethers.formatUnits(minOut, outDecimals),
      paidNative: buyWithNativeEth ? ethers.formatEther(payValue) : "",
      receivedNative: sellToNativeEth ? ethers.formatUnits(minOut, decimalsOut) : "",
      routeLabel: routeLabelFinal,
      confirm: async () => {
        try {
          const receipt = await withTimeout(tx.wait(1), TRADE_CONFIRM_TIMEOUT_MS, `confirm ${tx.hash}`);
          if (!receipt || Number(receipt.status) !== 1) {
            throw new Error(`Swap reverted on-chain. Tx: ${tx.hash}`);
          }
          return receipt;
        } catch (error) {
          const hash = extractTxHash(tx.hash, error);
          throw new Error(
            hash
              ? `Swap reverted on-chain. Tx: ${hash}. ${formatSwapError(error)}`
              : formatSwapError(error),
          );
        }
      },
    };
  };

  let amountIn;
  let knownBalance = null;
  const sellPercent = side === "SELL" ? parseSellPercent(amountText) : null;
  if (side === "SELL" && sellPercent !== null) {
    knownBalance = await rpcCall("balanceOf(sell%)", () => inputToken.balanceOf(wallet.address));
    amountIn = balancePercent(knownBalance, sellPercent);
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

  // Slippage from env (200 = 2%). Cap at 30% to avoid foot-guns.
  const slipBps = Math.min(3000, Math.max(1, Number(config.slippageBps) || 200));

  if (buyWithNativeEth) await assertNativeEthForBuy(wallet, amountIn);
  else await assertEthForGas(wallet, side);

  const best = await pickBestTradeRoute({
    provider,
    side,
    baseTokenAddress,
    tokenIn,
    tokenOut,
    amountIn,
    preferredFee: swapFee,
    buyWithNativeEth,
    sellToNativeEth,
  });
  let minOut = (best.amountOut * BigInt(10000 - slipBps)) / 10000n;
  if (minOut <= 0n) throw new Error("Quote minOut is zero — amount too small or pool illiquid.");
  const payValue = buyWithNativeEth ? amountIn : 0n;
  let routeLabel = best.label;

  if (best.kind === "v4") {
    const bestroute = require("./bestroute");
    const key = best.key;
    const tokenIs0 = normalizeAddress(key.currency0) === normalizeAddress(baseTokenAddress);
    const zeroForOne = side === "SELL" ? tokenIs0 : !tokenIs0;
    const v4TokenIn = side === "BUY" ? bestroute.NATIVE_ETH : baseTokenAddress;
    const v4TokenOut = side === "BUY" ? baseTokenAddress : bestroute.NATIVE_ETH;
    const deadline = Math.floor(Date.now() / 1000) + 300;
    let useV4 = true;

    if (side === "SELL") {
      await bestroute.ensurePermit2(wallet, baseTokenAddress, UNIVERSAL_ROUTER_V4, amountIn);
    }

    const data = bestroute.encodeExactInputSingle({
      key,
      zeroForOne,
      tokenIn: v4TokenIn,
      tokenOut: v4TokenOut,
      amountIn,
      minAmountOut: minOut,
      deadline,
    });

    try {
      await rpcCall("simulate v4", () =>
        provider.call({ from: wallet.address, to: UNIVERSAL_ROUTER_V4, data, value: payValue }),
      );
    } catch (simError) {
      console.warn(`V4 simulate failed (${simError.message}); falling back to V3.`);
      useV4 = false;
      const quoted = await quoteExactInputSingleAmount(provider, tokenIn, tokenOut, amountIn, swapFee);
      swapFee = quoted.fee;
      minOut = (quoted.amountOut * BigInt(10000 - slipBps)) / 10000n;
      routeLabel = "Uni V3 WETH";
    }

    if (useV4) {
      const gasOverrides = await resolveTradeGasOverrides(provider, {
        to: UNIVERSAL_ROUTER_V4,
        data,
        from: wallet.address,
        value: payValue,
      });
      const tx = await rpcCall("v4 execute", () =>
        wallet.sendTransaction({ to: UNIVERSAL_ROUTER_V4, data, value: payValue, ...gasOverrides }),
      );
      assertTradeTx(tx, "v4");
      return buildTradeResult(tx, routeLabel);
    }
  }

  if (best.kind === "v3" && Number.isFinite(best.fee)) swapFee = best.fee;

  if (!buyWithNativeEth) {
    const balance =
      knownBalance != null ? knownBalance : await rpcCall("balanceOf", () => inputToken.balanceOf(wallet.address));
    if (balance < amountIn) {
      throw new Error(
        `Not enough ${tokenInSymbol}. Need ${amountText}, wallet has ${ethers.formatUnits(balance, decimalsIn)} ${tokenInSymbol}`,
      );
    }

    const allowance = await rpcCall("allowance", () => inputToken.allowance(wallet.address, config.swapRouterAddress));
    if (allowance < amountIn) {
      const approvePopulated = await inputToken.approve.populateTransaction(config.swapRouterAddress, ethers.MaxUint256);
      const approveGas = await resolveTradeGasOverrides(provider, { ...approvePopulated, from: wallet.address });
      const approveTx = await rpcCall("approve", () =>
        inputToken.approve(config.swapRouterAddress, ethers.MaxUint256, approveGas),
      );
      const approveReceipt = await withTimeout(
        approveTx.wait(1),
        TRADE_CONFIRM_TIMEOUT_MS,
        `approve ${approveTx.hash}`,
      );
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

  const buildCalldata = () => {
    if (sellToNativeEth) {
      const params = { ...swapParams, recipient: config.swapRouterAddress };
      return {
        method: "multicall",
        args: [
          [
            router.interface.encodeFunctionData("exactInputSingle", [params]),
            router.interface.encodeFunctionData("unwrapWETH9", [0n, wallet.address]),
          ],
        ],
        value: 0n,
      };
    }
    if (buyWithNativeEth) {
      return { method: "exactInputSingle", args: [swapParams], value: payValue };
    }
    return { method: "exactInputSingle", args: [swapParams], value: 0n };
  };

  // Simulate first — fail fast with a clear error instead of broadcasting a reverting tx.
  try {
    if (sellToNativeEth) {
      const params = { ...swapParams, recipient: config.swapRouterAddress };
      await rpcCall("simulate multicall", () =>
        router.multicall.staticCall([
          router.interface.encodeFunctionData("exactInputSingle", [params]),
          router.interface.encodeFunctionData("unwrapWETH9", [0n, wallet.address]),
        ]),
      );
    } else if (buyWithNativeEth) {
      await rpcCall("simulate buy", () => router.exactInputSingle.staticCall(swapParams, { value: payValue }));
    } else {
      await rpcCall("simulate swap", () => router.exactInputSingle.staticCall(swapParams));
    }
  } catch (simError) {
    try {
      const quoted = await quoteExactInputSingleAmount(provider, tokenIn, tokenOut, amountIn, swapFee);
      swapFee = quoted.fee;
      minOut = (quoted.amountOut * BigInt(10000 - slipBps)) / 10000n;
      swapParams.fee = swapFee;
      swapParams.amountOutMinimum = minOut;
      if (sellToNativeEth) {
        const params = { ...swapParams, recipient: config.swapRouterAddress };
        await rpcCall("simulate multicall retry", () =>
          router.multicall.staticCall([
            router.interface.encodeFunctionData("exactInputSingle", [params]),
            router.interface.encodeFunctionData("unwrapWETH9", [0n, wallet.address]),
          ]),
        );
      } else if (buyWithNativeEth) {
        await rpcCall("simulate buy retry", () => router.exactInputSingle.staticCall(swapParams, { value: payValue }));
      } else {
        await rpcCall("simulate swap retry", () => router.exactInputSingle.staticCall(swapParams));
      }
    } catch {
      throw new Error(formatSwapError(simError));
    }
  }

  let tx;
  try {
    const call = buildCalldata();
    const populated =
      call.method === "multicall"
        ? await router.multicall.populateTransaction(...call.args)
        : await router.exactInputSingle.populateTransaction(...call.args, call.value ? { value: call.value } : {});
    const gasOverrides = await resolveTradeGasOverrides(provider, {
      ...populated,
      from: wallet.address,
      value: call.value || populated.value || 0n,
    });
    const sendOverrides = call.value ? { value: call.value, ...gasOverrides } : gasOverrides;
    tx = await rpcCall(sellToNativeEth ? "swap multicall" : "swap exactInputSingle", () =>
      call.method === "multicall"
        ? router.multicall(...call.args, sendOverrides)
        : router.exactInputSingle(...call.args, sendOverrides),
    );
    assertTradeTx(tx, "v3");
  } catch (error) {
    throw new Error(formatSwapError(error));
  }

  return buildTradeResult(tx, routeLabel);
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
  if (Date.now() - Number(pending.createdAt || 0) > 300_000) {
    clearPendingBuyPrompt(state);
    return null;
  }
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
    .filter((pair) => normalizeAddress(pair.chainId) === config.chainId)
    .filter((pair) => {
      const base = normalizeAddress(pair.baseToken?.address);
      const quote = normalizeAddress(pair.quoteToken?.address);
      return base === token || quote === token;
    });

  const isWethPair = (pair) => {
    const base = normalizeAddress(pair.baseToken?.address);
    const quote = normalizeAddress(pair.quoteToken?.address);
    const quoteSym = String(pair.quoteToken?.symbol || "").toUpperCase();
    const baseSym = String(pair.baseToken?.symbol || "").toUpperCase();
    // Native 0x000… on Dexscreener is usually v4 — do NOT treat as wrapped-quote pool.
    return (
      quoteSym === "WETH" ||
      baseSym === "WETH" ||
      quoteSym === "WBNB" ||
      baseSym === "WBNB" ||
      quote === config.quoteTokenAddress ||
      base === config.quoteTokenAddress
    );
  };

  // Only Uni V3 vs wrapped native (WETH/WBNB) — never fall back to V3/USDG hubs.
  const tradeable = validPairs.filter((pair) => isV3Pair(pair) && isWethPair(pair) && Number(pair.liquidity?.usd || 0) > 0);
  const ranked = tradeable.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));

  return ranked[0] || null;
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
    pairUrl: pair.url || `https://dexscreener.com/${config.chainId}/${pair.pairAddress}`,
    baseTokenAddress: normalizeAddress(baseToken?.address),
    baseSymbol: baseToken?.symbol || "TOKEN",
    quoteTokenAddress: normalizeAddress(quoteToken?.address),
    quoteSymbol: quoteToken?.symbol || "QUOTE",
    watchPairAddresses: [],
  };
}

function isV3Pair(pair) {
  const labels = (pair?.labels || []).map((item) => String(item).toLowerCase());
  // Require explicit v3 — empty labels / v2 / v4 are not SwapRouter-tradeable.
  if (labels.includes("v4") || labels.includes("v2")) return false;
  return labels.includes("v3");
}

function isV4Pair(pair) {
  const labels = (pair?.labels || []).map((item) => String(item).toLowerCase());
  return labels.includes("v4");
}

function isTradeableDexPair(pair) {
  return isV3Pair(pair) || isV4Pair(pair);
}

function isV4PoolId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

function chooseWatchPairAddresses(pairs, tokenAddress, primaryPairAddress = "") {
  const token = normalizeAddress(tokenAddress);
  const primary = normalizeAddress(primaryPairAddress);
  // One pool per token keeps WSS/getLogs light. Prefer forced/primary V3, else deepest V3 WETH.
  if (primary) {
    const primaryPair = (Array.isArray(pairs) ? pairs : []).find(
      (pair) => normalizeAddress(pair.pairAddress) === primary,
    );
    if (!primaryPair || isV3Pair(primaryPair)) return [primary];
  }

  const ranked = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => normalizeAddress(pair.chainId) === config.chainId)
    .filter((pair) => {
      const base = normalizeAddress(pair.baseToken?.address);
      const quote = normalizeAddress(pair.quoteToken?.address);
      if (!(base === token || quote === token)) return false;
      const quoteSym = String(pair.quoteToken?.symbol || "").toUpperCase();
      const baseSym = String(pair.baseToken?.symbol || "").toUpperCase();
      const isWeth =
        quoteSym === "WETH" ||
        quoteSym === "ETH" ||
        quoteSym === "WBNB" ||
        quoteSym === "BNB" ||
        baseSym === "WETH" ||
        baseSym === "ETH" ||
        baseSym === "WBNB" ||
        baseSym === "BNB" ||
        quote === config.quoteTokenAddress ||
        base === config.quoteTokenAddress;
      return isWeth && isV3Pair(pair) && Number(pair.liquidity?.usd || 0) > 0;
    })
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));

  const best = normalizeAddress(ranked[0]?.pairAddress || "");
  return best ? [best] : [];
}

function trackedPairsList() {
  if (Array.isArray(config.trackedPairs) && config.trackedPairs.length) return config.trackedPairs;
  // Legacy single-token fallback built from active config.
  return [
    {
      pairAddress: normalizeAddress(config.pairAddress),
      pairUrl: config.dexscreenPairUrl,
      baseTokenAddress: normalizeAddress(config.baseTokenAddress),
      baseSymbol: config.baseSymbol,
      quoteTokenAddress: normalizeAddress(config.quoteTokenAddress),
      quoteSymbol: config.quoteSymbol,
      watchPairAddresses: (config.watchPairAddresses || []).map(normalizeAddress).filter(Boolean),
    },
  ];
}

function findTrackedForPool(meta) {
  for (const entry of trackedPairsList()) {
    const base = normalizeAddress(entry.baseTokenAddress);
    const quote = normalizeAddress(entry.quoteTokenAddress);
    const t0 = normalizeAddress(meta?.token0);
    const t1 = normalizeAddress(meta?.token1);
    // Exact pool match only — never attach GME/USDG or other hubs to a GME/WETH track.
    if ((t0 === base && t1 === quote) || (t0 === quote && t1 === base)) {
      return entry;
    }
  }
  return null;
}

function tagTradeWithTracked(trade, entry, poolAddress = "") {
  if (!trade || !entry) return trade;
  trade.baseSymbol = entry.baseSymbol;
  trade.quoteSymbol = entry.quoteSymbol;
  trade.pairUrl = entry.pairUrl;
  trade.baseTokenAddress = normalizeAddress(entry.baseTokenAddress);
  // Prefer the pool that actually emitted the Swap (not only the primary tracked pair).
  trade.pairAddress = normalizeAddress(poolAddress || entry.pairAddress);
  if (trade.pairAddress && trade.pairAddress !== normalizeAddress(entry.pairAddress)) {
    trade.pairUrl = `https://dexscreener.com/${config.chainId}/${trade.pairAddress}`;
  }
  return trade;
}

function watchedPairSet(settings = config) {
  if (settings === config) {
    // Union of every tracked token's pools so alerts cover all of them.
    const set = new Set();
    for (const entry of trackedPairsList()) {
      const list = entry.watchPairAddresses?.length ? entry.watchPairAddresses : [entry.pairAddress];
      for (const address of list || []) {
        const normalized = normalizeAddress(address);
        if (normalized) set.add(normalized);
      }
    }
    if (!set.size && config.pairAddress) set.add(normalizeAddress(config.pairAddress));
    return set;
  }
  const list = settings.watchPairAddresses?.length
    ? settings.watchPairAddresses
    : [settings.pairAddress];
  return new Set((list || []).map(normalizeAddress).filter(Boolean));
}

function applyTrackedPair(trackedPair) {
  if (!trackedPair?.pairAddress || !trackedPair?.baseTokenAddress || !trackedPair?.quoteTokenAddress) return;

  config.pairAddress = normalizeAddress(trackedPair.pairAddress);
  config.dexscreenPairUrl = trackedPair.pairUrl || `https://dexscreener.com/${config.chainId}/${trackedPair.pairAddress}`;
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

function upsertTrackedPair(state, trackedPair) {
  const token = normalizeAddress(trackedPair.baseTokenAddress);
  const current = Array.isArray(state.trackedPairs) && state.trackedPairs.length
    ? state.trackedPairs
    : state.trackedPair
      ? [state.trackedPair]
      : [];
  const withoutDup = current.filter((entry) => normalizeAddress(entry?.baseTokenAddress) !== token);
  withoutDup.unshift(trackedPair);
  state.trackedPairs = withoutDup.slice(0, config.maxTrackedTokens);
  state.trackedPair = trackedPair;
  config.trackedPairs = state.trackedPairs;
  applyTrackedPair(trackedPair);
  return state.trackedPairs;
}

function removeTrackedPair(state, tokenAddress) {
  const token = normalizeAddress(tokenAddress);
  const current = Array.isArray(state.trackedPairs) && state.trackedPairs.length
    ? state.trackedPairs
    : state.trackedPair
      ? [state.trackedPair]
      : [];
  if (current.length <= 1) {
    return { removed: false, reason: "last", list: current };
  }

  const next = current.filter((entry) => normalizeAddress(entry?.baseTokenAddress) !== token);
  if (next.length === current.length) {
    return { removed: false, reason: "missing", list: current };
  }

  state.trackedPairs = next;
  config.trackedPairs = next;
  const activeRemoved = normalizeAddress(state.trackedPair?.baseTokenAddress) === token;
  if (activeRemoved || !next.some((entry) =>
    normalizeAddress(entry.baseTokenAddress) === normalizeAddress(state.trackedPair?.baseTokenAddress))) {
    state.trackedPair = next[0];
  }
  applyTrackedPair(state.trackedPair);
  saveState(state);
  return { removed: true, activeRemoved, list: next };
}

function applyStateConfig(state) {
  const list = Array.isArray(state.trackedPairs) && state.trackedPairs.length
    ? state.trackedPairs
    : state.trackedPair
      ? [state.trackedPair]
      : [];
  config.trackedPairs = list.filter((entry) => entry?.pairAddress && entry?.baseTokenAddress);
  applyTrackedPair(state.trackedPair || config.trackedPairs[0]);
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

function ensurePositions(state) {
  if (!state.positions || typeof state.positions !== "object" || Array.isArray(state.positions)) {
    state.positions = {};
  }
  return state.positions;
}

function getPosition(state, tokenAddress) {
  const token = normalizeAddress(tokenAddress);
  if (!isEvmAddress(token)) return null;
  const pos = state?.positions?.[token];
  if (!pos || !(Number(pos.amount) > 0)) return null;
  return pos;
}

/** Weighted-average cost basis after a buy (DCA). */
function recordBuyFill(state, { tokenAddress, symbol, tokenAmount, ethSpent, ethUsd }) {
  const token = normalizeAddress(tokenAddress);
  const amount = Number(tokenAmount);
  const eth = Number(ethSpent);
  const usdPerEth = Number(ethUsd);
  if (!isEvmAddress(token) || !(amount > 0) || !(eth > 0)) return null;

  const costUsd = Number.isFinite(usdPerEth) && usdPerEth > 0 ? eth * usdPerEth : NaN;
  const fillEntryUsd = Number.isFinite(costUsd) ? costUsd / amount : NaN;
  const fillEntryEth = eth / amount;

  const positions = ensurePositions(state);
  const prev = positions[token] || { amount: 0, costEth: 0, costUsd: 0, symbol: symbol || "TOKEN" };
  const prevAmt = Number(prev.amount) || 0;
  const prevCostEth = Number(prev.costEth) || 0;
  const prevCostUsd = Number.isFinite(Number(prev.costUsd)) ? Number(prev.costUsd) : 0;
  const addUsd = Number.isFinite(costUsd) ? costUsd : 0;

  const nextAmt = prevAmt + amount;
  const nextCostEth = prevCostEth + eth;
  const nextCostUsd = prevCostUsd + addUsd;
  const position = {
    symbol: symbol || prev.symbol || "TOKEN",
    amount: nextAmt,
    costEth: nextCostEth,
    costUsd: nextCostUsd,
    avgEntryEth: nextAmt > 0 ? nextCostEth / nextAmt : Number.NaN,
    avgEntryUsd: nextAmt > 0 && nextCostUsd > 0 ? nextCostUsd / nextAmt : Number.NaN,
    updatedAt: new Date().toISOString(),
  };
  positions[token] = position;
  return {
    position,
    fillEntryUsd,
    fillEntryEth,
    fillCostUsd: costUsd,
    isDca: prevAmt > 0,
  };
}

/** Reduce cost basis proportionally on sell (keeps avg entry). */
function recordSellFill(state, { tokenAddress, tokenAmount }) {
  const token = normalizeAddress(tokenAddress);
  const sold = Number(tokenAmount);
  const positions = ensurePositions(state);
  const prev = positions[token];
  if (!prev || !(Number(prev.amount) > 0) || !(sold > 0)) return null;

  const prevAmt = Number(prev.amount);
  const ratio = Math.min(1, sold / prevAmt);
  const nextAmt = Math.max(0, prevAmt - sold);
  if (!(nextAmt > 0) || nextAmt / prevAmt < 1e-12) {
    delete positions[token];
    return { position: null, closed: true };
  }

  const nextCostEth = Number(prev.costEth || 0) * (1 - ratio);
  const nextCostUsd = Number(prev.costUsd || 0) * (1 - ratio);
  const position = {
    symbol: prev.symbol || "TOKEN",
    amount: nextAmt,
    costEth: nextCostEth,
    costUsd: nextCostUsd,
    avgEntryEth: nextAmt > 0 ? nextCostEth / nextAmt : Number.NaN,
    avgEntryUsd: nextAmt > 0 && nextCostUsd > 0 ? nextCostUsd / nextAmt : Number.NaN,
    updatedAt: new Date().toISOString(),
  };
  positions[token] = position;
  return { position, closed: false };
}

function formatPnlPct(entryUsd, spotUsd) {
  const entry = Number(entryUsd);
  const spot = Number(spotUsd);
  if (!(entry > 0) || !(spot > 0)) return "";
  const pct = ((spot - entry) / entry) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function positionEntryLines(position, { fillEntryUsd, spotUsd, isDca } = {}) {
  const lines = [];
  const avg = Number(position?.avgEntryUsd);
  if (isDca && Number.isFinite(Number(fillEntryUsd)) && Number(fillEntryUsd) > 0) {
    lines.push(`Entry (lệnh này): <b>${escapeHtml(formatPriceUsd(fillEntryUsd))}</b>`);
  }
  if (Number.isFinite(avg) && avg > 0) {
    const pnl = formatPnlPct(avg, spotUsd);
    const label = isDca ? "Avg entry" : "Entry";
    lines.push(
      `${label}: <b>${escapeHtml(formatPriceUsd(avg))}</b>` +
        (pnl ? ` · PnL <b>${escapeHtml(pnl)}</b>` : ""),
    );
  }
  return lines;
}

async function resolveBuyTokenReceived(result) {
  const expected = Number(result?.expectedTokenAmount);
  if (!result?.baseTokenAddress || result.preBaseBalance == null || !result.wallet) {
    return Number.isFinite(expected) && expected > 0 ? expected : Number.NaN;
  }
  try {
    const { ethers } = require("ethers");
    const provider = getRpcProvider();
    const token = new ethers.Contract(
      result.baseTokenAddress,
      ["function balanceOf(address owner) view returns (uint256)"],
      provider,
    );
    const after = await token.balanceOf(result.wallet);
    const delta = after - BigInt(result.preBaseBalance);
    if (delta > 0n) return unitsToNumber(delta, Number(result.baseDecimals) || 18);
  } catch (error) {
    console.warn(`Buy fill balance delta failed: ${error.message}`);
  }
  return Number.isFinite(expected) && expected > 0 ? expected : Number.NaN;
}

async function applyConfirmedTradeFill(result) {
  if (!result?.side || !result?.baseTokenAddress) return { lines: [] };
  const state = loadState();

  if (result.side === "SELL") {
    const sold = Number(result.soldTokenAmount);
    const outcome = recordSellFill(state, {
      tokenAddress: result.baseTokenAddress,
      tokenAmount: sold,
    });
    saveState(state, { flush: true });
    return {
      state,
      lines: positionEntryLines(outcome?.position, {}),
      closed: Boolean(outcome?.closed),
    };
  }

  if (result.side !== "BUY") return { lines: [] };

  const [tokenAmount, ethUsd] = await Promise.all([resolveBuyTokenReceived(result), fetchEthPriceUsd()]);
  const ethSpent = Number(result.paidNative);
  const outcome = recordBuyFill(state, {
    tokenAddress: result.baseTokenAddress,
    symbol: result.baseSymbol,
    tokenAmount,
    ethSpent,
    ethUsd,
  });
  saveState(state, { flush: true });
  return {
    state,
    lines: positionEntryLines(outcome?.position, {
      fillEntryUsd: outcome?.fillEntryUsd,
      spotUsd: Number.NaN,
      isDca: Boolean(outcome?.isDca),
    }),
    fill: outcome,
  };
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
  if (item.address === normalizeAddress(config.quoteTokenAddress)) return false;
  if (!(Number(item.amount) > 0)) return false;
  if (!Number.isFinite(Number(item.priceUsd)) || Number(item.priceUsd) <= 0) return false;
  if (!isEvmAddress(item.pairAddress)) return false;
  // Reject junk/scam Dex quotes (tiny LP or absurd USD).
  const minLiq = Number(config.minPortfolioLiquidityUsd);
  if (Number.isFinite(minLiq) && minLiq > 0) {
    if (!Number.isFinite(Number(item.liquidityUsd)) || Number(item.liquidityUsd) < minLiq) return false;
  }
  const minBagUsd = Number(config.minBagValueUsd);
  const floor = Number.isFinite(minBagUsd) && minBagUsd > 0 ? minBagUsd : 1;
  if (!(Number.isFinite(Number(item.valueUsd)) && Number(item.valueUsd) > floor)) return false;
  // Holding value shouldn't dwarf pool liquidity (spot mark is not sellable size).
  const liq = Number(item.liquidityUsd);
  const value = Number(item.valueUsd);
  if (Number.isFinite(liq) && liq > 0 && value > liq * 2) return false;
  return true;
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
      pairUrl: pair?.url || (pair?.pairAddress ? `https://dexscreener.com/${config.chainId}/${pair.pairAddress}` : ""),
    };

    if (isBagSellableItem(enriched)) bagCandidates.push(enriched);

    if (isTradeablePortfolioItem(enriched, filterOptions)) {
      tradeable.push(enriched);
      if (Number.isFinite(valueUsd) && valueUsd > 0) totalUsd += valueUsd;
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
  let pairs = await fetchDexTokens(tokenAddresses);

  // Dex /tokens batch often omits the real V3 WETH pool when many bags are scanned.
  // Lookup tracked tokens always; cap other missing lookups to keep Update Price light.
  const trackedTokens = trackedPairsList()
    .map((entry) => normalizeAddress(entry?.baseTokenAddress))
    .filter(isEvmAddress);
  const missing = tokenAddresses.filter((address) => !chooseBestPairForToken(pairs, address));
  const needLookup = [...new Set([...trackedTokens, ...missing])].slice(0, 10);
  for (let index = 0; index < needLookup.length; index += 5) {
    const chunk = needLookup.slice(index, index + 5);
    const results = await Promise.all(
      chunk.map(async (address) => {
        try {
          return await fetchTokenPairs(address);
        } catch (error) {
          console.warn(`Portfolio pair lookup failed for ${address}: ${error.message}`);
          return [];
        }
      }),
    );
    for (const extra of results) {
      if (Array.isArray(extra) && extra.length) pairs = pairs.concat(extra);
    }
  }

  const portfolio = buildPortfolioFromBalances(balances, pairs, options);
  return { wallet, ...portfolio };
}

function portfolioSectionText(portfolio, state = null) {
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
    lines.push(`Không còn token > $${Number(config.minBagValueUsd) || 1} với pair WETH để bán.`);
  } else {
    for (const item of displayItems) {
      const chart = item.pairUrl ? ` <a href="${escapeHtml(item.pairUrl)}">chart</a>` : "";
      const pos = getPosition(state, item.address);
      const avg = Number(pos?.avgEntryUsd);
      const pnl = formatPnlPct(avg, item.priceUsd);
      const entryBit =
        Number.isFinite(avg) && avg > 0
          ? ` · Entry <b>${escapeHtml(formatPriceUsd(avg))}</b>${pnl ? ` <b>${escapeHtml(pnl)}</b>` : ""}`
          : "";
      lines.push(
        `↳ <b>${escapeHtml(item.symbol)}</b> ${escapeHtml(formatTokenAmount(item.amount))} · ${escapeHtml(formatPriceUsd(item.priceUsd))} · <b>${escapeHtml(formatUsd(item.valueUsd))}</b>${entryBit}${chart}`,
      );
    }
  }

  lines.push("<i>Bấm token bên dưới để Sell bag · Update Price để quét lại.</i>");
  return lines.join("\n");
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
        "Thêm ID này vào TELEGRAM_CHAT_ID trên server (có thể nối nhiều ID bằng dấu phẩy).",
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

function trackedSwitchRows() {
  const list = trackedPairsList();
  if (list.length <= 1) return [];
  const active = normalizeAddress(config.baseTokenAddress);
  const buttons = list.map((entry) => {
    const token = normalizeAddress(entry.baseTokenAddress);
    return {
      text: `${token === active ? "🎯 " : ""}${entry.baseSymbol || "TOKEN"}`,
      callback_data: `switch:${token}`,
    };
  });
  return chunkButtons(buttons, 3);
}

function manageTrackedText() {
  const list = trackedPairsList();
  const active = normalizeAddress(config.baseTokenAddress);
  return [
    `<b>Manage tracked tokens</b>`,
    `Đang track <b>${list.length}/${config.maxTrackedTokens}</b> token.`,
    "",
    ...list.map((entry, index) => {
      const token = normalizeAddress(entry.baseTokenAddress);
      const marker = token === active ? "🎯 ACTIVE" : `${index + 1}.`;
      return `${marker} <b>${escapeHtml(entry.baseSymbol || "TOKEN")}</b> · <code>${escapeHtml(compactAddress(token))}</code>`;
    }),
    "",
    `Use = chuyển token cho Buy/Sell nhanh.`,
    `Remove = ngừng alert token đó.`,
  ].join("\n");
}

function manageTrackedKeyboard() {
  const active = normalizeAddress(config.baseTokenAddress);
  const list = trackedPairsList();
  const rows = [];
  for (const entry of list) {
    const token = normalizeAddress(entry.baseTokenAddress);
    const symbol = entry.baseSymbol || "TOKEN";
    rows.push([
      {
        text: token === active ? `🎯 ${symbol}` : `Use ${symbol}`,
        callback_data: `switch:${token}`,
      },
      {
        text: list.length <= 1 ? "Last token" : `❌ Remove ${symbol}`,
        callback_data: `trackremove:${token}`,
      },
    ]);
  }
  rows.push([{ text: "← Main Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function mainMenuKeyboard(portfolio = null) {
  return {
    inline_keyboard: [
      ...trackedSwitchRows(),
      ...tradeActionRows(),
      [
        { text: "Chart", url: config.dexscreenPairUrl },
        { text: "Update Price", callback_data: "portfolio:refresh" },
      ],
      [{ text: `Manage Track (${trackedPairsList().length}/${config.maxTrackedTokens})`, callback_data: "trackmanage" }],
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

function bagSellPanelText(item, extras = {}, state = null) {
  if (!item?.address) {
    return [`<b>Sell bag</b>`, "Token không còn trong portfolio. Bấm Update Price rồi thử lại."].join("\n");
  }
  const chart = item.pairUrl ? `<a href="${escapeHtml(item.pairUrl)}">Dexscreener</a>` : "";
  const pos = getPosition(state, item.address);
  const avg = Number(pos?.avgEntryUsd);
  const pnl = formatPnlPct(avg, item.priceUsd);
  const entryLines =
    Number.isFinite(avg) && avg > 0
      ? [
          `Avg entry: <b>${escapeHtml(formatPriceUsd(avg))}</b>` +
            (pnl ? ` · PnL <b>${escapeHtml(pnl)}</b>` : ""),
        ]
      : [];
  return [
    `<b>Sell ${escapeHtml(item.symbol || "TOKEN")}</b>`,
    `Balance: <b>${escapeHtml(formatTokenAmount(item.amount))}</b> · Value: <b>${escapeHtml(formatUsd(item.valueUsd))}</b>`,
    `Price: <b>${escapeHtml(formatPriceUsd(item.priceUsd))}</b>`,
    ...entryLines,
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
    const weth = normalizeAddress(config.quoteTokenAddress);
    const pairs = await fetchTokenPairs(weth);
    const list = (Array.isArray(pairs) ? pairs : []).filter(
      (pair) => normalizeAddress(pair.chainId) === config.chainId && Number(pair.liquidity?.usd || 0) > 0,
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

  // Show the same address portfolio actually scans (not just the trade-key wallet).
  const wallet =
    (options.state && getPortfolioWallet(options.state)) ||
    (await getDisplayWallet());
  const [ethUsd, balance, portfolio] = await Promise.all([
    fetchEthPriceUsd(),
    getNativeBalance(wallet),
    portfolioPromise,
  ]);
  const priceText = Number.isFinite(ethUsd) ? `$${ethUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "n/a";
  const walletText = wallet ? compactAddress(wallet) : "Not configured";
  const balanceText = balance ? `${Number(balance).toPrecision(6)} ETH` : "n/a";

  const bagUsd =
    Number.isFinite(Number(portfolio?.totalUsd)) && Number(portfolio.totalUsd) > 0
      ? Number(portfolio.totalUsd)
      : 0;
  const ethBal = Number(balance);
  const ethUsdValue =
    Number.isFinite(ethUsd) && ethUsd > 0 && Number.isFinite(ethBal) && ethBal > 0 ? ethBal * ethUsd : 0;
  const totalUsd = bagUsd + ethUsdValue;
  const totalUsdText = totalUsd > 0 ? formatUsd(totalUsd) : "n/a";

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
    portfolioSectionText(portfolio, options.state),
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

  // getUpdates long-polls ~10s; UI edits should fail fast so polling stays snappy.
  const isLongPoll = method === "getUpdates";
  const isUi =
    method === "answerCallbackQuery" ||
    method === "editMessageText" ||
    method === "editMessageReplyMarkup" ||
    method === "editMessageCaption";
  const result = await fetchJson(
    telegramUrl(method),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      timeoutMs: isLongPoll ? 45_000 : isUi ? 12_000 : 20_000,
    },
    isLongPoll ? 3 : isUi ? 2 : 3,
  );

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
      "Invalid TELEGRAM_BOT_TOKEN: value is empty or still uses 123456:replace_me. Set the real BotFather token in the server environment.",
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
        `Telegram rejected TELEGRAM_BOT_TOKEN (${maskToken(config.telegramBotToken)}). Copy a fresh token from BotFather and update the server environment.`,
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

async function activateTrackedPair(trackedPair, state, chatId, options = {}) {
  const forced = Boolean(options.forced);
  const dexVer = options.dexVer || (forced ? "Uni V3 · forced pool" : "Uni V3");

  trackedPair.v4Meta = null;
  trackedPair.v4TradeKey = null;
  trackedPair.v4TradePoolId = "";
  trackedPair.v4AlertPoolId = "";
  trackedPair.v4AlertQuote = "";
  trackedPair.v4RouteMode = "";
  trackedPair.v4BridgeToken = "";

  if (!Array.isArray(trackedPair.watchPairAddresses) || !trackedPair.watchPairAddresses.length) {
    trackedPair.watchPairAddresses = [trackedPair.pairAddress];
  }

  upsertTrackedPair(state, trackedPair);

  try {
    const meta = await getPoolMeta(trackedPair.pairAddress);
    if (Number.isFinite(meta.fee) && meta.fee > 0) config.uniswapV3Fee = meta.fee;
  } catch (error) {
    console.warn(`Could not read pool fee: ${error.message}`);
  }

  try {
    await initRpcSwapCursors(state);
  } catch (error) {
    console.warn(`Could not init RPC swap cursor: ${error.message}`);
  }

  saveState(state);
  refreshWsSwapListener(state);

  const trackedNames = (state.trackedPairs || [trackedPair])
    .map((entry) => entry.baseSymbol || "TOKEN")
    .join(", ");
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      `<b>Tracking ${escapeHtml(trackedPair.baseSymbol)}</b> (active · ${escapeHtml(dexVer)})`,
      `Đang track <b>${state.trackedPairs?.length || 1}/${config.maxTrackedTokens}</b>: ${escapeHtml(trackedNames)}`,
      `Chỉ theo dõi buy/sell realtime (≥${config.minQuoteAmount} ${escapeHtml(trackedPair.quoteSymbol)}).`,
      `Pair: <code>${escapeHtml(compactAddress(trackedPair.pairAddress))}</code>`,
      forced ? "Buy/Sell dùng đúng pool này." : "",
      !forced && trackedPair.watchPairAddresses?.length
        ? `Watching <b>${trackedPair.watchPairAddresses.length}</b> WETH v3 pool(s)`
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

async function followPairAddress(pairAddress, state, chatId) {
  const pair = await fetchDexPairByAddress(pairAddress);
  if (!pair || normalizeAddress(pair.chainId) !== config.chainId) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        "Không load được pool Dexscreener:",
        `<code>${escapeHtml(pairAddress)}</code>`,
        "Paste link Dexscreener v3 hoặc contract token.",
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  if (!isV3Pair(pair)) {
    const tokenAddress = tradeTokenFromDexPair(pair);
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        "Pool này không phải <b>Uniswap V3</b> (bot trade qua V3 SwapRouter).",
        `<code>${escapeHtml(pairAddress)}</code>`,
        isEvmAddress(tokenAddress)
          ? `Đang fallback track token <code>${escapeHtml(compactAddress(tokenAddress))}</code> (auto chọn V3 WETH pool tốt nhất).`
          : "Paste contract token hoặc link pool V3.",
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    if (isEvmAddress(tokenAddress)) await followTokenAddress(tokenAddress, state, chatId);
    return;
  }

  const tokenAddress = tradeTokenFromDexPair(pair);
  if (!isEvmAddress(tokenAddress)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Pool không xác định được token để trade:\n<code>${escapeHtml(pairAddress)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  try {
    await getPoolMeta(pair.pairAddress);
  } catch (error) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        "Pool V3 không đọc được on-chain:",
        `<code>${escapeHtml(pairAddress)}</code>`,
        escapeHtml(error.message || String(error)),
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  const trackedPair = trackedPairFromDexPair(pair, tokenAddress);
  trackedPair.watchPairAddresses = [trackedPair.pairAddress];
  await activateTrackedPair(trackedPair, state, chatId, { forced: true, dexVer: "Uni V3 · forced pool" });
}

async function followTokenAddress(tokenAddress, state, chatId) {
  const raw = normalizeAddress(tokenAddress);
  if (!isEvmAddress(raw)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "Token address không hợp lệ.",
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  let followAddress = raw;
  try {
    const asPair = await fetchDexPairByAddress(raw);
    if (asPair?.pairAddress && (asPair.baseToken?.address || asPair.quoteToken?.address)) {
      if (isV3Pair(asPair)) {
        await followPairAddress(raw, state, chatId);
        return;
      }
      const base = normalizeAddress(asPair.baseToken?.address);
      const quote = normalizeAddress(asPair.quoteToken?.address);
      const weth = normalizeAddress(config.quoteTokenAddress);
      followAddress = base === weth && isEvmAddress(quote) ? quote : base || quote;
      console.log(`Pasted pair ${raw}; following token ${followAddress}`);
    }
  } catch (error) {
    console.warn(`Dex pair lookup for ${raw} failed: ${error.message}`);
  }
  if (followAddress === raw) {
    try {
      const meta = await getPoolMeta(raw);
      if (meta?.token0 && meta?.token1) {
        const weth = normalizeAddress(config.quoteTokenAddress);
        followAddress = meta.token0 === weth ? meta.token1 : meta.token0;
        console.log(`Pasted pool contract ${raw}; following token ${followAddress}`);
      }
    } catch {
      // not a v3 pool
    }
  }
  if (followAddress !== raw && isEvmAddress(followAddress)) {
    return followTokenAddress(followAddress, state, chatId);
  }

  const pairs = await fetchTokenPairs(followAddress);
  const pair = chooseBestPairForToken(pairs, followAddress);
  if (!pair) {
    try {
      let looksLikePool = false;
      try {
        const meta = await getPoolMeta(followAddress);
        looksLikePool = Boolean(meta?.token0 && meta?.token1);
      } catch {
        looksLikePool = false;
      }
      if (looksLikePool) {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: [
            "Đây là địa chỉ <b>pool/pair</b>, không phải ví:",
            `<code>${escapeHtml(followAddress)}</code>`,
            "Paste contract <b>token</b> để track, hoặc dùng <code>/wallet 0x...</code> để gắn ví portfolio.",
          ].join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: "true",
          reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
        });
        return;
      }

      const balances = await fetchWalletTokenBalances(followAddress);
      const hasTokens = balances.some((entry) => {
        const item = parseWalletBalanceEntry(entry);
        return item.address && item.amount > 0;
      });
      if (hasTokens) {
        await setPortfolioWallet(followAddress, state, chatId);
        return;
      }
    } catch (error) {
      console.warn(`Could not treat ${followAddress} as wallet: ${error.message}`);
    }

    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        "Không tìm thấy pool Robinhood cho contract:",
        `<code>${escapeHtml(followAddress)}</code>`,
        "Hoặc paste <b>link Dexscreener V3</b> để force đúng pool.",
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
    return;
  }

  const trackedPair = trackedPairFromDexPair(pair, followAddress);
  trackedPair.watchPairAddresses = chooseWatchPairAddresses(pairs, followAddress, trackedPair.pairAddress);
  if (trackedPair.watchPairAddresses?.length) {
    const primaryWatch = normalizeAddress(trackedPair.watchPairAddresses[0]);
    if (primaryWatch && primaryWatch !== normalizeAddress(trackedPair.pairAddress)) {
      console.log(
        `Retarget primary pair ${trackedPair.pairAddress} → v3 watch pool ${primaryWatch} for ${trackedPair.baseSymbol}`,
      );
      trackedPair.pairAddress = primaryWatch;
      trackedPair.pairUrl = `https://dexscreener.com/${config.chainId}/${primaryWatch}`;
    }
  }
  const finalDexPair =
    (Array.isArray(pairs) ? pairs : []).find(
      (entry) => normalizeAddress(entry.pairAddress) === normalizeAddress(trackedPair.pairAddress),
    ) || pair;
  const dexVer = isV3Pair(finalDexPair) ? "Uni V3" : "Uni V4 (alerts may use v3 watch pools)";
  await activateTrackedPair(trackedPair, state, chatId, { forced: false, dexVer });
}

async function followTrackInput(input, state, chatId) {
  const parsed = typeof input === "string" ? parseTrackInput(input) : input;
  if (!parsed?.address) throw new Error("Invalid track input.");

  if (parsed.forced || parsed.kind === "pair") {
    await followPairAddress(parsed.address, state, chatId);
    return;
  }

  const asPair = await fetchDexPairByAddress(parsed.address).catch(() => null);
  if (asPair && normalizeAddress(asPair.chainId) === config.chainId && isV3Pair(asPair)) {
    await followPairAddress(parsed.address, state, chatId);
    return;
  }
  await followTokenAddress(parsed.address, state, chatId);
}


const trackJobs = [];
let trackWorkerRunning = false;

async function enqueueFollowToken(tokenAddress, state, chatId) {
  trackJobs.push({ input: tokenAddress, state, chatId });
  if (trackWorkerRunning) return;
  trackWorkerRunning = true;
  try {
    while (trackJobs.length) {
      const job = trackJobs.shift();
      try {
        await followTrackInput(job.input, job.state, job.chatId);
      } catch (error) {
        console.error(`followTrackInput failed: ${error.message}`);
        try {
          await telegramRequest("sendMessage", {
            chat_id: job.chatId,
            text: `Không theo dõi được:\n<code>${escapeHtml(job.input)}</code>\n${escapeHtml(error.message)}`,
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
  const baseSymbol = trade.baseSymbol || config.baseSymbol;
  const quoteSymbol = trade.quoteSymbol || config.quoteSymbol;
  const pairUrl = trade.pairUrl || config.dexscreenPairUrl;
  const execPrice = Number.isFinite(trade.execPriceUsd) ? trade.execPriceUsd : trade.priceUsd;
  const spotPrice = Number(trade.spotPriceUsd);
  const priceLines = [`Price (lệnh này): <b>${escapeHtml(formatUsd(execPrice))}</b>`];
  if (Number.isFinite(spotPrice) && spotPrice > 0) {
    priceLines.push(`Spot (chart): <b>${escapeHtml(formatUsd(spotPrice))}</b>`);
  }
  return [
    `<b>${sideLabel} ${escapeHtml(baseSymbol)}</b> on Robinhood Uniswap v3`,
    `Amount: <b>${escapeHtml(formatUnits(trade.baseRaw, trade.baseDecimals, 4))} ${escapeHtml(baseSymbol)}</b>`,
    `Quote: <b>${escapeHtml(formatUnits(trade.quoteRaw, trade.quoteDecimals, 6))} ${escapeHtml(quoteSymbol)}</b> (${escapeHtml(formatUsd(trade.quoteUsdValue))})`,
    ...priceLines,
    `Trader: <code>${escapeHtml(compactAddress(trade.trader))}</code>`,
    `Block: <code>${trade.blockNumber}</code>`,
    `<a href="${escapeHtml(txUrl)}">Tx</a> | <a href="${escapeHtml(pairUrl)}">Dexscreener</a>`,
  ].join("\n");
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
    let decimals = Number(fromBag.decimals);
    if (!Number.isFinite(decimals) || decimals < 0) {
      try {
        decimals = await readTokenDecimals(token, getRpcProvider(), 18);
      } catch {
        decimals = 18;
      }
    }
    return {
      baseTokenAddress: token,
      baseSymbol: fromBag.symbol || "TOKEN",
      quoteTokenAddress: config.quoteTokenAddress,
      quoteSymbol: config.quoteSymbol,
      pairAddress: normalizeAddress(fromBag.pairAddress),
      pairUrl: fromBag.pairUrl || `https://dexscreener.com/${config.chainId}/${fromBag.pairAddress}`,
      fee,
      priceNative: Number.NaN,
      priceUsd: Number(fromBag.priceUsd),
      decimals,
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
  pairUrl = tracked.pairUrl || `https://dexscreener.com/${config.chainId}/${pairAddress}`;
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

  try {
    decimals = await readTokenDecimals(token, getRpcProvider(), 18);
  } catch {
    decimals = 18;
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

  const payload = await fetchJson(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      timeoutMs: 25_000,
    },
    5,
  );

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

  let broadcastHash = "";
  try {
    const result = await withTradeLock(() => executeSwap(side, amount));
    broadcastHash = result.hash;
    await pending;
    const txUrl = explorerTxUrl(result.hash);
    const state = loadState();
    await editTradeMessage(
      callbackQuery,
      [
        `<b>${escapeHtml(side)} broadcast</b>`,
        result.paidNative ? `Paid: <b>${escapeHtml(result.paidNative)} ETH</b>` : "",
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `<i>Đang chờ confirm…</i>`,
      ]
        .filter(Boolean)
        .join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    ).catch(() => {});

    // Confirm on-chain in background so Telegram getUpdates stays responsive.
    result
      .confirm()
      .then(async () => {
        nativeBalanceCache.at = 0;
        const fill = await applyConfirmedTradeFill(result).catch((error) => {
          console.warn(`Position fill tracking failed: ${error.message}`);
          return { lines: [] };
        });
        await editTradeMessage(
          callbackQuery,
          [
            `<b>${escapeHtml(side)} sent</b>`,
            result.paidNative ? `Paid: <b>${escapeHtml(result.paidNative)} ETH</b>` : "",
            `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
            `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
            `Route: <b>${escapeHtml(result.routeLabel || "Uni V3")}</b>`,
            `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
            result.receivedNative ? `Received: <b>≥${escapeHtml(result.receivedNative)} ETH</b>` : "",
            ...(fill.lines || []),
          ]
            .filter(Boolean)
            .join("\n"),
          mainMenuKeyboard(state.portfolioSnapshot),
        ).catch(() => {});
      })
      .catch(async (error) => {
        await editTradeMessage(
          callbackQuery,
          formatTradeFailureMessage(error, broadcastHash),
          mainMenuKeyboard(state.portfolioSnapshot),
        ).catch(() => {});
      });
  } catch (error) {
    await pending;
    const state = loadState();
    await editTradeMessage(
      callbackQuery,
      formatTradeFailureMessage(error, broadcastHash),
      mainMenuKeyboard(state.portfolioSnapshot),
    ).catch(() => {});
  }
}

async function runConfirmedBagSell(callbackQuery, tokenAddress, amount, state) {
  let ctx;
  try {
    ctx = await resolveSellContext(tokenAddress, state);
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Bag sell failed</b>\n${escapeHtml(formatSwapError(error))}`,
      mainMenuKeyboard(state.portfolioSnapshot),
    ).catch(() => {});
    return;
  }

  const pending = editTradeMessage(
    callbackQuery,
    `<b>Sending SELL ${escapeHtml(ctx.baseSymbol)}...</b>\nAmount: ${escapeHtml(amount)} ${escapeHtml(ctx.baseSymbol)}`,
  ).catch(() => {});

  let broadcastHash = "";
  try {
    const result = await withTradeLock(() => executeSwap("SELL", amount, ctx));
    broadcastHash = result.hash;
    await pending;
    const txUrl = explorerTxUrl(result.hash);
    await editTradeMessage(
      callbackQuery,
      [
        `<b>SELL ${escapeHtml(ctx.baseSymbol)} broadcast</b>`,
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `<i>Đang chờ confirm…</i>`,
      ].join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    ).catch(() => {});

    result
      .confirm()
      .then(async () => {
        nativeBalanceCache.at = 0;
        const fill = await applyConfirmedTradeFill(result).catch((error) => {
          console.warn(`Position fill tracking failed: ${error.message}`);
          return { lines: [] };
        });
        await editTradeMessage(
          callbackQuery,
          [
            `<b>SELL ${escapeHtml(ctx.baseSymbol)} sent</b>`,
            `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
            `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
            `Route: <b>${escapeHtml(result.routeLabel || "Uni V3")}</b>`,
            `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
            result.receivedNative ? `Received: <b>≥${escapeHtml(result.receivedNative)} ETH</b>` : "",
            ...(fill.lines || []),
            `Track alerts vẫn: <b>${escapeHtml(config.baseSymbol)}</b>`,
          ].join("\n"),
          mainMenuKeyboard(state.portfolioSnapshot),
        ).catch(() => {});
      })
      .catch(async (error) => {
        const item = findBagItem(state, tokenAddress) || {
          address: ctx.baseTokenAddress,
          symbol: ctx.baseSymbol,
          pairUrl: ctx.pairUrl,
        };
        await editTradeMessage(
          callbackQuery,
          formatTradeFailureMessage(error, broadcastHash).replace("<b>Trade not sent</b>", "<b>Bag sell not sent</b>"),
          bagSellKeyboard(item),
        ).catch(() => {});
      });
  } catch (error) {
    await pending;
    const item = findBagItem(state, tokenAddress) || {
      address: ctx.baseTokenAddress,
      symbol: ctx.baseSymbol,
      pairUrl: ctx.pairUrl,
    };
    await editTradeMessage(
      callbackQuery,
      formatTradeFailureMessage(error, broadcastHash).replace("<b>Trade not sent</b>", "<b>Bag sell not sent</b>"),
      bagSellKeyboard(item),
    ).catch(() => {});
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
  }).catch(() => {});

  let broadcastHash = "";
  try {
    const result = await withTradeLock(() => executeSwap(side, amount));
    broadcastHash = result.hash;
    const txUrl = explorerTxUrl(result.hash);
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        `<b>${escapeHtml(side)} broadcast</b>`,
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `<i>Đang chờ confirm…</i>`,
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    }).catch(() => {});

    result
      .confirm()
      .then(async () => {
        nativeBalanceCache.at = 0;
        const fill = await applyConfirmedTradeFill(result).catch((error) => {
          console.warn(`Position fill tracking failed: ${error.message}`);
          return { lines: [] };
        });
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: [
            `<b>${escapeHtml(side)} sent</b>`,
            result.paidNative ? `Paid: <b>${escapeHtml(result.paidNative)} ETH</b>` : "",
            `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
            `Route: <b>${escapeHtml(result.routeLabel || "Uni V3")}</b>`,
            `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
            result.receivedNative ? `Received: <b>≥${escapeHtml(result.receivedNative)} ETH</b>` : "",
            ...(fill.lines || []),
          ]
            .filter(Boolean)
            .join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: "true",
          reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
        }).catch(() => {});
      })
      .catch(async (error) => {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: formatTradeFailureMessage(error, broadcastHash),
          parse_mode: "HTML",
          disable_web_page_preview: "true",
          reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
        }).catch(() => {});
      });
  } catch (error) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: formatTradeFailureMessage(error, broadcastHash),
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    }).catch(() => {});
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
              : data.startsWith("switch:")
                ? "Switching…"
                : data.startsWith("trackremove:")
                  ? "Removing…"
                  : data === "trackmanage"
                    ? "Manage…"
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
    clearPendingBuyPrompt(state);
    await renderMainMenuFast(callbackQuery, state);
    return;
  }

  if (data === "trackmanage") {
    await editTradeMessage(callbackQuery, manageTrackedText(), manageTrackedKeyboard());
    return;
  }

  if (data.startsWith("switch:")) {
    const token = normalizeAddress(data.slice("switch:".length));
    const entry = trackedPairsList().find(
      (item) => normalizeAddress(item.baseTokenAddress) === token,
    );
    if (entry) {
      state.trackedPair = entry;
      applyTrackedPair(entry);
      saveState(state);
    }
    if (callbackQuery.message?.text?.includes("Manage tracked tokens")) {
      await editTradeMessage(callbackQuery, manageTrackedText(), manageTrackedKeyboard());
    } else {
      await renderMainMenuFast(callbackQuery, state);
    }
    return;
  }

  if (data.startsWith("trackremove:")) {
    const token = normalizeAddress(data.slice("trackremove:".length));
    const entry = trackedPairsList().find(
      (item) => normalizeAddress(item.baseTokenAddress) === token,
    );
    const result = removeTrackedPair(state, token);
    if (result.removed) {
      refreshWsSwapListener(state);
      await editTradeMessage(
        callbackQuery,
        [
          `<b>Removed ${escapeHtml(entry?.baseSymbol || compactAddress(token))}</b>`,
          `Còn track: <b>${escapeHtml(result.list.map((item) => item.baseSymbol || "TOKEN").join(", "))}</b>`,
          "",
          manageTrackedText(),
        ].join("\n"),
        manageTrackedKeyboard(),
      );
    } else {
      const reason = result.reason === "last"
        ? "Không thể remove token cuối cùng. Paste contract mới trước rồi remove token này."
        : "Token không còn trong danh sách track.";
      await editTradeMessage(
        callbackQuery,
        `<b>Không remove được</b>\n${escapeHtml(reason)}\n\n${manageTrackedText()}`,
        manageTrackedKeyboard(),
      );
    }
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
    await editTradeMessage(callbackQuery, bagSellPanelText(item, {}, state), bagSellKeyboard(item));
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
    // Transient network blips — don't spam the user with a second failing send.
    if (isRetryableFetchError(error)) return;
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

  const trackInput = parseTrackInput(text);
  if (trackInput) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: trackInput.forced
        ? `Đang force track pool:\n<code>${escapeHtml(trackInput.address)}</code>`
        : `Đang track buy/sell cho:\n<code>${escapeHtml(trackInput.address)}</code>`,
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
        TRADE_HANDLER_TIMEOUT_MS,
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
        // Prefer WS Swap alerts; transfer heuristic often misreads UniversalRouter multi-hop.
        if (isWsAlertHealthy()) {
          continue;
        }
        emitTradeAlertAsync(trade);
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
  // Alerts are WSS/HTTP getLogs — skip heavy Blockscout transfer crawl on boot.
  try {
    await initRpcSwapCursors(state);
  } catch (error) {
    console.warn(`RPC swap cursor init failed: ${error.message}`);
  }
  if (!state.seen) state.seen = [];
  saveState(state);
  console.log("Booted. RPC swap cursors ready (Blockscout boot crawl skipped).");
}

async function main() {
  console.log("Starting telegram-bot...");
  console.log(
    `Chain: ${config.chainName} (${config.chainId}) · ${config.dexLabel} V3` +
      (config.enableV4 ? " (V4 ETH fallback)" : "") +
      ` · quote ${config.quoteSymbol}`,
  );
  startHealthServer();

  const state = loadState();
  applyStateConfig(state);

  try {
    await validateTelegramConfig();
  } catch (error) {
    // Keep process alive so health checks can pass; Telegram loop will retry.
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

  if (config.rpcWsUrl) {
    try {
      startWsSwapListener(state);
    } catch (error) {
      console.warn(`WS Swap listener failed to start: ${error.message}`);
      markHttpFallback(error.message || "start failed");
    }
  } else {
    markHttpFallback("RPC_WS_URL not set");
    console.log("RPC_WS_URL not set — alerts use HTTP getLogs poll.");
  }

  console.log("Entering poll loop.");
  let lastRpcWarnAt = 0;
  let lastHttpCatchupAt = 0;
  let lastTelegramPollWarnAt = 0;
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
        const nowWarn = Date.now();
        // Network blips ("fetch failed") are retried inside fetchJson — don't spam the console.
        if (nowWarn - lastTelegramPollWarnAt > 30_000) {
          console.error(`Telegram poll error: ${error.message || error}`);
          lastTelegramPollWarnAt = nowWarn;
        }
        if (isRetryableFetchError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    const wsOk = isWsAlertHealthy();
    wsRuntime.stateRef = state;
    const now = Date.now();

    // Full HTTP getLogs when WSS is down; light catch-up every 2 min while WSS is healthy (fill gaps).
    const needFullHttp = !wsOk;
    const needLightCatchup = wsOk && now - lastHttpCatchupAt > 120_000;
    if (needFullHttp || needLightCatchup) {
      try {
        await withTimeout(
          pollRpcSwaps(state, {
            lookbackBlocks: needFullHttp ? config.rpcSwapLookbackBlocks : 30,
            light: !needFullHttp,
          }),
          needFullHttp ? 25_000 : 12_000,
          needFullHttp ? "HTTP RPC swap poll" : "HTTP light catch-up",
        );
        lastHttpCatchupAt = now;
      } catch (error) {
        if (now - lastRpcWarnAt > 60_000) {
          console.warn(`HTTP RPC poll failed (${config.rpcUrl}): ${error.message || error}`);
          lastRpcWarnAt = now;
        }
      }
    }

    // Optional Blockscout API is disabled in the hot loop — HTTP RPC (RPC_URL) already covers alerts.
    // Boot / track-token warmup still use Blockscout when available.

    if (once) return;
    const sleepMs = wsOk ? Math.min(1000, config.pollSeconds * 1000) : config.pollSeconds * 1000;
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

if (require.main === module) {
  process.on("unhandledRejection", (reason) => {
    console.error(`Unhandled rejection: ${reason?.message || reason}`);
  });
  process.on("uncaughtException", (error) => {
    console.error(`Uncaught exception: ${error?.message || error}`);
  });
  process.on("exit", () => {
    try {
      flushStateSync();
    } catch {
      // ignore
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      try {
        flushStateSync();
      } catch {
        // ignore
      }
      process.exit(0);
    });
  }
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
  activeChain,
  resolveChain: require("./chains").resolveChain,
  formatBagButtonLabel,
  formatUnits,
  getPortfolioWallet,
  groupTransfers,
  isAuthorizedChat,
  isEvmAddress,
  parseTrackInput,
  tradeTokenFromDexPair,
  isExpiredCallbackError,
  isFreshTrade,
  isMessageNotModifiedError,
  isPollingConflictError,
  isRetryableFetchError,
  formatSwapError,
  findTrackedForPool,
  manageTrackedKeyboard,
  removeTrackedPair,
  trackedPairsList,
  upsertTrackedPair,
  watchedPairSet,
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
  recordBuyFill,
  recordSellFill,
  getPosition,
  formatPnlPct,
  positionEntryLines,
  bagSellKeyboard,
};

