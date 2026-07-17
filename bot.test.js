const test = require("node:test");
const assert = require("node:assert/strict");

const bot = require("./bot");

function addr(value) {
  return { hash: value };
}

function transfer(token, src, dst, value, rate = undefined) {
  return {
    from: addr(src),
    to: addr(dst),
    token: {
      address_hash: token,
      exchange_rate: rate,
    },
    total: {
      value,
      decimals: "18",
    },
  };
}

test("base token into pool is SELL in tracked-token mode", () => {
  const tx = {
    hash: "0xabc",
    block_number: 1,
    timestamp: "2026-07-10T09:06:39Z",
    from: addr("0xuser"),
    token_transfers: [
      transfer(bot.config.quoteTokenAddress, bot.config.pairAddress, "0xrouter", "223469152225537637", "1783.74"),
      transfer(bot.config.baseTokenAddress, "0xuser", bot.config.pairAddress, "159635170801097973424246", "0.00258716"),
    ],
  };

  const trade = bot.classifyFromTransaction(tx, { buyWhenBaseLeavesPool: true, minQuoteAmount: 0 });

  assert.equal(trade.side, "SELL");
  assert.equal(bot.formatUnits(trade.baseRaw, trade.baseDecimals, 4), "159635.1708");
});

test("base token out of pool is BUY in tracked-token mode", () => {
  const tx = {
    hash: "0xdef",
    block_number: 2,
    timestamp: "2026-07-10T09:07:10Z",
    from: addr("0xuser"),
    token_transfers: [
      transfer(bot.config.baseTokenAddress, bot.config.pairAddress, "0xrouter", "173170569820669593642374", "0.00258716"),
      transfer(bot.config.quoteTokenAddress, "0xrouter", bot.config.pairAddress, "247500000000000000", "1783.74"),
    ],
  };

  const trade = bot.classifyFromTransaction(tx, { buyWhenBaseLeavesPool: true, minQuoteAmount: 0 });

  assert.equal(trade.side, "BUY");
  assert.equal(bot.formatUnits(trade.quoteRaw, trade.quoteDecimals, 6), "0.2475");
});

test("tracked-token buy/sell mode works for any token address", () => {
  const pairAddress = "0x9999999999999999999999999999999999999999";
  const trackedToken = "0x1111111111111111111111111111111111111111";
  const quoteToken = "0x2222222222222222222222222222222222222222";
  const sellTx = {
    hash: "0xanysell",
    block_number: 10,
    timestamp: "2026-07-10T09:10:00Z",
    from: addr("0xuser"),
    token_transfers: [
      transfer(trackedToken, "0xuser", pairAddress, "100000000000000000000", "0.01"),
      transfer(quoteToken, pairAddress, "0xrouter", "1000000000000000000", "1783.74"),
    ],
  };
  const buyTx = {
    ...sellTx,
    hash: "0xanybuy",
    token_transfers: [
      transfer(trackedToken, pairAddress, "0xuser", "100000000000000000000", "0.01"),
      transfer(quoteToken, "0xrouter", pairAddress, "1000000000000000000", "1783.74"),
    ],
  };
  const settings = {
    pairAddress,
    baseTokenAddress: trackedToken,
    quoteTokenAddress: quoteToken,
    buyWhenBaseLeavesPool: true,
    minQuoteAmount: 0,
  };

  assert.equal(bot.classifyFromTransaction(sellTx, settings).side, "SELL");
  assert.equal(bot.classifyFromTransaction(buyTx, settings).side, "BUY");
});

test("pasted token becomes tracked token even when it is quote side of pair", () => {
  const pastedToken = "0x3333333333333333333333333333333333333333";
  const weth = "0x4444444444444444444444444444444444444444";
  const pair = {
    pairAddress: "0x5555555555555555555555555555555555555555",
    url: "https://dexscreener.com/robinhood/0x5555555555555555555555555555555555555555",
    baseToken: { address: weth, symbol: "WETH" },
    quoteToken: { address: pastedToken, symbol: "ANY" },
  };

  const tracked = bot.trackedPairFromDexPair(pair, pastedToken);

  assert.equal(tracked.baseTokenAddress, pastedToken);
  assert.equal(tracked.baseSymbol, "ANY");
  assert.equal(tracked.quoteTokenAddress, weth);
  assert.equal(tracked.quoteSymbol, "WETH");
});

