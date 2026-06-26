import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Live odds that the CLARITY Act is signed into law in 2026, from Polymarket.
export async function GET() {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/events?slug=clarity-act-signed-into-law-in-2026",
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const ev = data?.[0];
    const m = ev?.markets?.[0];
    if (!m) throw new Error("market not found");

    // outcomes / outcomePrices arrive as JSON-encoded strings.
    const outcomes: string[] = JSON.parse(m.outcomes);
    const prices: string[] = JSON.parse(m.outcomePrices);
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    const yes = yesIdx >= 0 ? parseFloat(prices[yesIdx]) : parseFloat(m.lastTradePrice);

    return NextResponse.json({
      prob: Math.round(yes * 100),
      title: m.question,
      volume: Number(ev.volume ?? m.volume ?? 0),
      updated: Date.now(),
    });
  } catch {
    return NextResponse.json({ error: "polymarket unavailable" }, { status: 502 });
  }
}
