import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const url = "https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=30&interval=daily";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as {
      prices: number[][];
      total_volumes: number[][];
    };

    const prices = data.prices;
    const volumes = data.total_volumes;

    const days = prices.map((p, i) => {
      const ts = p[0];
      const close = p[1];
      const open = i > 0 ? prices[i - 1][1] : close;
      const total = volumes[i]?.[1] ?? 0;
      const buy = total * 0.5; // CoinGecko doesn't provide taker buy/sell split
      const sell = total - buy;
      const d = new Date(ts);
      const date = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const buyPct = 50;
      const sellPct = 50;
      const change = open > 0 ? +(((close - open) / open) * 100).toFixed(2) : 0;
      return { date, total, buy, sell, buyPct, sellPct, change, down: change < 0 };
    });

    const totalUSD = days.reduce((a, d) => a + d.total, 0);
    const buyPct = 50;

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const recent7 = days.slice(-7).map((d) => d.sellPct);
    const prior7 = days.slice(-14, -7).map((d) => d.sellPct);
    const downDays = days.filter((d) => d.down);
    const sellPressure = {
      recentAvg: +avg(recent7).toFixed(1),
      priorAvg: +avg(prior7).toFixed(1),
      downDayAvg: +avg(downDays.map((d) => d.sellPct)).toFixed(1),
      downDayCount: downDays.length,
    };

    const upDays = days.filter((d) => !d.down);
    const avgVol = avg(days.map((d) => d.total));
    const downVol = avg(downDays.map((d) => d.total));
    const upVol = avg(upDays.map((d) => d.total));
    const recentDown7 = days.slice(-7).filter((d) => d.down);
    const recentDownVol = avg(recentDown7.map((d) => d.total));
    const ratio = upVol > 0 ? +(downVol / upVol).toFixed(2) : 1;

    let label: string; let tone: string;
    if (ratio >= 1.15) { label = "거래량 동반 하락 — 실제 매물 출회 (분산/투매성)"; tone = "bad"; }
    else if (ratio <= 0.85) { label = "거래량 빈약한 하락 — 적극적 매도 적음 (수요 부족형)"; tone = "warn"; }
    else { label = "상승·하락 거래량 비슷 — 특이 쏠림 없음"; tone = "neutral"; }

    const decline = { ratio, downVol: Math.round(downVol), upVol: Math.round(upVol), avgVol: Math.round(avgVol), recentDownVol: Math.round(recentDownVol), label, tone };

    return NextResponse.json({ days, totalUSD, buyPct, sellPressure, decline, updated: Date.now() });
  } catch {
    return NextResponse.json({ error: "volume feed unavailable" }, { status: 502 });
  }
}
