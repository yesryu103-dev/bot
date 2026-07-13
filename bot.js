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
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
  walletAddress: process.env.WALLET_ADDRESS || "",
  swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoterAddress: process.env.QUOTER_ADDRESS || "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  uniswapV3Fee: Number(process.env.UNISWAP_V3_FEE || 10000),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 200),
  // >1 tips the sequencer harder so txs land in the next ~250ms block more reliably.
  gasFeeMultiplier: Number(process.env.GAS_FEE_MULTIPLIER || 1.5),
  oneTapTrade: truthy(process.env.ONE_TAP_TRADE),
  buyAmountsQuote: parseAmountOptions(process.env.BUY_AMOUNTS_QUOTE || "0.01,0.05,0.1,0.25"),
  sellPercents: parseAmountOptions(process.env.SELL_PERCENTS || "25,50,70")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100),
  sellAmountsBase: parseAmountOptions(process.env.SELL_AMOUNTS_BASE || "1000,5000,10000,25000"),
  minPortfolioLiquidityUsd: Number(process.env.MIN_PORTFOLIO_LIQUIDITY_USD || 50),
  minPortfolioValueUsd: Number(process.env.MIN_PORTFOLIO_VALUE_USD || 3),
  portfolioMaxTokens: Number(process.env.PORTFOLIO_MAX_TOKENS || 25),
  // Uniswap v3 concentrated LP preset from the provided Uniswap UI link.
  lpTokenAddress: normalizeAddress(process.env.LP_TOKEN_ADDRESS || "0xd7321801caae694090694ff55a9323139f043b88"),
  lpWethAddress: normalizeAddress(process.env.QUOTE_TOKEN_ADDRESS || "0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
  lpFee: Number(process.env.LP_FEE || 10000),
  lpTickSpacing: Number(process.env.LP_TICK_SPACING || 200),
  lpTickLower: Number(process.env.LP_TICK_LOWER || 111400),
  lpTickUpper: Number(process.env.LP_TICK_UPPER || 125200),
  lpEthAmounts: parseAmountOptions(process.env.LP_ETH_AMOUNTS || "0.01,0.05,0.1"),
  positionManagerAddress: process.env.POSITION_MANAGER_ADDRESS || "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  v3FactoryAddress: process.env.V3_FACTORY_ADDRESS || "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  v2FactoryAddress: process.env.V2_FACTORY_ADDRESS || "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
  multicall3Address: process.env.MULTICALL3_ADDRESS || "0xcA11bde05977b3631167028862bE2a173976CA11",
  lpLockerAddresses: parseAmountOptions(process.env.LP_LOCKER_ADDRESSES || "")
    .map(normalizeAddress)
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value)),
  uniswapLpUrl:
    process.env.UNISWAP_LP_URL ||
    "https://app.uniswap.org/positions/create/v3?currencyA=0xd7321801caae694090694ff55a9323139f043b88&currencyB=NATIVE&chain=robinhood",
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

async function fastTxOverrides(provider = null) {
  const rpc = provider || getRpcProvider();
  const fee = await rpc.getFeeData();
  const mult = Math.max(1, Number(process.env.GAS_FEE_MULTIPLIER || config.gasFeeMultiplier || 1.5));
  const scale = (value) => {
    if (value == null) return null;
    return (BigInt(value) * BigInt(Math.round(mult * 100))) / 100n;
  };

  const maxPriorityFeePerGas = scale(fee.maxPriorityFeePerGas);
  let maxFeePerGas = scale(fee.maxFeePerGas || fee.gasPrice);
  if (maxPriorityFeePerGas != null && maxFeePerGas != null && maxFeePerGas < maxPriorityFeePerGas) {
    maxFeePerGas = maxPriorityFeePerGas * 2n;
  }

  const overrides = {};
  if (maxPriorityFeePerGas != null) overrides.maxPriorityFeePerGas = maxPriorityFeePerGas;
  if (maxFeePerGas != null) overrides.maxFeePerGas = maxFeePerGas;
  // Legacy networks / fallback
  if (!overrides.maxFeePerGas && fee.gasPrice != null) {
    overrides.gasPrice = scale(fee.gasPrice);
  }
  return overrides;
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
      const priced = await enrichTradePrices(trade);
      await sendTelegram(tradeMessage(priced), alertTradeKeyboard());
      alerted.push(txHash);
      seen.add(txHash);
    }

    state.swapBlocks[pair] = latest;
  }

  if (alerted.length) addSeen(state, alerted);
  saveState(state);
  return alerted.length;
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

async function fetchBlockscoutToken(tokenAddress) {
  return fetchJson(`${config.blockscoutBaseUrl}/api/v2/tokens/${tokenAddress}`);
}

async function fetchBlockscoutAddress(address) {
  return fetchJson(`${config.blockscoutBaseUrl}/api/v2/addresses/${address}`);
}

