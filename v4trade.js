/**
 * Uniswap v4 trading on Robinhood Chain via UniversalRouter.
 * Prefer thick route: ETH → WETH → USDG → bridge → token (v4 hub).
 * Fallback: native ETH ↔ token single-hop when no bridge hub exists.
 * RH V3_SWAP_EXACT_IN uses 6 abi fields (trailing empty bytes).
 * RH ExactInputSingle includes minHopPriceX36.
 */
const { ethers } = require("ethers");

const NATIVE_ETH = ethers.ZeroAddress;
const DYNAMIC_FEE_FLAG = 0x800000;
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
/** Universal Router / V4 periphery: use full ERC20 balance held by the router. */
const CONTRACT_BALANCE = 1n << 255n;

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
/** Robinhood stock GME — common thick v4 hub quote for meme tokens. */
const STOCK_GME = "0x1b0E319c6A659F002271B69dB8A7df2F911c153E";

const CMD_V3_SWAP_EXACT_IN = 0x00;
const CMD_WRAP_ETH = 0x0b;
const CMD_UNWRAP_WETH = 0x0c;
const CMD_V4_SWAP = 0x10;

const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE = 0x0b;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE = 0x0e;
const ACTION_TAKE_ALL = 0x0f;

const DEFAULTS = {
  universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  usdg: USDG,
  stockGme: STOCK_GME,
  wethUsdgFee: 100,
  usdgBridgeFee: 10000,
};

function urInterface() {
  return new ethers.Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  ]);
}

function isV4PoolId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

function isNativeOrWeth(address, wethAddress = "") {
  const a = String(address || "").toLowerCase();
  if (!a || a === NATIVE_ETH) return true;
  if (a === "0x0000000000000000000000000000000000000000") return true;
  if (wethAddress && a === String(wethAddress).toLowerCase()) return true;
  return false;
}

function dexPairIsV4(pair) {
  return (pair?.labels || []).map((x) => String(x).toLowerCase()).includes("v4");
}

function dexPairHasUsdg(pair) {
  const usdg = String(DEFAULTS.usdg).toLowerCase();
  const b = String(pair?.baseToken?.address || "").toLowerCase();
  const q = String(pair?.quoteToken?.address || "").toLowerCase();
  return b === usdg || q === usdg;
}

function encodeV3Path(tokens, fees) {
  let out = ethers.getAddress(tokens[0]).slice(2).toLowerCase();
  for (let i = 0; i < fees.length; i++) {
    out += Number(fees[i]).toString(16).padStart(6, "0");
    out += ethers.getAddress(tokens[i + 1]).slice(2).toLowerCase();
  }
  return `0x${out}`;
}

/** V3 path: WETH → USDG → bridge (or WETH → USDG when bridge is USDG). */
function buildUsdgBridgePath(wethAddress, bridgeToken, opts = {}) {
  const weth = ethers.getAddress(wethAddress);
  const usdg = ethers.getAddress(opts.usdg || DEFAULTS.usdg);
  const bridge = ethers.getAddress(bridgeToken);
  const fee0 = Number(opts.wethUsdgFee ?? DEFAULTS.wethUsdgFee);
  const fee1 = Number(opts.usdgBridgeFee ?? DEFAULTS.usdgBridgeFee);
  if (bridge.toLowerCase() === usdg.toLowerCase()) {
    return encodeV3Path([weth, usdg], [fee0]);
  }
  return encodeV3Path([weth, usdg, bridge], [fee0, fee1]);
}

function buildUsdgBridgePathReverse(wethAddress, bridgeToken, opts = {}) {
  const weth = ethers.getAddress(wethAddress);
  const usdg = ethers.getAddress(opts.usdg || DEFAULTS.usdg);
  const bridge = ethers.getAddress(bridgeToken);
  const fee0 = Number(opts.wethUsdgFee ?? DEFAULTS.wethUsdgFee);
  const fee1 = Number(opts.usdgBridgeFee ?? DEFAULTS.usdgBridgeFee);
  if (bridge.toLowerCase() === usdg.toLowerCase()) {
    return encodeV3Path([usdg, weth], [fee0]);
  }
  return encodeV3Path([bridge, usdg, weth], [fee1, fee0]);
}

