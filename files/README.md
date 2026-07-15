# Bot Telegram theo dõi Buy/Sell — REPE/WETH trên Uniswap v3 (Robinhood Chain)

Bot poll trực tiếp RPC của Robinhood Chain (chain ID `4663`), đọc event `Swap` từ pool
Uniswap v3 `REPE/WETH` (`0xB541C2936982DD5c4090783d8F395d3e613c8016`) và bắn tin buy/sell
vào Telegram gần realtime.

Đã map sẵn theo 2 link bro gửi:
- Pool (dexscreener): `0xB541C2936982DD5c4090783d8F395d3e613c8016`
- REPE: `0x5266eeafF092D6136AB63D18B975A60a0Cc0C8f7`
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`

## 1. Cài đặt

```bash
npm install
cp .env.example .env
```

Mở `.env` và điền:
- `TELEGRAM_BOT_TOKEN`: tạo bot qua [@BotFather](https://t.me/BotFather) → `/newbot`
- `TELEGRAM_CHAT_ID`: nếu bắn vào channel/group, add bot vào rồi lấy ID (dùng `@userinfobot`
  hoặc gọi `https://api.telegram.org/bot<TOKEN>/getUpdates` sau khi gửi 1 tin test trong group)

Mặc định RPC dùng endpoint public `https://rpc.mainnet.chain.robinhood.com` — cái này
**rate-limited**, chạy test/dùng cá nhân thì ổn, nhưng nếu chạy 24/7 monitor nhiều thì nên
đăng ký RPC riêng (Alchemy / QuickNode / dRPC đều đã support Robinhood Chain) để tránh bị
throttle/rớt log.

## 2. Chạy

```bash
npm start
```

Bot sẽ:
1. Đọc `token0()/token1()` của pool qua HTTP RPC để biết thứ tự token thật (không assume cứng)
2. Nếu có `RPC_WS_URL` trong `.env`: mở WebSocket, subscribe thẳng `Swap` event — nhận tin
   ngay khi block confirm, không còn delay theo poll interval
3. Gửi tin Telegram qua **queue riêng, không await trong lúc xử lý event** — Swap tiếp theo
   không bao giờ bị chặn bởi Telegram chậm/rate-limit; nếu dính 429, queue tự retry với
   backoff (1s → 3s → 8s) mà không ảnh hưởng các swap khác
4. `sender` lấy thẳng từ event để build tin gửi ngay lập tức; `tx.from` (ví thật) được
   tra cứu song song và chỉ log thêm để đối chiếu, không làm chậm tin nhắn đầu
5. WS tự **reconnect** khi rớt (backoff 1s/2s/5s/10s/10s, tối đa 5 lần); nếu vẫn fail thì
   tự động **fallback về polling HTTP** dùng `RPC_URL` + `last-block.json` (giữ nguyên cơ
   chế cũ, không mất dữ liệu, không duplicate)
6. Xác định buy/sell theo dấu amount base token: REPE ra khỏi pool = MUA, REPE vào pool = BÁN
   (logic này giữ nguyên 100% từ bản đầu)

## 3. Format tin nhắn mẫu

```
🟢 MUA REPE
Số lượng: 1,234.56 REPE
Giá trị: 0.0821 WETH
Giá: 0.0000665 WETH/REPE
Ví: 0xAbCd...1234
Tx: 0x0046...38d6
```

## 4. Test nhanh với 2 tx bro gửi

Muốn kiểm tra logic buy/sell đúng chưa, có thể dùng chính 2 tx này làm reference
(so kết quả bot log ra console với data thật trên Blockscout):
- Buy: `0x004684c42fcc9b3388b5ab0133766b3ee6500de22a28ef44f42d450989238d6f`
- Sell: `0x889c0a34b3fce3fb83cc538f2151ed477acec729fed34047d9b472e407d004cf`

## 5. Lưu ý / mở rộng thêm nếu cần

- **Chạy 24/7**: nên deploy lên VPS nhỏ (hoặc dùng `pm2 start index.js --name repe-bot`)
  để tự restart khi crash.
- **RPC_WS_URL bắt buộc để có tốc độ realtime** — free tại alchemy.com (30M CU/tháng,
  25 req/s, đủ dùng thoải mái cho 1 pool volume thấp). Không điền thì bot tự chạy polling,
  chậm hơn nhưng vẫn hoạt động bình thường.
- **Nhiều pool/token cùng lúc**: hiện code chỉ theo dõi 1 pool. Nếu muốn theo dõi nhiều
  pool cùng lúc, có thể refactor thành loop qua array config thay vì 1 pool cứng —
  nói mình biết, mình viết multi-pool cho.
- **Lọc theo giá trị**: chỉnh `MIN_QUOTE_AMOUNT` trong `.env` để bỏ qua swap lặt vặt
  (vd chỉ báo khi >= 0.01 WETH ~ vài chục đô tùy giá ETH).
- **Log ví thật (tx.from)**: hiện chỉ in ra console để đối chiếu chứ không sửa lại tin
  đã gửi Telegram (tránh phải edit message, giữ tốc độ tối đa). Nếu muốn tin nhắn Telegram
  luôn hiển thị đúng ví ví thật ngay từ đầu (đánh đổi lấy độ trễ ~1 RPC call), nói mình biết
  mình đổi lại.