async function fetchTokenHolders(tokenAddress) {
  const payload = await fetchJson(`${config.blockscoutBaseUrl}/api/v2/tokens/${tokenAddress}/holders`);
  return payload.items || [];
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

function shouldTradeImmediately(side, amount) {
  // One-tap for every inline trade button — confirm step was the main perceived delay.
  return true;
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

async function ensureWethForBuy(wallet, wethAddress, amountIn) {
  const { ethers } = require("ethers");
  const weth = new ethers.Contract(
    wethAddress,
    [
      "function balanceOf(address owner) view returns (uint256)",
      "function deposit() payable",
    ],
    wallet,
  );
  let balance = await weth.balanceOf(wallet.address);
  if (balance >= amountIn) {
    return { wrapped: 0n, balance };
  }

  const shortfall = amountIn - balance;
  const nativeBalance = await wallet.provider.getBalance(wallet.address);
  const gasReserve = ethers.parseEther("0.003");
  if (nativeBalance < shortfall + gasReserve) {
    throw new Error(
      [
        `Not enough ETH/WETH for buy.`,
        `Need ${ethers.formatEther(amountIn)} WETH.`,
        `Have ${ethers.formatEther(balance)} WETH + ${ethers.formatEther(nativeBalance)} ETH.`,
        `Keep ~0.003 ETH for gas.`,
      ].join(" "),
    );
  }

  const depositTx = await weth.deposit({ value: shortfall, ...(await fastTxOverrides(wallet.provider)) });
  await depositTx.wait(1);
  balance = await weth.balanceOf(wallet.address);
  if (balance < amountIn) {
    throw new Error(
      `Wrap ETH→WETH failed. Still have ${ethers.formatEther(balance)} WETH after deposit.`,
    );
  }
  return { wrapped: shortfall, balance };
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
  const decimalsIn = Number.isFinite(Number(overrides.decimals)) ? Number(overrides.decimals) : 18;
  const decimalsOut = 18;

  const { ethers } = require("ethers");
  const provider = getRpcProvider();
  const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
  const tokenIn = side === "BUY" ? quoteTokenAddress : baseTokenAddress;
  const tokenOut = side === "BUY" ? baseTokenAddress : quoteTokenAddress;
  const tokenInSymbol = side === "BUY" ? quoteSymbol : baseSymbol;
  const tokenOutSymbol = side === "BUY" ? baseSymbol : quoteSymbol;

  const erc20Abi = [
    "function allowance(address owner,address spender) view returns (uint256)",
    "function approve(address spender,uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
  ];
  const routerAbi = [
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  ];
  const inputToken = new ethers.Contract(tokenIn, erc20Abi, wallet);
  const pairAddress = normalizeAddress(overrides.pairAddress || config.pairAddress || "");

  let amountIn;
  const sellPercent = side === "SELL" ? parseSellPercent(amountText) : null;
  if (side === "SELL" && sellPercent !== null) {
    const balance = await inputToken.balanceOf(wallet.address);
    amountIn = balancePercent(balance, sellPercent);
    if (amountIn <= 0n) throw new Error(`No ${baseSymbol} balance to sell.`);
    amountText = ethers.formatUnits(amountIn, decimalsIn);
  } else {
    amountIn = ethers.parseUnits(String(amountText), decimalsIn);
  }

  // Resolve fee + quote minOut + read allowance in parallel (skip slow Dexscreener).
  const metaPromise = isEvmAddress(pairAddress)
    ? getPoolMeta(pairAddress, provider).catch(() => null)
    : Promise.resolve(null);
  const allowancePromise = inputToken.allowance(wallet.address, config.swapRouterAddress);

  const meta = await metaPromise;
  if (meta) {
    const matches =
      (meta.token0 === tokenIn && meta.token1 === tokenOut) ||
      (meta.token0 === tokenOut && meta.token1 === tokenIn);
    if (matches && Number.isFinite(meta.fee) && meta.fee > 0) swapFee = meta.fee;
  }

  // Wrap ETH before quoting spends? Quote doesn't need WETH balance. Wrap in parallel with quote when needed.
  let wrappedEth = 0n;
  const needsWrapCheck =
    side === "BUY" && tokenIn === normalizeAddress(config.quoteTokenAddress || config.lpWethAddress);

  const [quoted, allowance, wrapResult] = await Promise.all([
    quoteExactInputSingleAmount(provider, tokenIn, tokenOut, amountIn, swapFee),
    allowancePromise,
    needsWrapCheck ? ensureWethForBuy(wallet, tokenIn, amountIn) : Promise.resolve(null),
  ]);

  swapFee = quoted.fee;
  const minOut = (quoted.amountOut * BigInt(10000 - config.slippageBps)) / 10000n;
  if (wrapResult) wrappedEth = wrapResult.wrapped;

  const balance = await inputToken.balanceOf(wallet.address);
  if (balance < amountIn) {
    const nativeBalance = await provider.getBalance(wallet.address);
    throw new Error(
      [
        `Not enough ${tokenInSymbol}. Need ${amountText}, wallet has ${ethers.formatUnits(balance, decimalsIn)} ${tokenInSymbol}`,
        side === "BUY" ? `+ ${ethers.formatEther(nativeBalance)} ETH native` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const gasOverrides = await fastTxOverrides(provider);

  if (allowance < amountIn) {
    // Max approve once so later trades skip this extra confirmation.
    const approveTx = await inputToken.approve(config.swapRouterAddress, ethers.MaxUint256, gasOverrides);
    await approveTx.wait(1);
  }

  const router = new ethers.Contract(config.swapRouterAddress, routerAbi, wallet);
  const tx = await router.exactInputSingle(
    {
      tokenIn,
      tokenOut,
      fee: swapFee,
      recipient: wallet.address,
      amountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0,
    },
    gasOverrides,
  );
  // Don't block Telegram on full receipt — hash is enough for the alert UI.
  tx.wait(1).catch((error) => console.warn(`Swap receipt wait failed: ${error.message}`));

  return {
    hash: tx.hash,
    wallet: wallet.address,
    tokenInSymbol,
    tokenOutSymbol,
    minOut: ethers.formatUnits(minOut, decimalsOut),
    wrappedEth: wrappedEth > 0n ? ethers.formatEther(wrappedEth) : "",
  };
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

function isDeadOrZeroAddress(address) {
  const value = normalizeAddress(address);
  return (
    !value ||
    value === "0x0000000000000000000000000000000000000000" ||
    value.endsWith("dead") ||
    value === "0x0000000000000000000000000000000000000001"
  );
}

function pickProbeHolder(holders, excludedAddresses = []) {
  const excluded = new Set((excludedAddresses || []).map(normalizeAddress).filter(Boolean));
  for (const entry of holders || []) {
    const address = normalizeAddress(entry?.address?.hash || entry?.address);
    if (!isEvmAddress(address) || isDeadOrZeroAddress(address) || excluded.has(address)) continue;
    if (entry?.address?.is_contract) continue;
    const raw = BigInt(entry?.value || "0");
    if (raw <= 0n) continue;
    return { address, raw };
  }
  return null;
}

function classifyRestrictionError(error) {
  const message = String(error?.shortMessage || error?.reason || error?.message || "").toLowerCase();
  if (!message) return "unknown revert";
  if (message.includes("insufficient") || message.includes("transfer amount exceeds balance")) {
    return "insufficient balance";
  }
  if (
    message.includes("blacklist") ||
    message.includes("blacklisted") ||
    message.includes("paused") ||
    message.includes("trading") ||
    message.includes("forbidden") ||
    message.includes("not allowed") ||
    message.includes("restricted") ||
    message.includes("honeypot")
  ) {
    return "transfer restricted";
  }
  return message.slice(0, 120);
}

function analyzeDexMarketRisk(pair) {
  const buys = Number(pair?.txns?.h24?.buys || 0);
  const sells = Number(pair?.txns?.h24?.sells || 0);
  const liquidityUsd = Number(pair?.liquidity?.usd || 0);
  const volume24 = Number(pair?.volume?.h24 || 0);
  const fdv = Number(pair?.fdv || pair?.marketCap || 0);
  const priceChangeH1 = Number(pair?.priceChange?.h1 || 0);
  const priceChangeH6 = Number(pair?.priceChange?.h6 || 0);
  const priceChangeH24 = Number(pair?.priceChange?.h24 || 0);
  const labels = (pair?.labels || []).map((label) => String(label).toLowerCase());
  const createdAt = Number(pair?.pairCreatedAt || 0);
  const ageHours = createdAt > 0 ? (Date.now() - createdAt) / 3_600_000 : null;
  const boosts = Number(pair?.boosts?.active || 0);
  const hasWebsite = Array.isArray(pair?.info?.websites) && pair.info.websites.length > 0;
  const warnings = [];
  let score = 0;

  if (!(liquidityUsd > 0)) {
    warnings.push("No withdrawable liquidity on Dexscreener");
    score += 60;
  } else if (liquidityUsd < 1000) {
    warnings.push(`Dangerously thin liquidity (${formatUsd(liquidityUsd)})`);
    score += 45;
  } else if (liquidityUsd < 3000) {
    warnings.push(`Very thin liquidity (${formatUsd(liquidityUsd)}) — hard to exit`);
    score += 30;
  } else if (liquidityUsd < 10000) {
    warnings.push(`Low liquidity (${formatUsd(liquidityUsd)})`);
    score += 15;
  }

  if (fdv > 0 && liquidityUsd > 0) {
    const liqRatio = liquidityUsd / fdv;
    if (liqRatio < 0.02) {
      warnings.push(`LP/FDV only ${(liqRatio * 100).toFixed(2)}% — classic soft-rug profile`);
      score += 45;
    } else if (liqRatio < 0.05) {
      warnings.push(`Thin LP vs FDV (${(liqRatio * 100).toFixed(1)}%)`);
      score += 30;
    } else if (liqRatio < 0.1) {
      warnings.push(`LP covers just ${(liqRatio * 100).toFixed(1)}% of FDV`);
      score += 15;
    }
  }

  const absH24 = Math.abs(priceChangeH24);
  const absH6 = Math.abs(priceChangeH6);
  const absH1 = Math.abs(priceChangeH1);
  if (absH24 >= 500) {
    warnings.push(`Extreme 24h price move ${priceChangeH24}% — pump/dump signature`);
    score += 45;
  } else if (absH24 >= 200) {
    warnings.push(`Violent 24h price move ${priceChangeH24}%`);
    score += 30;
  } else if (absH24 >= 100) {
    warnings.push(`Large 24h price move ${priceChangeH24}%`);
    score += 15;
  }
  if (absH6 >= 100) {
    warnings.push(`Sharp 6h move ${priceChangeH6}%`);
    score += 15;
  }
  if (absH1 >= 40) {
    warnings.push(`Sharp 1h move ${priceChangeH1}%`);
    score += 10;
  }

  if (buys >= 20 && sells === 0) {
    warnings.push("24h buys with zero sells (classic honeypot pattern)");
    score += 45;
  } else if (buys >= 20 && sells > 0 && buys / sells >= 20) {
    warnings.push(`Extreme buy/sell skew (${buys}/${sells} in 24h)`);
    score += 25;
  }

  if (volume24 <= 0 && liquidityUsd > 0) {
    warnings.push("No 24h volume");
    score += 8;
  } else if (liquidityUsd > 0 && volume24 > 0 && volume24 / liquidityUsd >= 20) {
    warnings.push("Volume >> liquidity (wash / sniper churn risk)");
    score += 15;
  }

  if (ageHours !== null) {
    if (ageHours < 6) {
      warnings.push(`Brand-new pair (${ageHours.toFixed(1)}h old)`);
      score += 20;
    } else if (ageHours < 24) {
      warnings.push(`Very new pair (${ageHours.toFixed(1)}h old)`);
      score += 10;
    }
  }

  if (labels.includes("v4") && liquidityUsd > 0 && liquidityUsd < 5000) {
    warnings.push("Thin Uniswap v4 pool — exit risk / chart bait");
    score += 20;
  }

  if (boosts >= 100) {
    warnings.push(`Heavy Dexscreener boosts (${boosts}) — paid hype common on scams`);
    score += 12;
  }

  if (!hasWebsite) {
    warnings.push("No project website on Dexscreener");
    score += 5;
  }

  return {
    buys,
    sells,
    liquidityUsd,
    volume24,
    fdv,
    priceChangeH24,
    ageHours,
    warnings,
    score,
    pairAddress: normalizeAddress(pair?.pairAddress || ""),
    labels,
  };
}

function pairLiquidityUsd(pair) {
  return Number(pair?.liquidity?.usd || 0);
}

function isV3Pair(pair) {
  const labels = (pair?.labels || []).map((label) => String(label).toLowerCase());
  if (labels.includes("v4") && !labels.includes("v3")) return false;
  return true;
}

function choosePrimaryDexPair(pairs) {
  const list = (Array.isArray(pairs) ? pairs : []).filter(Boolean);
  if (!list.length) return null;

  const ranked = [...list].sort((a, b) => {
    const aV3 = isV3Pair(a) ? 1 : 0;
    const bV3 = isV3Pair(b) ? 1 : 0;
    if (aV3 !== bV3) return bV3 - aV3;
    const aWeth = String(a.quoteToken?.symbol || "").toUpperCase() === "WETH" || String(a.quoteToken?.symbol || "").toUpperCase() === "ETH";
    const bWeth = String(b.quoteToken?.symbol || "").toUpperCase() === "WETH" || String(b.quoteToken?.symbol || "").toUpperCase() === "ETH";
    if (aWeth !== bWeth) return aWeth ? -1 : 1;
    return pairLiquidityUsd(b) - pairLiquidityUsd(a);
  });

  return ranked[0];
}

function analyzePairsMarketRisk(pairs) {
  const list = (Array.isArray(pairs) ? pairs : []).filter(Boolean);
  if (!list.length) {
    return {
      buys: 0,
      sells: 0,
      liquidityUsd: 0,
      volume24: 0,
      fdv: 0,
      priceChangeH24: 0,
      ageHours: null,
      warnings: ["No Dexscreener pairs to audit"],
      score: 40,
      pairAddress: "",
      labels: [],
    };
  }

  // Score the MAIN pool users actually trade (highest liq, prefer v3/WETH).
  // Do NOT let a tiny secondary v4 pool override the headline liquidity/FDV numbers.
  const primary = choosePrimaryDexPair(list);
  const primaryRisk = analyzeDexMarketRisk(primary);
  const warnings = [
    `Primary pool: ${isV3Pair(primary) ? "v3" : "v4"} ${formatUsd(primaryRisk.liquidityUsd)} liq` +
      (primaryRisk.fdv > 0 ? ` · LP/FDV ${((primaryRisk.liquidityUsd / primaryRisk.fdv) * 100).toFixed(1)}%` : ""),
    ...primaryRisk.warnings,
  ];
  let score = primaryRisk.score;

  const thinSecondaries = list.filter((pair) => {
    if (normalizeAddress(pair.pairAddress) === normalizeAddress(primary.pairAddress)) return false;
    return pairLiquidityUsd(pair) > 0 && pairLiquidityUsd(pair) < 3000;
  });
  if (thinSecondaries.length && primaryRisk.liquidityUsd >= 20000) {
    warnings.push(
      `Also has ${thinSecondaries.length} thin secondary pool(s) (min ${formatUsd(Math.min(...thinSecondaries.map(pairLiquidityUsd)))}) — ignore those charts`,
    );
    score += 8;
  } else if (thinSecondaries.length && primaryRisk.liquidityUsd < 20000) {
    warnings.push("Multiple thin pools — fragmented liquidity / chart bait risk");
    score += 12;
  }

  return {
    ...primaryRisk,
    score,
    warnings,
    primary: true,
    primaryPair: primary,
  };
}

function analyzeHolderConcentration(holders, totalSupplyRaw, excludedAddresses = []) {
  const warnings = [];
  let score = 0;
  const totalSupply = BigInt(totalSupplyRaw || "0");
  if (totalSupply <= 0n) return { score, warnings, top1Pct: 0, top10Pct: 0 };

  const excluded = new Set((excludedAddresses || []).map(normalizeAddress).filter(Boolean));
  const eoaBalances = [];

  for (const entry of holders || []) {
    const address = normalizeAddress(entry?.address?.hash || entry?.address);
    if (!isEvmAddress(address) || isDeadOrZeroAddress(address) || excluded.has(address)) continue;
    if (entry?.address?.is_contract) continue;
    const raw = BigInt(entry?.value || "0");
    if (raw > 0n) eoaBalances.push(raw);
  }

  eoaBalances.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  const top1 = eoaBalances[0] || 0n;
  const top10 = eoaBalances.slice(0, 10).reduce((sum, value) => sum + value, 0n);
  const top1Pct = Number((top1 * 10000n) / totalSupply) / 100;
  const top10Pct = Number((top10 * 10000n) / totalSupply) / 100;

  if (top1Pct >= 20) {
    warnings.push(`Top wallet holds ${top1Pct.toFixed(1)}% supply — dump risk`);
    score += 40;
  } else if (top1Pct >= 10) {
    warnings.push(`Top wallet holds ${top1Pct.toFixed(1)}% supply`);
    score += 25;
  } else if (top1Pct >= 5) {
    warnings.push(`Top wallet holds ${top1Pct.toFixed(1)}% supply`);
    score += 10;
  }

  if (top10Pct >= 50) {
    warnings.push(`Top 10 wallets hold ${top10Pct.toFixed(1)}% supply`);
    score += 30;
  } else if (top10Pct >= 35) {
    warnings.push(`Top 10 wallets hold ${top10Pct.toFixed(1)}% supply`);
    score += 15;
  }

  return { score, warnings, top1Pct, top10Pct };
}

function analyzeContractBytecode(code) {
  const warnings = [];
  let score = 0;
  const normalized = String(code || "").toLowerCase().replace(/^0x/, "");
  if (!normalized || normalized === "0x") {
    return {
      score: 100,
      warnings: ["No contract bytecode"],
      hasOwnerSelector: false,
      hasBlacklistSelector: false,
      hasPauseSelector: false,
      hasMintSelector: false,
      hasTaxSelector: false,
      hasMaxTxSelector: false,
      hasTradingToggle: false,
      hasAccessControl: false,
      hasProxySelector: false,
    };
  }

  const has = (selector) => normalized.includes(String(selector).toLowerCase().replace(/^0x/, ""));
  const hasOwnerSelector = has("8da5cb5b") || has("893d20e8");
  const hasBlacklistSelector = has("f9f92be4") || has("fe575a87") || has("e47d6060") || has("153b0d1e");
  const hasPauseSelector = has("5c975abb") || has("8456cb59") || has("3f4ba83a");
  const hasMintSelector = has("40c10f19") || has("a0712d68");
  const hasTaxSelector =
    has("4f7041a5") || has("cc1776d3") || has("47062402") || has("2b14ca56") || has("13114a9d") || has("5342acb4");
  const hasMaxTxSelector =
    has("8c0b5e22") || has("c8c8ebe4") || has("7d1db4a5") || has("f8b45b05") || has("aa4bde28");
  const hasTradingToggle = has("ffb54a99") || has("bbc0c742") || has("fa83cb58");
  const hasAccessControl = has("91d14854") || has("248a9ca3") || has("570ca735") || has("6d70f7ae");
  const hasProxySelector = has("5c60da1b") || has("52d1902d") || has("f851a440") || has("6e9960c3");

  if (hasBlacklistSelector) {
    warnings.push("Bytecode has blacklist-related selectors");
    score += 35;
  }
  if (hasPauseSelector) {
    warnings.push("Bytecode has pause/unpause selectors");
    score += 20;
  }
  if (hasMintSelector) {
    warnings.push("Bytecode has mint selector — supply can inflate");
    score += 25;
  }
  if (hasTaxSelector) {
    warnings.push("Bytecode has tax/fee selectors");
    score += 15;
  }
  if (hasMaxTxSelector) {
    warnings.push("Bytecode has maxTx/maxWallet selectors");
    score += 12;
  }
  if (hasTradingToggle) {
    warnings.push("Bytecode has trading enable/disable selectors");
    score += 15;
  }
  if (hasAccessControl) {
    warnings.push("Bytecode has AccessControl/operator roles — renounce may be incomplete");
    score += 18;
  }
  if (hasProxySelector) {
    warnings.push("Bytecode has proxy/admin selectors");
    score += 20;
  }
  if (hasOwnerSelector) {
    warnings.push("Ownable-style owner selector present");
    score += 8;
  }

  return {
    score,
    warnings,
    hasOwnerSelector,
    hasBlacklistSelector,
    hasPauseSelector,
    hasMintSelector,
    hasTaxSelector,
    hasMaxTxSelector,
    hasTradingToggle,
    hasAccessControl,
    hasProxySelector,
  };
}

function storageAddress(slotValue) {
  const hex = String(slotValue || "").toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return normalizeAddress(`0x${hex.slice(24)}`);
}

async function analyzeProxyRisk(provider, tokenAddress, addressInfo = null) {
  const notes = [];
  const dangers = [];
  let score = 0;
  const token = normalizeAddress(tokenAddress);

  const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
  const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

  let impl = "";
  let admin = "";
  let beacon = "";
  try {
    const [implRaw, adminRaw, beaconRaw] = await Promise.all([
      provider.getStorage(token, IMPLEMENTATION_SLOT),
      provider.getStorage(token, ADMIN_SLOT),
      provider.getStorage(token, BEACON_SLOT),
    ]);
    impl = storageAddress(implRaw);
    admin = storageAddress(adminRaw);
    beacon = storageAddress(beaconRaw);
  } catch (error) {
    notes.push(`Proxy storage read failed: ${error.message}`);
    return { score: 5, notes, dangers, isProxy: null, impl, admin };
  }

  const proxyType = String(addressInfo?.proxy_type || "").toLowerCase();
  const implementations = Array.isArray(addressInfo?.implementations) ? addressInfo.implementations : [];
  const isProxy =
    Boolean(proxyType) ||
    implementations.length > 0 ||
    (!isDeadOrZeroAddress(impl) && isEvmAddress(impl)) ||
    (!isDeadOrZeroAddress(admin) && isEvmAddress(admin)) ||
    (!isDeadOrZeroAddress(beacon) && isEvmAddress(beacon));

  if (!isProxy) {
    return { score: 0, notes, dangers, isProxy: false, impl, admin };
  }

  notes.push(`Upgradeable proxy detected${proxyType ? ` (${proxyType})` : ""}`);
  score += 30;

  if (admin && !isDeadOrZeroAddress(admin)) {
    dangers.push(`Proxy admin still active: ${admin}`);
    score += 25;
  } else if (beacon && !isDeadOrZeroAddress(beacon)) {
    dangers.push(`Proxy beacon still set: ${beacon}`);
    score += 25;
  } else {
    notes.push("Proxy admin/beacon slot empty — verify implementation immutability");
  }

  if (impl && !isDeadOrZeroAddress(impl)) {
    notes.push(`Implementation: ${impl}`);
  }

  return { score, notes, dangers, isProxy: true, impl, admin, beacon };
}

async function readTokenRiskViews(provider, tokenAddress) {
  const { ethers } = require("ethers");
  const token = normalizeAddress(tokenAddress);
  const iface = new ethers.Interface([
    "function sellTax() view returns (uint256)",
    "function buyTax() view returns (uint256)",
    "function sellFee() view returns (uint256)",
    "function buyFee() view returns (uint256)",
    "function totalFees() view returns (uint256)",
    "function maxTxAmount() view returns (uint256)",
    "function maxTransactionAmount() view returns (uint256)",
    "function maxWallet() view returns (uint256)",
    "function maxWalletAmount() view returns (uint256)",
    "function tradingOpen() view returns (bool)",
    "function tradingActive() view returns (bool)",
    "function paused() view returns (bool)",
  ]);

  const calls = [
    "sellTax",
    "buyTax",
    "sellFee",
    "buyFee",
    "totalFees",
    "maxTxAmount",
    "maxTransactionAmount",
    "maxWallet",
    "maxWalletAmount",
    "tradingOpen",
    "tradingActive",
    "paused",
  ].map((name) => ({
    name,
    target: token,
    data: iface.encodeFunctionData(name, []),
  }));

  const results = await aggregate3(provider, calls);
  const values = {};
  calls.forEach((call, index) => {
    const result = results[index];
    if (!result?.success || !result.returnData || result.returnData === "0x") return;
    try {
      const decoded = iface.decodeFunctionResult(call.name, result.returnData)[0];
      values[call.name] = decoded;
    } catch {
      // ignore
    }
  });

  const notes = [];
  const dangers = [];
  let score = 0;

  const asPct = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n > 1000) return n / 100; // bps-like
    return n;
  };

  for (const key of ["sellTax", "sellFee", "buyTax", "buyFee", "totalFees"]) {
    if (values[key] === undefined) continue;
    const pct = asPct(values[key]);
    if (pct === null) continue;
    notes.push(`${key}=${pct}%`);
    if (pct >= 20) {
      dangers.push(`High ${key}: ${pct}%`);
      score += 40;
    } else if (pct >= 10) {
      score += 20;
    } else if (pct >= 5) {
      score += 10;
    }
  }

  if (values.paused === true) {
    dangers.push("Token paused() == true");
    score += 50;
  }
  if (values.tradingOpen === false || values.tradingActive === false) {
    dangers.push("Trading disabled according to contract view");
    score += 45;
  }

  const maxTx = values.maxTxAmount ?? values.maxTransactionAmount;
  const maxWallet = values.maxWallet ?? values.maxWalletAmount;
  if (maxTx !== undefined && BigInt(maxTx) > 0n) {
    notes.push(`maxTxAmount set (${maxTx.toString()})`);
    score += 8;
  }
  if (maxWallet !== undefined && BigInt(maxWallet) > 0n) {
    notes.push(`maxWallet set (${maxWallet.toString()})`);
    score += 6;
  }

  return { score, notes, dangers, values };
}

async function analyzeRoundTripTax(provider, tokenAddress, quoteToken, fee, amountInQuote = 10n ** 15n) {
  const { ethers } = require("ethers");
  if (!quoteToken || !fee) {
    return { score: 0, notes: [], dangers: [], lossPct: null };
  }

  const quoter = new ethers.Contract(
    config.quoterAddress,
    [
      "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
    ],
    provider,
  );

  try {
    const buy = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: quoteToken,
      tokenOut: tokenAddress,
      amountIn: amountInQuote,
      fee,
      sqrtPriceLimitX96: 0,
    });
    const bought = BigInt(buy.amountOut ?? buy[0]);
    if (bought <= 0n) {
      return { score: 25, notes: ["Round-trip buy quote returned 0"], dangers: [], lossPct: 100 };
    }
    const sell = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: tokenAddress,
      tokenOut: quoteToken,
      amountIn: bought,
      fee,
      sqrtPriceLimitX96: 0,
    });
    const sold = BigInt(sell.amountOut ?? sell[0]);
    const lossPct = Number(amountInQuote - sold) * 100 / Number(amountInQuote);
    const feePct = Number(fee) / 100; // 10000 = 1%
    const expectedFloor = feePct * 2 + 1; // two swaps + tiny impact
    const notes = [`Round-trip loss ~${lossPct.toFixed(2)}% (pool fee ${feePct}%×2)`];
    const dangers = [];
    let score = 0;
    if (lossPct >= 40) {
      dangers.push(`Extreme round-trip loss ${lossPct.toFixed(1)}% — likely sell tax/honeypot`);
      score += 55;
    } else if (lossPct >= expectedFloor + 12) {
      dangers.push(`High round-trip loss ${lossPct.toFixed(1)}% beyond pool fees — likely tax`);
      score += 35;
    } else if (lossPct >= expectedFloor + 5) {
      notes.push("Round-trip loss above fee floor — possible tax or thin depth");
      score += 12;
    }
    return { score, notes, dangers, lossPct, bought, sold };
  } catch (error) {
    return {
      score: 15,
      notes: [`Round-trip tax check failed: ${classifyRestrictionError(error)}`],
      dangers: [],
      lossPct: null,
    };
  }
}

function analyzeV4HookRisk(primaryPair, allPairs = []) {
  const notes = [];
  const dangers = [];
  let score = 0;
  const list = (Array.isArray(allPairs) ? allPairs : []).filter(Boolean);
  const v4Pairs = list.filter((pair) => !isV3Pair(pair));
  const primaryIsV4 = primaryPair && !isV3Pair(primaryPair);

  if (primaryIsV4) {
    dangers.push("Primary pool is Uniswap v4 — custom hooks can tax/block/steal swaps");
    score += 35;
    const addr = String(primaryPair.pairAddress || "");
    if (addr.length > 42) {
      notes.push("v4 pool id (not a contract) — hooks address not readable from Dexscreener");
    }
    notes.push("Prefer trading the deepest v3 WETH pool when available");
  } else if (v4Pairs.length) {
    notes.push(`${v4Pairs.length} secondary v4 pool(s) — ignore for sizing; hooks risk on those pools`);
    score += 6;
  }

  return { score, notes, dangers, primaryIsV4, v4Count: v4Pairs.length };
}