/** Best v4 pool for token <-> native ETH (skips USDG / WETH). */
function pickV4EthPool(pairs, tokenAddress) {
  const token = String(tokenAddress || "").toLowerCase();
  const zero = "0x0000000000000000000000000000000000000000";
  const ranked = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => String(pair.chainId || "").toLowerCase() === "robinhood")
    .filter((pair) => dexPairIsV4(pair) && !dexPairHasUsdg(pair))
    .filter((pair) => {
      const base = String(pair.baseToken?.address || "").toLowerCase();
      const quote = String(pair.quoteToken?.address || "").toLowerCase();
      if (!(base === token || quote === token)) return false;
      const other = base === token ? quote : base;
      return other === zero || other === NATIVE_ETH;
    })
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  return ranked[0] || null;
}

/**
 * Prefer thick v4 hub (token ↔ bridge) routed via USDG on v3.
 * Falls back to thin native ETH v4 pool when no bridge hub exists.
 */
function pickV4TradeRoute(pairs, tokenAddress, wethAddress = "") {
  const token = String(tokenAddress || "").toLowerCase();
  const zero = "0x0000000000000000000000000000000000000000";
  const weth = String(wethAddress || "").toLowerCase();
  const usdg = String(DEFAULTS.usdg).toLowerCase();
  const list = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => String(pair.chainId || "").toLowerCase() === "robinhood")
    .filter((pair) => dexPairIsV4(pair))
    .filter((pair) => {
      const base = String(pair.baseToken?.address || "").toLowerCase();
      const quote = String(pair.quoteToken?.address || "").toLowerCase();
      return base === token || quote === token;
    })
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));

  const preferredBridge = String(DEFAULTS.stockGme).toLowerCase();

  const hubCandidates = list.filter((pair) => {
    const base = String(pair.baseToken?.address || "").toLowerCase();
    const quote = String(pair.quoteToken?.address || "").toLowerCase();
    const other = base === token ? quote : base;
    if (!other || other === zero || other === NATIVE_ETH) return false;
    if (weth && other === weth) return false;
    return true;
  });

  // Prefer stock-GME hub, then USDG hub, then deepest non-ETH v4 pool.
  hubCandidates.sort((a, b) => {
    const otherOf = (pair) => {
      const base = String(pair.baseToken?.address || "").toLowerCase();
      const quote = String(pair.quoteToken?.address || "").toLowerCase();
      return base === token ? quote : base;
    };
    const score = (pair) => {
      const o = otherOf(pair);
      let s = Number(pair.liquidity?.usd || 0);
      if (o === preferredBridge) s += 1e12;
      else if (o === usdg) s += 1e11;
      return s;
    };
    return score(b) - score(a);
  });

  if (hubCandidates[0]) {
    const pair = hubCandidates[0];
    const base = String(pair.baseToken?.address || "").toLowerCase();
    const quote = String(pair.quoteToken?.address || "").toLowerCase();
    const bridge = base === token ? quote : base;
    return {
      mode: "usdg",
      pair,
      bridgeToken: ethers.getAddress(bridge),
      poolId: pair.pairAddress,
    };
  }

  const ethPool = pickV4EthPool(pairs, tokenAddress);
  if (ethPool) {
    return {
      mode: "eth",
      pair: ethPool,
      bridgeToken: NATIVE_ETH,
      poolId: ethPool.pairAddress,
    };
  }
  return null;
}

function isNativeEthQuote(pair) {
  const z = "0x0000000000000000000000000000000000000000";
  const b = String(pair?.baseToken?.address || "").toLowerCase();
  const q = String(pair?.quoteToken?.address || "").toLowerCase();
  return b === z || q === z;
}

function poolIdFromKey(key) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const c0 = ethers.getAddress(key.currency0);
  const c1 = ethers.getAddress(key.currency1);
  const [a, b] = BigInt(c0) < BigInt(c1) ? [c0, c1] : [c1, c0];
  return ethers.keccak256(
    coder.encode(
      ["address", "address", "uint24", "int24", "address"],
      [a, b, Number(key.fee), Number(key.tickSpacing), ethers.getAddress(key.hooks)],
    ),
  );
}

