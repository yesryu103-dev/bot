/**
 * Uni V4 ETH helpers for Robinhood (fallback when Uni V3 WETH quote is unavailable).
 * Never routes through USDG / stock-GME hubs (those multi-hop paths lose retail size).
 */
const { ethers } = require("ethers");

const NATIVE_ETH = ethers.ZeroAddress;
const DYNAMIC_FEE_FLAG = 0x800000;

const DEFAULTS = {
  universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
};

const CMD_V4_SWAP = 0x10;
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;

function urInterface() {
  return new ethers.Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  ]);
}

function isV4PoolId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

function dexPairIsV4(pair) {
  return (pair?.labels || []).map((x) => String(x).toLowerCase()).includes("v4");
}

function dexPairHasUsdg(pair) {
  const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
  const b = String(pair?.baseToken?.address || "").toLowerCase();
  const q = String(pair?.quoteToken?.address || "").toLowerCase();
  return b === usdg || q === usdg;
}

/** Deepest v4 token/ETH pool (native 0x000… only — skips USDG hubs). */
function listV4EthPools(pairs, tokenAddress) {
  const token = String(tokenAddress || "").toLowerCase();
  const zero = "0x0000000000000000000000000000000000000000";
  return (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => String(pair.chainId || "").toLowerCase() === "robinhood")
    .filter((pair) => dexPairIsV4(pair) && !dexPairHasUsdg(pair))
    .filter((pair) => {
      const base = String(pair.baseToken?.address || "").toLowerCase();
      const quote = String(pair.quoteToken?.address || "").toLowerCase();
      if (!(base === token || quote === token)) return false;
      const other = base === token ? quote : base;
      return other === zero || other === NATIVE_ETH;
    })
    .filter((pair) => Number(pair.liquidity?.usd || 0) > 0)
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
}

function pickV4EthPool(pairs, tokenAddress) {
  return listV4EthPools(pairs, tokenAddress)[0] || null;
}

/**
 * Known Doppler / Rehype / multicurve hooks (Robinhood 4663 + common mainnet clones).
 * Env V4_HOOK_HINTS=0x..,0x.. extends this list for recover/classify.
 */
const KNOWN_V4_HOOKS = [
  // Robinhood Chain (4663) — whetstoneresearch/doppler Deployments.json
  "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544", // DopplerHookInitializer
  "0x7bf319d8e969f7596b1bc171da9ce322f67ae0c4", // DopplerHookMigrator
  "0x9982538f41f2ae29ddb9d3d9307010052984fdbb", // RehypeDopplerHookInitializer
  "0x975f9d1939cf6e4a3c9d99f9d41e6411cf4da23b", // RehypeDopplerHookMigrator
  "0xc16c826f75338a5ea626f94f8992191b4ce5aba2", // SwapRestrictorDopplerHook
  // Cross-chain Doppler / Rehype clones often reused in memes
  "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544",
  "0x1e40b0875dda35f41e15cfb475403859b8c860c4",
  "0x3ec4798a9b11e8243a8db99687f7a23597b96623",
  "0x56ea13da5f39863d3b3d54826187306af7ada544",
  "0x97cad5684fb7cc2bed9a9b5ebfba67138f4f2503",
  "0x78c79c95eaceb2d08f7a55cc0d31012f8af510c3",
  "0x9349e5a3e6458aa65e2fb7ed67e9ad08ae7f660d",
  "0xbf4195ab0b03e1eb3345dd1e83bed7650b1ed123",
  "0xea95dfdf69b90c65c827070852f7039d6af6dd7b",
  "0xbb7784a4d481184283ed89619a3e3ed143e1adc0", // DecayMulticurveInitializerHook
  "0xc6a562cb5cbfa29bcb1bdccf903b8b8f2e4a2dc0",
  "0x580ca49389d83b019d07e17e99454f2f218e2dc0",
  "0x11b55a121a38fdab8faf16f9f1a4f124e3f42d40",
  "0x892d3c2b4abeaaf67d52a7b29783e2161b7cad40",
  "0xfaf16d11737e6552156dd328cd26c530e1da2d40",
  "0x6a1061fc558dde1e6fd0efd641b370d435b56d40",
];

function knownV4HookHints() {
  const fromEnv = String(process.env.V4_HOOK_HINTS || "")
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => /^0x[a-f0-9]{40}$/.test(item));
  return [...new Set([...KNOWN_V4_HOOKS.map((h) => h.toLowerCase()), ...fromEnv])];
}

function recoverV4PoolKeyEither(poolId, tokenAddress, hookHints = []) {
  const token = tokenAddress;
  return (
    recoverV4PoolKey(poolId, token, NATIVE_ETH, hookHints) ||
    recoverV4PoolKey(poolId, NATIVE_ETH, token, hookHints)
  );
}

/**
 * Classify a V4 ETH pool for hook-fee safety.
 * clean = hooks is zero; hooked = known non-zero hook; unsafe = cannot recover.
 */
