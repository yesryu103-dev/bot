/**
 * Chain / DEX presets for the Telegram trading bot.
 * Set CHAIN=robinhood (default) or CHAIN=bsc in .env.
 */
const CHAINS = {
  robinhood: {
    id: "robinhood",
    name: "Robinhood Chain",
    dexId: "uniswap",
    dexLabel: "Uni",
    nativeSymbol: "ETH",
    wrappedSymbol: "WETH",
    wrappedAddress: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    rpcWsUrl: "",
    explorerBaseUrl: "https://robinhoodchain.blockscout.com",
    swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
    quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
    defaultFee: 10000,
    feeTiers: [10000, 3000, 500, 100],
    enableV4: true,
    // Robinhood Uni V4 singleton (Blockscout name: PoolManager).
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    // Sample pair for docs / empty boot (REPE/WETH).
    defaultPair: "0xb541c2936982dd5c4090783d8f395d3e613c8016",
    defaultBase: "0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7",
    defaultBaseSymbol: "REPE",
  },
  bsc: {
    id: "bsc",
    name: "BNB Smart Chain",
    dexId: "pancakeswap",
    dexLabel: "Pancake",
    nativeSymbol: "BNB",
    wrappedSymbol: "WBNB",
    wrappedAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    rpcUrl: "https://bsc-rpc.publicnode.com",
    rpcWsUrl: "wss://bsc-rpc.publicnode.com",
    explorerBaseUrl: "https://bscscan.com",
    // PancakeSwap V3 SwapRouter (exactInputSingle / multicall / unwrapWETH9).
    swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
    defaultFee: 2500,
    feeTiers: [2500, 10000, 500, 100, 3000],
    enableV4: false,
    poolManager: "",
    defaultPair: "",
    defaultBase: "",
    defaultBaseSymbol: "TOKEN",
  },
};

function resolveChain(name = process.env.CHAIN || "robinhood") {
  const key = String(name || "robinhood").trim().toLowerCase();
  const aliases = {
    rh: "robinhood",
    robinhoodchain: "robinhood",
    pancake: "bsc",
    pancakeswap: "bsc",
    bnb: "bsc",
    bnbchain: "bsc",
  };
  const id = aliases[key] || key;
  const chain = CHAINS[id];
  if (!chain) {
    throw new Error(`Unknown CHAIN=${name}. Use robinhood or bsc (pancakeswap).`);
  }
  return chain;
}

module.exports = { CHAINS, resolveChain };