function classifyOwnerStatus({ ownerAddress = "", ownerReadable = false, hasOwnerSelector = false } = {}) {
  const owner = normalizeAddress(ownerAddress);
  if (ownerReadable && isDeadOrZeroAddress(owner)) {
    return {
      ownerActive: false,
      ownerRenounced: true,
      ownerAddress: owner || "0x0000000000000000000000000000000000000000",
      score: 0,
      notes: ["Owner renounced (owner = 0x0 / dead)"],
      dangers: [],
    };
  }
  if (ownerReadable && owner && !isDeadOrZeroAddress(owner)) {
    return {
      ownerActive: true,
      ownerRenounced: false,
      ownerAddress: owner,
      score: 25,
      notes: [],
      dangers: [`Owner still active: ${owner}`],
    };
  }
  if (!hasOwnerSelector) {
    return {
      ownerActive: false,
      ownerRenounced: null,
      ownerAddress: "",
      score: 5,
      notes: ["No Ownable owner() — non-ownable or custom admin"],
      dangers: [],
    };
  }
  return {
    ownerActive: false,
    ownerRenounced: null,
    ownerAddress: "",
    score: 8,
    notes: ["Could not read owner()"],
    dangers: [],
  };
}

async function aggregate3(provider, calls) {
  const { ethers } = require("ethers");
  const multicall = new ethers.Contract(
    config.multicall3Address,
    [
      "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])",
    ],
    provider,
  );
  return multicall.aggregate3.staticCall(
    calls.map((call) => ({
      target: call.target,
      allowFailure: true,
      callData: call.data,
    })),
  );
}

async function analyzeV2LpBurn(provider, tokenAddress) {
  const { ethers } = require("ethers");
  const token = normalizeAddress(tokenAddress);
  const weth = normalizeAddress(config.lpWethAddress);
  const factory = new ethers.Contract(
    config.v2FactoryAddress,
    ["function getPair(address,address) view returns (address)"],
    provider,
  );
  const pairAddress = normalizeAddress(await factory.getPair(token, weth));
  if (!pairAddress || pairAddress === ethers.ZeroAddress) {
    return { hasV2: false, burnedPct: 0, notes: [], score: 0 };
  }

  const pair = new ethers.Contract(
    pairAddress,
    ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"],
    provider,
  );
  const dead = "0x000000000000000000000000000000000000dead";
  const [totalSupply, deadBal, oneBal] = await Promise.all([
    pair.totalSupply(),
    pair.balanceOf(dead),
    pair.balanceOf("0x0000000000000000000000000000000000000001"),
  ]);
  const burned = BigInt(deadBal) + BigInt(oneBal);
  const total = BigInt(totalSupply);
  const burnedPct = total > 0n ? Number((burned * 10000n) / total) / 100 : 0;
  if (burnedPct >= 90) {
    return { hasV2: true, burnedPct, notes: [`V2 LP burned ~${burnedPct.toFixed(1)}% to dead`], score: -5 };
  }
  if (burnedPct >= 50) {
    return { hasV2: true, burnedPct, notes: [`V2 LP partially burned (~${burnedPct.toFixed(1)}%)`], score: 5 };
  }
  return { hasV2: true, burnedPct, notes: [`V2 LP mostly unburned (~${burnedPct.toFixed(1)}% burned)`], score: 18 };
}

async function sumMatchingV3Positions(provider, holder, token0, token1, fee, maxNfts = 24) {
  const { ethers } = require("ethers");
  const npmAbi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)",
    "function getApproved(uint256 tokenId) view returns (address)",
    "function isApprovedForAll(address owner,address operator) view returns (bool)",
    "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
  ];
  const npm = new ethers.Contract(config.positionManagerAddress, npmAbi, provider);
  const npmIface = npm.interface;
  let balance = 0n;
  try {
    balance = BigInt(await npm.balanceOf(holder));
  } catch {
    return { liquidity: 0n, positions: [], approvals: [] };
  }
  if (balance <= 0n) return { liquidity: 0n, positions: [], approvals: [] };

  const count = Math.min(Number(balance), maxNfts);
  const idCalls = [];
  for (let index = 0; index < count; index += 1) {
    idCalls.push({
      target: config.positionManagerAddress,
      data: npmIface.encodeFunctionData("tokenOfOwnerByIndex", [holder, index]),
    });
  }
  const idResults = await aggregate3(provider, idCalls);
  const tokenIds = [];
  for (const result of idResults) {
    if (!result.success) continue;
    try {
      tokenIds.push(npmIface.decodeFunctionResult("tokenOfOwnerByIndex", result.returnData)[0]);
    } catch {
      // ignore
    }
  }

  const posCalls = tokenIds.map((tokenId) => ({
    target: config.positionManagerAddress,
    data: npmIface.encodeFunctionData("positions", [tokenId]),
  }));
  const approvedCalls = tokenIds.map((tokenId) => ({
    target: config.positionManagerAddress,
    data: npmIface.encodeFunctionData("getApproved", [tokenId]),
  }));
  const [posResults, approvedResults] = await Promise.all([
    posCalls.length ? aggregate3(provider, posCalls) : Promise.resolve([]),
    approvedCalls.length ? aggregate3(provider, approvedCalls) : Promise.resolve([]),
  ]);

  let matched = 0n;
  const positions = [];
  const approvals = [];
  const t0 = normalizeAddress(token0);
  const t1 = normalizeAddress(token1);
  for (let index = 0; index < posResults.length; index += 1) {
    const result = posResults[index];
    if (!result.success) continue;
    try {
      const decoded = npmIface.decodeFunctionResult("positions", result.returnData);
      const posToken0 = normalizeAddress(decoded.token0 ?? decoded[2]);
      const posToken1 = normalizeAddress(decoded.token1 ?? decoded[3]);
      const posFee = Number(decoded.fee ?? decoded[4]);
      const tickLower = Number(decoded.tickLower ?? decoded[5]);
      const tickUpper = Number(decoded.tickUpper ?? decoded[6]);
      const liquidity = BigInt(decoded.liquidity ?? decoded[7]);
      const operator = normalizeAddress(decoded.operator ?? decoded[1]);
      const samePair = (posToken0 === t0 && posToken1 === t1) || (posToken0 === t1 && posToken1 === t0);
      if (!(samePair && Number(fee) === posFee) || liquidity <= 0n) continue;
      matched += liquidity;
      positions.push({
        tokenId: tokenIds[index],
        liquidity,
        tickLower,
        tickUpper,
        width: tickUpper - tickLower,
        operator,
      });
      const approvedResult = approvedResults[index];
      if (approvedResult?.success) {
        try {
          const approved = normalizeAddress(
            npmIface.decodeFunctionResult("getApproved", approvedResult.returnData)[0],
          );
          if (approved && !isDeadOrZeroAddress(approved)) {
            approvals.push({ tokenId: tokenIds[index], approved });
          }
        } catch {
          // ignore
        }
      }
      if (operator && !isDeadOrZeroAddress(operator)) {
        approvals.push({ tokenId: tokenIds[index], approved: operator, via: "operator" });
      }
    } catch {
      // ignore
    }
  }
  return { liquidity: matched, positions, approvals };
}

async function analyzeV3LpBurnAndLock(provider, primaryPair, extraHolders = []) {
  const { ethers } = require("ethers");
  if (!primaryPair?.pairAddress || !isV3Pair(primaryPair)) {
    return { burnedPct: 0, lockedPct: 0, notes: ["No v3 primary pool to check LP burn/lock"], score: 0, dangers: [] };
  }

  const pool = new ethers.Contract(
    primaryPair.pairAddress,
    [
      "function token0() view returns (address)",
      "function token1() view returns (address)",
      "function fee() view returns (uint24)",
      "function liquidity() view returns (uint128)",
      "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
    ],
    provider,
  );

  let token0;
  let token1;
  let fee;
  let poolLiquidity;
  let currentTick = 0;
  try {
    [token0, token1, fee, poolLiquidity] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.liquidity(),
    ]);
    try {
      const slot0 = await pool.slot0();
      currentTick = Number(slot0.tick ?? slot0[1]);
    } catch {
      currentTick = 0;
    }
  } catch (error) {
    return { burnedPct: 0, lockedPct: 0, notes: [`Could not read v3 pool LP state: ${error.message}`], score: 10, dangers: [] };
  }

  poolLiquidity = BigInt(poolLiquidity);
  if (poolLiquidity <= 0n) {
    return { burnedPct: 0, lockedPct: 0, notes: ["Primary v3 pool has zero liquidity"], score: 40, dangers: [] };
  }

  const dead = "0x000000000000000000000000000000000000dead";
  const nearDead = "0x0000000000000000000000000000000000000001";
  const [deadA, deadB] = await Promise.all([
    sumMatchingV3Positions(provider, dead, token0, token1, fee),
    sumMatchingV3Positions(provider, nearDead, token0, token1, fee),
  ]);
  const burnedLiq = deadA.liquidity + deadB.liquidity;
  const burnedPositions = [...deadA.positions, ...deadB.positions];
  const burnedApprovals = [...deadA.approvals, ...deadB.approvals];

  let lockedLiq = 0n;
  const lockedPositions = [];
  for (const locker of config.lpLockerAddresses || []) {
    const stats = await sumMatchingV3Positions(provider, locker, token0, token1, fee);
    lockedLiq += stats.liquidity;
    lockedPositions.push(...stats.positions);
  }

  let teamLiq = 0n;
  const teamNotes = [];
  for (const holder of extraHolders || []) {
    if (!isEvmAddress(holder) || isDeadOrZeroAddress(holder)) continue;
    const stats = await sumMatchingV3Positions(provider, holder, token0, token1, fee);
    if (stats.liquidity <= 0n) continue;
    teamLiq += stats.liquidity;
    teamNotes.push(`Creator/team wallet holds V3 LP NFT liquidity (~${((Number(stats.liquidity) * 100) / Number(poolLiquidity)).toFixed(1)}% of active)`);
    for (const approval of stats.approvals) {
      burnedApprovals.push(approval);
    }
  }

  const burnedPct = Number((burnedLiq * 10000n) / poolLiquidity) / 100;
  const lockedPct = Number((lockedLiq * 10000n) / poolLiquidity) / 100;
  const teamPct = Number((teamLiq * 10000n) / poolLiquidity) / 100;
  const securedPct = burnedPct + lockedPct;
  const notes = [...teamNotes];
  const dangers = [];
  let score = 0;

  if (burnedPct >= 80) {
    notes.push(`V3 LP burned ~${burnedPct.toFixed(1)}% (NFT to dead)`);
    score -= 8;
  } else if (burnedPct >= 20) {
    notes.push(`V3 LP partially burned ~${burnedPct.toFixed(1)}%`);
    score += 5;
  } else {
    notes.push(`V3 LP burned ~${burnedPct.toFixed(1)}%`);
  }

  if (!(config.lpLockerAddresses || []).length) {
    notes.push("No LP locker addresses configured (set LP_LOCKER_ADDRESSES)");
  } else if (lockedPct >= 80) {
    notes.push(`V3 LP locked ~${lockedPct.toFixed(1)}% in known locker(s)`);
    score -= 8;
  } else if (lockedPct >= 20) {
    notes.push(`V3 LP partially locked ~${lockedPct.toFixed(1)}%`);
    score += 5;
  } else {
    notes.push(`V3 LP locked ~${lockedPct.toFixed(1)}% in known locker(s)`);
  }

  if (teamPct >= 20) {
    dangers.push(`Creator/team still controls ~${teamPct.toFixed(1)}% of active V3 liquidity (can pull)`);
    score += 35;
  } else if (teamPct >= 5) {
    notes.push(`Creator/team controls ~${teamPct.toFixed(1)}% of active V3 liquidity`);
    score += 15;
  }

  if (securedPct < 20) {
    notes.push("LP not meaningfully burned/locked — position owner can still pull liquidity");
    score += 25;
  } else if (securedPct < 50) {
    notes.push("Only part of LP is burned/locked");
    score += 12;
  }

  if (burnedApprovals.length) {
    dangers.push(`V3 LP NFT still approved/operator set (${burnedApprovals[0].approved}) — burn may be bypassable`);
    score += 40;
  }

  const ranged = [...burnedPositions, ...lockedPositions];
  if (ranged.length) {
    const narrow = ranged.filter((pos) => pos.width > 0 && pos.width < 10000);
    const narrowLiq = narrow.reduce((sum, pos) => sum + pos.liquidity, 0n);
    const totalTracked = ranged.reduce((sum, pos) => sum + pos.liquidity, 0n);
    if (totalTracked > 0n && narrowLiq * 2n >= totalTracked) {
      notes.push("Tracked LP positions use narrow tick ranges — depth can vanish if price leaves range");
      score += 15;
    }
    const inRangeLiq = ranged
      .filter((pos) => currentTick >= pos.tickLower && currentTick < pos.tickUpper)
      .reduce((sum, pos) => sum + pos.liquidity, 0n);
    if (totalTracked > 0n && inRangeLiq * 5n < totalTracked) {
      notes.push("Most burned/locked LP is out of range — visible LP may overstate exit depth");
      score += 12;
    }
  }

  return {
    burnedPct,
    lockedPct,
    teamPct,
    securedPct,
    notes,
    dangers,
    score,
    poolAddress: normalizeAddress(primaryPair.pairAddress),
  };
}

// keep old name used elsewhere
async function sumMatchingV3Liquidity(provider, holder, token0, token1, fee, maxNfts = 24) {
  const stats = await sumMatchingV3Positions(provider, holder, token0, token1, fee, maxNfts);
  return stats.liquidity;
}

function scoreHoneypotFindings(findings) {
  let score =
    Number(findings.marketScore || 0) +
    Number(findings.holderScore || 0) +
    Number(findings.contractScore || 0) +
    Number(findings.ownerScore || 0) +
    Number(findings.lpScore || 0) +
    Number(findings.proxyScore || 0) +
    Number(findings.taxScore || 0) +
    Number(findings.v4Score || 0);
  const dangers = [
    ...(findings.ownerDangers || []),
    ...(findings.proxyDangers || []),
    ...(findings.taxDangers || []),
    ...(findings.lpDangers || []),
    ...(findings.v4Dangers || []),
  ];
  const notes = [
    ...(findings.marketWarnings || []),
    ...(findings.holderWarnings || []),
    ...(findings.contractWarnings || []),
    ...(findings.ownerNotes || []),
    ...(findings.lpNotes || []),
    ...(findings.proxyNotes || []),
    ...(findings.taxNotes || []),
    ...(findings.v4Notes || []),
  ];

  if (!findings.hasCode) {
    dangers.push("No contract bytecode at this address");
    score += 100;
  }
  if (findings.reputation && findings.reputation !== "ok") {
    dangers.push(`Blockscout reputation: ${findings.reputation}`);
    score += 40;
  }
  if (findings.transferOk === false) {
    dangers.push(`Sell/transfer simulation failed: ${findings.transferError || "restricted"}`);
    score += 70;
  }
  if (findings.quoteOk === false) {
    notes.push(`V3 sell quote failed: ${findings.quoteError || "no route"}`);
    score += 20;
  }
  if (findings.routerSellOk === false) {
    dangers.push(`Router sell simulation failed: ${findings.routerSellError || "restricted"}`);
    score += 35;
  } else if (findings.routerSellOk === true) {
    notes.push("Router sell simulation passed");
  }
  if (findings.ownerActive && findings.ownerAddress) {
    dangers.push(`Owner still active: ${findings.ownerAddress}`);
  }
  if (findings.ownerRenounced === true && findings.proxyIsProxy) {
    dangers.push("Owner renounced but contract is upgradeable proxy — admin can still rug");
    score += 20;
  } else if (findings.ownerRenounced === true) {
    notes.unshift("Owner renounced");
  }
  if (findings.transferOk === true) {
    notes.push("Transfer simulation passed — NOT proof of safety (soft rugs often pass this)");
  }
  if (findings.quoteOk === true) {
    notes.push("V3 sell quote passed — market/rug risk can still exist");
  }

  let verdict = "SAFE";
  if (score >= 55 || findings.transferOk === false) {
    verdict = "DANGER";
  } else if (score >= 25) {
    verdict = "CAUTION";
  }
  if (dangers.length && verdict === "SAFE") verdict = "CAUTION";

  return {
    verdict,
    score: Math.max(0, score),
    dangers: [...new Set(dangers)],
    notes: [...new Set(notes)],
  };
}

