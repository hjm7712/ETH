import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Last 30 daily candles → taker buy vs sell volume (in USDT).
 * Binance kline indices: [7] quote volume (total USDT),
 * [10] taker-buy quote volume. Taker sell = total − taker buy.
 * "Taker" = market orders that hit the book → a proxy for aggressive buy/sell pressure.
 */
export async function GET() {
  const url = "https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1d&limit=30";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const raw = (await res.json()) as string[][];

    const days = raw.map((c) => {
      const open = parseFloat(c[1]);
      const close = parseFloat(c[4]);
      const total = parseFloat(c[7]);
      const buy = parseFloat(c[10]);
      const sell = Math.max(total - buy, 0);
      const d = new Date(Number(c[0]));
      const date = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const buyPct = total > 0 ? +((buy / total) * 100).toFixed(1) : 50;
      const sellPct = +(100 - buyPct).toFixed(1);
      const change = +(((close - open) / open) * 100).toFixed(2);
      return { date, total, buy, sell, buyPct, sellPct, change, down: change < 0 };
    });

    const totalUSD = days.reduce((a, d) => a + d.total, 0);
    const totalBuy = days.reduce((a, d) => a + d.buy, 0);
    const buyPct = totalUSD > 0 ? +((totalBuy / totalUSD) * 100).toFixed(1) : 50;

    // Sell-pressure trend: taker-sell share, recent 7d vs prior 7d, plus down-day average.
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const recent7 = days.slice(-7).map((d) => d.sellPct);
    const prior7 = days.slice(-14, -7).map((d) => d.sellPct);
    const downDays = days.filter((d) => d.down);
    const sellPressure = {
      recentAvg: +avg(recent7).toFixed(1),
      priorAvg: +avg(prior7).toFixed(1),
      downDayAvg: +avg(downDays.map((d) => d.sellPct)).toFixed(1),
      downDayCount: downDays.length,
    };

    // Nature of the decline: are down days HIGH volume (real selling / capitulation)
    // or LOW volume (price drifting down on thin trade / lack of demand)?
    const upDays = days.filter((d) => !d.down);
    const avgVol = avg(days.map((d) => d.total));
    const downVol = avg(downDays.map((d) => d.total));
    const upVol = avg(upDays.map((d) => d.total));
    const recentDown7 = days.slice(-7).filter((d) => d.down);
    const recentDownVol = avg(recentDown7.map((d) => d.total));
    const ratio = upVol > 0 ? +(downVol / upVol).toFixed(2) : 1; // down-day vs up-day volume

    let label: string;
    let tone: string;
    if (ratio >= 1.15) {
      label = "거래량 동반 하락 — 실제 매물 출회 (분산/투매성)";
      tone = "bad";
    } else if (ratio <= 0.85) {
      label = "거래량 빈약한 하락 — 적극적 매도 적음 (수요 부족형)";
      tone = "warn";
    } else {
      label = "상승·하락 거래량 비슷 — 특이 쏠림 없음";
      tone = "neutral";
    }

    const decline = {
      ratio,
      downVol: Math.round(downVol),
      upVol: Math.round(upVol),
      avgVol: Math.round(avgVol),
      recentDownVol: Math.round(recentDownVol),
      label,
      tone,
    };

    return NextResponse.json({ days, totalUSD, buyPct, sellPressure, decline, updated: Date.now() });
  } catch {
    return NextResponse.json({ error: "volume feed unavailable" }, { status: 502 });
  }
}