function classifyV4EthPool(poolId, tokenAddress) {
  const id = String(poolId || "").toLowerCase();
  if (!isV4PoolId(id)) return { status: "unsafe", key: null, clean: false, hooked: false };

  const cleanKey = recoverV4PoolKeyEither(id, tokenAddress, []);
  if (cleanKey && String(cleanKey.hooks).toLowerCase() === NATIVE_ETH) {
    return { status: "clean", key: cleanKey, clean: true, hooked: false };
  }

  const hookedKey = recoverV4PoolKeyEither(id, tokenAddress, knownV4HookHints());
  if (hookedKey && String(hookedKey.hooks).toLowerCase() !== NATIVE_ETH) {
    return { status: "hooked", key: hookedKey, clean: false, hooked: true };
  }

  return { status: "unsafe", key: null, clean: false, hooked: false };
}

/** Deepest V4 native-ETH pool with hooks=0x0 (skips Doppler/Rehype fee skims). */
function pickCleanV4EthPool(pairs, tokenAddress) {
  for (const pair of listV4EthPools(pairs, tokenAddress)) {
    const classified = classifyV4EthPool(pair.pairAddress, tokenAddress);
    if (classified.clean) {
      return { pair, key: classified.key, liquidityUsd: Number(pair.liquidity?.usd || 0) };
    }
  }
  return null;
}

function recoverV4PoolKey(poolId, currencyA, currencyB, hookHints = []) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const aIn = !currencyA || currencyA === NATIVE_ETH ? NATIVE_ETH : ethers.getAddress(currencyA);
  const bIn = !currencyB || currencyB === NATIVE_ETH ? NATIVE_ETH : ethers.getAddress(currencyB);
  const [a, b] = BigInt(aIn) < BigInt(bIn) ? [aIn, bIn] : [bIn, aIn];
  const hooksList = [
    ...hookHints.map((h) => (h && h !== NATIVE_ETH ? ethers.getAddress(h) : NATIVE_ETH)),
    NATIVE_ETH,
  ];
  const fees = [DYNAMIC_FEE_FLAG, 2500, 3000, 10000, 500, 100, 7000, 2000, 4000, 5000, 1];
  const target = String(poolId).toLowerCase();
  const spacings = [1, 10, 60, 200, 500, 1000, 20, 30, 50, 100, 250, 2, 5, 8, 15, 25];
  for (const fee of fees) {
    for (const hooks of hooksList) {
      for (const tickSpacing of spacings) {
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
    [[[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], Boolean(zeroForOne), amountIn, minAmountOut, 0n, "0x"]],
  );
  const settleParams = coder.encode(["address", "uint256"], [tokenIn, amountIn]);
  const takeParams = coder.encode(["address", "uint256"], [tokenOut, minAmountOut]);
  const actions = ethers.hexlify(Uint8Array.of(ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL));
  const v4Input = coder.encode(["bytes", "bytes[]"], [actions, [swapParams, settleParams, takeParams]]);
  return urInterface().encodeFunctionData("execute", [ethers.hexlify(Uint8Array.of(CMD_V4_SWAP)), [v4Input], deadline]);
}

async function quoteV4ExactInSpot(provider, poolId, zeroForOne, amountIn, stateViewAddress = DEFAULTS.stateView) {
  const view = new ethers.Contract(
    stateViewAddress,
    ["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"],
    provider,
  );
  const [sqrtPriceX96, , , lpFee] = await view.getSlot0(poolId);
  const fee = BigInt(lpFee || 0);
  const amountAfterFee = (BigInt(amountIn) * (1_000_000n - fee)) / 1_000_000n;
  const Q96 = 1n << 96n;
  const sqrt = BigInt(sqrtPriceX96);
  if (sqrt <= 0n || amountAfterFee <= 0n) return 0n;
  if (zeroForOne) return (amountAfterFee * sqrt * sqrt) / (Q96 * Q96);
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
  const ethPerToken = base === token ? priceNative : 1 / priceNative;
  if (!(ethPerToken > 0) || !Number.isFinite(ethPerToken)) {
    throw new Error("Invalid v4 ethPerToken quote.");
  }
  // Mid price — slippage is applied by caller (minOut). Do not double-haircut here.
  if (side === "BUY") {
    const eth = Number(ethers.formatEther(amountIn));
    const tokens = eth / ethPerToken;
    return ethers.parseUnits(Math.max(tokens, 0).toFixed(12), 18);
  }
  const tokens = Number(ethers.formatUnits(amountIn, 18));
  const eth = tokens * ethPerToken;
  return ethers.parseEther(Math.max(eth, 0).toFixed(18));
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
    throw new Error(`Not enough token to sell. Need ${amountIn.toString()}, wallet has ${balance.toString()}.`);
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
  DEFAULTS,
  KNOWN_V4_HOOKS,
  isV4PoolId,
  listV4EthPools,
  pickV4EthPool,
  pickCleanV4EthPool,
  classifyV4EthPool,
  knownV4HookHints,
  recoverV4PoolKey,
  encodeExactInputSingle,
  quoteV4ExactInSpot,
  quoteViaDexPrice,
  ensurePermit2,
};