function localizeAuditLine(text) {
  let line = String(text || "").trim();
  if (!line) return "";

  const replacements = [
    [/^Primary pool:\s*v3\s*(.+)$/i, "Pool chính: Uniswap v3 · $1"],
    [/^Primary pool:\s*v4\s*(.+)$/i, "Pool chính: Uniswap v4 · $1"],
    [/^Also has (.+)$/i, "Còn $1"],
    [/^Multiple thin pools — fragmented liquidity \/ chart bait risk$/i, "Nhiều pool mỏng — dễ bị chart bait"],
    [/^Heavy Dexscreener boosts \((.+)\) — paid hype common on scams$/i, "Boost Dexscreener nặng ($1) — hay là hype trả tiền"],
    [/^Volume >> liquidity \(wash \/ sniper churn risk\)$/i, "Volume >> thanh khoản — nghi wash/sniper"],
    [/^Bytecode has trading enable\/disable selectors$/i, "Contract có thể bật/tắt trading"],
    [/^Bytecode has blacklist-related selectors$/i, "Contract có blacklist"],
    [/^Bytecode has pause\/unpause selectors$/i, "Contract có pause"],
    [/^Bytecode has mint selector — supply can inflate$/i, "Contract có mint — supply có thể tăng"],
    [/^Bytecode has tax\/fee selectors$/i, "Contract có tax/fee"],
    [/^Bytecode has maxTx\/maxWallet selectors$/i, "Contract có maxTx/maxWallet"],
    [/^Bytecode has AccessControl\/operator roles — renounce may be incomplete$/i, "Còn role/operator — renounce có thể giả"],
    [/^Bytecode has proxy\/admin selectors$/i, "Contract có dấu hiệu proxy/admin"],
    [/^Ownable-style owner selector present$/i, "Còn selector owner (Ownable)"],
    [/^Owner renounced \(owner = 0x0 \/ dead\)$/i, "Owner đã renounce (0x0/dead)"],
    [/^Owner renounced$/i, "Owner đã renounce"],
    [/^Owner still active:\s*(.+)$/i, "Owner còn active: $1"],
    [/^No Ownable owner\(\) — non-ownable or custom admin$/i, "Không có owner() chuẩn — có thể admin riêng"],
    [/^Could not read owner\(\)$/i, "Không đọc được owner()"],
    [/^V2 LP burned ~(.+)% to dead$/i, "LP V2 đã burn ~$1%"],
    [/^V2 LP partially burned \(~(.+)%\)$/i, "LP V2 burn một phần (~$1%)"],
    [/^V2 LP mostly unburned \(~(.+)% burned\)$/i, "LP V2 gần như chưa burn (~$1% đã burn)"],
    [/^V3 LP burned ~(.+)% \(NFT to dead\)$/i, "LP V3 burn ~$1% (NFT → dead)"],
    [/^V3 LP partially burned ~(.+)%$/i, "LP V3 burn một phần ~$1%"],
    [/^V3 LP burned ~(.+)%$/i, "LP V3 burn ~$1%"],
    [/^V3 LP locked ~(.+)% in known locker\(s\)$/i, "LP V3 lock ~$1% ở locker"],
    [/^V3 LP partially locked ~(.+)%$/i, "LP V3 lock một phần ~$1%"],
    [/^No LP locker addresses configured \(set LP_LOCKER_ADDRESSES\)$/i, "Chưa cấu hình địa chỉ locker LP"],
    [/^LP not meaningfully burned\/locked — position owner can still pull liquidity$/i, "LP gần như chưa burn/lock — vẫn rút được"],
    [/^Only part of LP is burned\/locked$/i, "LP mới burn/lock một phần"],
    [/^Could not read v3 pool LP state:\s*(.+)$/i, "Không đọc được LP V3: $1"],
    [/^No v3 primary pool to check LP burn\/lock$/i, "Không có pool V3 chính để check burn/lock"],
    [/^Primary v3 pool has zero liquidity$/i, "Pool V3 chính hết thanh khoản"],
    [/^Creator\/team still controls ~(.+)% of active V3 liquidity \(can pull\)$/i, "Team còn giữ ~$1% LP V3 (rút được)"],
    [/^Creator\/team controls ~(.+)% of active V3 liquidity$/i, "Team còn giữ ~$1% LP V3"],
    [/^Creator\/team wallet holds V3 LP NFT liquidity \((.+)\)$/i, "Ví creator/team còn LP NFT ($1)"],
    [/^V3 LP NFT still approved\/operator set \((.+)\) — burn may be bypassable$/i, "NFT LP vẫn còn approve/operator ($1) — burn có thể giả"],
    [/^Tracked LP positions use narrow tick ranges — depth can vanish if price leaves range$/i, "LP range hẹp — giá lệch range là hết depth"],
    [/^Most burned\/locked LP is out of range — visible LP may overstate exit depth$/i, "LP burn/lock đa số out-of-range — depth ảo"],
    [/^Round-trip tax check failed:\s*(.+)$/i, "Check thuế round-trip lỗi: $1"],
    [/^Round-trip loss ~(.+)% \(pool fee (.+)\)$/i, "Lỗ round-trip ~$1% (phí pool $2)"],
    [/^Round-trip loss above fee floor — possible tax or thin depth$/i, "Lỗ round-trip cao hơn phí — nghi có tax hoặc pool mỏng"],
    [/^Extreme round-trip loss (.+)% — likely sell tax\/honeypot$/i, "Lỗ round-trip cực cao $1% — nghi tax/honeypot"],
    [/^High round-trip loss (.+)% beyond pool fees — likely tax$/i, "Lỗ round-trip cao $1% — nghi có tax"],
    [/^Round-trip buy quote returned 0$/i, "Quote mua round-trip ra 0"],
    [/^\d+ secondary v4 pool\(s\) — ignore for sizing; hooks risk on those pools$/i, "Có pool V4 phụ — bỏ qua khi tính size; rủi ro hooks"],
    [/^Primary pool is Uniswap v4 — custom hooks can tax\/block\/steal swaps$/i, "Pool chính là V4 — hooks có thể tax/chặn/rug swap"],
    [/^Prefer trading the deepest v3 WETH pool when available$/i, "Nên trade pool V3/WETH sâu nhất nếu có"],
    [/^v4 pool id \(not a contract\) — hooks address not readable from Dexscreener$/i, "Pool V4 (pool id) — không đọc được hooks từ Dexscreener"],
    [/^Upgradeable proxy detected(.*)$/i, "Phát hiện proxy nâng cấp được$1"],
    [/^Proxy admin still active:\s*(.+)$/i, "Proxy admin còn active: $1"],
    [/^Owner renounced but contract is upgradeable proxy — admin can still rug$/i, "Đã renounce nhưng còn proxy — admin vẫn rug được"],
    [/^Sell\/transfer simulation failed:\s*(.+)$/i, "Sim transfer/sell fail: $1"],
    [/^Router sell simulation failed:\s*(.+)$/i, "Sim bán qua router fail: $1"],
    [/^Router sell simulation passed$/i, "Sim bán qua router OK"],
    [/^Router sell sim skipped \(needs allowance \/ non-restriction revert\)$/i, "Bỏ qua sim router (thiếu allowance)"],
    [/^V3 sell quote failed:\s*(.+)$/i, "Quote bán V3 fail: $1"],
    [/^Transfer simulation passed — NOT proof of safety \(soft rugs often pass this\)$/i, "Transfer OK — chưa chứng minh an toàn"],
    [/^V3 sell quote passed — market\/rug risk can still exist$/i, "Quote bán OK — vẫn có thể rug mềm"],
    [/^No withdrawable liquidity on Dexscreener$/i, "Không có thanh khoản trên Dexscreener"],
    [/^Dangerously thin liquidity \((.+)\)$/i, "Thanh khoản cực mỏng ($1)"],
    [/^Very thin liquidity \((.+)\) — hard to exit$/i, "Thanh khoản rất mỏng ($1) — khó thoát"],
    [/^Low liquidity \((.+)\)$/i, "Thanh khoản thấp ($1)"],
    [/^LP\/FDV only (.+)% — classic soft-rug profile$/i, "LP/FDV chỉ $1% — profile soft-rug"],
    [/^Thin LP vs FDV \((.+)%\)$/i, "LP mỏng so với FDV ($1%)"],
    [/^LP covers just (.+)% of FDV$/i, "LP chỉ cover $1% FDV"],
    [/^24h buys with zero sells \(classic honeypot pattern\)$/i, "24h chỉ mua không bán — pattern honeypot"],
    [/^Extreme buy\/sell skew \((.+) in 24h\)$/i, "Lệch mua/bán mạnh ($1 trong 24h)"],
    [/^Brand-new pair \((.+)h old\)$/i, "Pair mới tạo ($1h)"],
    [/^Very new pair \((.+)h old\)$/i, "Pair rất mới ($1h)"],
    [/^No project website on Dexscreener$/i, "Chưa có website trên Dexscreener"],
    [/^Top wallet holds (.+)% supply — dump risk$/i, "Ví top giữ $1% supply — rủi ro dump"],
    [/^Top wallet holds (.+)% supply$/i, "Ví top giữ $1% supply"],
    [/^Top 10 wallets hold (.+)% supply$/i, "Top 10 ví giữ $1% supply"],
    [/^No contract bytecode at this address$/i, "Không có bytecode tại địa chỉ này"],
    [/^Blockscout reputation:\s*(.+)$/i, "Reputation Blockscout: $1"],
    [/^No EOA holder found to simulate transfer$/i, "Không tìm thấy ví EOA để sim transfer"],
    [/^Trading disabled according to contract view$/i, "Trading đang tắt theo view contract"],
    [/^Token paused\(\) == true$/i, "Token đang paused"],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(line)) {
      line = line.replace(pattern, replacement);
      break;
    }
  }

  // Trim noisy technical revert tails for Telegram readability.
  line = line.replace(/\s*\(action="?call"?[^)]*\)\s*$/i, "");
  line = line.replace(/\s*\(could not decode.*?\)\s*$/i, "");
  if (line.length > 140) line = `${line.slice(0, 137)}...`;
  return line;
}

function formatHoneypotReport(report) {
  if (!report) return "Kiểm tra bảo mật: không có dữ liệu";

  const verdictVi =
    report.verdict === "SAFE" ? "AN TOÀN" : report.verdict === "CAUTION" ? "CẨN TRỌNG" : "NGUY HIỂM";
  const icon = report.verdict === "SAFE" ? "✅" : report.verdict === "CAUTION" ? "⚠️" : "🚨";

  const skipNote = (line) => {
    const lower = String(line || "").toLowerCase();
    if (lower.includes("ownable-style") && report.ownerRenounced) return true;
    if (lower.includes("transfer simulation passed")) return true;
    if (lower.includes("v3 sell quote passed")) return true;
    if (lower.includes("router sell simulation passed")) return true;
    if (lower.includes("no lp locker addresses configured")) return true;
    return false;
  };

  const dangers = [...new Set((report.dangers || []).map(localizeAuditLine).filter(Boolean))];
  const notes = [...new Set((report.notes || []).filter((n) => !skipNote(n)).map(localizeAuditLine).filter(Boolean))]
    .filter((note) => !dangers.includes(note))
    .slice(0, 5);

  const lines = [`<b>Bảo mật</b>: ${icon} <b>${verdictVi}</b> (${report.score})`];

  for (const danger of dangers.slice(0, 4)) {
    lines.push(`🚨 ${escapeHtml(danger)}`);
  }
  for (const note of notes) {
    lines.push(`• ${escapeHtml(note)}`);
  }

  if (report.verdict === "DANGER") {
    lines.push("<b>Đừng mua — token rủi ro cao / nghi scam. Theo dõi vẫn bật.</b>");
  } else if (report.verdict === "CAUTION") {
    lines.push("<b>Chưa nên ape — kiểm tra LP burn/lock, holder và chart trước.</b>");
  }

  return lines.join("\n");
}

async function checkTokenHoneypot(tokenAddress, pair = null, allPairs = null) {
  const { ethers } = require("ethers");
  const token = normalizeAddress(tokenAddress);
  const pairs = Array.isArray(allPairs) && allPairs.length ? allPairs : pair ? [pair] : [];
  const tracked = pair ? trackedPairFromDexPair(pair, token) : null;
  const pairAddress = tracked?.pairAddress || normalizeAddress(pair?.pairAddress);
  const quoteToken = tracked?.quoteTokenAddress || config.quoteTokenAddress;
  const feeCandidates = [
    Number(pair?.fee),
    config.uniswapV3Fee,
    10000,
    3000,
    500,
    100,
  ].filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index);
  const market = analyzePairsMarketRisk(pairs);

  const findings = {
    hasCode: false,
    reputation: "",
    transferOk: null,
    transferError: "",
    quoteOk: null,
    quoteError: "",
    routerSellOk: null,
    routerSellError: "",
    ownerActive: false,
    ownerRenounced: null,
    ownerAddress: "",
    ownerScore: 0,
    ownerNotes: [],
    ownerDangers: [],
    lpScore: 0,
    lpNotes: [],
    lpDangers: [],
    proxyScore: 0,
    proxyNotes: [],
    proxyDangers: [],
    proxyIsProxy: false,
    taxScore: 0,
    taxNotes: [],
    taxDangers: [],
    v4Score: 0,
    v4Notes: [],
    v4Dangers: [],
    marketScore: market.score,
    marketWarnings: market.warnings,
    holderScore: 0,
    holderWarnings: [],
    contractScore: 0,
    contractWarnings: [],
  };

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl || "https://rpc.mainnet.chain.robinhood.com");
    const code = await provider.getCode(token);
    findings.hasCode = Boolean(code && code !== "0x");
    const bytecodeRisk = analyzeContractBytecode(code);
    findings.contractScore = bytecodeRisk.score;
    findings.contractWarnings = bytecodeRisk.warnings;

    let totalSupplyRaw = "0";
    let creatorAddress = "";
    let addressInfo = null;
    try {
      const [tokenInfo, addrInfo] = await Promise.all([
        fetchBlockscoutToken(token),
        fetchBlockscoutAddress(token).catch(() => null),
      ]);
      addressInfo = addrInfo;
      findings.reputation = String(tokenInfo?.reputation || "").toLowerCase();
      totalSupplyRaw = String(tokenInfo?.total_supply || "0");
      creatorAddress = normalizeAddress(addrInfo?.creator_address_hash || "");
    } catch (error) {
      findings.marketWarnings.push(`Blockscout token info unavailable: ${error.message}`);
    }

    try {
      const tokenContract = new ethers.Contract(
        token,
        ["function owner() view returns (address)", "function getOwner() view returns (address)"],
        provider,
      );
      let owner = "";
      let ownerReadable = false;
      try {
        owner = normalizeAddress(await tokenContract.owner());
        ownerReadable = true;
      } catch {
        try {
          owner = normalizeAddress(await tokenContract.getOwner());
          ownerReadable = true;
        } catch {
          owner = "";
        }
      }
      const ownerStatus = classifyOwnerStatus({
        ownerAddress: owner,
        ownerReadable,
        hasOwnerSelector: bytecodeRisk.hasOwnerSelector,
      });
      findings.ownerActive = ownerStatus.ownerActive;
      findings.ownerRenounced = ownerStatus.ownerRenounced;
      findings.ownerAddress = ownerStatus.ownerAddress;
      findings.ownerScore = ownerStatus.score;
      findings.ownerNotes = ownerStatus.notes;
      findings.ownerDangers = ownerStatus.dangers;
    } catch {
      // ignore
    }

    try {
      const proxyRisk = await analyzeProxyRisk(provider, token, addressInfo);
      findings.proxyScore = proxyRisk.score;
      findings.proxyNotes = proxyRisk.notes;
      findings.proxyDangers = proxyRisk.dangers;
      findings.proxyIsProxy = Boolean(proxyRisk.isProxy);
    } catch (error) {
      findings.proxyNotes.push(`Proxy check failed: ${error.message}`);
    }

    const v4Risk = analyzeV4HookRisk(market.primaryPair || choosePrimaryDexPair(pairs) || pair, pairs);
    findings.v4Score = v4Risk.score;
    findings.v4Notes = v4Risk.notes;
    findings.v4Dangers = v4Risk.dangers;

    try {
      const viewRisk = await readTokenRiskViews(provider, token);
      findings.taxScore += Number(viewRisk.score || 0);
      findings.taxNotes.push(...(viewRisk.notes || []));
      findings.taxDangers.push(...(viewRisk.dangers || []));
    } catch (error) {
      findings.taxNotes.push(`Tax/maxTx view check failed: ${error.message}`);
    }

    try {
      const extraHolders = [creatorAddress, findings.ownerAddress].filter(Boolean);
      const [v2Lp, v3Lp] = await Promise.all([
        analyzeV2LpBurn(provider, token),
        analyzeV3LpBurnAndLock(
          provider,
          market.primaryPair || choosePrimaryDexPair(pairs) || pair,
          extraHolders,
        ),
      ]);
      findings.lpScore = Number(v2Lp.score || 0) + Number(v3Lp.score || 0);
      findings.lpNotes = [...(v2Lp.notes || []), ...(v3Lp.notes || [])];
      findings.lpDangers = [...(v3Lp.dangers || [])];
      findings.lpV2BurnedPct = v2Lp.burnedPct;
      findings.lpV3BurnedPct = v3Lp.burnedPct;
      findings.lpV3LockedPct = v3Lp.lockedPct;
    } catch (error) {
      findings.lpNotes.push(`LP burn/lock check failed: ${error.message}`);
      findings.lpScore += 5;
    }

    let probeAmount = 0n;
    let probeAddress = "";
    let holders = [];
    try {
      holders = await fetchTokenHolders(token);
      const excluded = [
        pairAddress,
        ...pairs.map((item) => normalizeAddress(item.pairAddress)),
        token,
        quoteToken,
        config.swapRouterAddress,
        config.positionManagerAddress,
      ];
      const concentration = analyzeHolderConcentration(holders, totalSupplyRaw, excluded);
      findings.holderScore = concentration.score;
      findings.holderWarnings = concentration.warnings;

      const probe = pickProbeHolder(holders, excluded);
      if (probe) {
        probeAmount = probe.raw / 1000n || 1n;
        probeAddress = probe.address;
        const erc20 = new ethers.Contract(
          token,
          ["function transfer(address to,uint256 amount) returns (bool)"],
          provider,
        );
        await erc20.transfer.staticCall("0x1111111111111111111111111111111111111111", probeAmount, {
          from: probe.address,
        });
        findings.transferOk = true;
      } else {
        findings.transferOk = null;
        findings.marketWarnings.push("No EOA holder found to simulate transfer");
      }
    } catch (error) {
      findings.transferOk = false;
      findings.transferError = classifyRestrictionError(error);
    }

    let usedFee = feeCandidates[0] || config.uniswapV3Fee;
    if (probeAmount > 0n && quoteToken) {
      let quoted = false;
      let lastQuoteError = "";
      for (const fee of feeCandidates) {
        try {
          const quoter = new ethers.Contract(
            config.quoterAddress,
            [
              "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
            ],
            provider,
          );
          const result = await quoter.quoteExactInputSingle.staticCall({
            tokenIn: token,
            tokenOut: quoteToken,
            amountIn: probeAmount,
            fee,
            sqrtPriceLimitX96: 0,
          });
          findings.quoteOk = BigInt(result.amountOut ?? result[0]) > 0n;
          if (!findings.quoteOk) {
            lastQuoteError = "zero amount out";
            continue;
          }
          usedFee = fee;
          quoted = true;
          break;
        } catch (error) {
          lastQuoteError = classifyRestrictionError(error);
        }
      }
      if (!quoted) {
        findings.quoteOk = false;
        findings.quoteError = lastQuoteError || "no route";
      }
    }

    if (quoteToken && usedFee) {
      try {
        const tax = await analyzeRoundTripTax(provider, token, quoteToken, usedFee);
        findings.taxScore += Number(tax.score || 0);
        findings.taxNotes.push(...(tax.notes || []));
        findings.taxDangers.push(...(tax.dangers || []));
        findings.roundTripLossPct = tax.lossPct;
      } catch (error) {
        findings.taxNotes.push(`Round-trip tax check failed: ${error.message}`);
      }
    }

    // Router sell path: only mark failure when revert is clearly restriction (not allowance).
    if (probeAmount > 0n && probeAddress && quoteToken && findings.quoteOk) {
      try {
        const router = new ethers.Contract(
          config.swapRouterAddress,
          [
            "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
          ],
          provider,
        );
        await router.exactInputSingle.staticCall(
          {
            tokenIn: token,
            tokenOut: quoteToken,
            fee: usedFee,
            recipient: probeAddress,
            amountIn: probeAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
          },
          { from: probeAddress },
        );
        findings.routerSellOk = true;
      } catch (error) {
        const classified = classifyRestrictionError(error);
        const raw = String(error?.shortMessage || error?.message || "").toLowerCase();
        if (
          classified === "transfer restricted" ||
          raw.includes("blacklist") ||
          raw.includes("trading") ||
          raw.includes("paused") ||
          raw.includes("honeypot")
        ) {
          findings.routerSellOk = false;
          findings.routerSellError = classified;
        } else {
          findings.routerSellOk = null;
          findings.taxNotes.push("Router sell sim skipped (needs allowance / non-restriction revert)");
        }
      }
    }
  } catch (error) {
    findings.marketWarnings.push(`RPC security check failed: ${error.message}`);
  }

  const scored = scoreHoneypotFindings(findings);
  return {
    token,
    pairAddress,
    ...findings,
    ...scored,
    market,
    quoteOk: findings.quoteOk,
  };
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
  const totalUsd = items.reduce((sum, item) => sum + (Number(item.valueUsd) || 0), 0);

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
      "<i>Tools → Update Price để thử lại.</i>",
    ].join("\n");
  }

  const items = Array.isArray(portfolio.items) ? portfolio.items : [];
  const bagItems = Array.isArray(portfolio.bagItems) ? portfolio.bagItems : [];
  const displayItems = bagItems.length ? bagItems : items;
  const totalUsd = displayItems.reduce((sum, item) => sum + (Number(item.valueUsd) || 0), 0);
  const lines = [
    `<b>📦 Portfolio</b>`,
    `Total: <b>${escapeHtml(formatUsd(totalUsd))}</b> · Bags: <b>${displayItems.length}</b> · Hidden: <b>${Number(portfolio.skipped) || 0}</b>`,
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

  lines.push("<i>Bấm token bên dưới để Sell bag · Tools → Update Price để quét lại.</i>");
  return lines.join("\n");
}

