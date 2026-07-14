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

test("sell all trades immediately even when one-tap mode is off", () => {
  assert.equal(bot.config.oneTapTrade, false);
  assert.equal(bot.shouldTradeImmediately("SELL", "ALL"), true);
  assert.equal(bot.shouldTradeImmediately("SELL", "25%"), true);
  assert.equal(bot.shouldTradeImmediately("BUY", "0.01"), true);
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
  assert(labels.includes(`Buy ${bot.config.buyAmountsQuote[0]}`));
  assert(labels.includes("25%"));
  assert(labels.includes("50%"));
  assert(labels.includes("70%"));
  assert(labels.includes(`All ${bot.config.baseSymbol}`));
  assert(callbacks.includes("qtrade:SELL:ALL"));
  assert(labels.includes("Tools"));
  assert(labels.includes("Chart"));
  assert.equal(labels.includes("Update Price"), false);
  assert.equal(callbacks.includes("portfolio:refresh"), false);
  assert.equal(labels.includes("Buy & Sell"), false);
  assert.equal(labels.includes("Portfolio"), false);
  assert.equal(labels.includes("Honeypot"), false);
  assert.equal(labels.includes("Add LP"), false);
  assert.equal(labels.includes("My LP"), false);
  assert.equal(labels.includes("Profile"), false);
  assert.equal(labels.includes("Wallets"), false);
  assert.equal(labels.includes("Sniper"), false);
  assert.equal(labels.includes("Limit Orders"), false);
  assert.equal(labels.includes("Trades"), false);

  const tools = bot.toolsKeyboard().inline_keyboard.flat().map((button) => button.text);
  const toolCallbacks = bot.toolsKeyboard().inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  assert.equal(tools.includes("Honeypot"), false);
  assert.equal(tools.includes("Add LP"), false);
  assert.equal(tools.includes("My LP"), false);
  assert(tools.includes("Update Price"));
  assert(tools.includes("Profile"));
  assert(tools.includes("Wallets"));
  assert(toolCallbacks.includes("portfolio:refresh"));
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
  assert.equal(
    bot.mainMenuKeyboard().inline_keyboard.flat().some((button) => button.callback_data === "portfolio:refresh"),
    false,
  );
  assert.ok(
    bot.toolsKeyboard().inline_keyboard.flat().some((button) => button.callback_data === "portfolio:refresh"),
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

test("honeypot scorer marks failed transfer as DANGER", () => {
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: false,
    transferError: "transfer restricted",
    quoteOk: false,
    quoteError: "no route",
    marketScore: 0,
    marketWarnings: [],
  });

  assert.equal(report.verdict, "DANGER");
  assert.ok(report.score >= 60);
});

test("honeypot scorer keeps healthy token SAFE", () => {
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: 0,
    marketWarnings: [],
    holderScore: 0,
    holderWarnings: [],
    contractScore: 0,
    contractWarnings: [],
  });

  assert.equal(report.verdict, "SAFE");
});

test("dex market risk flags buy-only honeypot pattern", () => {
  const risk = bot.analyzeDexMarketRisk({
    liquidity: { usd: 1000 },
    volume: { h24: 5000 },
    txns: { h24: { buys: 80, sells: 0 } },
  });

  assert.ok(risk.score >= 45);
  assert.ok(risk.warnings.some((item) => item.toLowerCase().includes("honeypot")));
});

test("dex market risk flags extreme pump and thin LP vs FDV", () => {
  const risk = bot.analyzeDexMarketRisk({
    liquidity: { usd: 1700 },
    volume: { h24: 2100 },
    fdv: 64000,
    marketCap: 64000,
    priceChange: { h1: 5, h6: 20, h24: 8569 },
    txns: { h24: { buys: 8, sells: 13 } },
    labels: ["v4"],
    boosts: { active: 1000 },
    pairCreatedAt: Date.now() - 3 * 3600_000,
    info: { websites: [], socials: [{ url: "https://t.me/x", type: "telegram" }] },
  });

  assert.ok(risk.score >= 55);
  assert.ok(risk.warnings.some((item) => item.toLowerCase().includes("pump")));
});

