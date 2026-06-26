import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTERVAL_MAP: Record<string, { days: string; interval: string }> = {
  "15m": { days: "1", interval: "minutely" },
  "1h":  { days: "2", interval: "hourly" },
  "1d":  { days: "200", interval: "daily" },
  "1w":  { days: "1400", interval: "daily" },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw_iv = searchParams.get("interval") ?? "1d";
  const cfg = INTERVAL_MAP[raw_iv] ?? INTERVAL_MAP["1d"];

  const url = `https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=${cfg.days}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const raw = (await res.json()) as number[][];

    const candles = raw.map((c) => ({
      time: Math.floor(c[0] / 1000),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
    }));

    const volume = raw.map((c) => ({
      time: Math.floor(c[0] / 1000),
      value: 0,
      color: c[4] >= c[1] ? "rgba(34,224,107,0.45)" : "rgba(255,77,77,0.45)",
    }));

    return NextResponse.json({ candles, volume });
  } catch {
    return NextResponse.json({ error: "klines unavailable" }, { status: 502 });
  }
}