function portfolioPanelText(portfolio) {
  return portfolioSectionText(portfolio);
}

function portfolioKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Update Price", callback_data: "portfolio:refresh" }],
      [
        { text: "Main Menu", callback_data: "menu" },
        { text: "Wallets", callback_data: "panel:wallets" },
      ],
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
  const buyButtons = config.buyAmountsQuote.map((amount) => ({
    text: `Buy ${amount} ${config.quoteSymbol}`,
    callback_data: `qtrade:BUY:${amount}`,
  }));
  const sellButtons = [...(config.sellPercents || [25, 50, 70])].map((percent) => ({
    text: `Sell ${percent}%`,
    callback_data: `qtrade:SELL:${percent}%`,
  }));

  return [
    ...chunkButtons(buyButtons, 2),
    ...chunkButtons(sellButtons, 2),
    [{ text: `Sell All ${config.baseSymbol}`, callback_data: "qtrade:SELL:ALL" }],
  ];
}

function sniperTradeKeyboard() {
  return {
    inline_keyboard: [
      ...tradeActionRows(),
      [
        { text: "Main Menu", callback_data: "menu" },
        { text: "Chart", url: config.dexscreenPairUrl },
      ],
    ],
  };
}

function confirmKeyboard(side, amount) {
  const inputSymbol = side === "BUY" ? config.quoteSymbol : config.baseSymbol;
  const sellPct = side === "SELL" ? parseSellPercent(amount) : null;
  const amountLabel =
    sellPct !== null
      ? sellPct >= 100
        ? `ALL ${inputSymbol}`
        : `${sellPct}% ${inputSymbol}`
      : `${amount} ${inputSymbol}`;
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

function toolsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Update Price", callback_data: "portfolio:refresh" },
        { text: "Profile", callback_data: "panel:profile" },
      ],
      [{ text: "Wallets", callback_data: "panel:wallets" }],
      [{ text: "Main Menu", callback_data: "menu" }],
    ],
  };
}

function toolsPanelText() {
  return [
    `<b>Tools</b>`,
    `Đang theo dõi: <b>${escapeHtml(config.baseSymbol)}</b>`,
    "Update Price / ví / profile.",
  ].join("\n");
}

function formatBagButtonLabel(item) {
  const sym = String(item?.symbol || "TOKEN").slice(0, 10);
  const value = Number(item?.valueUsd);
  if (!Number.isFinite(value)) return sym;
  if (value >= 100) return `${sym} $${Math.round(value)}`;
  if (value >= 1) return `${sym} $${value.toFixed(2)}`;
  return `${sym} $${Number(value.toPrecision(3))}`;
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
  const sellButtons = [...(config.sellPercents || [25, 50, 70])].map((percent) => ({
    text: `Sell ${percent}%`,
    callback_data: `bagsell:${token}:${percent}%`,
  }));
  return {
    inline_keyboard: [
      ...chunkButtons(sellButtons, 2),
      [{ text: `Sell All ${symbol}`, callback_data: `bagsell:${token}:ALL` }],
      [{ text: `Track ${symbol}`, callback_data: `bagtrack:${token}` }],
      [{ text: "Main Menu", callback_data: "menu" }],
    ],
  };
}

function bagConfirmKeyboard(tokenAddress, amount) {
  const token = normalizeAddress(tokenAddress);
  return {
    inline_keyboard: [
      [{ text: `Confirm SELL ${amount}`, callback_data: `bagconfirm:${token}:${amount}` }],
      [
        { text: "Cancel", callback_data: `bag:${token}` },
        { text: "Main Menu", callback_data: "menu" },
      ],
    ],
  };
}

function mainMenuKeyboard(portfolio = null) {
  return {
    inline_keyboard: [
      ...tradeActionRows(),
      [
        { text: "Chart", url: config.dexscreenPairUrl },
        { text: "Tools", callback_data: "panel:tools" },
      ],
      ...bagButtonRows(portfolio),
    ],
  };
}

function tradePanelText(title = `${config.baseSymbol} Sniper`) {
  return [
    `<b>${escapeHtml(title)}</b>`,
    `Đang theo dõi: <b>${escapeHtml(config.baseSymbol)}</b>`,
    `Buy: số ${escapeHtml(config.quoteSymbol)}. Sell: <b>25% / 50% / 70% / All</b> bag.`,
    `One-tap: <b>${config.oneTapTrade ? "ON" : "OFF"}</b> | Trading: <b>${config.tradeEnabled ? "ON" : "OFF"}</b>`,
    `Slippage: <b>${config.slippageBps / 100}%</b>`,
  ].join("\n");
}

function linkLine() {
  return "";
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

async function fetchEthPriceUsd() {
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
    if (stable && Number(stable.priceUsd) > 0) return Number(stable.priceUsd);

    // Fallback: any liquid pair involving WETH — derive ETH from token USD / native.
    for (const pair of list.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))) {
      const priceUsd = Number(pair.priceUsd);
      const priceNative = Number(pair.priceNative);
      const base = normalizeAddress(pair.baseToken?.address);
      const quote = normalizeAddress(pair.quoteToken?.address);
      if (base === weth && priceUsd > 0) return priceUsd;
      if (quote === weth && priceUsd > 0 && priceNative > 0) return priceUsd / priceNative;
    }
  } catch {
    // ignore
  }
  return Number.NaN;
}

