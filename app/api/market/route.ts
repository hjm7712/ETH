import { NextResponse } from "next/server";

// Always run fresh.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Vote = "BUY" | "SELL" | "NEUTRAL";

async function jget(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/**
 * Widely-watched market/sentiment gauges, all from keyless free APIs.
 * Each gauge votes contrarian-style where that's the convention traders use.
 */
export async function GET() {
  const out: Record<string, unknown> = { updated: Date.now() };

  // Independent fetches — one failure must not blank the whole panel.
  const [fg, global, ethbtc, fund] = await Promise.allSettled([
    jget("https://api.alternative.me/fng/?limit=1"),
    jget("https://api.coingecko.com/api/v3/global"),
    jget("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHBTC"),
    jget("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT"),
  ]);

  // Crypto Fear & Greed Index (0–100). Extreme fear = contrarian buy.
  if (fg.status === "fulfilled") {
    const d = fg.value.data?.[0];
    const v = parseInt(d.value, 10);
    let vote: Vote = "NEUTRAL";
    if (v <= 25) vote = "BUY";
    else if (v >= 75) vote = "SELL";
    out.fearGreed = { value: v, label: d.value_classification, vote };
  }

  // Bitcoin dominance — pure macro context for alts. Shown, not voted.
  if (global.status === "fulfilled") {
    const btc = global.value.data?.market_cap_percentage?.btc;
    out.btcDom = { value: btc != null ? +btc.toFixed(1) : null, vote: "NEUTRAL" as Vote };
  }

  // ETH/BTC ratio — alt strength. ETH gaining on BTC leans bullish for ETH.
  if (ethbtc.status === "fulfilled") {
    const price = parseFloat(ethbtc.value.lastPrice);
    const chg = parseFloat(ethbtc.value.priceChangePercent);
    let vote: Vote = "NEUTRAL";
    if (chg > 1) vote = "BUY";
    else if (chg < -1) vote = "SELL";
    out.ethBtc = { value: price, changePct: chg, vote };
  }

  // Perp funding rate (per 8h). Deep negative = shorts crowded = contrarian buy.
  if (fund.status === "fulfilled") {
    const rate = parseFloat(fund.value.lastFundingRate);
    const annualPct = rate * 3 * 365 * 100; // 3 settlements/day, %/yr
    let vote: Vote = "NEUTRAL";
    if (rate < -0.0002) vote = "BUY";
    else if (rate > 0.0005) vote = "SELL";
    out.funding = { ratePct: rate * 100, annualPct, vote };
  }

  // MVRV Z-Score (optional). No keyless ETH source exists, so this is left null
  // unless you wire a keyed provider (Glassnode / Santiment / BGeometrics).
  // See README "Adding MVRV". Interpretation: low/negative = undervalued (buy),
  // high (>~7 BTC-scale) = overvalued (sell).
  out.mvrv = null;

  return NextResponse.json(out);
}