test("sniper keyboard exposes buy amounts and sell percents", () => {
  const keyboard = bot.sniperTradeKeyboard();
  const buttons = keyboard.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);
  const callbacks = buttons.map((button) => button.callback_data).filter(Boolean);
  const sellRow = keyboard.inline_keyboard.find((row) =>
    row.some((button) => button.callback_data === "qtrade:SELL:ALL"),
  );

  assert(labels.includes(`Buy ${bot.config.buyAmountsQuote[0]}`));
  assert(labels.includes("25%"));
  assert(labels.includes("50%"));
  assert(labels.includes("70%"));
  assert(labels.includes(`All ${bot.config.baseSymbol}`));
  assert.ok(sellRow && sellRow.length === 4, "Sell percents + All should share one row");
  assert(callbacks.includes(`qtrade:BUY:${bot.config.buyAmountsQuote[0]}`));
  assert(callbacks.includes("qtrade:SELL:25%"));
  assert(callbacks.includes("qtrade:SELL:50%"));
  assert(callbacks.includes("qtrade:SELL:70%"));
  assert(callbacks.includes("qtrade:SELL:ALL"));
});

test("slippage default is two percent", () => {
  assert.equal(bot.config.slippageBps, 200);
});

test("all trades execute immediately on button tap", () => {
  assert.equal(bot.shouldTradeImmediately("SELL", "ALL"), true);
  assert.equal(bot.shouldTradeImmediately("SELL", "25%"), true);
  assert.equal(bot.shouldTradeImmediately("BUY", "0.01"), true);
});

test("buy amount parser accepts positive decimals", () => {
  assert.equal(bot.parseBuyAmountText("0.15"), "0.15");
  assert.equal(bot.parseBuyAmountText("1"), "1");
  assert.equal(bot.parseBuyAmountText("0"), null);
  assert.equal(bot.parseBuyAmountText("-1"), null);
  assert.equal(bot.parseBuyAmountText("abc"), null);
});

test("quick trade callbacks validate buy and sell amounts", () => {
  assert.deepEqual(bot.parseQuickTradeCallback("qtrade:BUY:0.2"), { side: "BUY", amount: "0.2" });
  assert.deepEqual(bot.parseQuickTradeCallback("qtrade:SELL:25%"), { side: "SELL", amount: "25%" });
  assert.deepEqual(bot.parseQuickTradeCallback("qtrade:SELL:ALL"), { side: "SELL", amount: "ALL" });
  assert.equal(bot.parseQuickTradeCallback("qtrade:SELL:bad"), null);
  assert.equal(bot.parseQuickTradeCallback("qtrade:HACK:0.2"), null);
  assert.equal(bot.parseQuickTradeCallback("menu"), null);
});

test("sell percent parser and balance math", () => {
  assert.equal(bot.parseSellPercent("25%"), 25);
  assert.equal(bot.parseSellPercent("ALL"), 100);
  assert.equal(bot.parseSellPercent("100%"), 100);
  assert.equal(bot.parseSellPercent("0.01"), null);
  assert.equal(bot.balancePercent(1000n, 25), 250n);
  assert.equal(bot.balancePercent(1000n, 100), 1000n);
});

test("trade USD enrichment prefers Dexscreener spot price", () => {
  const trade = {
    side: "BUY",
    quoteAmount: 7.5,
    baseAmount: 83073.3186,
    quoteUsdValue: Number.NaN,
    priceUsd: Number.NaN,
  };
  const priced = bot.applyTradeUsd(trade, { priceUsd: 0.1597, ethUsd: 1784 });
  assert.equal(priced.priceUsd, 0.1597);
  assert.ok(Math.abs(priced.quoteUsdValue - 7.5 * 1784) < 0.01);

  const fallback = bot.applyTradeUsd(trade, { priceUsd: Number.NaN, ethUsd: 1784 });
  assert.ok(Math.abs(fallback.priceUsd - (7.5 * 1784) / 83073.3186) < 0.001);
});