async function mainPanelText(options = {}) {
  const ethUsd = await fetchEthPriceUsd();
  const priceText = Number.isFinite(ethUsd) ? `$${ethUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "n/a";
  const wallet = await getDisplayWallet();
  const balance = await getNativeBalance(wallet);
  const walletText = wallet ? compactAddress(wallet) : "Not configured";
  const balanceText = balance ? `${Number(balance).toPrecision(6)} ETH` : "n/a";
  const portfolio =
    options.portfolio !== undefined
      ? options.portfolio
      : options.state
        ? await resolveMenuPortfolio(options.state, { forceRefresh: Boolean(options.refreshPortfolio) })
        : null;

  return [
    `🚀 <b>${escapeHtml(config.botTitle)}</b>`,
    "",
    `💰 <b>ETH Price:</b> <code>${escapeHtml(priceText)}</code>`,
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

async function sendTradeMenu(chatId = config.telegramChatId) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text: tradePanelText(),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: sniperTradeKeyboard(),
  });
}

async function sendMainMenu(chatId = config.telegramChatId, state = loadState()) {
  let portfolio = state.portfolioSnapshot || null;
  try {
    portfolio = await withTimeout(
      resolveMenuPortfolio(state, { forceRefresh: false }),
      8_000,
      "Menu portfolio",
    );
  } catch (error) {
    console.warn(`sendMainMenu portfolio skipped: ${error.message}`);
    if (!portfolio) {
      portfolio = {
        wallet: getPortfolioWallet(state),
        items: [],
        skipped: 0,
        totalUsd: 0,
        error: error.message,
      };
    }
  }

  let text;
  try {
    text = await withTimeout(mainPanelText({ state, portfolio }), 10_000, "Main panel");
  } catch (error) {
    text = staticMainPanelText();
    text += `\n\n<i>Menu partial: ${escapeHtml(error.message)}</i>`;
  }

  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(portfolio || state.portfolioSnapshot),
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

  const text = await mainPanelText({ state, refreshPortfolio: forceRefresh });
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
    reply_markup: afterTrackKeyboard(),
  });
}

async function runHoneypotOnDemand(state, chatId, editCallback = null) {
  const token = normalizeAddress(state.trackedPair?.baseTokenAddress || config.baseTokenAddress);
  if (!isEvmAddress(token)) {
    const text = `<b>Honeypot</b>\nPaste contract token trước để track, rồi bấm Honeypot.`;
    if (editCallback) await editTradeMessage(editCallback, text, mainMenuKeyboard());
    else {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: "true",
        reply_markup: mainMenuKeyboard(),
      });
    }
    return;
  }

  const pending = `Đang audit honeypot cho <b>${escapeHtml(config.baseSymbol)}</b>...\n<code>${escapeHtml(token)}</code>`;
  if (editCallback) await editTradeMessage(editCallback, pending, afterTrackKeyboard());
  else {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: pending,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
  }

  let honeypotReport = null;
  try {
    const pairs = await fetchTokenPairs(token);
    const pair = chooseBestPairForToken(pairs, token);
    honeypotReport = await withTimeout(checkTokenHoneypot(token, pair, pairs), 45000, "Security audit");
  } catch (error) {
    honeypotReport = {
      verdict: "CAUTION",
      score: 25,
      dangers: [],
      notes: [`Audit lỗi: ${error.message}`],
    };
  }

  const text = [
    `<b>Honeypot · ${escapeHtml(config.baseSymbol)}</b>`,
    `<code>${escapeHtml(token)}</code>`,
    "",
    formatHoneypotReport(honeypotReport),
  ].join("\n");

  if (editCallback) await editTradeMessage(editCallback, text, afterTrackKeyboard());
  else {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: afterTrackKeyboard(),
    });
  }
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

const Q96 = 2n ** 96n;

function mulDiv(a, b, denominator) {
  return (BigInt(a) * BigInt(b)) / BigInt(denominator);
}

function sortUniswapTokens(tokenA, tokenB) {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

function alignTick(tick, tickSpacing) {
  const spacing = Number(tickSpacing);
  let compressed = Math.trunc(tick / spacing);
  if (tick < 0 && tick % spacing !== 0) compressed -= 1;
  return compressed * spacing;
}

/** Uniswap v3 TickMath.getSqrtRatioAtTick (JS port). */
function getSqrtRatioAtTick(tick) {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) {
    throw new Error(`Tick out of bounds: ${tick}`);
  }

  const absTick = tick < 0 ? -tick : tick;
  let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a911cd461f6a2f1f8bn) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7440d0c1917764be19n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a4b9e3039c5db1a5d043n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
  let sqrtA = BigInt(sqrtRatioAX96);
  let sqrtB = BigInt(sqrtRatioBX96);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const intermediate = mulDiv(sqrtA, sqrtB, Q96);
  return mulDiv(amount0, intermediate, sqrtB - sqrtA);
}

function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
  let sqrtA = BigInt(sqrtRatioAX96);
  let sqrtB = BigInt(sqrtRatioBX96);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return mulDiv(amount1, Q96, sqrtB - sqrtA);
}

function getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  let sqrtA = BigInt(sqrtRatioAX96);
  let sqrtB = BigInt(sqrtRatioBX96);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return ((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB / sqrtA;
}

function getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  let sqrtA = BigInt(sqrtRatioAX96);
  let sqrtB = BigInt(sqrtRatioBX96);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return mulDiv(liquidity, sqrtB - sqrtA, Q96);
}

function amountsForExactEth({ sqrtPriceX96, tickLower, tickUpper, ethAmount, wethIsToken0 }) {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  const sqrtCurrent = BigInt(sqrtPriceX96);
  const eth = BigInt(ethAmount);

  if (wethIsToken0) {
    if (sqrtCurrent <= sqrtLower) {
      const liquidity = getLiquidityForAmount0(sqrtLower, sqrtUpper, eth);
      return {
        amount0: getAmount0ForLiquidity(sqrtLower, sqrtUpper, liquidity),
        amount1: 0n,
        ethRaw: eth,
        tokenRaw: 0n,
        liquidity,
        positionSide: "below-range",
      };
    }
    if (sqrtCurrent >= sqrtUpper) {
      return {
        amount0: 0n,
        amount1: 0n,
        ethRaw: 0n,
        tokenRaw: 0n,
        liquidity: 0n,
        positionSide: "above-range",
        error: "Giá đang trên range LP. Chọn range rộng hơn hoặc đợi giá quay lại.",
      };
    }
    const liquidity = getLiquidityForAmount0(sqrtCurrent, sqrtUpper, eth);
    const amount1 = getAmount1ForLiquidity(sqrtLower, sqrtCurrent, liquidity);
    return {
      amount0: getAmount0ForLiquidity(sqrtCurrent, sqrtUpper, liquidity),
      amount1,
      ethRaw: eth,
      tokenRaw: amount1,
      liquidity,
      positionSide: "in-range",
    };
  }

  // ETH is token1
  if (sqrtCurrent >= sqrtUpper) {
    const liquidity = getLiquidityForAmount1(sqrtLower, sqrtUpper, eth);
    return {
      amount0: 0n,
      amount1: getAmount1ForLiquidity(sqrtLower, sqrtUpper, liquidity),
      ethRaw: eth,
      tokenRaw: 0n,
      liquidity,
      positionSide: "above-range",
    };
  }
  if (sqrtCurrent <= sqrtLower) {
    return {
      amount0: 0n,
      amount1: 0n,
      ethRaw: 0n,
      tokenRaw: 0n,
      liquidity: 0n,
      positionSide: "below-range",
      error: "Giá đang dưới range LP. Chọn range rộng hơn hoặc đợi giá quay lại.",
    };
  }
  const liquidity = getLiquidityForAmount1(sqrtLower, sqrtCurrent, eth);
  const amount0 = getAmount0ForLiquidity(sqrtCurrent, sqrtUpper, liquidity);
  return {
    amount0,
    amount1: getAmount1ForLiquidity(sqrtLower, sqrtCurrent, liquidity),
    ethRaw: eth,
    tokenRaw: amount0,
    liquidity,
    positionSide: "in-range",
  };
}

function feeToTickSpacing(fee) {
  const map = { 100: 1, 500: 10, 3000: 60, 10000: 200 };
  return map[Number(fee)] || Number(config.lpTickSpacing) || 60;
}

function ticksAroundPrice(currentTick, percent, tickSpacing) {
  if (String(percent) === "full") {
    return {
      tickLower: alignTick(-887220, tickSpacing),
      tickUpper: alignTick(887220, tickSpacing),
      rangeLabel: "Full range",
    };
  }

  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct <= 0) throw new Error("Invalid range percent.");
  const delta = Math.max(tickSpacing, Math.round(Math.log(1 + pct / 100) / Math.log(1.0001)));
  let tickLower = alignTick(currentTick - delta, tickSpacing);
  let tickUpper = alignTick(currentTick + delta, tickSpacing);
  if (tickLower >= tickUpper) {
    tickLower = alignTick(currentTick - tickSpacing, tickSpacing);
    tickUpper = alignTick(currentTick + tickSpacing * 2, tickSpacing);
  }
  return { tickLower, tickUpper, rangeLabel: `±${pct}%` };
}

function lpPreset(state = {}) {
  const saved = state.lp || {};
  const tokenAddress = normalizeAddress(saved.tokenAddress || "");
  const fee = Number(saved.fee || config.lpFee || 10000);
  const tickSpacing = Number(saved.tickSpacing || feeToTickSpacing(fee));
  const hasRange = saved.tickLower != null && saved.tickUpper != null;
  const tickLower = hasRange ? alignTick(Number(saved.tickLower), tickSpacing) : null;
  const tickUpper = hasRange ? alignTick(Number(saved.tickUpper), tickSpacing) : null;
  const [token0, token1] = tokenAddress
    ? sortUniswapTokens(config.lpWethAddress, tokenAddress)
    : ["", ""];
  return {
    token0,
    token1,
    fee,
    tickSpacing,
    tickLower,
    tickUpper,
    rangeLabel: saved.rangeLabel || "",
    wethIsToken0: token0 === normalizeAddress(config.lpWethAddress),
    tokenAddress,
    poolAddress: normalizeAddress(saved.poolAddress || ""),
    symbol: saved.symbol || "TOKEN",
    decimals: Number(saved.decimals || 18),
  };
}

function lpRangeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "±5%", callback_data: "lp:range:5" },
        { text: "±15%", callback_data: "lp:range:15" },
        { text: "±50%", callback_data: "lp:range:50" },
      ],
      [{ text: "Full range", callback_data: "lp:range:full" }],
      [
        { text: "Refresh", callback_data: "panel:lp" },
        { text: "Main Menu", callback_data: "menu" },
      ],
    ],
  };
}

function lpAmountKeyboard() {
  const amountButtons = config.lpEthAmounts.map((amount) => ({
    text: `${amount} ETH`,
    callback_data: `lp:preview:${amount}`,
  }));
  return {
    inline_keyboard: [
      ...chunkButtons(amountButtons, 3),
      [
        { text: "Đổi range", callback_data: "lp:ranges" },
        { text: "Main Menu", callback_data: "menu" },
      ],
    ],
  };
}

function lpConfirmKeyboard(ethAmount) {
  return {
    inline_keyboard: [
      [{ text: `Confirm add ${ethAmount} ETH LP`, callback_data: `lp:confirm:${ethAmount}` }],
      [
        { text: "Back", callback_data: "lp:amounts" },
        { text: "Main Menu", callback_data: "menu" },
      ],
    ],
  };
}

function afterTrackKeyboard() {
  return {
    inline_keyboard: [
      ...tradeActionRows(),
      [
        { text: "Tools", callback_data: "panel:tools" },
        { text: "Main Menu", callback_data: "menu" },
      ],
    ],
  };
}

async function discoverV3WethPool(tokenAddress) {
  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(config.rpcUrl || "https://rpc.mainnet.chain.robinhood.com");
  const token = normalizeAddress(tokenAddress);
  const weth = normalizeAddress(config.lpWethAddress);
  if (token === weth) throw new Error("Không add LP cho WETH với chính nó.");

  const [token0, token1] = sortUniswapTokens(token, weth);
  const factory = new ethers.Contract(
    config.v3FactoryAddress,
    ["function getPool(address,address,uint24) view returns (address)"],
    provider,
  );

  let best = null;
  for (const fee of [10000, 3000, 500, 100]) {
    const poolAddress = await factory.getPool(token0, token1, fee);
    if (!poolAddress || poolAddress === ethers.ZeroAddress) continue;
    const pool = new ethers.Contract(
      poolAddress,
      [
        "function liquidity() view returns (uint128)",
        "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
      ],
      provider,
    );
    const [liquidity, slot0] = await Promise.all([pool.liquidity(), pool.slot0()]);
    if (!best || BigInt(liquidity) > best.liquidity) {
      best = {
        provider,
        poolAddress: normalizeAddress(poolAddress),
        fee,
        tickSpacing: feeToTickSpacing(fee),
        token0,
        token1,
        wethIsToken0: token0 === weth,
        liquidity: BigInt(liquidity),
        sqrtPriceX96: BigInt(slot0.sqrtPriceX96),
        tick: Number(slot0.tick),
      };
    }
  }

  if (!best) throw new Error("Không tìm thấy Uniswap v3 pool TOKEN/WETH trên Robinhood.");

  const erc20 = new ethers.Contract(
    token,
    ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
    provider,
  );
  const [symbol, decimals] = await Promise.all([
    erc20.symbol().catch(() => "TOKEN"),
    erc20.decimals().catch(() => 18),
  ]);

  return {
    ...best,
    tokenAddress: token,
    symbol: String(symbol || "TOKEN"),
    decimals: Number(decimals || 18),
  };
}

async function prepareLpFromToken(tokenAddress, state, rangePercent = null) {
  const discovered = await discoverV3WethPool(tokenAddress);
  const sameToken = state.lp?.tokenAddress === discovered.tokenAddress;
  let tickLower = sameToken ? state.lp.tickLower : null;
  let tickUpper = sameToken ? state.lp.tickUpper : null;
  let rangeLabel = sameToken ? state.lp.rangeLabel : null;

  if (rangePercent != null) {
    const ranged = ticksAroundPrice(discovered.tick, rangePercent, discovered.tickSpacing);
    tickLower = ranged.tickLower;
    tickUpper = ranged.tickUpper;
    rangeLabel = ranged.rangeLabel;
  }

  state.lp = {
    tokenAddress: discovered.tokenAddress,
    symbol: discovered.symbol,
    decimals: discovered.decimals,
    fee: discovered.fee,
    tickSpacing: discovered.tickSpacing,
    poolAddress: discovered.poolAddress,
    token0: discovered.token0,
    token1: discovered.token1,
    wethIsToken0: discovered.wethIsToken0,
    tickLower,
    tickUpper,
    rangeLabel,
  };
  saveState(state);
  return { discovered, preset: lpPreset(state) };
}

async function fetchLpPoolState(state = {}) {
  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(config.rpcUrl || "https://rpc.mainnet.chain.robinhood.com");
  let preset = lpPreset(state);

  if (!preset.tokenAddress) {
    throw new Error("Chưa chọn token. Paste contract token vào chat trước.");
  }

  if (!preset.poolAddress) {
    await prepareLpFromToken(preset.tokenAddress, state);
    preset = lpPreset(state);
  }

  const factory = new ethers.Contract(
    config.v3FactoryAddress,
    ["function getPool(address,address,uint24) view returns (address)"],
    provider,
  );
  const poolAddress =
    preset.poolAddress || (await factory.getPool(preset.token0, preset.token1, preset.fee));
  if (!poolAddress || poolAddress === ethers.ZeroAddress) {
    throw new Error("LP pool not found for this token/fee.");
  }

  const pool = new ethers.Contract(
    poolAddress,
    [
      "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
      "function liquidity() view returns (uint128)",
    ],
    provider,
  );
  const token = new ethers.Contract(
    preset.tokenAddress,
    ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
    provider,
  );

  const [slot0, poolLiquidity, symbol, decimals] = await Promise.all([
    pool.slot0(),
    pool.liquidity(),
    token.symbol().catch(() => preset.symbol || "TOKEN"),
    token.decimals().catch(() => preset.decimals || 18),
  ]);

  return {
    provider,
    preset: {
      ...preset,
      poolAddress: normalizeAddress(poolAddress),
      symbol: String(symbol || preset.symbol || "TOKEN"),
      decimals: Number(decimals || preset.decimals || 18),
    },
    poolAddress: normalizeAddress(poolAddress),
    sqrtPriceX96: BigInt(slot0.sqrtPriceX96),
    tick: Number(slot0.tick),
    poolLiquidity: BigInt(poolLiquidity),
    symbol: String(symbol || preset.symbol || "TOKEN"),
    decimals: Number(decimals || preset.decimals || 18),
    inRange:
      preset.tickLower != null &&
      preset.tickUpper != null &&
      Number(slot0.tick) >= preset.tickLower &&
      Number(slot0.tick) < preset.tickUpper,
  };
}

function buildLpPreview(poolState, ethAmountText) {
  const { ethers } = require("ethers");
  if (poolState.preset.tickLower == null || poolState.preset.tickUpper == null) {
    throw new Error("Chưa chọn range. Bấm ±5% / ±15% / ±50% / Full range trước.");
  }
  const ethAmount = Number(ethAmountText);
  if (!Number.isFinite(ethAmount) || ethAmount <= 0) throw new Error("Invalid ETH amount.");

  const ethRaw = ethers.parseEther(String(ethAmountText));
  const amounts = amountsForExactEth({
    sqrtPriceX96: poolState.sqrtPriceX96,
    tickLower: poolState.preset.tickLower,
    tickUpper: poolState.preset.tickUpper,
    ethAmount: ethRaw,
    wethIsToken0: poolState.preset.wethIsToken0,
  });
  if (amounts.error) throw new Error(amounts.error);

  const amount0Min = (amounts.amount0 * BigInt(10000 - config.slippageBps)) / 10000n;
  const amount1Min = (amounts.amount1 * BigInt(10000 - config.slippageBps)) / 10000n;
  const tokenRaw = poolState.preset.wethIsToken0 ? amounts.amount1 : amounts.amount0;

  return {
    ethAmount: String(ethAmountText),
    symbol: poolState.symbol,
    decimals: poolState.decimals,
    tick: poolState.tick,
    inRange: poolState.inRange,
    positionSide: amounts.positionSide,
    amount0: amounts.amount0,
    amount1: amounts.amount1,
    amount0Min,
    amount1Min,
    ethRaw: amounts.ethRaw,
    tokenRaw,
    liquidity: amounts.liquidity,
    ethText: ethers.formatEther(amounts.ethRaw),
    tokenText: ethers.formatUnits(tokenRaw, poolState.decimals),
  };
}

function lpPanelText(poolState, { preview = null, step = "range" } = {}) {
  const hasRange = poolState?.preset?.tickLower != null && poolState?.preset?.tickUpper != null;
  const lines = [
    `<b>Add Liquidity (Uniswap v3)</b>`,
    poolState
      ? `Token: <b>${escapeHtml(poolState.symbol)}</b> <code>${escapeHtml(compactAddress(poolState.preset.tokenAddress))}</code>`
      : "Chưa chọn token.",
  ];

  if (poolState) {
    lines.push(
      `Fee: <b>${poolState.preset.fee / 10000}%</b> · Pool <code>${escapeHtml(compactAddress(poolState.poolAddress))}</code>`,
      `Current tick: <code>${poolState.tick}</code>`,
    );
    if (hasRange && step !== "range") {
      lines.push(
        `Range (${escapeHtml(poolState.preset.rangeLabel || "custom")}): <code>${poolState.preset.tickLower}</code> → <code>${poolState.preset.tickUpper}</code>`,
        `${poolState.inRange ? "✅ In range" : "⚠️ Out of range"}`,
      );
    }
  }

  lines.push(`Trading: <b>${config.tradeEnabled ? "ON" : "OFF"}</b>`, "");

  if (!poolState) {
    lines.push("Paste contract token vào chat để bot đọc pool, rồi chọn range.");
  } else if (step === "range" || preview == null && step !== "amount" && step !== "preview") {
    lines.push("Bước 2: chọn range quanh giá hiện tại.");
  } else if (preview) {
    lines.push(
      `<b>Preview ${escapeHtml(preview.ethAmount)} ETH</b>`,
      `Deposit ETH: <b>${escapeHtml(Number(preview.ethText).toPrecision(6))}</b>`,
      `Deposit ${escapeHtml(preview.symbol)}: <b>${escapeHtml(Number(preview.tokenText).toPrecision(6))}</b>`,
      `Side: <code>${escapeHtml(preview.positionSide)}</code>`,
      `Slippage: <b>${config.slippageBps / 100}%</b>`,
      "",
      "Bấm Confirm để mint position NFT.",
    );
  } else {
    lines.push("Bước 3: chọn số ETH muốn add vào LP.");
  }

  return lines.join("\n");
}

async function executeAddLiquidity(ethAmountText, state = {}) {
  if (!config.tradeEnabled) {
    throw new Error("TRADE_ENABLED=0. Bật TRADE_ENABLED=1 và cấu hình WALLET_PRIVATE_KEY trước khi add LP.");
  }
  if (!config.rpcUrl || !config.walletPrivateKey) {
    throw new Error("Missing RPC_URL or WALLET_PRIVATE_KEY.");
  }
  if (!state.lp?.tokenAddress) {
    throw new Error("Chưa chọn token LP. Paste contract trước.");
  }
  if (state.lp.tickLower == null || state.lp.tickUpper == null) {
    throw new Error("Chưa chọn range LP.");
  }

  const { ethers } = require("ethers");
  const poolState = await fetchLpPoolState(state);
  const preview = buildLpPreview(poolState, ethAmountText);
  const wallet = new ethers.Wallet(config.walletPrivateKey, poolState.provider);
  const npm = new ethers.Contract(
    config.positionManagerAddress,
    [
      "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
      "function refundETH() payable",
    ],
    wallet,
  );

  const ethBalance = await poolState.provider.getBalance(wallet.address);
  if (ethBalance < preview.ethRaw) {
    throw new Error(`Not enough ETH. Need ~${preview.ethText}, wallet has ${ethers.formatEther(ethBalance)}.`);
  }

  const token = new ethers.Contract(
    poolState.preset.tokenAddress,
    [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner,address spender) view returns (uint256)",
      "function approve(address spender,uint256 amount) returns (bool)",
    ],
    wallet,
  );
  const tokenBalance = await token.balanceOf(wallet.address);
  if (tokenBalance < preview.tokenRaw) {
    throw new Error(
      `Not enough ${preview.symbol}. Need ~${preview.tokenText}, wallet has ${ethers.formatUnits(tokenBalance, preview.decimals)}.`,
    );
  }

  if (config.dryRun) {
    console.log(`[lp:mint:dry-run] ${JSON.stringify({
      token: poolState.preset.tokenAddress,
      eth: preview.ethText,
      amountToken: preview.tokenText,
      ticks: [poolState.preset.tickLower, poolState.preset.tickUpper],
    })}`);
    return {
      hash: "dry-run",
      tokenId: "0",
      amount0: preview.ethText,
      amount1: preview.tokenText,
      symbol: preview.symbol,
      wallet: wallet.address,
    };
  }

  if (preview.tokenRaw > 0n) {
    const allowance = await token.allowance(wallet.address, config.positionManagerAddress);
    if (allowance < preview.tokenRaw) {
      const approveTx = await token.approve(config.positionManagerAddress, preview.tokenRaw);
      await approveTx.wait();
    }
  }

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const tx = await npm.mint(
    {
      token0: poolState.preset.token0,
      token1: poolState.preset.token1,
      fee: poolState.preset.fee,
      tickLower: poolState.preset.tickLower,
      tickUpper: poolState.preset.tickUpper,
      amount0Desired: preview.amount0,
      amount1Desired: preview.amount1,
      amount0Min: preview.amount0Min,
      amount1Min: preview.amount1Min,
      recipient: wallet.address,
      deadline,
    },
    { value: preview.ethRaw },
  );
  const receipt = await tx.wait();

  let tokenId = "";
  try {
    const iface = new ethers.Interface([
      "event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
    ]);
    for (const log of receipt.logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "IncreaseLiquidity") {
          tokenId = parsed.args.tokenId.toString();
          break;
        }
      } catch {
        // ignore unrelated logs
      }
    }
  } catch {
    // ignore parse failures
  }

  try {
    await (await npm.refundETH()).wait();
  } catch {
    // no leftover ETH is fine
  }

  return {
    hash: tx.hash,
    tokenId: tokenId || "n/a",
    amount0: preview.ethText,
    amount1: preview.tokenText,
    symbol: preview.symbol,
    wallet: wallet.address,
  };
}

async function showLpPanel(callbackQuery, state) {
  try {
    if (!state.lp?.tokenAddress && state.trackedPair?.baseTokenAddress) {
      await prepareLpFromToken(state.trackedPair.baseTokenAddress, state);
    }
    if (!state.lp?.tokenAddress) {
      await editTradeMessage(
        callbackQuery,
        [
          `<b>Add Liquidity (Uniswap v3)</b>`,
          "Paste contract token vào chat.",
          "Bot sẽ đọc pool TOKEN/WETH → bạn chọn range → chọn ETH → Confirm.",
        ].join("\n"),
        mainMenuKeyboard(),
      );
      return;
    }

    const poolState = await fetchLpPoolState(state);
    const hasRange = state.lp.tickLower != null && state.lp.tickUpper != null;
    if (!hasRange) {
      await editTradeMessage(callbackQuery, lpPanelText(poolState, { step: "range" }), lpRangeKeyboard());
    } else {
      await editTradeMessage(callbackQuery, lpPanelText(poolState, { step: "amount" }), lpAmountKeyboard());
    }
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Add LP</b>\n${escapeHtml(error.message)}`,
      mainMenuKeyboard(),
    );
  }
}

