import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";
import fetch from "node-fetch";

// ================= CONFIG =================
const {
  RPC_URL,
  RPC_WS_URL,
  POOL_ADDRESS,
  BASE_TOKEN_ADDRESS,
  BASE_TOKEN_SYMBOL,
  QUOTE_TOKEN_ADDRESS,
  QUOTE_TOKEN_SYMBOL,
  MIN_QUOTE_AMOUNT,
  POLL_INTERVAL_MS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  EXPLORER_TX_BASE,
} = process.env;

const minQuoteAmount = parseFloat(MIN_QUOTE_AMOUNT || "0");
const pollIntervalMs = parseInt(POLL_INTERVAL_MS || "3000", 10);
const STATE_FILE = "./last-block.json";

// Uniswap V3 pool - chỉ cần đúng 1 event + 2 hàm đọc token
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const swapIface = new ethers.Interface(POOL_ABI);
const swapTopic = swapIface.getEvent("Swap").topicHash;

// ============ STATE FILE (dùng chung cho polling / fallback) ============
function loadLastBlock() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw).lastBlock;
  } catch {
    return null;
  }
}

function saveLastBlock(blockNumber) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastBlock: blockNumber }));
}

// ============ HELPERS ============
function fmt(num, maxDecimals = 6) {
  const n = Number(num);
  if (!isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

function shortAddr(addr) {
  if (!addr) return "?";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ TELEGRAM QUEUE — không bao giờ block pipeline xử lý swap ============
const tgQueue = [];
let tgWorkerRunning = false;
const TG_BACKOFFS_MS = [1000, 3000, 8000];

function enqueueTelegram(text) {
  tgQueue.push({ text, attempts: 0 });
  if (!tgWorkerRunning) processTelegramQueue();
}

async function processTelegramQueue() {
  tgWorkerRunning = true;
  while (tgQueue.length > 0) {
    const item = tgQueue[0];
    try {
      await sendTelegramMessage(item.text);
      tgQueue.shift();
    } catch (err) {
      item.attempts += 1;
      if (item.attempts > TG_BACKOFFS_MS.length) {
        console.error(
          "Bỏ qua 1 tin Telegram sau nhiều lần retry:",
          err.message || err
        );
        tgQueue.shift();
        continue;
      }
      const wait = TG_BACKOFFS_MS[item.attempts - 1];
      console.warn(
        `Telegram lỗi (lần ${item.attempts}/${TG_BACKOFFS_MS.length}): ${err.message || err} — retry sau ${wait}ms`
      );
      await sleep(wait);
    }
  }
  tgWorkerRunning = false;
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram HTTP ${res.status}: ${body}`);
  }
}

// ============ SWAP DECODE + MESSAGE (dùng chung WS & polling) ============
let baseDecimals, quoteDecimals, isBaseToken0;

function buildMessage({ isBuy, baseAmount, quoteAmount, price, trader, txHash }) {
  const emoji = isBuy ? "🟢" : "🔴";
  const action = isBuy ? "MUA" : "BÁN";
  return (
    `${emoji} <b>${action} ${BASE_TOKEN_SYMBOL}</b>\n` +
    `Số lượng: <b>${fmt(baseAmount)} ${BASE_TOKEN_SYMBOL}</b>\n` +
    `Giá trị: <b>${fmt(quoteAmount)} ${QUOTE_TOKEN_SYMBOL}</b>\n` +
    `Giá: <b>${fmt(price, 10)} ${QUOTE_TOKEN_SYMBOL}/${BASE_TOKEN_SYMBOL}</b>\n` +
    `Ví: <code>${shortAddr(trader)}</code>\n` +
    `Tx: <a href="${EXPLORER_TX_BASE}${txHash}">${shortAddr(txHash)}</a>`
  );
}

// Core xử lý 1 swap đã decode xong (rawBase/rawQuote là BigInt có dấu)
// KHÔNG await bất cứ gì trước khi enqueue tin nhắn — đây là điểm mấu chốt giữ tốc độ
function processSwapAndNotify({ rawBase, rawQuote, sender, txHash, readProvider }) {
  try {
    const isBuy = rawBase < 0n;
    const baseAmount = Math.abs(Number(ethers.formatUnits(rawBase, baseDecimals)));
    const quoteAmount = Math.abs(Number(ethers.formatUnits(rawQuote, quoteDecimals)));

    if (quoteAmount < minQuoteAmount) return;

    const price = baseAmount > 0 ? quoteAmount / baseAmount : 0;

    // Gửi ngay với "sender" lấy thẳng từ event (thường là router) — không đợi tra cứu gì cả
    const text = buildMessage({
      isBuy,
      baseAmount,
      quoteAmount,
      price,
      trader: sender,
      txHash,
    });

    console.log(text.replace(/<[^>]+>/g, " | "));
    enqueueTelegram(text);

    // Tra ví thật (tx.from) chạy song song, không chặn gì — chỉ để log đối chiếu
    if (readProvider && txHash) {
      readProvider
        .getTransaction(txHash)
        .then((tx) => {
          if (tx?.from && tx.from.toLowerCase() !== sender.toLowerCase()) {
            console.log(`   ↳ ví thật (tx.from) của ${shortAddr(txHash)}: ${tx.from}`);
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error("Lỗi xử lý swap:", err.message || err);
  }
}

// Dùng cho polling: nhận raw Log, tự parse qua interface
function handleRawLog(log, readProvider) {
  try {
    const parsed = swapIface.parseLog(log);
    const { amount0, amount1, sender } = parsed.args;
    const rawBase = isBaseToken0 ? amount0 : amount1;
    const rawQuote = isBaseToken0 ? amount1 : amount0;
    processSwapAndNotify({
      rawBase,
      rawQuote,
      sender,
      txHash: log.transactionHash,
      readProvider,
    });
  } catch (err) {
    console.error("Lỗi parse log swap:", err.message || err);
  }
}

// ============ HTTP POLLING (dự phòng khi WS chết) ============
let pollingActive = false;

async function pollOnce(provider, lastBlockRef) {
  const latest = await provider.getBlockNumber();
  if (latest <= lastBlockRef.value) return;

  const MAX_RANGE = 500;
  let fromBlock = lastBlockRef.value + 1;

  while (fromBlock <= latest) {
    const toBlock = Math.min(fromBlock + MAX_RANGE - 1, latest);
    const logs = await provider.getLogs({
      address: POOL_ADDRESS,
      topics: [swapTopic],
      fromBlock,
      toBlock,
    });
    for (const log of logs) handleRawLog(log, provider);
    fromBlock = toBlock + 1;
  }

  lastBlockRef.value = latest;
  saveLastBlock(lastBlockRef.value);
}

function startPollingFallback() {
  if (pollingActive) return;
  pollingActive = true;
  console.warn("⚠️  Chuyển sang chế độ polling HTTP dự phòng (WS không dùng được).");

  const fallbackProvider = new ethers.JsonRpcProvider(RPC_URL);
  const lastBlockRef = { value: loadLastBlock() };

  (async () => {
    if (lastBlockRef.value == null) {
      lastBlockRef.value = await fallbackProvider.getBlockNumber();
      saveLastBlock(lastBlockRef.value);
    }
    console.log(`Polling mỗi ${pollIntervalMs}ms, bắt đầu từ block ${lastBlockRef.value}`);

    const run = () =>
      pollOnce(fallbackProvider, lastBlockRef).catch((err) =>
        console.error("Lỗi khi poll:", err.message || err)
      );

    await run();
    setInterval(run, pollIntervalMs);
  })();
}

// ============ WEBSOCKET + AUTO-RECONNECT ============
const RECONNECT_BACKOFFS_MS = [1000, 2000, 5000, 10000, 10000]; // tối đa 5 lần thử
let reconnectAttempts = 0;
let wsProvider = null;

function setupWsProvider() {
  const safeUrl = RPC_WS_URL.replace(/\/v2\/.+$/, "/v2/***");
  console.log("Đang kết nối WebSocket:", safeUrl);

  wsProvider = new ethers.WebSocketProvider(RPC_WS_URL);
  const wsPool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wsProvider);

  wsPool.on("Swap", (sender, _recipient, amount0, amount1, _sqrtPriceX96, _liquidity, _tick, eventPayload) => {
    const rawBase = isBaseToken0 ? amount0 : amount1;
    const rawQuote = isBaseToken0 ? amount1 : amount0;
    const txHash = eventPayload?.log?.transactionHash ?? eventPayload?.transactionHash;
    processSwapAndNotify({ rawBase, rawQuote, sender, txHash, readProvider: wsProvider });
  });

  // Bắt sự kiện rớt kết nối ở tầng socket gốc (ethers v6 dùng thư viện "ws" trên Node)
  const rawSocket = wsProvider.websocket;
  if (rawSocket?.on) {
    rawSocket.on("close", () => handleWsDown("socket closed"));
    rawSocket.on("error", (err) => handleWsDown(err));
  } else {
    console.warn("Không truy cập được raw websocket để bắt sự kiện close/error — reconnect có thể không tự động kích hoạt.");
  }

  reconnectAttempts = 0; // reset sau khi connect lại thành công
  console.log("✅ WS đã kết nối — đang lắng nghe Swap event realtime, không còn delay theo poll interval.");
}

function handleWsDown(reason) {
  if (pollingActive) return; // đã fallback rồi thì bỏ qua, không cần reconnect nữa
  console.error("❌ WS mất kết nối:", reason?.message || reason);
  tryReconnect();
}

function tryReconnect() {
  if (pollingActive) return;

  if (reconnectAttempts >= RECONNECT_BACKOFFS_MS.length) {
    console.error(`WS reconnect thất bại sau ${RECONNECT_BACKOFFS_MS.length} lần thử.`);
    startPollingFallback();
    return;
  }

  const wait = RECONNECT_BACKOFFS_MS[reconnectAttempts];
  reconnectAttempts += 1;
  console.warn(`🔄 Thử reconnect WS lần ${reconnectAttempts}/${RECONNECT_BACKOFFS_MS.length} sau ${wait}ms...`);

  setTimeout(() => {
    try {
      wsProvider?.destroy?.();
    } catch {
      // ignore lỗi khi đóng socket cũ
    }
    try {
      setupWsProvider();
    } catch (err) {
      console.error("Reconnect thất bại:", err.message || err);
      tryReconnect();
    }
  }, wait);
}

// ============ MAIN ============
async function main() {
  console.log("Đang đọc thông tin pool qua HTTP RPC:", RPC_URL);
  const httpProvider = new ethers.JsonRpcProvider(RPC_URL);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, httpProvider);

  const [token0Addr, token1Addr] = await Promise.all([pool.token0(), pool.token1()]);
  const token0 = new ethers.Contract(token0Addr, ERC20_ABI, httpProvider);
  const token1 = new ethers.Contract(token1Addr, ERC20_ABI, httpProvider);
  const [dec0, dec1] = await Promise.all([token0.decimals(), token1.decimals()]);

  isBaseToken0 = token0Addr.toLowerCase() === BASE_TOKEN_ADDRESS.toLowerCase();
  baseDecimals = isBaseToken0 ? dec0 : dec1;
  quoteDecimals = isBaseToken0 ? dec1 : dec0;

  console.log(`Pool: ${POOL_ADDRESS} | token0=${token0Addr} token1=${token1Addr}`);
  console.log(
    `Base=${BASE_TOKEN_SYMBOL} (decimals ${baseDecimals}) | Quote=${QUOTE_TOKEN_SYMBOL} (decimals ${quoteDecimals})`
  );

  if (RPC_WS_URL) {
    try {
      setupWsProvider();
    } catch (err) {
      console.error("Không khởi tạo được WS:", err.message || err);
      startPollingFallback();
    }
  } else {
    console.warn("Không có RPC_WS_URL trong .env — chạy thẳng chế độ polling HTTP.");
    startPollingFallback();
  }
}

main().catch((err) => {
  console.error("Lỗi khởi động bot:", err);
  process.exit(1);
});