test("trade alert labels distinguish buy and sell", () => {
  const buy = bot.tradeMessage({
    side: "BUY",
    txHash: "0xabc",
    baseRaw: 1000n * 10n ** 18n,
    quoteRaw: 2n * 10n ** 18n,
    baseDecimals: 18,
    quoteDecimals: 18,
    quoteUsdValue: 3000,
    priceUsd: 0.003,
    trader: "0x1111111111111111111111111111111111111111",
    blockNumber: 1,
  });
  const sell = bot.tradeMessage({
    side: "SELL",
    txHash: "0xdef",
    baseRaw: 1000n * 10n ** 18n,
    quoteRaw: 2n * 10n ** 18n,
    baseDecimals: 18,
    quoteDecimals: 18,
    quoteUsdValue: 3000,
    priceUsd: 0.003,
    trader: "0x1111111111111111111111111111111111111111",
    blockNumber: 2,
  });
  assert.ok(buy.includes("🟢 BUY"));
  assert.ok(sell.includes("🔴 SELL"));
  assert.equal(buy.includes("🔴"), false);
  assert.equal(sell.includes("🟢"), false);
});

test("stale trades are not considered fresh for alerts", () => {
  const now = Date.parse("2026-07-13T14:27:00+07:00");
  const fresh = { timestamp: "2026-07-13T14:26:30+07:00" };
  const stale = { timestamp: "2026-07-13T14:20:00+07:00" };
  assert.equal(bot.isFreshTrade(fresh, now, 90_000), true);
  assert.equal(bot.isFreshTrade(stale, now, 90_000), false);
});

test("v3 swap log decoder flags 2 ETH buy", () => {
  const weth = bot.config.quoteTokenAddress;
  const token = "0xd7321801caae694090694ff55a9323139f043b88";
  const trade = bot.tradeFromV3SwapLog({
    amount0: 2n * 10n ** 18n, // pool received 2 WETH
    amount1: -(1000n * 10n ** 18n),
    token0: weth,
    token1: token,
    quoteToken: weth,
    baseToken: token,
    txHash: "0xabc",
    blockNumber: 1,
    timestampMs: Date.now(),
    recipient: "0x1111111111111111111111111111111111111111",
  });
  assert.ok(trade);
  assert.equal(trade.side, "BUY");
  assert.equal(trade.quoteAmount, 2);
});

test("main menu looks like a trading dashboard", () => {
  const keyboard = bot.mainMenuKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  const text = bot.staticMainPanelText();

  assert(text.includes(bot.config.botTitle));
  assert(text.includes("Portfolio"));
  assert(text.includes("Total USD"));
  assert(labels.includes(`Buy ${bot.config.buyAmountsQuote[0]}`));
  assert(labels.includes("25%"));
  assert(labels.includes("50%"));
  assert(labels.includes("70%"));
  assert(labels.includes(`All ${bot.config.baseSymbol}`));
  assert(labels.includes("Buy custom"));
  assert(callbacks.includes("buy:custom"));
  assert(callbacks.includes("qtrade:SELL:ALL"));
  assert(labels.includes("Chart"));
  assert(labels.includes("Update Price"));
  assert(callbacks.includes("portfolio:refresh"));
  assert.equal(labels.includes("Tools"), false);
  assert.equal(labels.includes("Buy & Sell"), false);
  assert.equal(labels.includes("Honeypot"), false);
  assert.equal(labels.includes("Add LP"), false);
  assert.equal(labels.includes("My LP"), false);
  assert.equal(labels.includes("Profile"), false);
  assert.equal(labels.includes("Wallets"), false);
  assert.equal(labels.includes("Sniper"), false);
  assert.equal(labels.includes("Limit Orders"), false);
  assert.equal(labels.includes("Trades"), false);
});