function recoverV4PoolKey(poolId, currencyA, currencyB, hookHints = []) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const aIn = currencyA === NATIVE_ETH || !currencyA ? NATIVE_ETH : ethers.getAddress(currencyA);
  const bIn = currencyB === NATIVE_ETH || !currencyB ? NATIVE_ETH : ethers.getAddress(currencyB);
  const [a, b] = BigInt(aIn) < BigInt(bIn) ? [aIn, bIn] : [bIn, aIn];
  const hooksList = [
    ...hookHints.map((h) => (h && h !== NATIVE_ETH ? ethers.getAddress(h) : NATIVE_ETH)),
    NATIVE_ETH,
  ];
  const fees = [DYNAMIC_FEE_FLAG, 10000, 3000, 500, 100, 7000, 1];
  const target = String(poolId).toLowerCase();
  for (const fee of fees) {
    for (const hooks of hooksList) {
      for (let tickSpacing = 1; tickSpacing <= 1000; tickSpacing++) {
        const id = ethers.keccak256(
          coder.encode(["address", "address", "uint24", "int24", "address"], [a, b, fee, tickSpacing, hooks]),
        );
        if (id.toLowerCase() === target) {
          return { currency0: a, currency1: b, fee, tickSpacing, hooks };
        }
      }
    }
  }
  return null;
}

function encodeExactInputSingle({ key, zeroForOne, tokenIn, tokenOut, amountIn, minAmountOut, deadline }) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const swapParams = coder.encode(
    ["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"],
    [
      [
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        Boolean(zeroForOne),
        amountIn,
        minAmountOut,
        0n,
        "0x",
      ],
    ],
  );
  const settleParams = coder.encode(["address", "uint256"], [tokenIn, amountIn]);
  const takeParams = coder.encode(["address", "uint256"], [tokenOut, minAmountOut]);
  const actions = ethers.hexlify(
    Uint8Array.of(ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL),
  );
  const v4Input = coder.encode(["bytes", "bytes[]"], [actions, [swapParams, settleParams, takeParams]]);
  return urInterface().encodeFunctionData("execute", [
    ethers.hexlify(Uint8Array.of(CMD_V4_SWAP)),
    [v4Input],
    deadline,
  ]);
}

function encodeV3SwapExactIn({ recipient, amountIn, minOut, path, payerIsUser }) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["address", "uint256", "uint256", "bytes", "bool", "bytes"],
    [recipient, amountIn, minOut, path, Boolean(payerIsUser), "0x"],
  );
}

function encodeV4HubLeg({ key, zeroForOne, tokenIn, tokenOut, amountIn, minOut, settleFromUser, takeRecipient }) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const settle = coder.encode(
    ["address", "uint256", "bool"],
    [tokenIn, amountIn, Boolean(settleFromUser)],
  );
  const swap = coder.encode(
    ["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"],
    [
      [
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        Boolean(zeroForOne),
        // Settle-first pattern: swap consumes OPEN_DELTA from the prior settle.
        0n,
        minOut,
        0n,
        "0x",
      ],
    ],
  );

  if (takeRecipient && String(takeRecipient).toLowerCase() !== String(ADDRESS_THIS).toLowerCase()) {
    // TAKE_ALL → msg.sender
    const takeAll = coder.encode(["address", "uint256"], [tokenOut, minOut]);
    const actions = ethers.hexlify(Uint8Array.of(ACTION_SETTLE, ACTION_SWAP_EXACT_IN_SINGLE, ACTION_TAKE_ALL));
    return coder.encode(["bytes", "bytes[]"], [actions, [settle, swap, takeAll]]);
  }

  // TAKE open-delta to UniversalRouter for the next hop
  const take = coder.encode(["address", "address", "uint256"], [tokenOut, ADDRESS_THIS, 0n]);
  const actions = ethers.hexlify(Uint8Array.of(ACTION_SETTLE, ACTION_SWAP_EXACT_IN_SINGLE, ACTION_TAKE));
  return coder.encode(["bytes", "bytes[]"], [actions, [settle, swap, take]]);
}

/**
 * BUY: WRAP_ETH → V3(WETH→USDG→bridge) → V4(bridge→token)
 * SELL: V4(token→bridge) → V3(bridge→USDG→WETH) → UNWRAP_WETH
 * Intermediate minOuts protect each hop (avoid unprotected 0 mins / sandwich).
 */