test("WSB-like multi-pool profile is not treated as SAFE", () => {
  const market = bot.analyzePairsMarketRisk([
    {
      pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      liquidity: { usd: 47000 },
      volume: { h24: 680000 },
      fdv: 220000,
      priceChange: { h24: 8569 },
      txns: { h24: { buys: 5000, sells: 3000 } },
      labels: ["v3"],
      quoteToken: { symbol: "WETH" },
      boosts: { active: 1000 },
      info: { websites: [] },
    },
    {
      pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      liquidity: { usd: 1700 },
      volume: { h24: 2100 },
      fdv: 64000,
      priceChange: { h24: 167 },
      txns: { h24: { buys: 8, sells: 13 } },
      labels: ["v4"],
      quoteToken: { symbol: "USDG" },
      boosts: { active: 1000 },
      info: { websites: [] },
    },
  ]);
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: market.score,
    marketWarnings: market.warnings,
    holderScore: 10,
    holderWarnings: ["Top wallet holds 5.0% supply"],
    contractScore: 0,
    contractWarnings: [],
  });

  assert.notEqual(report.verdict, "SAFE");
  assert.ok(report.score >= 25);
  assert.ok(market.warnings.some((item) => item.includes("Primary pool")));
  assert.ok(market.liquidityUsd >= 40000);
});

test("CashDog-like token is scored on main v3 pool not tiny v4", () => {
  const market = bot.analyzePairsMarketRisk([
    {
      pairAddress: "0xb95956e052653fd5ab039babd71f108728859af5",
      liquidity: { usd: 125000 },
      volume: { h24: 2000000 },
      fdv: 900000,
      priceChange: { h24: -44 },
      txns: { h24: { buys: 4950, sells: 3650 } },
      labels: ["v3"],
      quoteToken: { symbol: "WETH" },
      info: { websites: [] },
    },
    {
      pairAddress: "0xbe326c075973fbb4d6537d5e291a88fce8dbb7ef4fdd5950698408afa7ad3753",
      liquidity: { usd: 306.27 },
      volume: { h24: 4200 },
      fdv: 1659576,
      priceChange: { h24: 3.4 },
      txns: { h24: { buys: 84, sells: 62 } },
      labels: ["v4"],
      quoteToken: { symbol: "USDG" },
      info: { websites: [] },
    },
  ]);

  assert.ok(market.liquidityUsd >= 100000);
  assert.equal(market.warnings.some((item) => item.includes("Dangerously thin liquidity")), false);
  assert.ok(market.warnings.some((item) => item.toLowerCase().includes("thin secondary")));
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: market.score,
    marketWarnings: market.warnings,
    holderScore: 0,
    holderWarnings: [],
    contractScore: 0,
    contractWarnings: [],
  });
  assert.notEqual(report.verdict, "DANGER");
});

test("holder concentration flags dominant wallet", () => {
  const result = bot.analyzeHolderConcentration(
    [
      { address: { hash: "0x1111111111111111111111111111111111111111", is_contract: false }, value: "250000" },
      { address: { hash: "0x2222222222222222222222222222222222222222", is_contract: false }, value: "10000" },
    ],
    "1000000",
    [],
  );
  assert.ok(result.top1Pct >= 20);
  assert.ok(result.score >= 40);
});

test("owner status marks renounced vs active", () => {
  const renounced = bot.classifyOwnerStatus({
    ownerAddress: "0x0000000000000000000000000000000000000000",
    ownerReadable: true,
    hasOwnerSelector: true,
  });
  assert.equal(renounced.ownerRenounced, true);
  assert.equal(renounced.ownerActive, false);
  assert.ok(renounced.notes.some((item) => item.toLowerCase().includes("renounced")));

  const active = bot.classifyOwnerStatus({
    ownerAddress: "0x1111111111111111111111111111111111111111",
    ownerReadable: true,
    hasOwnerSelector: true,
  });
  assert.equal(active.ownerActive, true);
  assert.equal(active.ownerRenounced, false);
  assert.ok(active.score >= 25);
  assert.ok(active.dangers.some((item) => item.includes("Owner still active")));
});

