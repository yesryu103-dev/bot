/**
 * up Finance Slipstream CL (Robinhood) — native SwapRouter/Quoter, not Kyber.
 * Docs: https://github.com/labrinyang/lp-terminal/blob/main/docs/up33-contract-map.md
 */
const SWAP_ROUTER = "0xC062b870E813fcA720f1e002c234369Ab3aB9415";
const QUOTER = "0x03983AB2C057a2eac211ff01738a1e49ff325B49";
const FACTORY = "0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3";

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
];

function isUpDexId(dexId) {
  const id = String(dexId || "").toLowerCase();
  return id === "up" || id === "up33";
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

module.exports = {
  SWAP_ROUTER,
  QUOTER,
  FACTORY,
  QUOTER_ABI,
  ROUTER_ABI,
  isUpDexId,
  quoteExactInputSingle,
};