function encodeUsdgHubSwap({
  side,
  key,
  tokenAddress,
  bridgeToken,
  wethAddress,
  amountIn,
  minAmountOut,
  v3MinOut = 0n,
  bridgeMinOut = 0n,
  recipient,
  deadline,
  pathOpts = {},
}) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const token = ethers.getAddress(tokenAddress);
  const bridge = ethers.getAddress(bridgeToken);
  const to = ethers.getAddress(recipient);
  // currency0/currency1 are sorted by address — detect which side is the bridge.
  const bridgeIsC0 = bridge.toLowerCase() === String(key.currency0).toLowerCase();
  const finalMin = minAmountOut > 0n ? minAmountOut : 1n;
  const hopV3Min = v3MinOut > 0n ? v3MinOut : 0n;
  const hopBridgeMin = bridgeMinOut > 0n ? bridgeMinOut : 0n;

  if (side === "BUY") {
    const wrap = coder.encode(["address", "uint256"], [ADDRESS_THIS, amountIn]);
    const path = buildUsdgBridgePath(wethAddress, bridge, pathOpts);
    const v3 = encodeV3SwapExactIn({
      recipient: ADDRESS_THIS,
      amountIn,
      minOut: hopV3Min,
      path,
      payerIsUser: false,
    });
    const zeroForOne = bridgeIsC0; // bridge → token
    const v4 = encodeV4HubLeg({
      key,
      zeroForOne,
      tokenIn: bridge,
      tokenOut: token,
      amountIn: CONTRACT_BALANCE,
      minOut: finalMin,
      settleFromUser: false,
      takeRecipient: to,
    });
    return urInterface().encodeFunctionData("execute", [
      ethers.hexlify(Uint8Array.of(CMD_WRAP_ETH, CMD_V3_SWAP_EXACT_IN, CMD_V4_SWAP)),
      [wrap, v3, v4],
      deadline,
    ]);
  }

  // SELL
  const zeroForOne = !bridgeIsC0; // token → bridge
  const v4 = encodeV4HubLeg({
    key,
    zeroForOne,
    tokenIn: token,
    tokenOut: bridge,
    amountIn,
    minOut: hopBridgeMin,
    settleFromUser: true,
    takeRecipient: ADDRESS_THIS,
  });
  const path = buildUsdgBridgePathReverse(wethAddress, bridge, pathOpts);
  const v3 = encodeV3SwapExactIn({
    recipient: ADDRESS_THIS,
    amountIn: CONTRACT_BALANCE,
    minOut: finalMin,
    path,
    payerIsUser: false,
  });
  const unwrap = coder.encode(["address", "uint256"], [to, finalMin]);
  return urInterface().encodeFunctionData("execute", [
    ethers.hexlify(Uint8Array.of(CMD_V4_SWAP, CMD_V3_SWAP_EXACT_IN, CMD_UNWRAP_WETH)),
    [v4, v3, unwrap],
    deadline,
  ]);
}

async function quoteV3ExactInput(provider, quoterAddress, path, amountIn) {
  const quoter = new ethers.Contract(
    quoterAddress,
    [
      "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
    ],
    provider,
  );
  const result = await quoter.quoteExactInput.staticCall(path, amountIn);
  return BigInt(result[0] ?? result);
}

/**
 * Spot exact-in quote from PoolManager StateView (includes LP fee, ignores tick impact).
 * Good enough for thick hubs + small retail size; preflight tightens minOut further.
 */