test("honeypot scorer includes LP not burned/locked as caution", () => {
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: 0,
    marketWarnings: [],
    holderScore: 0,
    holderWarnings: [],
    contractScore: 0,
    contractWarnings: [],
    ownerRenounced: true,
    ownerScore: 0,
    ownerNotes: ["Owner renounced"],
    lpScore: 25,
    lpNotes: ["LP not meaningfully burned/locked — position owner can still pull liquidity"],
  });

  assert.equal(report.verdict, "CAUTION");
  assert.ok(report.notes.some((item) => item.toLowerCase().includes("burn")));
});

test("honeypot scorer keeps healthy renounced token SAFE without LP risk", () => {
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: 0,
    marketWarnings: [],
    holderScore: 0,
    holderWarnings: [],
    contractScore: 0,
    contractWarnings: [],
    ownerRenounced: true,
    ownerScore: 0,
    ownerNotes: ["Owner renounced"],
    lpScore: -8,
    lpNotes: ["V3 LP burned ~95.0% (NFT to dead)"],
  });

  assert.equal(report.verdict, "SAFE");
  assert.ok(report.notes.some((item) => item.toLowerCase().includes("renounced")));
});

test("proxy + renounced owner is not SAFE", () => {
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: 0,
    marketWarnings: [],
    holderScore: 0,
    holderWarnings: [],
    contractScore: 0,
    contractWarnings: [],
    ownerRenounced: true,
    ownerScore: 0,
    proxyIsProxy: true,
    proxyScore: 30,
    proxyDangers: ["Proxy admin still active: 0x1111111111111111111111111111111111111111"],
    proxyNotes: ["Upgradeable proxy detected"],
  });
  assert.notEqual(report.verdict, "SAFE");
  assert.ok(report.dangers.some((item) => item.toLowerCase().includes("proxy")));
});

test("round-trip tax score marks extreme loss as DANGER", () => {
  const report = bot.scoreHoneypotFindings({
    hasCode: true,
    reputation: "ok",
    transferOk: true,
    quoteOk: true,
    marketScore: 0,
    marketWarnings: [],
    taxScore: 55,
    taxDangers: ["Extreme round-trip loss 55.0% — likely sell tax/honeypot"],
    taxNotes: ["Round-trip loss ~55.00% (pool fee 1%×2)"],
  });
  assert.equal(report.verdict, "DANGER");
});

test("v4 primary pool is flagged", () => {
  const risk = bot.analyzeV4HookRisk(
    {
      pairAddress: "0xb721c41770ebba210c0cf074e6f0a091f844a453a2dd3a155af876825f91f4df",
      labels: ["v4"],
      liquidity: { usd: 1000 },
    },
    [],
  );
  assert.equal(risk.primaryIsV4, true);
  assert.ok(risk.score >= 30);
  assert.ok(risk.dangers.some((item) => item.toLowerCase().includes("v4")));
});

test("bytecode flags tax maxTx and access control selectors", () => {
  // selectors concatenated as if present in bytecode
  const code =
    "0x" +
    "4f7041a5" + // buyTax
    "cc1776d3" + // sellTax
    "8c0b5e22" + // maxTxAmount
    "91d14854" + // hasRole
    "5c60da1b"; // implementation
  const risk = bot.analyzeContractBytecode(code);
  assert.equal(risk.hasTaxSelector, true);
  assert.equal(risk.hasMaxTxSelector, true);
  assert.equal(risk.hasAccessControl, true);
  assert.equal(risk.hasProxySelector, true);
  assert.ok(risk.score >= 40);
});

