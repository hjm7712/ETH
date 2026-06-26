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

  const [fg, global, ethbtc, fund, longshort, ethData, stableData] = await Promise.allSettled([
    jget("https://api.alternative.me/fng/?limit=1"),
    jget("https://api.coingecko.com/api/v3/global"),
    jget("https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&community_data=false&developer_data=false"),
    jget("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT"),
    jget("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=ETHUSDT&period=5m&limit=1"),
    jget("https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=2&interval=daily"),
    jget("https://api.coingecko.com/api/v3/global"),
  ]);

  // Fear & Greed Index
  if (fg.status === "fulfilled") {
    const d = fg.value.data?.[0];
    const v = parseInt(d.value, 10);
    let vote: Vote = "NEUTRAL";
    if (v <= 25) vote = "BUY";
    else if (v >= 75) vote = "SELL";
    out.fearGreed = { value: v, label: d.value_classification, vote };
  }

  // BTC 도미넌스 + 변화율
  if (global.status === "fulfilled") {
    const btc = global.value.data?.market_cap_percentage?.btc;
    const eth = global.value.data?.market_cap_percentage?.eth;
    out.btcDom = { value: btc != null ? +btc.toFixed(1) : null, vote: "NEUTRAL" as Vote };
    out.ethDom = { value: eth != null ? +eth.toFixed(1) : null, vote: "NEUTRAL" as Vote };
  }

  // ETH/BTC 비율 (CoinGecko)
  if (ethbtc.status === "fulfilled") {
    const price = ethbtc.value.market_data?.current_price?.btc;
    const chg = ethbtc.value.market_data?.price_change_percentage_24h_in_currency?.btc;
    if (price != null) {
      let vote: Vote = "NEUTRAL";
      if (chg > 1) vote = "BUY";
      else if (chg < -1) vote = "SELL";
      out.ethBtc = { value: price, changePct: chg ?? 0, vote };
    }
  }

  // 펀딩비 (Binance Futures)
  if (fund.status === "fulfilled") {
    const rate = parseFloat(fund.value.lastFundingRate);
    const annualPct = rate * 3 * 365 * 100;
    let vote: Vote = "NEUTRAL";
    if (rate < -0.0002) vote = "BUY";
    else if (rate > 0.0005) vote = "SELL";
    out.funding = { ratePct: rate * 100, annualPct, vote };
  }

  // Long/Short 비율 (Binance Futures)
  if (longshort.status === "fulfilled") {
    const d = longshort.value?.[0];
    if (d) {
      const ratio = parseFloat(d.longShortRatio);
      const longPct = parseFloat(d.longAccount) * 100;
      const shortPct = parseFloat(d.shortAccount) * 100;
      // 롱 비율 극단적으로 높으면(과열) SELL, 낮으면(공포) BUY
      let vote: Vote = "NEUTRAL";
      if (longPct < 45) vote = "BUY";   // 숏 과열 → 역발상 매수
      else if (longPct > 60) vote = "SELL"; // 롱 과열 → 역발상 매도
      out.longShort = { ratio: +ratio.toFixed(2), longPct: +longPct.toFixed(1), shortPct: +shortPct.toFixed(1), vote };
    }
  }

  // SSR 근사 (Stablecoin Supply Ratio)
  // SSR = BTC 시총 / 스테이블코인 시총. 낮을수록 매수 대기 자금 풍부 → BUY
  if (stableData.status === "fulfilled" && global.status === "fulfilled") {
    try {
      const totalMcap = global.value.data?.total_market_cap?.usd ?? 0;
      const stableCoins = ["tether", "usd-coin", "dai", "binancecoin"];
      const stableRes = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin,dai,first-digital-usd&order=market_cap_desc`,
        { cache: "no-store" }
      );
      if (stableRes.ok) {
        const stables = await stableRes.json() as { market_cap: number }[];
        const stableMcap = stables.reduce((a: number, c: { market_cap: number }) => a + (c.market_cap ?? 0), 0);
        const btcMcap = (global.value.data?.market_cap_percentage?.btc / 100) * totalMcap;
        const ssr = stableMcap > 0 ? +(btcMcap / stableMcap).toFixed(2) : null;
        if (ssr !== null) {
          // SSR 낮으면(< 5) 스테이블 풍부 → 매수 여력 큼
          let vote: Vote = "NEUTRAL";
          if (ssr < 5) vote = "BUY";
          else if (ssr > 15) vote = "SELL";
          out.ssr = { value: ssr, stableMcapB: +(stableMcap / 1e9).toFixed(1), vote };
        }
      }
    } catch { /* ignore */ }
  }

  out.mvrv = null;

  return NextResponse.json(out);
}
