import { NextResponse } from "next/server";
import { sma, rsi, macd } from "@/lib/indicators";

// Always run fresh — never cache the signal.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Reason = { label: string; value: string; vote: "BUY" | "SELL" | "NEUTRAL" };

// Binance kline intervals we evaluate, shortest → longest.
const TIMEFRAMES = [
  { interval: "15m", label: "15M" },
  { interval: "4h", label: "4H" },
  { interval: "1d", label: "1D" },
  { interval: "1w", label: "1W" },
];

function verdictFromRatio(ratio: number): string {
  if (ratio >= 0.6) return "STRONG BUY";
  if (ratio >= 0.25) return "BUY";
  if (ratio <= -0.6) return "STRONG SELL";
  if (ratio <= -0.25) return "SELL";
  return "HOLD";
}

/** Compute the four indicator votes + an aggregate verdict for one timeframe. */
function computeSignal(closes: number[]) {
  const price = closes[closes.length - 1];
  const r = rsi(closes, 14);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const m = macd(closes);

  let score = 0;
  const reasons: Reason[] = [];

  // RSI: <30 oversold (buy), >70 overbought (sell)
  if (r !== null) {
    let vote: Reason["vote"] = "NEUTRAL";
    if (r < 30) { score += 1; vote = "BUY"; }
    else if (r > 70) { score -= 1; vote = "SELL"; }
    reasons.push({ label: "RSI(14)", value: r.toFixed(1), vote });
  }

  // Trend: golden cross (MA50 > MA200) vs death cross
  if (sma50 !== null && sma200 !== null) {
    const buy = sma50 > sma200;
    score += buy ? 1 : -1;
    reasons.push({ label: "MA50 / MA200", value: buy ? "GOLDEN" : "DEATH", vote: buy ? "BUY" : "SELL" });
  }

  // Momentum vs MA50
  if (sma50 !== null) {
    const buy = price > sma50;
    score += buy ? 1 : -1;
    reasons.push({ label: "PRICE / MA50", value: buy ? "ABOVE" : "BELOW", vote: buy ? "BUY" : "SELL" });
  }

  // MACD histogram sign
  {
    let vote: Reason["vote"] = "NEUTRAL";
    if (m.histogram > 0) { score += 1; vote = "BUY"; }
    else if (m.histogram < 0) { score -= 1; vote = "SELL"; }
    reasons.push({ label: "MACD HIST", value: m.histogram.toFixed(2), vote });
  }

  const max = reasons.length;
  const ratio = max > 0 ? score / max : 0;
  return { price, score, max, ratio, verdict: verdictFromRatio(ratio), reasons };
}

/**
 * Transparent, model-based bottom estimate. NOT a prediction — just math:
 *  - price zone = recent structural swing low, with a ~10% capitulation undercut
 *  - ETA = linear extrapolation of the last 20 daily returns (down-momentum only)
 *  - 200-week SMA shown as a long-cycle floor reference
 */
function estimateBottom(daily: number[], weekly: number[], price: number) {
  if (daily.length < 30) return null;

  // Structural support: lowest close over ~last 120 daily candles.
  const swingLow = Math.min(...daily.slice(-120));
  // Final-flush undercut ~10% below structural support → lower bound of the zone.
  const low = swingLow * 0.9;
  const high = swingLow;
  const estimate = (low + high) / 2;

  const ma200w = sma(weekly, 200);

  // Average daily return over the last 20 candles → downward velocity.
  const recent = daily.slice(-21);
  let sum = 0;
  let n = 0;
  for (let i = 1; i < recent.length; i++) {
    sum += (recent[i] - recent[i - 1]) / recent[i - 1];
    n++;
  }
  const avgDaily = n ? sum / n : 0;

  let etaDays: number | null = null;
  if (price <= estimate) {
    etaDays = 0; // already in/below the estimated zone
  } else if (avgDaily < -0.0005) {
    // meaningful downtrend → extrapolate
    etaDays = Math.round((price - estimate) / (price * Math.abs(avgDaily)));
  } // else: no down-momentum → leave null (bottoming / ranging)

  return {
    estimate: Math.round(estimate),
    low: Math.round(low),
    high: Math.round(high),
    ma200w: ma200w ? Math.round(ma200w) : null,
    etaDays,
    avgDailyPct: +(avgDaily * 100).toFixed(2),
  };
}

async function fetchRaw(interval: string, limit: number): Promise<string[][]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as string[][];
}

async function fetchCloses(interval: string): Promise<number[]> {
  // limit 300 covers MA200 warmup on every interval.
  const raw = await fetchRaw(interval, 300);
  // Binance kline format: [openTime, open, high, low, close, volume, ...]
  return raw.map((c) => parseFloat(c[4]));
}