test("honeypot report is compact Vietnamese", () => {
  const text = bot.formatHoneypotReport({
    verdict: "DANGER",
    score: 108,
    dangers: [],
    notes: [
      "Primary pool: v3 $19.77K liq · LP/FDV 24.2%",
      "Multiple thin pools — fragmented liquidity / chart bait risk",
      "Heavy Dexscreener boosts (100) — paid hype common on scams",
      "Volume >> liquidity (wash / sniper churn risk)",
      "Bytecode has trading enable/disable selectors",
      "Owner renounced",
      "Ownable-style owner selector present",
      "V2 LP burned ~100.0% to dead",
      "Could not read v3 pool LP state: execution reverted (no data present; ...)",
      "No LP locker addresses configured (set LP_LOCKER_ADDRESSES)",
      "Round-trip tax check failed: unexpected error",
      "1 secondary v4 pool(s) — ignore for sizing; hooks risk on those pools",
      "Transfer simulation passed — NOT proof of safety (soft rugs often pass this)",
      "V3 sell quote passed — market/rug risk can still exist",
    ],
    ownerRenounced: true,
  });

  assert.match(text, /Bảo mật/);
  assert.match(text, /NGUY HIỂM/);
  assert.match(text, /Đừng mua/);
  assert.equal(text.includes("Security audit"), false);
  assert.equal(text.includes("Ownable-style"), false);
  assert.equal(text.includes("NOT proof of safety"), false);
  assert.ok(text.split("\n").length <= 10);
});

test("probe holder skips pool dead and contracts", () => {
  const pair = "0xb541c2936982dd5c4090783d8f395d3e613c8016";
  const probe = bot.pickProbeHolder(
    [
      { address: { hash: "0x000000000000000000000000000000000000dEaD", is_contract: false }, value: "100" },
      { address: { hash: pair, is_contract: true }, value: "1000" },
      { address: { hash: "0x2a7c37742C7DD2E24143BE825a1970284B47E6F6", is_contract: false }, value: "500" },
    ],
    [pair],
  );

  assert.equal(probe.address, "0x2a7c37742c7dd2e24143be825a1970284b47e6f6");
});

test("LP preset matches Uniswap link range", () => {
  const preset = bot.lpPreset({
    lp: {
      tokenAddress: "0xd7321801caae694090694ff55a9323139f043b88",
      fee: 10000,
      tickSpacing: 200,
      tickLower: 111400,
      tickUpper: 125200,
    },
  });
  assert.equal(preset.fee, 10000);
  assert.equal(preset.tickLower, 111400);
  assert.equal(preset.tickUpper, 125200);
  assert.equal(preset.wethIsToken0, true);
  assert.equal(bot.alignTick(111450, 200), 111400);
});

test("LP amount math needs both sides when price is in range", () => {
  const tickLower = 111400;
  const tickUpper = 125200;
  const tickCurrent = 118255;
  const sqrtPriceX96 = bot.getSqrtRatioAtTick(tickCurrent);
  const ethWei = 10n ** 16n; // 0.01 ETH
  const amounts = bot.amountsForExactEth({
    sqrtPriceX96,
    tickLower,
    tickUpper,
    ethAmount: ethWei,
    wethIsToken0: true,
  });

  assert.equal(amounts.positionSide, "in-range");
  assert.ok(amounts.amount0 > 0n);
  assert.ok(amounts.amount1 > 0n);
  assert.ok(amounts.liquidity > 0n);
});

test("LP range percents expand around current tick", () => {
  const ranged = bot.ticksAroundPrice(118255, 15, 200);
  assert.ok(ranged.tickLower < 118255);
  assert.ok(ranged.tickUpper > 118255);
  assert.equal(ranged.tickLower % 200, 0);
  assert.equal(ranged.tickUpper % 200, 0);
  assert.equal(bot.feeToTickSpacing(10000), 200);
});

test("LP remove percent scales liquidity", () => {
  assert.equal(bot.liquidityPercent(1000n, 25), 250n);
  assert.equal(bot.liquidityPercent(1000n, 100), 1000n);
});