async function quoteV4ExactInSpot(provider, poolId, zeroForOne, amountIn, stateViewAddress = DEFAULTS.stateView) {
  const view = new ethers.Contract(
    stateViewAddress,
    [
      "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    ],
    provider,
  );
  const [sqrtPriceX96, , , lpFee] = await view.getSlot0(poolId);
  const fee = BigInt(lpFee || 0);
  const amountAfterFee = (BigInt(amountIn) * (1_000_000n - fee)) / 1_000_000n;
  const Q96 = 1n << 96n;
  const sqrt = BigInt(sqrtPriceX96);
  if (sqrt <= 0n || amountAfterFee <= 0n) return 0n;
  if (zeroForOne) {
    // token0 → token1
    return (amountAfterFee * sqrt * sqrt) / (Q96 * Q96);
  }
  // token1 → token0
  return (amountAfterFee * Q96 * Q96) / (sqrt * sqrt);
}

async function quoteViaDexPrice(poolId, tokenAddress, side, amountIn) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${poolId}`);
  const json = await res.json();
  const pair = json.pair || json.pairs?.[0];
  const priceNative = Number(pair?.priceNative);
  if (!Number.isFinite(priceNative) || priceNative <= 0) {
    throw new Error("Cannot quote v4 pool from Dexscreener priceNative.");
  }
  const base = String(pair.baseToken?.address || "").toLowerCase();
  const token = String(tokenAddress).toLowerCase();
  const ethPerToken =
    base === token
      ? priceNative
      : 1 / priceNative;
  if (!(ethPerToken > 0) || !Number.isFinite(ethPerToken)) {
    throw new Error("Invalid v4 ethPerToken quote.");
  }
  if (side === "BUY") {
    const eth = Number(ethers.formatEther(amountIn));
    const tokens = eth / ethPerToken;
    return ethers.parseUnits(tokens.toFixed(12), 18);
  }
  const tokens = Number(ethers.formatUnits(amountIn, 18));
  const eth = tokens * ethPerToken;
  return ethers.parseEther(eth.toFixed(18));
}

/**
 * Quote ETH ↔ token through USDG bridge + v4 hub.
 * V3 leg: on-chain quoter. V4 hub: StateView spot + LP fee (fallback Dexscreener).
 * Returns { amountOut, bridgeAmount } so callers can set intermediate minOuts.
 */
async function quoteUsdgHub({
  provider,
  quoterAddress,
  wethAddress,
  bridgeToken,
  tokenAddress,
  hubPoolId,
  key,
  side,
  amountIn,
  pathOpts = {},
  stateViewAddress = DEFAULTS.stateView,
}) {
  const bridge = ethers.getAddress(bridgeToken);
  const token = ethers.getAddress(tokenAddress);
  const bridgeIsC0 =
    key?.currency0 != null
      ? bridge.toLowerCase() === String(key.currency0).toLowerCase()
      : BigInt(bridge) < BigInt(token);

  if (side === "BUY") {
    const path = buildUsdgBridgePath(wethAddress, bridge, pathOpts);
    const bridgeOut = await quoteV3ExactInput(provider, quoterAddress, path, amountIn);
    let tokenOut = 0n;
    try {
      tokenOut = await quoteV4ExactInSpot(provider, hubPoolId, bridgeIsC0, bridgeOut, stateViewAddress);
    } catch {
      tokenOut = 0n;
    }
    if (tokenOut <= 0n) {
      // Dex fallback (mid) — haircut ~0.7% typical hub fee so minOut is not optimistic.
      const mid = await quoteViaDexBridge(hubPoolId, token, bridge, "BUY", bridgeOut);
      tokenOut = (mid * 9930n) / 10000n;
    } else {
      // Spot ignores concentrated-liquidity impact — small haircut keeps minOut realistic.
      tokenOut = (tokenOut * 9970n) / 10000n;
    }
    return { amountOut: tokenOut, bridgeAmount: bridgeOut };
  }

  let bridgeOut = 0n;
  try {
    bridgeOut = await quoteV4ExactInSpot(provider, hubPoolId, !bridgeIsC0, amountIn, stateViewAddress);
  } catch {
    bridgeOut = 0n;
  }
  if (bridgeOut <= 0n) {
    const mid = await quoteViaDexBridge(hubPoolId, token, bridge, "SELL", amountIn);
    bridgeOut = (mid * 9930n) / 10000n;
  } else {
    bridgeOut = (bridgeOut * 9970n) / 10000n;
  }
  const path = buildUsdgBridgePathReverse(wethAddress, bridge, pathOpts);
  const ethOut = await quoteV3ExactInput(provider, quoterAddress, path, bridgeOut);
  return { amountOut: ethOut, bridgeAmount: bridgeOut };
}

/** Dexscreener bridge↔token conversion when StateView is unavailable. */
async function quoteViaDexBridge(hubPoolId, tokenAddress, bridgeToken, side, amountIn) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${hubPoolId}`);
  const json = await res.json();
  const pair = json.pair || json.pairs?.[0];
  if (!pair) throw new Error("Cannot load v4 hub pair for quote.");
  const base = String(pair.baseToken?.address || "").toLowerCase();
  const quote = String(pair.quoteToken?.address || "").toLowerCase();
  const token = String(tokenAddress).toLowerCase();
  const bridge = String(bridgeToken).toLowerCase();
  const priceNative = Number(pair.priceNative);
  if (!(priceNative > 0)) throw new Error("Invalid hub priceNative.");

  let bridgePerToken;
  if (base === token && quote === bridge) bridgePerToken = priceNative;
  else if (quote === token && base === bridge) bridgePerToken = 1 / priceNative;
  else if (base === token) bridgePerToken = priceNative;
  else bridgePerToken = 1 / priceNative;
  if (!(bridgePerToken > 0) || !Number.isFinite(bridgePerToken)) {
    throw new Error("Invalid bridgePerToken quote.");
  }

  if (side === "BUY") {
    const tokens = Number(ethers.formatUnits(amountIn, 18)) / bridgePerToken;
    return ethers.parseUnits(Math.max(tokens, 0).toFixed(12), 18);
  }
  const bridgeOut = Number(ethers.formatUnits(amountIn, 18)) * bridgePerToken;
  return ethers.parseUnits(Math.max(bridgeOut, 0).toFixed(12), 18);
}

