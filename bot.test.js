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

test("sniper keyboard exposes direct buy and sell amount buttons", () => {
  const keyboard = bot.sniperTradeKeyboard();
  const buttons = keyboard.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);
  const callbacks = buttons.map((button) => button.callback_data).filter(Boolean);

  assert(labels.includes(`Buy ${bot.config.buyAmountsQuote[0]} ${bot.config.quoteSymbol}`));
  assert(labels.includes(`Sell ${bot.config.sellAmountsBase[0]} ${bot.config.baseSymbol}`));
  assert(labels.includes(`Sell All ${bot.config.baseSymbol}`));
  assert(callbacks.includes(`qtrade:BUY:${bot.config.buyAmountsQuote[0]}`));
  assert(callbacks.includes(`qtrade:SELL:${bot.config.sellAmountsBase[0]}`));
  assert(callbacks.includes("qtrade:SELL:ALL"));
});

test("slippage default is two percent", () => {
  assert.equal(bot.config.slippageBps, 200);
});

test("sell all trades immediately even when one-tap mode is off", () => {
  assert.equal(bot.config.oneTapTrade, false);
  assert.equal(bot.shouldTradeImmediately("SELL", "ALL"), true);
  assert.equal(bot.shouldTradeImmediately("SELL", "1000"), false);
  assert.equal(bot.shouldTradeImmediately("BUY", "0.01"), false);
});

test("main menu looks like a trading dashboard", () => {
  const keyboard = bot.mainMenuKeyboard();
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  const text = bot.staticMainPanelText();

  assert(text.includes(bot.config.botTitle));
  assert(labels.includes("Buy & Sell"));
  assert(labels.includes("Sniper"));
  assert(labels.includes("Limit Orders"));
  assert(labels.includes("Copy Trades"));
  assert(labels.includes("Profile"));
  assert(labels.includes("Wallets"));
  assert(labels.includes("Trades"));
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
      transfer(bot.config.quoteTokenAddress, bot.config.pairAddress, "0xrouter", "1999999999999999999", "1783.74"),
    ],
  };

  const trade = bot.classifyFromTransaction(tx, { buyWhenBaseLeavesPool: true, minQuoteAmount: 2 });

  assert.equal(trade, null);
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
});

test("portfolio keyboard exposes Update Price", () => {
  const keyboard = bot.portfolioKeyboard();
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, "portfolio:refresh");
  assert.ok(bot.mainMenuKeyboard().inline_keyboard.flat().some((button) => button.callback_data === "panel:portfolio"));
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