async function showLpRanges(callbackQuery, state) {
  try {
    if (!state.lp?.tokenAddress && state.trackedPair?.baseTokenAddress) {
      await prepareLpFromToken(state.trackedPair.baseTokenAddress, state);
    }
    if (!state.lp?.tokenAddress) {
      await editTradeMessage(
        callbackQuery,
        `<b>Add LP</b>\nPaste contract token trước.`,
        mainMenuKeyboard(),
      );
      return;
    }
    const poolState = await fetchLpPoolState(state);
    await editTradeMessage(callbackQuery, lpPanelText(poolState, { step: "range" }), lpRangeKeyboard());
  } catch (error) {
    await editTradeMessage(callbackQuery, `<b>Add LP</b>\n${escapeHtml(error.message)}`, mainMenuKeyboard());
  }
}

async function applyLpRange(callbackQuery, state, percent) {
  try {
    if (!state.lp?.tokenAddress) throw new Error("Chưa chọn token.");
    const poolState = await fetchLpPoolState(state);
    const ranged = ticksAroundPrice(poolState.tick, percent, poolState.preset.tickSpacing);
    state.lp = {
      ...state.lp,
      tickLower: ranged.tickLower,
      tickUpper: ranged.tickUpper,
      rangeLabel: ranged.rangeLabel,
    };
    saveState(state);
    const updated = await fetchLpPoolState(state);
    await editTradeMessage(callbackQuery, lpPanelText(updated, { step: "amount" }), lpAmountKeyboard());
  } catch (error) {
    await editTradeMessage(callbackQuery, `<b>Chọn range thất bại</b>\n${escapeHtml(error.message)}`, lpRangeKeyboard());
  }
}

async function showLpPreview(callbackQuery, state, ethAmount) {
  try {
    const poolState = await fetchLpPoolState(state);
    const preview = buildLpPreview(poolState, ethAmount);
    await editTradeMessage(callbackQuery, lpPanelText(poolState, { preview, step: "preview" }), lpConfirmKeyboard(ethAmount));
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Add LP preview failed</b>\n${escapeHtml(error.message)}`,
      lpAmountKeyboard(),
    );
  }
}

async function runConfirmedAddLiquidity(callbackQuery, state, ethAmount) {
  await editTradeMessage(callbackQuery, `<b>Adding LP with ${escapeHtml(ethAmount)} ETH...</b>`, null);
  try {
    const result = await executeAddLiquidity(ethAmount, state);
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>LP minted</b>`,
        `Token ID: <code>${escapeHtml(result.tokenId)}</code>`,
        `ETH: <b>${escapeHtml(Number(result.amount0).toPrecision(6))}</b>`,
        `${escapeHtml(result.symbol)}: <b>${escapeHtml(Number(result.amount1).toPrecision(6))}</b>`,
        `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
        `<a href="${escapeHtml(txUrl)}">Tx</a>`,
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: "My LP", callback_data: "panel:mylp" }],
          [{ text: "Add more", callback_data: "lp:amounts" }, { text: "Main Menu", callback_data: "menu" }],
        ],
      },
    );
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>LP not minted</b>\n${escapeHtml(error.message)}`,
      lpAmountKeyboard(),
    );
  }
}

function npmContract(providerOrSigner) {
  const { ethers } = require("ethers");
  return new ethers.Contract(
    config.positionManagerAddress,
    [
      "function balanceOf(address owner) view returns (uint256)",
      "function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)",
      "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
      "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256 amount0,uint256 amount1)",
      "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)",
      "function burn(uint256 tokenId) payable",
      "function multicall(bytes[] data) payable returns (bytes[] results)",
      "function factory() view returns (address)",
    ],
    providerOrSigner,
  );
}

async function getManagedWallet() {
  if (!config.rpcUrl || !config.walletPrivateKey) {
    throw new Error("Missing RPC_URL or WALLET_PRIVATE_KEY.");
  }
  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
  return { ethers, provider, wallet };
}

async function readPositionDetails(tokenId, provider) {
  const { ethers } = require("ethers");
  const npm = npmContract(provider);
  const pos = await npm.positions(tokenId);
  const token0 = normalizeAddress(pos.token0);
  const token1 = normalizeAddress(pos.token1);
  const weth = normalizeAddress(config.lpWethAddress);
  const fee = Number(pos.fee);
  const tickLower = Number(pos.tickLower);
  const tickUpper = Number(pos.tickUpper);
  const liquidity = BigInt(pos.liquidity);
  const factory = new ethers.Contract(
    config.v3FactoryAddress,
    ["function getPool(address,address,uint24) view returns (address)"],
    provider,
  );
  const poolAddress = await factory.getPool(token0, token1, fee);
  let currentTick = 0;
  let inRange = false;
  if (poolAddress && poolAddress !== ethers.ZeroAddress) {
    const pool = new ethers.Contract(
      poolAddress,
      ["function slot0() view returns (uint160,int24 tick,uint16,uint16,uint16,uint8,bool)"],
      provider,
    );
    const slot0 = await pool.slot0();
    currentTick = Number(slot0.tick);
    inRange = currentTick >= tickLower && currentTick < tickUpper;
  }

  const otherToken = token0 === weth ? token1 : token1 === weth ? token0 : token0;
  const erc20 = new ethers.Contract(otherToken, ["function symbol() view returns (string)", "function decimals() view returns (uint8)"], provider);
  const [symbol, decimals] = await Promise.all([
    erc20.symbol().catch(() => "TOKEN"),
    erc20.decimals().catch(() => 18),
  ]);

  return {
    tokenId: String(tokenId),
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    liquidity,
    tokensOwed0: BigInt(pos.tokensOwed0),
    tokensOwed1: BigInt(pos.tokensOwed1),
    poolAddress: normalizeAddress(poolAddress || ""),
    currentTick,
    inRange,
    wethIsToken0: token0 === weth,
    tokenAddress: otherToken,
    symbol: String(symbol || "TOKEN"),
    decimals: Number(decimals || 18),
    tickSpacing: feeToTickSpacing(fee),
  };
}

async function fetchWalletLpPositions(max = 8) {
  const { provider, wallet } = await getManagedWallet();
  const npm = npmContract(provider);
  const balance = Number(await npm.balanceOf(wallet.address));
  if (!balance) return { wallet: wallet.address, positions: [] };

  const count = Math.min(balance, max);
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    const tokenId = await npm.tokenOfOwnerByIndex(wallet.address, index);
    try {
      const details = await readPositionDetails(tokenId, provider);
      if (details.liquidity > 0n || details.tokensOwed0 > 0n || details.tokensOwed1 > 0n) {
        positions.push(details);
      }
    } catch (error) {
      console.warn(`Could not read LP NFT ${tokenId}: ${error.message}`);
    }
  }
  return { wallet: wallet.address, positions };
}

function myLpListText(payload) {
  const lines = [
    `<b>My LP Positions</b>`,
    `Wallet: <code>${escapeHtml(compactAddress(payload.wallet))}</code>`,
    "",
  ];
  if (!payload.positions.length) {
    lines.push("Chưa có position Uniswap v3 nào (hoặc liquidity = 0).");
    lines.push("Paste token rồi bấm Add LP để tạo mới.");
    return lines.join("\n");
  }

  for (const pos of payload.positions) {
    lines.push(
      `#${escapeHtml(pos.tokenId)} · <b>${escapeHtml(pos.symbol)}/ETH</b> · fee ${pos.fee / 10000}%`,
      `Range <code>${pos.tickLower}</code>→<code>${pos.tickUpper}</code> · tick <code>${pos.currentTick}</code> · ${pos.inRange ? "✅ In range" : "⚠️ Out of range"}`,
      `Liquidity: <code>${escapeHtml(pos.liquidity.toString())}</code>`,
      "",
    );
  }
  lines.push("Chọn position để Remove hoặc Re-range.");
  return lines.join("\n");
}

