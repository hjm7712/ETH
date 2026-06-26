import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = ["15m", "1h", "1d", "1w"];

// OHLC + volume for the chart, from Binance klines.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw_iv = searchParams.get("interval") ?? "1d";
  const iv = ALLOWED.includes(raw_iv) ? raw_iv : "1d";
  const url = `https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=${iv}&limit=200`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const raw = (await res.json()) as string[][];

    const candles = raw.map((c) => ({
      time: Math.floor(Number(c[0]) / 1000),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
    const volume = raw.map((c) => ({
      time: Math.floor(Number(c[0]) / 1000),
      value: parseFloat(c[5]),
      color: parseFloat(c[4]) >= parseFloat(c[1]) ? "rgba(34,224,107,0.45)" : "rgba(255,77,77,0.45)",
    }));

    return NextResponse.json({ candles, volume });
  } catch {
    return NextResponse.json({ error: "klines unavailable" }, { status: 502 });
  }
}