/**
 * Detect a recent bounce off the low and judge whether it's a convincing
 * reversal or just a technical/dead-cat bounce. Uses daily klines (price +
 * taker volume). Five "health" checks the market actually watches.
 */
function analyzeRebound(kl: string[][]) {
  const closes = kl.map((c) => parseFloat(c[4]));
  const totals = kl.map((c) => parseFloat(c[7]));
  const buyPcts = kl.map((c) => {
    const t = parseFloat(c[7]);
    const b = parseFloat(c[10]);
    return t > 0 ? (b / t) * 100 : 50;
  });
  const n = closes.length;
  if (n < 25) return null;

  const price = closes[n - 1];
  // Swing low over the last 15 days.
  let lowIdx = n - 1;
  let lowVal = Infinity;
  for (let i = n - 15; i < n; i++) {
    if (closes[i] < lowVal) {
      lowVal = closes[i];
      lowIdx = i;
    }
  }
  const daysSinceLow = n - 1 - lowIdx;
  const bouncePct = (price / lowVal - 1) * 100;

  // A bounce is "active" if we're ≥3% off a low set in the last 1–12 days.
  const active = bouncePct >= 3 && daysSinceLow >= 1 && daysSinceLow <= 12;
  if (!active) {
    return { active: false, lowVal: Math.round(lowVal), bouncePct: +bouncePct.toFixed(1), daysSinceLow };
  }

  const rsiVal = rsi(closes, 14);
  const ma20 = sma(closes, 20);
  const histNow = macd(closes).histogram;
  const histPrev = macd(closes.slice(0, -1)).histogram;

  // Volume confirmation: up-days since the low vs 20-day median volume.
  const bounceIdx: number[] = [];
  for (let i = lowIdx + 1; i < n; i++) bounceIdx.push(i);
  const upDays = bounceIdx.filter((i) => closes[i] > closes[i - 1]);
  const sorted = totals.slice(-20).slice().sort((a, b) => a - b);
  const medVol = sorted[Math.floor(sorted.length / 2)] || 1;
  const upVolAvg = upDays.length ? upDays.reduce((a, i) => a + totals[i], 0) / upDays.length : 0;
  const buyAvg = bounceIdx.length ? bounceIdx.reduce((a, i) => a + buyPcts[i], 0) / bounceIdx.length : 50;

  const checks = [
    { k: "RSI 50 회복", ok: rsiVal !== null && rsiVal > 50, val: rsiVal !== null ? rsiVal.toFixed(1) : "—" },
    { k: "MA20 상회", ok: ma20 !== null && price > ma20, val: ma20 !== null ? `$${Math.round(ma20)}` : "—" },
    { k: "MACD 개선", ok: histNow > histPrev, val: histNow > histPrev ? "상승" : "둔화" },
    { k: "거래량 확인", ok: upVolAvg > medVol, val: `${(upVolAvg / medVol).toFixed(2)}× 중앙값` },
    { k: "테이커 매수우위", ok: buyAvg > 50, val: `${buyAvg.toFixed(1)}%` },
  ];
  const healthy = checks.filter((c) => c.ok).length;

  let verdict: string;
  let tone: string;
  if (healthy >= 4) {
    verdict = "신뢰도 높은 반등 · 추세전환 가능";
    tone = "good";
  } else if (healthy >= 2) {
    verdict = "중립 — 추가 확인 필요";
    tone = "warn";
  } else {
    verdict = "약한 기술적 반등 · 데드캣 주의";
    tone = "bad";
  }

  return {
    active: true,
    lowVal: Math.round(lowVal),
    bouncePct: +bouncePct.toFixed(1),
    daysSinceLow,
    healthy,
    total: checks.length,
    verdict,
    tone,
    checks,
  };
}

export async function GET() {
  try {
    const closesByTf: Record<string, number[]> = {};
    const timeframes = await Promise.all(
      TIMEFRAMES.map(async (tf) => {
        const closes = await fetchCloses(tf.interval);
        closesByTf[tf.interval] = closes;
        return { interval: tf.interval, label: tf.label, ...computeSignal(closes) };
      })
    );
    // Spot ≈ last close of the shortest timeframe.
    const price = timeframes[0].price;
    const bottom = estimateBottom(closesByTf["1d"] ?? [], closesByTf["1w"] ?? [], price);
    // Rebound analysis needs daily price + taker volume (separate, smaller pull).
    const rebound = analyzeRebound(await fetchRaw("1d", 60));
    return NextResponse.json({ price, timeframes, bottom, rebound, updated: Date.now() });
  } catch {
    return NextResponse.json({ error: "price feed unavailable" }, { status: 502 });
  }
}