test("main menu bag buttons open sell panel without changing sniper labels", () => {
  const repe = "0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7";
  const cash = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
  const portfolio = {
    items: [],
    bagItems: [
      { address: repe, symbol: "REPE", valueUsd: 12.5, pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { address: cash, symbol: "CASHCAT", valueUsd: 40, pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    ],
  };
  const keyboard = bot.mainMenuKeyboard(portfolio);
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);

  assert(labels.includes(`All ${bot.config.baseSymbol}`));
  assert(labels.some((label) => label.startsWith("REPE ")));
  assert(labels.some((label) => label.startsWith("CASHCAT ")));
  assert(callbacks.includes(`bag:${repe}`));
  assert(callbacks.includes(`bag:${cash}`));

  const bagKeyboard = bot.bagSellKeyboard(portfolio.bagItems[0]);
  const bagLabels = bagKeyboard.inline_keyboard.flat().map((button) => button.text);
  const bagCallbacks = bagKeyboard.inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  assert(bagLabels.includes("25%"));
  assert(bagLabels.includes("All"));
  assert(bagCallbacks.includes(`bagsell:${repe}:25%`));
  assert(bagCallbacks.includes(`bagsell:${repe}:ALL`));
  assert(bagCallbacks.includes(`bagtrack:${repe}`));
  assert.equal(bot.formatBagButtonLabel(portfolio.bagItems[0]), "REPE $12.50");
});

test("expired Telegram callback errors are recognized", () => {
  const error = new Error(
    'HTTP 400 Bad Request: {"ok":false,"description":"Bad Request: query is too old and response timeout expired or query ID is invalid"}',
  );

  assert.equal(bot.isExpiredCallbackError(error), true);
});

test("Telegram message-not-modified errors are recognized", () => {
  const error = new Error(
    'HTTP 400 Bad Request: {"ok":false,"description":"Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message"}',
  );

  assert.equal(bot.isMessageNotModifiedError(error), true);
});

test("Telegram polling conflict errors are recognized", () => {
  const error = new Error(
    'HTTP 409 Conflict: {"ok":false,"error_code":409,"description":"Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"}',
  );

  assert.equal(bot.isPollingConflictError(error), true);
});

test("transient Telegram network errors are retryable", () => {
  const fetchFailed = new Error("fetch failed");
  fetchFailed.cause = { code: "ECONNRESET", message: "read ECONNRESET" };
  assert.equal(bot.isRetryableFetchError(fetchFailed), true);
  assert.equal(bot.isRetryableFetchError(new Error("Request timed out after 25000ms: https://api.telegram.org")), true);
  assert.equal(bot.isRetryableFetchError(Object.assign(new Error("HTTP 429 Too Many Requests"), { status: 429 })), true);
  assert.equal(bot.isRetryableFetchError(new Error("HTTP 400 Bad Request: chat not found")), false);
});

test("swap error formatter softens network and busy messages", () => {
  assert.match(bot.formatSwapError(new Error("fetch failed")), /Mạng\/RPC/i);
  assert.match(bot.formatSwapError(new Error("Trade đang chạy. Đợi xong rồi bấm lại (tránh double-send).")), /Trade đang chạy/);
  assert.match(bot.formatSwapError(new Error("nonce too low")), /Nonce/i);
});

test("gas shortage is not mislabeled as slippage", () => {
  const gasErr = new Error(
    "Không đủ ETH gas để SELL. Cần ~0.0001 ETH, còn 0.000818069059511026 ETH. Nạp thêm ETH rồi Sell lại.",
  );
  const formatted = bot.formatSwapError(gasErr);
  assert.match(formatted, /Không đủ ETH gas/i);
  assert.equal(/slippage/i.test(formatted), false);

  // Legacy English gas message must also stay clear (old bug: /AS/ matched inside "gas").
  const legacy = bot.formatSwapError(
    new Error("Not enough ETH for gas (SELL). Need ~0.001 ETH, have 0.000818069059511026 ETH."),
  );
  assert.match(legacy, /Not enough ETH for gas/i);
  assert.equal(/slippage/i.test(legacy), false);

  assert.match(bot.formatSwapError(new Error("Too little received")), /Slippage/i);
});

test("tracking multiple tokens keeps max 3 and unions watched pools", () => {
  const prevTracked = bot.config.trackedPairs;
  const state = {};
  const mk = (n) => ({
    pairAddress: `0x${String(n).repeat(40).slice(0, 40)}`,
    pairUrl: `https://dexscreener.com/robinhood/pair${n}`,
    baseTokenAddress: `0x${String(n + 4).repeat(40).slice(0, 40)}`,
    baseSymbol: `TK${n}`,
    quoteTokenAddress: bot.config.quoteTokenAddress,
    quoteSymbol: "WETH",
    watchPairAddresses: [`0x${String(n).repeat(40).slice(0, 40)}`],
  });

  bot.upsertTrackedPair(state, mk(1));
  bot.upsertTrackedPair(state, mk(2));
  bot.upsertTrackedPair(state, mk(3));
  assert.equal(state.trackedPairs.length, 3);

  // 4th token evicts the oldest (TK1).
  bot.upsertTrackedPair(state, mk(4));
  assert.equal(state.trackedPairs.length, 3);
  assert.equal(state.trackedPairs.some((entry) => entry.baseSymbol === "TK1"), false);
  assert.equal(state.trackedPairs[0].baseSymbol, "TK4");

  // Re-pasting an existing token moves it to front without duplicating.
  bot.upsertTrackedPair(state, mk(2));
  assert.equal(state.trackedPairs.length, 3);
  assert.equal(state.trackedPairs[0].baseSymbol, "TK2");

  // Watched pools = union of all tracked tokens' pools.
  const watched = bot.watchedPairSet();
  for (const entry of state.trackedPairs) {
    assert.equal(watched.has(entry.pairAddress), true);
  }

  // Pool meta resolves back to the right tracked token.
  const entry3 = state.trackedPairs.find((item) => item.baseSymbol === "TK3");
  const found = bot.findTrackedForPool({
    token0: entry3.baseTokenAddress,
    token1: entry3.quoteTokenAddress,
  });
  assert.equal(found.baseSymbol, "TK3");

  bot.config.trackedPairs = prevTracked;
});

test("authorized chat IDs support comma-separated values", () => {
  const ids = bot.parseTelegramChatIds("123456789, -1001234567890");
  assert.deepEqual(ids, ["123456789", "-1001234567890"]);
  assert.equal(bot.isAuthorizedChat("123456789"), false);

  const original = bot.config.telegramChatIds;
  bot.config.telegramChatIds = ids;
  assert.equal(bot.isAuthorizedChat("123456789"), true);
  assert.equal(bot.isAuthorizedChat("-1001234567890"), true);
  assert.equal(bot.isAuthorizedChat("999"), false);
  bot.config.telegramChatIds = original;
});

test("EVM token address input is recognized", () => {
  assert.equal(bot.isEvmAddress("0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7"), true);
  assert.equal(bot.isEvmAddress("hello"), false);
});

test("best pair selection prefers WETH quote and highest liquidity", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const weth = bot.config.quoteTokenAddress;
  const pairs = [
    {
      chainId: "robinhood",
      pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseToken: { address: token, symbol: "AAA" },
      quoteToken: { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", symbol: "USDC" },
      liquidity: { usd: 1000000 },
    },
    {
      chainId: "robinhood",
      pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      baseToken: { address: token, symbol: "AAA" },
      quoteToken: { address: weth, symbol: "WETH" },
      liquidity: { usd: 100 },
    },
  ];

  const pair = bot.chooseBestPairForToken(pairs, token);

  assert.equal(pair.pairAddress, "0xcccccccccccccccccccccccccccccccccccccccc");
});

test("trade smaller than minimum quote amount is ignored", () => {
  const tx = {
    hash: "0xsmall",
    block_number: 3,
    timestamp: "2026-07-10T09:08:00Z",
    from: addr("0xuser"),
    token_transfers: [
      transfer(bot.config.baseTokenAddress, "0xuser", bot.config.pairAddress, "1000000000000000000000", "0.002"),
      transfer(bot.config.quoteTokenAddress, bot.config.pairAddress, "0xrouter", "500000000000000000", "1783.74"),
    ],
  };

  const trade = bot.classifyFromTransaction(tx, { buyWhenBaseLeavesPool: true, minQuoteAmount: 2 });

  assert.equal(trade, null);
});

test("near-threshold 1 ETH buy is still alerted", () => {
  const tx = {
    hash: "0xnear1",
    block_number: 4,
    timestamp: "2026-07-10T09:09:00Z",
    from: addr("0xuser"),
    token_transfers: [
      transfer(bot.config.baseTokenAddress, bot.config.pairAddress, "0xuser", "1000000000000000000000", "0.002"),
      transfer(bot.config.quoteTokenAddress, "0xuser", bot.config.pairAddress, "990000000000000000", "3000"),
    ],
  };

  const trade = bot.classifyFromTransaction(tx, { buyWhenBaseLeavesPool: true, minQuoteAmount: 1 });
  assert.ok(trade);
  assert.equal(trade.side, "BUY");
  assert.ok(trade.quoteAmount >= 0.95);
});

test("watch pair list keeps primary and extra WETH pools", () => {
  const token = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
  const watched = bot.chooseWatchPairAddresses(
    [
      {
        chainId: "robinhood",
        pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        liquidity: { usd: 100000 },
        labels: ["v3"],
        baseToken: { address: token, symbol: "CASHCAT" },
        quoteToken: { address: bot.config.quoteTokenAddress, symbol: "WETH" },
      },
      {
        chainId: "robinhood",
        pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        liquidity: { usd: 400000 },
        labels: ["v3"],
        baseToken: { address: token, symbol: "CASHCAT" },
        quoteToken: { address: bot.config.quoteTokenAddress, symbol: "WETH" },
      },
      {
        chainId: "robinhood",
        pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        liquidity: { usd: 800000 },
        labels: ["v4"],
        baseToken: { address: token, symbol: "CASHCAT" },
        quoteToken: { address: "0x1111111111111111111111111111111111111111", symbol: "USDG" },
      },
    ],
    token,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.ok(watched.includes("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.ok(watched.includes("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
  assert.equal(watched.some((item) => item.startsWith("0xccc")), false);
});

test("portfolio keeps liquid tokens and hides junk", () => {
  const goodToken = "0x1111111111111111111111111111111111111111";
  const junkToken = "0x2222222222222222222222222222222222222222";
  const dustyToken = "0x3333333333333333333333333333333333333333";
  const balances = [
    {
      value: "1000000000000000000000",
      token: { address_hash: goodToken, symbol: "GOOD", decimals: "18", type: "ERC-20" },
    },
    {
      value: "5000000000000000000000",
      token: { address_hash: junkToken, symbol: "SCAM", decimals: "18", type: "ERC-20" },
    },
    {
      value: "45000000000000000000",
      token: { address_hash: dustyToken, symbol: "DUST", decimals: "18", type: "ERC-20" },
    },
  ];
  const pairs = [
    {
      chainId: "robinhood",
      pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      url: "https://dexscreener.com/robinhood/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseToken: { address: goodToken, symbol: "GOOD" },
      quoteToken: { address: bot.config.quoteTokenAddress, symbol: "WETH" },
      priceUsd: "0.01",
      liquidity: { usd: 250 },
    },
    {
      chainId: "robinhood",
      pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      baseToken: { address: junkToken, symbol: "SCAM" },
      quoteToken: { address: bot.config.quoteTokenAddress, symbol: "WETH" },
      priceUsd: "0.02",
      liquidity: { usd: 5 },
    },
    {
      chainId: "robinhood",
      pairAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      baseToken: { address: dustyToken, symbol: "DUST" },
      quoteToken: { address: bot.config.quoteTokenAddress, symbol: "WETH" },
      priceUsd: "0.001",
      liquidity: { usd: 500 },
    },
  ];

  const portfolio = bot.buildPortfolioFromBalances(balances, pairs, {
    minLiquidityUsd: 50,
    minValueUsd: 3,
    maxTokens: 10,
  });

  assert.equal(portfolio.items.length, 1);
  assert.equal(portfolio.items[0].symbol, "GOOD");
  assert.equal(portfolio.skipped, 2);
  assert.ok(portfolio.totalUsd > 0);
  assert.equal(bot.isTradeablePortfolioItem(portfolio.items[0], { minLiquidityUsd: 50, minValueUsd: 3 }), true);
  assert.ok(Array.isArray(portfolio.bagItems));
  assert.ok(portfolio.bagItems.some((item) => item.symbol === "GOOD"));
  assert.ok(portfolio.bagItems.some((item) => item.symbol === "SCAM"));
  assert.equal(portfolio.items[0].raw, undefined);
});

test("portfolio keyboard exposes Update Price", () => {
  const keyboard = bot.portfolioKeyboard();
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, "portfolio:refresh");
  assert.ok(
    bot.mainMenuKeyboard().inline_keyboard.flat().some((button) => button.callback_data === "portfolio:refresh"),
  );
});

test("portfolio wallet prefers state over config", () => {
  const original = bot.config.walletAddress;
  bot.config.walletAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(bot.getPortfolioWallet({}), "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(
    bot.getPortfolioWallet({ portfolioWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  bot.config.walletAddress = original;
});
