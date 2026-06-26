import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Vote = "BUY" | "SELL" | "NEUTRAL";

async function jget(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export async function GET() {
  const out: Record<string, unknown> = { updated: Date.now() };

  const [fg, global, ethData] = await Promise.allSettled([
    jget("https://api.alternative.me/fng/?limit=1"),
    jget("https://api.coingecko.com/api/v3/global"),
    jget("https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&community_data=false&developer_data=false"),
  ]);

  if (fg.status === "fulfilled") {
    const d = fg.value.data?.[0];
    const v = parseInt(d.value, 10);
    let vote: Vote = "NEUTRAL";
    if (v <= 25) vote = "BUY";
    else if (v >= 75) vote = "SELL";
    out.fearGreed = { value: v, label: d.value_classification, vote };
  }

  if (global.status === "fulfilled") {
    const btc = global.value.data?.market_cap_percentage?.btc;
    out.btcDom = { value: btc != null ? +btc.toFixed(1) : null, vote: "NEUTRAL" as Vote };
  }

  // ETH/BTC ratio from CoinGecko
  if (ethData.status === "fulfilled") {
    const price = ethData.value.market_data?.current_price?.btc;
    const chg = ethData.value.market_data?.price_change_percentage_24h_in_currency?.btc;
    if (price != null) {
      let vote: Vote = "NEUTRAL";
      if (chg > 1) vote = "BUY";
      else if (chg < -1) vote = "SELL";
      out.ethBtc = { value: price, changePct: chg ?? 0, vote };
    }
  }

  // funding rate: not available without Binance, set to null gracefully
  out.funding = null;
  out.mvrv = null;

  return NextResponse.json(out);
}
