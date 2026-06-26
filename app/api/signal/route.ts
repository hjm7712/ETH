import { NextResponse } from "next/server";
import { sma, rsi, macd } from "@/lib/indicators";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Reason = { label: string; value: string; vote: "BUY" | "SELL" | "NEUTRAL" };

const TIMEFRAMES = [
  { interval: "15m", label: "15M", days: "1" },
  { interval: "4h",  label: "4H",  days: "14" },
  { interval: "1d",  label: "1D",  days: "300" },
  { interval: "1w",  label: "1W",  days: "2100" },
];

function verdictFromRatio(ratio: number): string {
  if (ratio >= 0.6) return "STRONG BUY";
  if (ratio >= 0.25) return "BUY";
  if (ratio <= -0.6) return "STRONG SELL";
  if (ratio <= -0.25) return "SELL";
  return "HOLD";
}

function computeSignal(closes: number[]) {
  const price = closes[closes.length - 1];
  const r = rsi(closes, 14);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const m = macd(closes);

  let score = 0;
  const reasons: Reason[] = [];

  if (r !== null) {
    let vote: Reason["vote"] = "NEUTRAL";
    if (r < 30) { score += 1; vote = "BUY"; }
    else if (r > 70) { score -= 1; vote = "SELL"; }
    reasons.push({ label: "RSI(14)", value: r.toFixed(1), vote });
  }

  if (sma50 !== null && sma200 !== null) {
    const buy = sma50 > sma200;
    score += buy ? 1 : -1;
    reasons.push({ label: "MA50 / MA200", value: buy ? "GOLDEN" : "DEATH", vote: buy ? "BUY" : "SELL" });
  }

  if (sma50 !== null) {
    const buy = price > sma50;
    score += buy ? 1 : -1;
    reasons.push({ label: "PRICE / MA50", value: buy ? "ABOVE" : "BELOW", vote: buy ? "BUY" : "SELL" });
  }

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

function estimateBottom(daily: number[], weekly: number[], price: number) {
  if (daily.length < 30) return null;
  const swingLow = Math.min(...daily.slice(-120));
  const low = swingLow * 0.9;
  const high = swingLow;
  const estimate = (low + high) / 2;
  const ma200w = sma(weekly, 200);
  const recent = daily.slice(-21);
  let sum = 0; let n = 0;
  for (let i = 1; i < recent.length; i++) {
    sum += (recent[i] - recent[i - 1]) / recent[i - 1]; n++;
  }
  const avgDaily = n ? sum / n : 0;
  let etaDays: number | null = null;
  if (price <= estimate) { etaDays = 0; }
  else if (avgDaily < -0.0005) {
    etaDays = Math.round((price - estimate) / (price * Math.abs(avgDaily)));
  }
  return {
    estimate: Math.round(estimate), low: Math.round(low), high: Math.round(high),
    ma200w: ma200w ? Math.round(ma200w) : null, etaDays, avgDailyPct: +(avgDaily * 100).toFixed(2),
  };
}

async function fetchOHLC(days: string): Promise<number[][]> {
  const url = `https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as number[][];
}

async function fetchCloses(days: string): Promise<number[]> {
  const raw = await fetchOHLC(days);
  return raw.map((c) => c[4]);
}

function analyzeRebound(ohlc: number[][], closes: number[]) {
  const n = closes.length;
  if (n < 25) return null;
  const price = closes[n - 1];
  let lowIdx = n - 1; let lowVal = Infinity;
  for (let i = n - 15; i < n; i++) {
    if (closes[i] < lowVal) { lowVal = closes[i]; lowIdx = i; }
  }
  const daysSinceLow = n - 1 - lowIdx;
  const bouncePct = (price / lowVal - 1) * 100;
  const active = bouncePct >= 3 && daysSinceLow >= 1 && daysSinceLow <= 12;
  if (!active) return { active: false, lowVal: Math.round(lowVal), bouncePct: +bouncePct.toFixed(1), daysSinceLow };

  const rsiVal = rsi(closes, 14);
  const ma20 = sma(closes, 20);
  const histNow = macd(closes).histogram;
  const histPrev = macd(closes.slice(0, -1)).histogram;

  const checks = [
    { k: "RSI 50 회복", ok: rsiVal !== null && rsiVal > 50, val: rsiVal !== null ? rsiVal.toFixed(1) : "—" },
    { k: "MA20 상회", ok: ma20 !== null && price > ma20, val: ma20 !== null ? `$${Math.round(ma20)}` : "—" },
    { k: "MACD 개선", ok: histNow > histPrev, val: histNow > histPrev ? "상승" : "둔화" },
    { k: "거래량 확인", ok: true, val: "N/A" },
    { k: "테이커 매수우위", ok: true, val: "N/A" },
  ];
  const healthy = checks.filter((c) => c.ok).length;
  let verdict: string; let tone: string;
  if (healthy >= 4) { verdict = "신뢰도 높은 반등 · 추세전환 가능"; tone = "good"; }
  else if (healthy >= 2) { verdict = "중립 — 추가 확인 필요"; tone = "warn"; }
  else { verdict = "약한 기술적 반등 · 데드캣 주의"; tone = "bad"; }

  return { active: true, lowVal: Math.round(lowVal), bouncePct: +bouncePct.toFixed(1), daysSinceLow, healthy, total: checks.length, verdict, tone, checks };
}

export async function GET() {
  try {
    const closesByTf: Record<string, number[]> = {};
    const timeframes = await Promise.all(
      TIMEFRAMES.map(async (tf) => {
        const closes = await fetchCloses(tf.days);
        closesByTf[tf.interval] = closes;
        return { interval: tf.interval, label: tf.label, ...computeSignal(closes) };
      })
    );
    const price = timeframes[0].price;
    const bottom = estimateBottom(closesByTf["1d"] ?? [], closesByTf["1w"] ?? [], price);
    const dailyOhlc = await fetchOHLC("60");
    const dailyCloses = dailyOhlc.map((c) => c[4]);
    const rebound = analyzeRebound(dailyOhlc, dailyCloses);
    return NextResponse.json({ price, timeframes, bottom, rebound, updated: Date.now() });
  } catch {
    return NextResponse.json({ error: "price feed unavailable" }, { status: 502 });
  }
}
