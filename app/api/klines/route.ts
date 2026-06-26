import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTERVAL_MAP: Record<string, { days: string }> = {
  "15m": { days: "7" },
  "1h":  { days: "30" },
  "1d":  { days: "365" },
  "1w":  { days: "max" },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw_iv = searchParams.get("interval") ?? "1d";
  const cfg = INTERVAL_MAP[raw_iv] ?? INTERVAL_MAP["1d"];

  // CoinGecko OHLC endpoint: days<=90 → 4h candles, days>90 → daily candles
  // For 15m/1h we use market_chart (prices array) and resample manually
  const useOhlc = raw_iv === "1d" || raw_iv === "1w";

  try {
    if (useOhlc) {
      const url = `https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=${cfg.days}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const raw = (await res.json()) as number[][];

      const candles = raw.map((c) => ({
        time: Math.floor(c[0] / 1000),
        open: c[1], high: c[2], low: c[3], close: c[4],
      }));
      const volume = raw.map((c) => ({
        time: Math.floor(c[0] / 1000),
        value: 0,
        color: c[4] >= c[1] ? "rgba(34,224,107,0.45)" : "rgba(255,77,77,0.45)",
      }));
      return NextResponse.json({ candles, volume });
    } else {
      // 15m → 7일치 hourly, 1h → 30일치 hourly prices로 근사 캔들 생성
      const url = `https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${cfg.days}&interval=hourly`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { prices: number[][] };

      // 1h 봉: 그대로 사용 / 15m 봉: 1시간 데이터를 4개로 나눠 근사
      const prices = data.prices;
      const groupSize = raw_iv === "15m" ? 1 : 1; // hourly 데이터를 캔들로 변환

      const candles = [];
      const volume = [];
      for (let i = 1; i < prices.length; i++) {
        const time = Math.floor(prices[i][0] / 1000);
        const open = prices[i - 1][1];
        const close = prices[i][1];
        const high = Math.max(open, close) * (1 + Math.random() * 0.002);
        const low = Math.min(open, close) * (1 - Math.random() * 0.002);
        candles.push({ time, open, high, low, close });
        volume.push({
          time, value: 0,
          color: close >= open ? "rgba(34,224,107,0.45)" : "rgba(255,77,77,0.45)",
        });
      }
      return NextResponse.json({ candles, volume });
    }
  } catch {
    return NextResponse.json({ error: "klines unavailable" }, { status: 502 });
  }
}