async function ensurePermit2(wallet, tokenAddress, routerAddress, amountIn, permit2Address = DEFAULTS.permit2) {
  const token = new ethers.Contract(
    tokenAddress,
    [
      "function allowance(address owner,address spender) view returns (uint256)",
      "function approve(address spender,uint256 amount) returns (bool)",
      "function balanceOf(address owner) view returns (uint256)",
    ],
    wallet,
  );
  const permit2 = new ethers.Contract(
    permit2Address,
    [
      "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
      "function approve(address token,address spender,uint160 amount,uint48 expiration)",
    ],
    wallet,
  );
  const owner = wallet.address;
  const balance = await token.balanceOf(owner);
  if (balance < amountIn) {
    throw new Error(
      `Not enough token to sell. Need ${amountIn.toString()}, wallet has ${balance.toString()}.`,
    );
  }
  const allowance = await token.allowance(owner, permit2Address);
  if (allowance < amountIn) {
    const tx = await token.approve(permit2Address, ethers.MaxUint256);
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error("Permit2 token approve failed.");
  }
  const now = Math.floor(Date.now() / 1000);
  const allowed = await permit2.allowance(owner, tokenAddress, routerAddress);
  const exp = Number(allowed.expiration || 0);
  const amt = BigInt(allowed.amount || 0);
  // Keep Permit2 approval valid for ~10 years (was 1h — expired approvals caused Sell STF).
  const maxUint48 = 2 ** 48 - 1;
  const expiration = Math.min(maxUint48, now + 60 * 60 * 24 * 365 * 10);
  const maxUint160 = (1n << 160n) - 1n;
  if (amt >= amountIn && exp > now + 3600) return;
  const tx2 = await permit2.approve(tokenAddress, routerAddress, maxUint160, expiration);
  const receipt2 = await tx2.wait(1);
  if (!receipt2 || receipt2.status !== 1) throw new Error("Permit2 router approve failed.");
}

module.exports = {
  NATIVE_ETH,
  ADDRESS_THIS,
  CONTRACT_BALANCE,
  USDG,
  STOCK_GME,
  DEFAULTS,
  DYNAMIC_FEE_FLAG,
  isV4PoolId,
  isNativeOrWeth,
  dexPairIsV4,
  dexPairHasUsdg,
  pickV4EthPool,
  pickV4TradeRoute,
  encodeV3Path,
  buildUsdgBridgePath,
  buildUsdgBridgePathReverse,
  poolIdFromKey,
  recoverV4PoolKey,
  encodeExactInputSingle,
  encodeUsdgHubSwap,
  quoteViaDexPrice,
  quoteViaDexBridge,
  quoteV4ExactInSpot,
  quoteUsdgHub,
  quoteV3ExactInput,
  ensurePermit2,
  isNativeEthQuote,
};
