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
  telegramChatIds: parseTelegramChatIds(process.env.TELEGRAM_CHAT_ID || ""),
  telegramChatId: parseTelegramChatIds(process.env.TELEGRAM_CHAT_ID || "")[0] || "",
  botTitle: process.env.BOT_TITLE || "REPETradingBot",
  botTagline: process.env.BOT_TAGLINE || "Your Gateway to Robinhood DeFi",
  telegramUrl: process.env.PROJECT_TELEGRAM_URL || "",
  twitterUrl: process.env.PROJECT_TWITTER_URL || "",
  websiteUrl: process.env.PROJECT_WEBSITE_URL || "",
  tradeEnabled: truthy(process.env.TRADE_ENABLED),
  rpcUrl: process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
  walletAddress: process.env.WALLET_ADDRESS || "",
  swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoterAddress: process.env.QUOTER_ADDRESS || "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  uniswapV3Fee: Number(process.env.UNISWAP_V3_FEE || 10000),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 200),
  oneTapTrade: truthy(process.env.ONE_TAP_TRADE),
  buyAmountsQuote: parseAmountOptions(process.env.BUY_AMOUNTS_QUOTE || "0.01,0.05,0.1,0.25"),
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

async function fetchTokenTransfers() {
  const url = `${config.blockscoutBaseUrl}/api/v2/addresses/${config.pairAddress}/token-transfers`;
  const payload = await fetchJson(url, {}, 2);
  return (payload.items || []).slice(0, config.maxItems);
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
  const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${config.pairAddress}`;
  const payload = await fetchJson(url);
  return payload.pair || payload.pairs?.[0] || null;
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
  fs.writeFileSync(config.stateFile, `${JSON.stringify(state, null, 2)}\n`);
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

  let worst = analyzeDexMarketRisk(list[0]);
  for (const pair of list.slice(1)) {
    const risk = analyzeDexMarketRisk(pair);
    if (risk.score > worst.score) worst = risk;
  }

  const thin = list.filter((pair) => Number(pair?.liquidity?.usd || 0) < 3000);
  const deep = list.filter((pair) => Number(pair?.liquidity?.usd || 0) >= 20000);
  if (thin.length && deep.length) {
    worst = {
      ...worst,
      score: worst.score + 12,
      warnings: [
        ...worst.warnings,
        "Multiple pools: thin pool can bait charts while liquidity sits elsewhere",
      ],
    };
  }

  return worst;
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
    return { score: 100, warnings: ["No contract bytecode"], hasOwnerSelector: false, hasBlacklistSelector: false, hasPauseSelector: false, hasMintSelector: false };
  }

  const has = (selector) => normalized.includes(String(selector).toLowerCase().replace(/^0x/, ""));
  const hasOwnerSelector = has("8da5cb5b") || has("893d20e8");
  const hasBlacklistSelector = has("f9f92be4") || has("fe575a87") || has("e47d6060");
  const hasPauseSelector = has("5c975abb") || has("8456cb59") || has("3f4ba83a");
  const hasMintSelector = has("40c10f19") || has("a0712d68");

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
  if (hasOwnerSelector) {
    warnings.push("Ownable-style owner selector present");
    score += 8;
  }

  return { score, warnings, hasOwnerSelector, hasBlacklistSelector, hasPauseSelector, hasMintSelector };
}

function scoreHoneypotFindings(findings) {
  let score = Number(findings.marketScore || 0) + Number(findings.holderScore || 0) + Number(findings.contractScore || 0);
  const dangers = [];
  const notes = [...(findings.marketWarnings || []), ...(findings.holderWarnings || []), ...(findings.contractWarnings || [])];

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
  if (findings.ownerActive) {
    dangers.push(`Owner still active: ${findings.ownerAddress}`);
    score += 25;
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
    score,
    dangers,
    notes: [...new Set(notes)],
  };
}

function formatHoneypotReport(report) {
  if (!report) return "Security audit: unavailable";

  const icon = report.verdict === "SAFE" ? "✅" : report.verdict === "CAUTION" ? "⚠️" : "🚨";
  const lines = [
    `<b>Security audit</b>: ${icon} <b>${escapeHtml(report.verdict)}</b> (score ${report.score})`,
  ];

  for (const danger of report.dangers || []) {
    lines.push(`🚨 ${escapeHtml(danger)}`);
  }
  for (const note of (report.notes || []).slice(0, 6)) {
    lines.push(`• ${escapeHtml(note)}`);
  }

  if (report.verdict === "DANGER") {
    lines.push("<b>Cảnh báo: token rủi ro cao / có dấu hiệu scam. Theo dõi vẫn bật — đừng mua.</b>");
  } else if (report.verdict === "CAUTION") {
    lines.push("<b>Thận trọng: chưa đủ an toàn để ape. Kiểm tra LP/holder/chart trước khi mua.</b>");
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
    ownerActive: false,
    ownerAddress: "",
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
    try {
      const tokenInfo = await fetchBlockscoutToken(token);
      findings.reputation = String(tokenInfo?.reputation || "").toLowerCase();
      totalSupplyRaw = String(tokenInfo?.total_supply || "0");
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
      try {
        owner = normalizeAddress(await tokenContract.owner());
      } catch {
        try {
          owner = normalizeAddress(await tokenContract.getOwner());
        } catch {
          owner = "";
        }
      }
      if (owner && !isDeadOrZeroAddress(owner)) {
        findings.ownerActive = true;
        findings.ownerAddress = owner;
      }
    } catch {
      // ignore
    }

    let probeAmount = 0n;
    let holders = [];
    try {
      holders = await fetchTokenHolders(token);
      const excluded = [
        pairAddress,
        ...pairs.map((item) => normalizeAddress(item.pairAddress)),
        token,
        quoteToken,
        config.swapRouterAddress,
      ];
      const concentration = analyzeHolderConcentration(holders, totalSupplyRaw, excluded);
      findings.holderScore = concentration.score;
      findings.holderWarnings = concentration.warnings;

      const probe = pickProbeHolder(holders, excluded);
      if (probe) {
        probeAmount = probe.raw / 1000n || 1n;
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
  return normalizeAddress(state.portfolioWallet || config.walletAddress || "");
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
  let skipped = 0;

  for (const item of parsed) {
    const pair = bestByToken.get(item.address);
    const priceUsd = Number(pair?.priceUsd);
    const liquidityUsd = Number(pair?.liquidity?.usd);
    const valueUsd = Number.isFinite(priceUsd) ? item.amount * priceUsd : NaN;
    const enriched = {
      ...item,
      priceUsd,
      liquidityUsd,
      valueUsd,
      pairAddress: normalizeAddress(pair?.pairAddress || ""),
      pairUrl: pair?.url || (pair?.pairAddress ? `https://dexscreener.com/robinhood/${pair.pairAddress}` : ""),
    };

    if (isTradeablePortfolioItem(enriched, filterOptions)) {
      tradeable.push(enriched);
    } else {
      skipped += 1;
    }
  }

  tradeable.sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0));
  const items = tradeable.slice(0, maxTokens);
  const totalUsd = items.reduce((sum, item) => sum + (Number(item.valueUsd) || 0), 0);

  return {
    items,
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

function portfolioPanelText(portfolio) {
  if (!portfolio?.wallet) {
    return [
      `<b>Portfolio</b>`,
      "Chưa có ví. Gửi lệnh:",
      "<code>/wallet 0xYourAddress</code>",
      "Hoặc paste địa chỉ ví của bạn.",
    ].join("\n");
  }

  const lines = [
    `<b>Portfolio</b>`,
    `Wallet: <code>${escapeHtml(compactAddress(portfolio.wallet))}</code>`,
    `Total: <b>${escapeHtml(formatUsd(portfolio.totalUsd))}</b>`,
    `Tradeable: <b>${portfolio.items.length}</b> | Hidden junk: <b>${portfolio.skipped}</b>`,
    `Min value: <b>${escapeHtml(formatUsd(config.minPortfolioValueUsd))}</b> | Min liquidity: <b>${escapeHtml(formatUsd(config.minPortfolioLiquidityUsd))}</b>`,
    "",
  ];

  if (!portfolio.items.length) {
    lines.push(`Không còn token nào có balance ≥ ${escapeHtml(formatUsd(config.minPortfolioValueUsd))} và thanh khoản hợp lệ.`);
  } else {
    for (const item of portfolio.items) {
      const chart = item.pairUrl ? ` <a href="${escapeHtml(item.pairUrl)}">chart</a>` : "";
      lines.push(
        `<b>${escapeHtml(item.symbol)}</b> ${escapeHtml(formatTokenAmount(item.amount))} · ${escapeHtml(formatPriceUsd(item.priceUsd))} · <b>${escapeHtml(formatUsd(item.valueUsd))}</b>${chart}`,
      );
    }
  }

  lines.push("", "<i>Bấm Update Price để quét lại ví và bỏ token rác / hết thanh khoản.</i>");
  return lines.join("\n");
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
      [{ text: "Buy & Sell", callback_data: "panel:trade" }],
      [
        { text: "Add LP", callback_data: "panel:lp" },
        { text: "My LP", callback_data: "panel:mylp" },
      ],
      [
        { text: "Portfolio", callback_data: "panel:portfolio" },
        { text: "Update Price", callback_data: "portfolio:refresh" },
      ],
      [
        { text: "Profile", callback_data: "panel:profile" },
        { text: "Wallets", callback_data: "panel:wallets" },
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

async function sendMainMenu(chatId = config.telegramChatId) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text: await mainPanelText(),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: mainMenuKeyboard(),
  });
}

