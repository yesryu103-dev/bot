/**
 * up Finance Slipstream CL — swap + one-sided range limit sell (maker).
 * Docs: https://github.com/labrinyang/lp-terminal/blob/main/docs/up33-contract-map.md
 */
const SWAP_ROUTER = "0xC062b870E813fcA720f1e002c234369Ab3aB9415";
const QUOTER = "0x03983AB2C057a2eac211ff01738a1e49ff325B49";
const FACTORY = "0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3";
const POSITION_MANAGER = "0x07F44c47743A2f36414A82b9F558ECFCf0EEdCEf";
/** Official Uniswap V3 NonfungiblePositionManager on Robinhood. */
const UNI_V3_POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
];

const POSITION_MANAGER_ABI = [
  "function mint((address token0,address token1,int24 tickSpacing,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline,uint160 sqrtPriceX96) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256 amount0,uint256 amount1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,int24 tickSpacing,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

/** Uni V3 NFPM — mint uses uint24 fee instead of int24 tickSpacing. */
const UNI_V3_POSITION_MANAGER_ABI = [
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256 amount0,uint256 amount1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
];

const MAX_UINT128 = (1n << 128n) - 1n;

function isUpDexId(dexId) {
  const id = String(dexId || "").toLowerCase();
  return id === "up" || id === "up33";
}

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

function alignTickDown(tick, spacing) {
  const s = Number(spacing);
  let t = Math.trunc(Number(tick));
  let aligned = Math.trunc(t / s) * s;
  if (t < 0 && t % s !== 0) aligned -= s;
  return aligned;
}

function alignTickUp(tick, spacing) {
  const down = alignTickDown(tick, spacing);
  if (down === Math.trunc(Number(tick))) return down;
  return down + Number(spacing);
}

/** Approximate Uniswap tick delta for a multiplicative price move. */
function ticksForPricePct(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.max(1, Math.round(Math.log(1 + p / 100) / Math.log(1.0001)));
}

/**
 * Plan a one-sided out-of-range band that fills when sellToken price rises vs WETH.
 * band: "1t" | "1" | "3" | "5" (percent of token price, or one tickSpacing).
 */
function planLimitSellBand({
  currentTick,
  tickSpacing,
  token0,
  token1,
  sellToken,
  band = "1t",
}) {
  const spacing = Number(tickSpacing);
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error("bad tickSpacing");
  const tick = Number(currentTick);
  if (!Number.isFinite(tick)) throw new Error("bad currentTick");

  const sell = normalizeAddress(sellToken);
  const t0 = normalizeAddress(token0);
  const t1 = normalizeAddress(token1);
  if (sell !== t0 && sell !== t1) throw new Error("sellToken not in pool");

  const sellingToken0 = sell === t0;
  const rawBand = String(band || "1t").toLowerCase();
  let offsetTicks;
  if (rawBand === "1t" || rawBand === "1tick" || rawBand === "tight") {
    offsetTicks = spacing;
  } else {
    const pct = Number(rawBand);
    if (!Number.isFinite(pct) || pct <= 0) throw new Error(`bad band ${band}`);
    offsetTicks = Math.max(spacing, alignTickUp(ticksForPricePct(pct), spacing));
  }

  let tickLower;
  let tickUpper;
  if (sellingToken0) {
    // Range ABOVE market → 100% token0 until price rises into band.
    tickLower = alignTickUp(tick + 1, spacing);
    if (tickLower <= tick) tickLower += spacing;
    tickLower = Math.max(tickLower, alignTickUp(tick + offsetTicks, spacing));
    tickUpper = tickLower + spacing;
  } else {
    // Range BELOW market → 100% token1 until price falls into band (token pumps vs WETH).
    tickUpper = alignTickDown(tick, spacing);
    if (tickUpper > tick) tickUpper -= spacing;
    if (tickUpper === tick) tickUpper -= spacing;
    const target = alignTickDown(tick - offsetTicks, spacing);
    tickUpper = Math.min(tickUpper, target);
    tickLower = tickUpper - spacing;
  }

  if (tickLower >= tickUpper) throw new Error("invalid tick range");
  if (sellingToken0 && !(tickLower > tick)) {
    throw new Error("limit band not above market (token0)");
  }
  if (!sellingToken0 && !(tickUpper <= tick)) {
    throw new Error("limit band not below market (token1)");
  }

  return {
    tickLower,
    tickUpper,
    tickSpacing: spacing,
    sellingToken0,
    currentTick: tick,
    band: rawBand,
    offsetTicks,
  };
}

async function quoteExactInputSingle(provider, { tokenIn, tokenOut, amountIn, tickSpacing }) {
  const { ethers } = require("ethers");
  const spacing = Number(tickSpacing);
  if (!Number.isFinite(spacing) || spacing === 0) {
    throw new Error("up quote needs tickSpacing");
  }
  const quoter = new ethers.Contract(QUOTER, QUOTER_ABI, provider);
  const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn,
    tickSpacing: spacing,
    sqrtPriceLimitX96: 0,
  });
  const amountOut = BigInt(result.amountOut ?? result[0]);
  if (amountOut <= 0n) throw new Error("up quote returned 0");
  return { amountOut, tickSpacing: spacing };
}

