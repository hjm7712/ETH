# ETH WATCH — Ethereum Signal Terminal

A `pizzint.watch`-style single-glance dashboard, but for Ethereum: live ETH price + a
DEFCON-style **STRONG SELL → STRONG BUY** signal gauge driven by rule-based technical indicators.

> ⚠️ **Not financial advice.** This computes textbook technical indicators (RSI, moving-average
> crossovers, MACD) and turns them into a signal. Indicators are not predictions and do not
> guarantee returns. Build it to learn — don't bet the farm on it.

## Stack
- **Next.js (App Router) + TypeScript**
- Live price: **Binance WebSocket** (`ethusdt@ticker`)
- Signal engine: server route `/api/signal` pulls 1h candles from Binance REST and computes
  indicators in `lib/indicators.ts` (no external libraries — every number is auditable)

## Run it

**Windows — one click:** double-click **`start.bat`** (installs deps on first run, then launches and opens the browser). 한국어 안내는 **`실행방법.md`** 참고.

**Any OS — terminal:**
```bash
cd eth-watch
npm install
npm run dev
```
Open http://localhost:3000

> First run installs packages (1–2 min, needs internet). If you cloned from GitHub, `node_modules` isn't included — that's expected; `npm install` (or `start.bat`) creates it.

## How the signal works
`app/api/signal/route.ts` scores four checks, each voting BUY (+1) / SELL (−1):
| Check | BUY when | SELL when |
|-------|----------|-----------|
| RSI(14) | < 30 (oversold) | > 70 (overbought) |
| MA50 vs MA200 | golden cross | death cross |
| Price vs MA50 | above | below |
| MACD histogram | > 0 | < 0 |

The net ratio maps to: STRONG SELL / SELL / HOLD / BUY / STRONG BUY.
Tune the thresholds and add indicators (Bollinger, Stochastic, volume) in that one file.

## If the price feed is blocked
Binance APIs are geo-restricted in some regions (e.g. the US). If you see
"price feed unavailable", swap the data source to **CoinGecko** (no key, generous free tier):

- Candles: `https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=14`
- Live price: poll `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`
  every few seconds instead of using the WebSocket.

## Ideas to extend
- Embed a **TradingView** candlestick widget under the price block
- Browser/Telegram **alerts** when the verdict flips (e.g. → STRONG BUY)
- Store signal history in a DB to backtest how the rules would have performed
- Add a timeframe switch (15m / 1h / 1d)

## Deploy
Push to GitHub → import into **Vercel** → deploy (free). The signal route runs as a serverless function.