async function showPortfolio(chatId, state, { editCallback = null, announce = false } = {}) {
  const wallet = getPortfolioWallet(state);
  if (!wallet) {
    const text = portfolioPanelText(null);
    if (editCallback) {
      await editTradeMessage(editCallback, text, portfolioKeyboard());
      return null;
    }
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      reply_markup: portfolioKeyboard(),
    });
    return null;
  }

  if (announce) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Đang cập nhật giá portfolio cho:\n<code>${escapeHtml(wallet)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
  }

  try {
    const portfolio = await buildPortfolio(wallet);
    state.portfolioWallet = wallet;
    state.portfolioCache = {
      totalUsd: portfolio.totalUsd,
      count: portfolio.items.length,
      skipped: portfolio.skipped,
      updatedAt: portfolio.updatedAt,
    };
    saveState(state);

    const text = portfolioPanelText(portfolio);
    if (editCallback) {
      await editTradeMessage(editCallback, text, portfolioKeyboard());
    } else {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: "true",
        reply_markup: portfolioKeyboard(),
      });
    }
    return portfolio;
  } catch (error) {
    const text = [
      `<b>Portfolio</b>`,
      `Wallet: <code>${escapeHtml(compactAddress(wallet))}</code>`,
      `Không lấy được giá lúc này: ${escapeHtml(error.message)}`,
      "Thử lại bằng nút Update Price.",
    ].join("\n");
    if (editCallback) {
      await editTradeMessage(editCallback, text, portfolioKeyboard());
    } else {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: "true",
        reply_markup: portfolioKeyboard(),
      });
    }
    return null;
  }
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

  let honeypotReport = null;
  try {
    honeypotReport = await checkTokenHoneypot(tokenAddress, pair, pairs);
  } catch (error) {
    console.warn(`Honeypot check failed for ${tokenAddress}: ${error.message}`);
  }

  try {
    await prepareLpFromToken(tokenAddress, state);
  } catch (error) {
    console.warn(`LP pool prepare failed for ${tokenAddress}: ${error.message}`);
  }

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      `<b>Now tracking ${escapeHtml(trackedPair.baseSymbol)}</b>`,
      `Pair: <code>${escapeHtml(compactAddress(trackedPair.pairAddress))}</code>`,
      `Quote: <b>${escapeHtml(trackedPair.quoteSymbol)}</b>`,
      `Alert min: <b>${config.minQuoteAmount} ${escapeHtml(trackedPair.quoteSymbol)}</b>`,
      `<a href="${escapeHtml(trackedPair.pairUrl)}">Dexscreener</a>`,
      "",
      formatHoneypotReport(honeypotReport),
      "",
      state.lp?.poolAddress
        ? `LP pool sẵn sàng (fee ${state.lp.fee / 10000}%). Bấm <b>Add LP</b> để chọn range.`
        : "Chưa có Uniswap v3 pool TOKEN/WETH để Add LP.",
    ].join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: "true",
    reply_markup: afterTrackKeyboard(),
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
      [{ text: "➕ Add LP", callback_data: "lp:ranges" }],
      [
        { text: "Buy & Sell", callback_data: "panel:trade" },
        { text: "Portfolio", callback_data: "panel:portfolio" },
      ],
      [{ text: "Main Menu", callback_data: "menu" }],
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

  if (data === "panel:lp") {
    await showLpPanel(callbackQuery, state);
    return;
  }

  if (data === "panel:mylp") {
    await showMyLpPanel(callbackQuery);
    return;
  }

  if (data.startsWith("lp:pos:")) {
    const tokenId = data.slice("lp:pos:".length);
    await showLpPosition(callbackQuery, tokenId);
    return;
  }

  if (data.startsWith("lp:rm:")) {
    const parts = data.split(":");
    const tokenId = parts[2];
    const percent = parts[3];
    await runRemoveLiquidity(callbackQuery, tokenId, percent);
    return;
  }

  if (data.startsWith("lp:rerange:")) {
    const tokenId = data.slice("lp:rerange:".length);
    await startLpRerange(callbackQuery, state, tokenId);
    return;
  }

  if (data === "lp:ranges") {
    await showLpRanges(callbackQuery, state);
    return;
  }

  if (data === "lp:amounts") {
    try {
      const poolState = await fetchLpPoolState(state);
      await editTradeMessage(callbackQuery, lpPanelText(poolState, { step: "amount" }), lpAmountKeyboard());
    } catch (error) {
      await editTradeMessage(callbackQuery, `<b>Add LP</b>\n${escapeHtml(error.message)}`, mainMenuKeyboard());
    }
    return;
  }

  if (data.startsWith("lp:range:")) {
    const percent = data.slice("lp:range:".length);
    await applyLpRange(callbackQuery, state, percent);
    return;
  }

  if (data.startsWith("lp:preview:")) {
    const ethAmount = data.slice("lp:preview:".length);
    await showLpPreview(callbackQuery, state, ethAmount);
    return;
  }

  if (data.startsWith("lp:confirm:")) {
    const ethAmount = data.slice("lp:confirm:".length);
    await runConfirmedAddLiquidity(callbackQuery, state, ethAmount);
    return;
  }

  if (data === "panel:portfolio" || data === "portfolio:refresh") {
    await showPortfolio(chatId, state, { editCallback: callbackQuery });
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
      mainMenuKeyboard(),
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
        "Xem giá: bấm Portfolio hoặc Update Price.",
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
  if (!isAuthorizedChat(chatId)) {
    await notifyUnauthorizedChat(chatId);
    return;
  }

  const text = String(message.text || "").trim();
  console.log(`Telegram message from chat ${chatId}: ${text.slice(0, 80) || "(no text)"}`);
  if (isEvmAddress(text)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Đang kiểm tra pool + honeypot cho:\n<code>${escapeHtml(text)}</code>`,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
    await followTokenAddress(text, state, chatId);
    return;
  }

  const walletMatch = text.match(/^\/wallet(?:@\w+)?\s+(0x[a-fA-F0-9]{40})$/i);
  if (walletMatch) {
    await setPortfolioWallet(walletMatch[1], state, chatId);
    return;
  }

  if (text === "/start" || text === "/menu") {
    await sendMainMenu(chatId);
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

  if (text === "/lp" || text.startsWith("/lp@")) {
    try {
      if (!state.lp?.tokenAddress && state.trackedPair?.baseTokenAddress) {
        await prepareLpFromToken(state.trackedPair.baseTokenAddress, state);
      }
      if (!state.lp?.tokenAddress) {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: [
            `<b>Add Liquidity</b>`,
            "Paste contract token vào chat.",
            "Flow: đọc pool → chọn range → chọn ETH → Confirm.",
          ].join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: "true",
          reply_markup: mainMenuKeyboard(),
        });
        return;
      }
      const poolState = await fetchLpPoolState(state);
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: lpPanelText(poolState, { step: "range" }),
        parse_mode: "HTML",
        disable_web_page_preview: "true",
        reply_markup: lpRangeKeyboard(),
      });
    } catch (error) {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: `<b>Add LP</b>\n${escapeHtml(error.message)}`,
        parse_mode: "HTML",
        disable_web_page_preview: "true",
        reply_markup: mainMenuKeyboard(),
      });
    }
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
    timeout: 25,
    allowed_updates: ["message", "callback_query"],
  });
  const updates = payload.result || [];
  if (updates.length > 0) {
    console.log(`Received ${updates.length} Telegram update(s).`);
  }

  for (const update of updates) {
    state.telegramOffset = update.update_id + 1;
    try {
      if (update.message) await handleTelegramMessage(update.message, state);
      if (update.callback_query) await handleCallbackQuery(update.callback_query, state);
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
  try {
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
  } catch (error) {
    if (!state.seen) state.seen = [];
    saveState(state);
    console.warn(`Blockscout unavailable during boot: ${error.message}`);
    console.warn("Telegram commands still work. Swap alerts will resume when Blockscout responds.");
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
  while (true) {
    try {
      await processTelegramUpdates(state);
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

    try {
      const groups = groupTransfers(await fetchTokenTransfers());
      await handleNewGroups(groups, state);
    } catch (error) {
      const now = Date.now();
      if (isTransientHttpError(error)) {
        if (now - lastBlockscoutWarnAt > 60_000) {
          console.warn(`Blockscout temporarily unavailable: ${error.message || error}`);
          console.warn("Telegram commands still work; swap alerts paused until Blockscout recovers.");
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
  buildLpPreview,
  buildPortfolioFromBalances,
  classifyFromTransaction,
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
  mainPanelText,
  chooseBestPairForToken,
  parseTelegramChatIds,
  parseWalletBalanceEntry,
  pickProbeHolder,
  portfolioKeyboard,
  portfolioPanelText,
  scoreHoneypotFindings,
  shouldTradeImmediately,
  sniperTradeKeyboard,
  sortUniswapTokens,
  staticMainPanelText,
  trackedPairFromDexPair,
  tradePanelText,
  tradeMessage,
};