function myLpListKeyboard(positions) {
  const rows = positions.map((pos) => [
    {
      text: `#${pos.tokenId} ${pos.symbol} ${pos.inRange ? "IN" : "OUT"}`,
      callback_data: `lp:pos:${pos.tokenId}`,
    },
  ]);
  rows.push([{ text: "Refresh", callback_data: "panel:mylp" }, { text: "Add LP", callback_data: "panel:lp" }]);
  rows.push([{ text: "Main Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function lpPositionKeyboard(tokenId) {
  return {
    inline_keyboard: [
      [
        { text: "Remove 25%", callback_data: `lp:rm:${tokenId}:25` },
        { text: "Remove 50%", callback_data: `lp:rm:${tokenId}:50` },
      ],
      [{ text: "Remove 100%", callback_data: `lp:rm:${tokenId}:100` }],
      [{ text: "Re-range (remove → new range)", callback_data: `lp:rerange:${tokenId}` }],
      [{ text: "Back", callback_data: "panel:mylp" }, { text: "Main Menu", callback_data: "menu" }],
    ],
  };
}

function lpPositionText(pos) {
  return [
    `<b>LP #${escapeHtml(pos.tokenId)}</b>`,
    `Pair: <b>${escapeHtml(pos.symbol)}/ETH</b> · Fee <b>${pos.fee / 10000}%</b>`,
    `Range: <code>${pos.tickLower}</code> → <code>${pos.tickUpper}</code>`,
    `Current tick: <code>${pos.currentTick}</code> · ${pos.inRange ? "✅ In range (đang earn fee)" : "⚠️ Out of range (không earn fee đến khi giá quay lại)"}`,
    `Liquidity: <code>${escapeHtml(pos.liquidity.toString())}</code>`,
    `Pool: <code>${escapeHtml(compactAddress(pos.poolAddress))}</code>`,
    "",
    "Remove: rút liquidity (+ collect fee).",
    "Re-range: remove 100% rồi chọn range mới và add lại.",
  ].join("\n");
}

function liquidityPercent(liquidity, percent) {
  const pct = BigInt(percent);
  if (pct >= 100n) return liquidity;
  return (liquidity * pct) / 100n;
}

async function executeRemoveLiquidity(tokenId, percent) {
  if (!config.tradeEnabled) {
    throw new Error("TRADE_ENABLED=0. Bật TRADE_ENABLED=1 trước khi remove LP.");
  }
  const { ethers, provider, wallet } = await getManagedWallet();
  const npm = npmContract(wallet);
  const pos = await readPositionDetails(tokenId, provider);
  if (pos.liquidity <= 0n && percent > 0) {
    throw new Error("Position đã hết liquidity.");
  }

  const removeLiquidity = liquidityPercent(pos.liquidity, percent);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const maxUint128 = (2n ** 128n) - 1n;

  if (config.dryRun) {
    console.log(`[lp:remove:dry-run] id=${tokenId} pct=${percent} liq=${removeLiquidity}`);
    return { hash: "dry-run", tokenId: String(tokenId), percent, burned: percent >= 100, symbol: pos.symbol };
  }

  const calls = [];
  if (removeLiquidity > 0n) {
    calls.push(
      npm.interface.encodeFunctionData("decreaseLiquidity", [
        {
          tokenId,
          liquidity: removeLiquidity,
          amount0Min: 0,
          amount1Min: 0,
          deadline,
        },
      ]),
    );
  }
  calls.push(
    npm.interface.encodeFunctionData("collect", [
      {
        tokenId,
        recipient: wallet.address,
        amount0Max: maxUint128,
        amount1Max: maxUint128,
      },
    ]),
  );

  if (percent >= 100) {
    // burn only works when liquidity is 0 after decrease+collect
    calls.push(npm.interface.encodeFunctionData("burn", [tokenId]));
  }

  let tx;
  try {
    tx = await npm.multicall(calls);
  } catch (error) {
    // If burn fails because dust remains, retry without burn.
    if (percent >= 100 && calls.length > 2) {
      tx = await npm.multicall(calls.slice(0, -1));
    } else {
      throw error;
    }
  }
  await tx.wait();

  return {
    hash: tx.hash,
    tokenId: String(tokenId),
    percent,
    burned: percent >= 100,
    symbol: pos.symbol,
    wallet: wallet.address,
  };
}

async function showMyLpPanel(callbackQuery) {
  try {
    const payload = await fetchWalletLpPositions();
    await editTradeMessage(callbackQuery, myLpListText(payload), myLpListKeyboard(payload.positions));
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>My LP</b>\n${escapeHtml(error.message)}`,
      mainMenuKeyboard(),
    );
  }
}

async function showLpPosition(callbackQuery, tokenId) {
  try {
    const { provider } = await getManagedWallet();
    const pos = await readPositionDetails(tokenId, provider);
    await editTradeMessage(callbackQuery, lpPositionText(pos), lpPositionKeyboard(tokenId));
  } catch (error) {
    await editTradeMessage(callbackQuery, `<b>LP position</b>\n${escapeHtml(error.message)}`, {
      inline_keyboard: [[{ text: "Back", callback_data: "panel:mylp" }]],
    });
  }
}

async function runRemoveLiquidity(callbackQuery, tokenId, percent) {
  await editTradeMessage(callbackQuery, `<b>Removing ${percent}% from LP #${escapeHtml(tokenId)}...</b>`, null);
  try {
    const result = await executeRemoveLiquidity(tokenId, Number(percent));
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>LP removed ${result.percent}%</b>`,
        `Position: <code>#${escapeHtml(result.tokenId)}</code> · ${escapeHtml(result.symbol)}/ETH`,
        result.burned ? "NFT burn attempted (full remove)." : "NFT vẫn giữ (partial remove).",
        `<a href="${escapeHtml(txUrl)}">Tx</a>`,
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: "My LP", callback_data: "panel:mylp" }],
          [{ text: "Main Menu", callback_data: "menu" }],
        ],
      },
    );
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Remove failed</b>\n${escapeHtml(error.message)}`,
      lpPositionKeyboard(tokenId),
    );
  }
}

async function startLpRerange(callbackQuery, state, tokenId) {
  await editTradeMessage(callbackQuery, `<b>Re-range:</b> đang remove 100% LP #${escapeHtml(tokenId)}...`, null);
  try {
    const { provider } = await getManagedWallet();
    const pos = await readPositionDetails(tokenId, provider);
    const removed = await executeRemoveLiquidity(tokenId, 100);

    state.lp = {
      tokenAddress: pos.tokenAddress,
      symbol: pos.symbol,
      decimals: pos.decimals,
      fee: pos.fee,
      tickSpacing: pos.tickSpacing,
      poolAddress: pos.poolAddress,
      token0: pos.token0,
      token1: pos.token1,
      wethIsToken0: pos.wethIsToken0,
      tickLower: null,
      tickUpper: null,
      rangeLabel: null,
      rerangeFrom: String(tokenId),
    };
    saveState(state);

    const poolState = await fetchLpPoolState(state);
    const txUrl = `${config.blockscoutBaseUrl}/tx/${removed.hash}`;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>Old LP removed</b> · <a href="${escapeHtml(txUrl)}">Tx</a>`,
        `Token: <b>${escapeHtml(pos.symbol)}</b>`,
        `Old range: <code>${pos.tickLower}</code>→<code>${pos.tickUpper}</code> (${pos.inRange ? "was in range" : "was OUT of range"})`,
        `Current tick: <code>${poolState.tick}</code>`,
        "",
        "Chọn range mới, rồi chọn ETH để mint lại.",
      ].join("\n"),
      lpRangeKeyboard(),
    );
  } catch (error) {
    await editTradeMessage(
      callbackQuery,
      `<b>Re-range failed</b>\n${escapeHtml(error.message)}`,
      lpPositionKeyboard(tokenId),
    );
  }
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
  let pairAddress = normalizeAddress(fromBag?.pairAddress || "");
  let baseSymbol = fromBag?.symbol || "TOKEN";
  let pairUrl = fromBag?.pairUrl || "";
  let priceNative = Number.NaN;
  let priceUsd = Number(fromBag?.priceUsd);
  let decimals = Number(fromBag?.decimals);
  if (!Number.isFinite(decimals) || decimals < 0) decimals = 18;

  let pair = pairAddress ? await fetchDexPairByAddress(pairAddress) : null;
  if (!pair) {
    const pairs = await fetchTokenPairs(token);
    pair = chooseBestPairForToken(pairs, token);
  }
  if (!pair?.pairAddress) {
    throw new Error(`Không tìm thấy pair WETH thanh khoản cho ${baseSymbol}.`);
  }

  const tracked = trackedPairFromDexPair(pair, token);
  pairAddress = tracked.pairAddress;
  baseSymbol = tracked.baseSymbol || baseSymbol;
  pairUrl = tracked.pairUrl || pairUrl || `https://dexscreener.com/robinhood/${pairAddress}`;
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

async function estimateMinimumOut(side, amountText, overrides = {}) {
  const baseTokenAddress = normalizeAddress(overrides.baseTokenAddress || config.baseTokenAddress);
  const baseSymbol = overrides.baseSymbol || config.baseSymbol;
  const decimals = Number.isFinite(Number(overrides.decimals)) ? Number(overrides.decimals) : 18;
  let resolvedAmountText = amountText;
  if (side === "SELL") {
    const percent = parseSellPercent(amountText);
    if (percent !== null) {
      const { ethers } = require("ethers");
      const tokenBalance = await getWalletTokenBalance(baseTokenAddress);
      const amountIn = balancePercent(tokenBalance.balance, percent);
      if (amountIn <= 0n) throw new Error(`No ${baseSymbol} balance to sell.`);
      resolvedAmountText = ethers.formatUnits(amountIn, decimals);
    }
  }

  let priceNative = Number(overrides.priceNative);
  let priceUsd = Number(overrides.priceUsd);
  if (!Number.isFinite(priceNative) || priceNative <= 0) {
    const pair = overrides.pairAddress
      ? await fetchDexPairByAddress(overrides.pairAddress)
      : await fetchDexPair();
    priceNative = Number(pair?.priceNative);
    priceUsd = Number(pair?.priceUsd);
    if (overrides.baseTokenAddress) {
      const rawBase = normalizeAddress(pair?.baseToken?.address);
      const token = normalizeAddress(overrides.baseTokenAddress);
      if (rawBase && token && rawBase !== token && Number.isFinite(priceNative) && priceNative > 0) {
        priceNative = 1 / priceNative;
      }
    }
  }
  if (!Number.isFinite(priceNative) || priceNative <= 0) {
    throw new Error("Cannot read current price from Dexscreener.");
  }

  const amount = Number(resolvedAmountText);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount.");

  const expectedOut = side === "BUY" ? amount / priceNative : amount * priceNative;
  const minOut = (expectedOut * (10000 - config.slippageBps)) / 10000;
  return {
    expectedOut,
    minOut,
    priceNative,
    priceUsd,
    resolvedAmountText,
    sellPercent: side === "SELL" ? parseSellPercent(amountText) : null,
    baseSymbol,
    quoteSymbol: overrides.quoteSymbol || config.quoteSymbol,
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
    const state = loadState();
    await editTradeMessage(
      callbackQuery,
      [
        `<b>${escapeHtml(side)} sent</b>`,
        result.wrappedEth ? `Wrapped: <b>${escapeHtml(result.wrappedEth)} ETH → WETH</b>` : "",
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
        `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
      ]
        .filter(Boolean)
        .join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    );
  } catch (error) {
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

  await editTradeMessage(
    callbackQuery,
    `<b>Sending SELL ${escapeHtml(ctx.baseSymbol)}...</b>\nAmount: ${escapeHtml(amount)} ${escapeHtml(ctx.baseSymbol)}`,
  );

  try {
    const result = await executeSwap("SELL", amount, ctx);
    const txUrl = `${config.blockscoutBaseUrl}/tx/${result.hash}`;
    await editTradeMessage(
      callbackQuery,
      [
        `<b>SELL ${escapeHtml(ctx.baseSymbol)} sent</b>`,
        `Tx: <a href="${escapeHtml(txUrl)}">${escapeHtml(compactAddress(result.hash))}</a>`,
        `Wallet: <code>${escapeHtml(compactAddress(result.wallet))}</code>`,
        `Min out: <b>${escapeHtml(result.minOut)} ${escapeHtml(result.tokenOutSymbol)}</b>`,
        `Track alerts vẫn: <b>${escapeHtml(config.baseSymbol)}</b>`,
      ].join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    );
  } catch (error) {
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

  const data = String(callbackQuery.data || "");
  await answerCallback(callbackQuery);

  if (data === "menu") {
    let portfolio = state.portfolioSnapshot || null;
    try {
      portfolio = await withTimeout(
        resolveMenuPortfolio(state, { forceRefresh: false }),
        8_000,
        "Menu portfolio",
      );
    } catch (error) {
      console.warn(`menu portfolio skipped: ${error.message}`);
    }
    let text;
    try {
      text = await withTimeout(mainPanelText({ state, portfolio }), 10_000, "Main panel");
    } catch {
      text = staticMainPanelText();
    }
    await editTradeMessage(callbackQuery, text, mainMenuKeyboard(portfolio || state.portfolioSnapshot));
    return;
  }

  if (data === "panel:trade") {
    await editTradeMessage(callbackQuery, tradePanelText(), sniperTradeKeyboard());
    return;
  }

  if (data === "panel:tools") {
    await editTradeMessage(callbackQuery, toolsPanelText(), toolsKeyboard());
    return;
  }

  if (data === "panel:honeypot" || data === "panel:lp" || data === "panel:mylp" || data.startsWith("lp:")) {
    await editTradeMessage(
      callbackQuery,
      "<b>Tools</b>\nHoneypot / LP đã tắt trên bot này.",
      toolsKeyboard(),
    );
    return;
  }

  if (data === "panel:portfolio" || data === "portfolio:refresh") {
    await showPortfolio(chatId, state, {
      editCallback: callbackQuery,
      forceRefresh: data === "portfolio:refresh",
    });
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
        `Portfolio wallet: <code>${escapeHtml(getPortfolioWallet(state) ? compactAddress(getPortfolioWallet(state)) : "Not set")}</code>`,
      ].join("\n"),
      mainMenuKeyboard(state.portfolioSnapshot),
    );
    return;
  }

  if (data === "panel:wallets") {
    const wallet = await getDisplayWallet();
    const balance = await getNativeBalance(wallet);
    const portfolioWallet = getPortfolioWallet(state);
    await editTradeMessage(
      callbackQuery,
      [
        `<b>Wallets</b>`,
        `Trade wallet: <code>${escapeHtml(wallet ? compactAddress(wallet) : "Not configured")}</code>`,
        `Balance: <code>${escapeHtml(balance ? `${Number(balance).toPrecision(6)} ETH` : "n/a")}</code>`,
        `Portfolio wallet: <code>${escapeHtml(portfolioWallet ? compactAddress(portfolioWallet) : "Not set")}</code>`,
        "",
        "Gắn ví portfolio: <code>/wallet 0x...</code>",
        "Xem giá: Tools → Update Price hoặc /menu.",
      ].join("\n"),
      portfolioKeyboard(),
    );
    return;
  }

  if (data.startsWith("soon:")) {
    const feature = data.slice("soon:".length);
    await answerCallback(callbackQuery, `${feature} coming soon.`);
    return;
  }

  if (data.startsWith("bag:")) {
    const token = normalizeAddress(data.slice("bag:".length));
    let item = findBagItem(state, token);
    if (!item) {
      await resolveMenuPortfolio(state, { forceRefresh: true });
      item = findBagItem(state, token);
    }
    if (!item) {
      await editTradeMessage(
        callbackQuery,
        bagSellPanelText(null),
        mainMenuKeyboard(state.portfolioSnapshot),
      );
      return;
    }
    await editTradeMessage(callbackQuery, bagSellPanelText(item), bagSellKeyboard(item));
    return;
  }

  if (data.startsWith("bagtrack:")) {
    const token = normalizeAddress(data.slice("bagtrack:".length));
    if (!isEvmAddress(token)) {
      await editTradeMessage(
        callbackQuery,
        "Token address không hợp lệ.",
        mainMenuKeyboard(state.portfolioSnapshot),
      );
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
      await editTradeMessage(
        callbackQuery,
        "Bag sell callback không hợp lệ.",
        mainMenuKeyboard(state.portfolioSnapshot),
      );
      return;
    }

    if (shouldTradeImmediately("SELL", amount)) {
      await runConfirmedBagSell(callbackQuery, token, amount, state);
      return;
    }

    let ctx;
    try {
      ctx = await resolveSellContext(token, state);
    } catch (error) {
      const item = findBagItem(state, token);
      await editTradeMessage(
        callbackQuery,
        `<b>Confirm SELL failed</b>\n${escapeHtml(error.message)}`,
        item ? bagSellKeyboard(item) : mainMenuKeyboard(state.portfolioSnapshot),
      );
      return;
    }

    const sellPercent = parseSellPercent(amount);
    const spendLabel =
      sellPercent !== null
        ? sellPercent >= 100
          ? `ALL ${ctx.baseSymbol}`
          : `${sellPercent}% bag ${ctx.baseSymbol}`
        : `${amount} ${ctx.baseSymbol}`;
    let estimateText = "";
    try {
      const quote = await estimateMinimumOut("SELL", amount, ctx);
      estimateText = [
        sellPercent !== null && quote.resolvedAmountText
          ? `Sell qty: ~<b>${escapeHtml(numberToDecimalString(Number(quote.resolvedAmountText), 6))} ${escapeHtml(ctx.baseSymbol)}</b>`
          : "",
        `Expected out: ~<b>${escapeHtml(numberToDecimalString(quote.expectedOut, 6))} ${escapeHtml(ctx.quoteSymbol)}</b>`,
        `Min out: <b>${escapeHtml(numberToDecimalString(quote.minOut, 6))} ${escapeHtml(ctx.quoteSymbol)}</b>`,
        `Slippage: <b>${config.slippageBps / 100}%</b>`,
      ]
        .filter(Boolean)
        .join("\n");
    } catch (error) {
      estimateText = `Estimate unavailable: ${escapeHtml(error.message)}`;
    }

    await editTradeMessage(
      callbackQuery,
      [
        `<b>Confirm SELL ${escapeHtml(ctx.baseSymbol)}</b>`,
        `Spend: <b>${escapeHtml(spendLabel)}</b>`,
        estimateText,
        `Trading: <b>${config.tradeEnabled ? "ON" : "OFF"}</b>`,
        `Alerts vẫn track: <b>${escapeHtml(config.baseSymbol)}</b>`,
      ].join("\n"),
      bagConfirmKeyboard(token, amount),
    );
    return;
  }

  if (data.startsWith("bagconfirm:")) {
    const parts = data.split(":");
    const token = normalizeAddress(parts[1] || "");
    const amount = parts.slice(2).join(":") || "";
    if (!isEvmAddress(token) || !amount) {
      await editTradeMessage(
        callbackQuery,
        "Bag confirm callback không hợp lệ.",
        mainMenuKeyboard(state.portfolioSnapshot),
      );
      return;
    }
    await runConfirmedBagSell(callbackQuery, token, amount, state);
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
    const sellPercent = side === "SELL" ? parseSellPercent(amount) : null;
    const spendLabel =
      sellPercent !== null
        ? sellPercent >= 100
          ? `ALL ${inputSymbol}`
          : `${sellPercent}% bag ${inputSymbol}`
        : `${amount} ${inputSymbol}`;
    let estimateText = "";
    try {
      const quote = await estimateMinimumOut(side, amount);
      estimateText = [
        sellPercent !== null && quote.resolvedAmountText
          ? `Sell qty: ~<b>${escapeHtml(numberToDecimalString(Number(quote.resolvedAmountText), 6))} ${escapeHtml(inputSymbol)}</b>`
          : "",
        `Expected out: ~<b>${escapeHtml(numberToDecimalString(quote.expectedOut, 6))} ${escapeHtml(outputSymbol)}</b>`,
        `Min out: <b>${escapeHtml(numberToDecimalString(quote.minOut, 6))} ${escapeHtml(outputSymbol)}</b>`,
        `Slippage: <b>${config.slippageBps / 100}%</b>`,
      ]
        .filter(Boolean)
        .join("\n");
    } catch (error) {
      estimateText = `Estimate unavailable: ${escapeHtml(error.message)}`;
    }

    await editTradeMessage(
      callbackQuery,
      [
        `<b>Confirm ${escapeHtml(side)} ${escapeHtml(config.baseSymbol)}</b>`,
        `Spend: <b>${escapeHtml(spendLabel)}</b>`,
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
  if (!isAuthorizedChat(chatId)) {
    await notifyUnauthorizedChat(chatId);
    return;
  }

  const text = String(message.text || "").trim();
  console.log(`Telegram message from chat ${chatId}: ${text.slice(0, 80) || "(no text)"}`);
  if (isEvmAddress(text)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Đang track buy/sell cho:\n<code>${escapeHtml(text)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
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

  if (text === "/start" || text === "/menu") {
    await sendMainMenu(chatId, state);
    return;
  }

  if (text === "/portfolio" || text.startsWith("/portfolio@")) {
    await showPortfolio(chatId, state, { announce: true });
    return;
  }

  if (text === "/trade") {
    await sendTradeMenu(chatId);
    return;
  }

  if (text === "/lp" || text.startsWith("/lp@") || text === "/honeypot" || text.startsWith("/honeypot@")) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "Honeypot / LP đã tắt trên bot này.",
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: mainMenuKeyboard(state.portfolioSnapshot),
    });
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
        25_000,
        `Telegram update ${update.update_id}`,
      );
    } catch (error) {
      if (isExpiredCallbackError(error) || isMessageNotModifiedError(error)) {
        console.warn(`Ignored stale Telegram update ${update.update_id}.`);
      } else {
        console.error(`Telegram update ${update.update_id} failed: ${error.message}`);
        try {
          const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
          if (chatId && String(error.message || "").includes("timed out")) {
            await telegramRequest("sendMessage", {
              chat_id: chatId,
              text: "Bot đang chậm (timeout). Thử /menu lại hoặc Update Price.",
              parse_mode: "HTML",
              disable_web_page_preview: "true",
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
        const priced = await enrichTradePrices(trade);
        await sendTelegram(tradeMessage(priced), alertTradeKeyboard());
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

  if (process.argv.includes("--send-trade")) {
    await sendTradeMenu();
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

  console.log("Entering poll loop.");
  let lastBlockscoutWarnAt = 0;
  let lastRpcWarnAt = 0;
  while (true) {
    try {
      await withTimeout(processTelegramUpdates(state), 45_000, "Telegram poll cycle");
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

    // Primary realtime path: Uniswap v3 Swap logs via RPC (works when Blockscout 500s).
    try {
      await withTimeout(pollRpcSwaps(state), 20_000, "RPC swap poll");
    } catch (error) {
      const now = Date.now();
      if (now - lastRpcWarnAt > 60_000) {
        console.warn(`RPC swap poll failed: ${error.message || error}`);
        lastRpcWarnAt = now;
      }
    }

    // Optional secondary path via Blockscout transfers.
    try {
      const groups = groupTransfers(await withTimeout(fetchTokenTransfers(), 15_000, "Blockscout transfers"));
      await withTimeout(handleNewGroups(groups, state), 20_000, "Blockscout alerts");
    } catch (error) {
      const now = Date.now();
      if (isTransientHttpError(error) || String(error.message || "").includes("timed out")) {
        if (now - lastBlockscoutWarnAt > 60_000) {
          console.warn(`Blockscout temporarily unavailable: ${error.message || error}`);
          console.warn("Swap alerts continue via RPC logs.");
          lastBlockscoutWarnAt = now;
        }
      } else {
        console.error(`Swap poll error: ${error.message || error}`);
      }
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
  alignTick,
  analyzeContractBytecode,
  analyzeDexMarketRisk,
  analyzeHolderConcentration,
  analyzePairsMarketRisk,
  amountsForExactEth,
  amountsForEthLiquidity: amountsForExactEth,
  balancePercent,
  parseSellPercent,
  buildLpPreview,
  buildPortfolioFromBalances,
  classifyFromTransaction,
  isFreshTrade,
  tradeTimestampMs,
  tradeFromV3SwapLog,
  classifyRestrictionError,
  config,
  feeToTickSpacing,
  formatHoneypotReport,
  formatUnits,
  getPortfolioWallet,
  getSqrtRatioAtTick,
  groupHashes,
  groupTransfers,
  isAuthorizedChat,
  isExpiredCallbackError,
  isEvmAddress,
  isMessageNotModifiedError,
  isPollingConflictError,
  isTradeablePortfolioItem,
  lpPreset,
  liquidityPercent,
  ticksAroundPrice,
  normalizeAddress,
  mainMenuKeyboard,
  toolsKeyboard,
  bagButtonRows,
  bagSellKeyboard,
  formatBagButtonLabel,
  mainPanelText,
  chooseBestPairForToken,
  chooseWatchPairAddresses,
  parseTelegramChatIds,
  parseWalletBalanceEntry,
  pickProbeHolder,
  portfolioKeyboard,
  portfolioPanelText,
  scoreHoneypotFindings,
  classifyOwnerStatus,
  analyzeV2LpBurn,
  analyzeV3LpBurnAndLock,
  analyzeProxyRisk,
  analyzeRoundTripTax,
  analyzeV4HookRisk,
  applyTradeUsd,
  readTokenRiskViews,
  shouldTradeImmediately,
  sniperTradeKeyboard,
  sortUniswapTokens,
  staticMainPanelText,
  trackedPairFromDexPair,
  tradePanelText,
  tradeMessage,
};