async function readPoolState(provider, poolAddress) {
  const { ethers } = require("ethers");
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [slot0, token0, token1, tickSpacing, fee] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.token1(),
    pool.tickSpacing(),
    pool.fee(),
  ]);
  return {
    poolAddress: normalizeAddress(poolAddress),
    sqrtPriceX96: BigInt(slot0.sqrtPriceX96 ?? slot0[0]),
    tick: Number(slot0.tick ?? slot0[1]),
    token0: normalizeAddress(token0),
    token1: normalizeAddress(token1),
    tickSpacing: Number(tickSpacing),
    fee: Number(fee),
  };
}

async function readPosition(provider, tokenId, venue = "up", npmAddress = "") {
  const { ethers } = require("ethers");
  const isUni = String(venue || "").toLowerCase() === "uni";
  const addr =
    normalizeAddress(npmAddress) || (isUni ? UNI_V3_POSITION_MANAGER : POSITION_MANAGER);
  const abi = isUni ? UNI_V3_POSITION_MANAGER_ABI : POSITION_MANAGER_ABI;
  const npm = new ethers.Contract(addr, abi, provider);
  const pos = await npm.positions(tokenId);
  if (isUni) {
    return {
      venue: "uni",
      npm: addr,
      token0: normalizeAddress(pos.token0 ?? pos[2]),
      token1: normalizeAddress(pos.token1 ?? pos[3]),
      fee: Number(pos.fee ?? pos[4]),
      tickSpacing: 0,
      tickLower: Number(pos.tickLower ?? pos[5]),
      tickUpper: Number(pos.tickUpper ?? pos[6]),
      liquidity: BigInt(pos.liquidity ?? pos[7]),
      tokensOwed0: BigInt(pos.tokensOwed0 ?? pos[10]),
      tokensOwed1: BigInt(pos.tokensOwed1 ?? pos[11]),
    };
  }
  return {
    venue: "up",
    npm: addr,
    token0: normalizeAddress(pos.token0 ?? pos[2]),
    token1: normalizeAddress(pos.token1 ?? pos[3]),
    tickSpacing: Number(pos.tickSpacing ?? pos[4]),
    fee: 0,
    tickLower: Number(pos.tickLower ?? pos[5]),
    tickUpper: Number(pos.tickUpper ?? pos[6]),
    liquidity: BigInt(pos.liquidity ?? pos[7]),
    tokensOwed0: BigInt(pos.tokensOwed0 ?? pos[10]),
    tokensOwed1: BigInt(pos.tokensOwed1 ?? pos[11]),
  };
}

/**
 * Fill status for a sell limit:
 * - open: still 100% sell token (price hasn't entered)
 * - partial: in range
 * - filled: converted to quote side (above/below depending on sell side)
 */
function classifyLimitFill({ currentTick, tickLower, tickUpper, sellingToken0 }) {
  const tick = Number(currentTick);
  if (sellingToken0) {
    if (tick < tickLower) return "open";
    if (tick >= tickUpper) return "filled";
    return "partial";
  }
  if (tick >= tickUpper) return "open";
  if (tick < tickLower) return "filled";
  return "partial";
}

module.exports = {
  SWAP_ROUTER,
  QUOTER,
  FACTORY,
  POSITION_MANAGER,
  UNI_V3_POSITION_MANAGER,
  QUOTER_ABI,
  ROUTER_ABI,
  POSITION_MANAGER_ABI,
  UNI_V3_POSITION_MANAGER_ABI,
  POOL_ABI,
  MAX_UINT128,
  isUpDexId,
  alignTickDown,
  alignTickUp,
  ticksForPricePct,
  planLimitSellBand,
  quoteExactInputSingle,
  readPoolState,
  readPosition,
  classifyLimitFill,
};
