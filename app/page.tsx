"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Responsive, WidthProvider } from "react-grid-layout";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Client-only chart (canvas lib) — never server-rendered.
const Chart = dynamic(() => import("./Chart"), { ssr: false });

const CHART_TFS = [
  { label: "15m", iv: "15m" },
  { label: "1h", iv: "1h" },
  { label: "1d", iv: "1d" },
  { label: "1w", iv: "1w" },
];

// Default panel placement (12-col grid). Users drag/resize; we persist overrides.
const DEFAULT_LAYOUT = [
  { i: "price", x: 0, y: 0, w: 8, h: 5, minW: 3, minH: 3 },
  { i: "patience", x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "chart", x: 0, y: 5, w: 12, h: 12, minW: 4, minH: 6 },
  { i: "primary", x: 0, y: 17, w: 6, h: 6, minW: 3, minH: 4 },
  { i: "multitf", x: 6, y: 17, w: 6, h: 10, minW: 3, minH: 5 },
  { i: "bottom", x: 0, y: 23, w: 6, h: 8, minW: 3, minH: 4 },
  { i: "rebound", x: 6, y: 27, w: 6, h: 8, minW: 3, minH: 4 },
  { i: "market", x: 0, y: 31, w: 6, h: 7, minW: 3, minH: 4 },
  { i: "volume", x: 6, y: 35, w: 6, h: 10, minW: 3, minH: 5 },
  { i: "bull", x: 0, y: 38, w: 6, h: 6, minW: 3, minH: 4 },
  { i: "bear", x: 6, y: 45, w: 6, h: 6, minW: 3, minH: 4 },
  { i: "news", x: 0, y: 51, w: 12, h: 16, minW: 4, minH: 6 },
];
const LAYOUT_BY_KEY: Record<string, any> = Object.fromEntries(DEFAULT_LAYOUT.map((l) => [l.i, l]));
const LAYOUT_KEY = "eth-watch-layout-v2";

type Reason = { label: string; value: string; vote: string };
type TF = {
  interval: string;
  label: string;
  verdict: string;
  score: number;
  max: number;
  reasons: Reason[];
};
type Bottom = {
  estimate: number;
  low: number;
  high: number;
  ma200w: number | null;
  etaDays: number | null;
  avgDailyPct: number;
};
type Check = { k: string; ok: boolean; val: string };
type Rebound = {
  active: boolean;
  lowVal: number;
  bouncePct: number;
  daysSinceLow: number;
  healthy?: number;
  total?: number;
  verdict?: string;
  tone?: string;
  checks?: Check[];
};
type Signal = { price: number; timeframes: TF[]; bottom: Bottom | null; rebound: Rebound | null; updated: number };

const LEVELS = ["STRONG SELL", "SELL", "HOLD", "BUY", "STRONG BUY"];
const COLORS: Record<string, string> = {
  "STRONG SELL": "#ff2d2d",
  SELL: "#ff7a45",
  HOLD: "#f5c518",
  BUY: "#7ed957",
  "STRONG BUY": "#22e06b",
};
const MEANING: Record<string, string> = {
  "STRONG BUY": "지표 대부분 매수 우위",
  BUY: "매수 우위",
  HOLD: "중립 · 방향성 불분명",
  SELL: "매도 우위",
  "STRONG SELL": "지표 대부분 매도 우위",
};

// Published analyst calls, split by stance. Update as new ones come out.
const BULL_TARGETS = [
  { firm: "TOM LEE · BULL", target: 11000, note: "BULL CASE" },
  { firm: "STD CHARTERED", target: 7500, note: "YE2026" },
  { firm: "FUNDSTRAT · BASE", target: 4500, note: "YE2026" },
  { firm: "CITI · BASE", target: 3175, note: "YE2026" },
];
const BEAR_TARGETS = [
  { firm: "TECH 하방", target: 1500, note: "주요 지지 이탈" },
  { firm: "극단 시나리오", target: 1200, note: "ETF 유출 지속" },
  { firm: "CITI · BEAR", target: 1198, note: "불황 시나리오" },
];

// Trend assumption used ONLY for the "how long to HODL" estimate. Pure what-if.
const ASSUMED_CAGR = 0.5; // +50% / year

function verdictFromRatio(ratio: number): string {
  if (ratio >= 0.6) return "STRONG BUY";
  if (ratio >= 0.25) return "BUY";
  if (ratio <= -0.6) return "STRONG SELL";
  if (ratio <= -0.25) return "SELL";
  return "HOLD";
}

function tally(rs: Reason[]) {
  const b = rs.filter((r) => r.vote === "BUY").length;
  const s = rs.filter((r) => r.vote === "SELL").length;
  const n = rs.filter((r) => r.vote === "NEUTRAL").length;
  return `BUY ${b} · SELL ${s} · NEUTRAL ${n}`;
}

// Months to reach `target` from `price` at the assumed compound growth rate.
function etaMonths(price: number, target: number, cagr = ASSUMED_CAGR): number {
  if (!price || target <= price) return 0;
  return (Math.log(target / price) / Math.log(1 + cagr)) * 12;
}

function fmtEta(m: number | null): string {
  if (m === null) return "—";
  if (m <= 0) return "달성";
  if (m < 12) return `≈${Math.round(m)}개월`;
  return `≈${(m / 12).toFixed(1)}년`;
}

function fmtUSD(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}

export default function Page() {
  const [live, setLive] = useState<number | null>(null);
  const [change, setChange] = useState<number | null>(null);
  const [sig, setSig] = useState<Signal | null>(null);
  const [mkt, setMkt] = useState<any>(null);
  const [vol, setVol] = useState<any>(null);
  const [clarity, setClarity] = useState<any>(null);
  const [news, setNews] = useState<any>(null);
  const [err, setErr] = useState(false);
  const [chartTf, setChartTf] = useState("1d");

  // Draggable layout (loaded from localStorage after mount).
  const [mounted, setMounted] = useState(false);
  const [layouts, setLayouts] = useState<any>({
    lg: DEFAULT_LAYOUT,
    md: DEFAULT_LAYOUT,
    sm: DEFAULT_LAYOUT.map((l) => ({ ...l, x: 0, w: 6 })),
    xs: DEFAULT_LAYOUT.map((l) => ({ ...l, x: 0, w: 1 })),
  });
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setLayouts((prev: any) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore */
    }
  }, []);
  const onLayoutChange = (_cur: any, all: any) => {
    setLayouts(all);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  };
  const resetLayout = () => {
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      /* ignore */
    }
    setLayouts({ lg: DEFAULT_LAYOUT.map((x) => ({ ...x })) });
  };

  // Live spot price via Binance WebSocket ticker stream.
  useEffect(() => {
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket("wss://stream.binance.com:9443/ws/ethusdt@ticker");
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        setLive(parseFloat(d.c));
        setChange(parseFloat(d.P));
      };
    } catch {
      /* WS unavailable — REST signal price is the fallback */
    }
    return () => ws?.close();
  }, []);

  // Technical signal: poll every 30s.
  useEffect(() => {
    const load = () =>
      fetch("/api/signal")
        .then((r) => r.json())
        .then((d) => {
          if (d.error) setErr(true);
          else {
            setSig(d);
            setErr(false);
          }
        })
        .catch(() => setErr(true));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // Market regime (sentiment/on-chain): poll every 60s — these move slowly.
  useEffect(() => {
    const load = () =>
      fetch("/api/market")
        .then((r) => r.json())
        .then(setMkt)
        .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  // Daily buy/sell volume (last 30d): poll every 5 min.
  useEffect(() => {
    const load = () =>
      fetch("/api/volume")
        .then((r) => r.json())
        .then((d) => !d.error && setVol(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 300000);
    return () => clearInterval(id);
  }, []);

  // CLARITY Act 2026 odds (Polymarket): poll every 5 min.
  useEffect(() => {
    const load = () =>
      fetch("/api/clarity")
        .then((r) => r.json())
        .then((d) => !d.error && setClarity(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 300000);
    return () => clearInterval(id);
  }, []);

  // Crypto news (ETH-first, BTC too): poll every 5 min.
  useEffect(() => {
    const load = () =>
      fetch("/api/news")
        .then((r) => r.json())
        .then((d) => !d.error && setNews(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 300000);
    return () => clearInterval(id);
  }, []);

  const tfs = sig?.timeframes ?? [];
  const daily = tfs.find((t) => t.interval === "1d");
  const headline = daily?.verdict ?? "HOLD";
  const color = COLORS[headline] ?? "#f5c518";
  const totScore = tfs.reduce((a, t) => a + t.score, 0);
  const totMax = tfs.reduce((a, t) => a + t.max, 0);
  const consensus = totMax ? verdictFromRatio(totScore / totMax) : "HOLD";

  const price = live ?? sig?.price ?? null;

  const bullSorted = [...BULL_TARGETS].sort((a, b) => a.target - b.target);
  const nearest = (price ? bullSorted.find((t) => t.target > price) : null) ?? bullSorted[0];
  const nearestEta = price ? etaMonths(price, nearest.target) : null;

  const TONE: Record<string, string> = { good: "#22e06b", warn: "#f5c518", bad: "#ff4d4d" };
  const rb = sig?.rebound ?? null;
  const rbColor = rb?.tone ? TONE[rb.tone] : "#7c8cff";

  const b = sig?.bottom ?? null;
  const downsidePct = b && price ? (b.estimate / price - 1) * 100 : null;
  let etaText = "—";
  if (b) {
    if (b.etaDays === 0) etaText = "이미 추정 저점 구간 근접 / 진입";
    else if (b.etaDays === null) etaText = "하락 모멘텀 없음 → 바닥 형성 중일 수 있음";
    else {
      const d = new Date(Date.now() + b.etaDays * 86400000);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      etaText = `≈${b.etaDays}일 후 (${ymd})`;
    }
  }

  const marketRows: { label: string; value: string; vote: string; desc?: string }[] = [];
  if (mkt?.fearGreed)
    marketRows.push({ label: "FEAR & GREED", value: `${mkt.fearGreed.value} · ${mkt.fearGreed.label}`, vote: mkt.fearGreed.vote, desc: "25↓ 극단공포=BUY · 75↑ 과열=SELL" });
  if (mkt?.funding)
    marketRows.push({
      label: "FUNDING 8H",
      value: `${mkt.funding.ratePct.toFixed(4)}% (${mkt.funding.annualPct >= 0 ? "+" : ""}${mkt.funding.annualPct.toFixed(1)}%/yr)`,
      vote: mkt.funding.vote,
      desc: "음수 펀딩 = 숏 과열 = 역발상 BUY",
    });
  if (mkt?.longShort)
    marketRows.push({
      label: "LONG / SHORT",
      value: `롱 ${mkt.longShort.longPct}% · 숏 ${mkt.longShort.shortPct}% (${mkt.longShort.ratio}x)`,
      vote: mkt.longShort.vote,
      desc: "롱 60%↑ 과열=SELL · 45%↓ 숏쏠림=BUY",
    });
  if (mkt?.ethBtc)
    marketRows.push({
      label: "ETH / BTC",
      value: `${mkt.ethBtc.value.toFixed(6)} (${mkt.ethBtc.changePct >= 0 ? "+" : ""}${mkt.ethBtc.changePct.toFixed(2)}%)`,
      vote: mkt.ethBtc.vote,
      desc: "ETH가 BTC 대비 강세면 알트 강세 신호",
    });
  if (mkt?.btcDom)
    marketRows.push({ label: "BTC DOMINANCE", value: `${mkt.btcDom.value}%`, vote: mkt.btcDom.vote, desc: "하락 = 알트로 자금 이동" });
  if (mkt?.ethDom)
    marketRows.push({ label: "ETH DOMINANCE", value: `${mkt.ethDom.value}%`, vote: mkt.ethDom.vote, desc: "ETH 시총 비중" });
  if (mkt?.ssr)
    marketRows.push({
      label: "SSR (스테이블 공급비)",
      value: `${mkt.ssr.value} · 스테이블 $${mkt.ssr.stableMcapB}B`,
      vote: mkt.ssr.vote,
      desc: "낮을수록 매수 대기 자금 풍부 → BUY",
    });

  const volDays: any[] = vol?.days ?? [];
  const maxVol = volDays.length ? Math.max(...volDays.map((d) => d.total)) : 1;
  const today = volDays.length ? volDays[volDays.length - 1] : null;

  const sp = vol?.sellPressure ?? null;
  let spDir = "→ 보합";
  let spColor = "var(--muted)";
  if (sp) {
    const diff = sp.recentAvg - sp.priorAvg;
    if (diff > 0.5) {
      spDir = "↑ 증가 (매도압력 강화)";
      spColor = "#ff4d4d";
    } else if (diff < -0.5) {
      spDir = "↓ 감소 (매도압력 완화)";
      spColor = "#22e06b";
    }
  }

  // Each draggable panel: a title (drag handle) + its body content. `glow` adds an accent border.
  const panels: { key: string; title: string; node: React.ReactNode; glow?: string }[] = [
    {
      key: "price",
      title: "SPOT PRICE",
      node: (
        <section className="price-block">
          <div className="label">SPOT PRICE</div>
          <div className="price">
            {price
              ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </div>
          <div className="change-row">
            {today && (
              <span style={{ color: today.change >= 0 ? "#22e06b" : "#ff2d2d" }}>
                {today.change >= 0 ? "▲" : "▼"} {Math.abs(today.change).toFixed(2)}% (오늘 · UTC)
              </span>
            )}
            {change !== null && (
              <span style={{ color: change >= 0 ? "#22e06b" : "#ff2d2d" }}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% (24h 롤링)
              </span>
            )}
          </div>
        </section>
      ),
    },
    {
      key: "patience",
      title: "⏳ 존버 · CLARITY",
      node: (
        <section className="indicators patience-panel">
          <div className="patience-grid">
            <div>
              <div className="p-label">⏳ 존버 ESTIMATE</div>
              <div className="p-eta">{fmtEta(nearestEta)}</div>
              <div className="p-sub">
                → {nearest.firm} ${nearest.target.toLocaleString()} 도달
              </div>
              <div className="p-note">가정 +{Math.round(ASSUMED_CAGR * 100)}%/yr · 보장 아님</div>
            </div>
            <div>
              <div className="p-label">CLARITY 법안 2026 통과</div>
              <div
                className="p-clarity"
                style={{ color: clarity ? (clarity.prob >= 50 ? "#22e06b" : "#ff7a45") : "var(--muted)" }}
              >
                {clarity ? `${clarity.prob}%` : "—"}
              </div>
              <div className="p-note">Polymarket 예측시장</div>
            </div>
          </div>
        </section>
      ),
    },
    {
      key: "chart",
      title: "ETH/USDT CHART",
      node: (
        <section className="indicators chart-panel">
          <div className="chart-head">
            <div className="label" style={{ margin: 0 }}>
              ETH/USDT CHART
            </div>
            <div className="tf-btns">
              {CHART_TFS.map((c) => (
                <button
                  key={c.iv}
                  className={"tf-btn" + (chartTf === c.iv ? " on" : "")}
                  onClick={() => setChartTf(c.iv)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <Chart interval={chartTf} />
        </section>
      ),
    },
    {
      key: "primary",
      title: "PRIMARY SIGNAL · 1D",
      node: (
        <section className="verdict-block" style={{ borderColor: color }}>
          <div className="label">PRIMARY SIGNAL · 1D (DAILY)</div>
          <div className="verdict" style={{ color }}>
            {headline}
          </div>
          <div className="gauge">
            {LEVELS.map((lv) => (
              <div
                key={lv}
                className={"seg" + (lv === headline ? " active" : "")}
                style={{
                  background: lv === headline ? COLORS[lv] : "transparent",
                  borderColor: COLORS[lv],
                  color: COLORS[lv],
                }}
                title={lv}
              />
            ))}
          </div>
          <div className="gauge-labels">
            <span>SELL</span>
            <span>HOLD</span>
            <span>BUY</span>
          </div>
          <div className="muted">4-TF 컨센서스: {consensus} · 위 신호는 1D 기준 대표값</div>
        </section>
      ),
    },
    {
      key: "multitf",
      title: "MULTI-TIMEFRAME",
      node: (
        <section className="indicators">
          <div className="label">MULTI-TIMEFRAME READOUT</div>
          <div className="tf-grid">
            {tfs.map((t) => (
              <div className="tf-card" key={t.interval} style={{ borderColor: COLORS[t.verdict] }}>
                <div className="tf-head">
                  <span className="tf-tf">{t.label}</span>
                  <span className="tf-badge" style={{ background: COLORS[t.verdict] }}>
                    {t.verdict}
                  </span>
                </div>
                {t.reasons.map((r) => (
                  <div className="row" key={r.label}>
                    <span className="r-label">{r.label}</span>
                    <span className="r-value">{r.value}</span>
                    <span className="r-vote" data-vote={r.vote}>
                      {r.vote}
                    </span>
                  </div>
                ))}
                <div className="tf-explain">
                  → {MEANING[t.verdict]} ({tally(t.reasons)})
                </div>
              </div>
            ))}
          </div>
          {!sig && !err && <div className="muted">acquiring signal…</div>}
          {err && (
            <div className="muted err">
              ⚠ price feed unavailable (Binance API may be geo-blocked — see README for a CoinGecko fallback)
            </div>
          )}
        </section>
      ),
    },
    {
      key: "bottom",
      title: "BOTTOM ESTIMATE · 추정 저점",
      node: (
        <section className="verdict-block" style={{ borderColor: "#ff7a45" }}>
          <div className="label">MODEL BOTTOM ESTIMATE · 추정 저점 (모델)</div>
          {b ? (
            <>
              <div className="bottom-zone">
                ${b.low.toLocaleString()} <span className="dash">–</span> ${b.high.toLocaleString()}
              </div>
              <div className="muted">
                중심 추정 ${b.estimate.toLocaleString()}
                {downsidePct !== null && ` · 현재가 대비 ${downsidePct >= 0 ? "+" : ""}${downsidePct.toFixed(1)}%`}
              </div>
              <div className="row">
                <span className="r-label">도달 예상 시점</span>
                <span className="r-value">{etaText}</span>
                <span />
              </div>
              <div className="row">
                <span className="r-label">200주 이평 (장기 바닥 기준)</span>
                <span className="r-value">{b.ma200w ? `$${b.ma200w.toLocaleString()}` : "—"}</span>
                <span />
              </div>
              <div className="row">
                <span className="r-label">최근 20일 평균 일변동</span>
                <span className="r-value">
                  {b.avgDailyPct >= 0 ? "+" : ""}
                  {b.avgDailyPct}%/day
                </span>
                <span />
              </div>
              <div className="tf-explain">
                → 구조적 지지선(최근 120일 저점) − 투매여유 10% 로 산출. 시점은 최근 하락속도 선형 외삽.
                <b> 예측 아님 · 참고용 추정치.</b>
              </div>
            </>
          ) : (
            <div className="muted">계산 중…</div>
          )}
        </section>
      ),
    },
    {
      key: "rebound",
      title: "🔄 REBOUND CHECK · 반등 판정",
      glow: rbColor,
      node: (
        <section className="verdict-block">
          <div className="label">REBOUND CHECK · 반등 판정 (기술적 vs 추세전환)</div>
          <div
            className="rebound-status"
            style={{ color: rbColor, borderColor: rbColor, background: `${rbColor}1f` }}
          >
            {rb ? (rb.active ? `🔄 ${rb.verdict}` : "🔍 반등 감시 중 · 미발생") : "분석 중…"}
          </div>
          {rb && rb.active && (
            <>
              <div className="muted" style={{ paddingTop: 8, marginBottom: 6 }}>
                저점 ${rb.lowVal.toLocaleString()}에서 +{rb.bouncePct}% · {rb.daysSinceLow}일 경과 · 충족{" "}
                <b style={{ color: rbColor }}>
                  {rb.healthy}/{rb.total}
                </b>
              </div>
              {rb.checks?.map((c) => (
                <div className="row" key={c.k}>
                  <span className="r-label">
                    {c.ok ? "✓" : "✗"} {c.k}
                  </span>
                  <span className="r-value">{c.val}</span>
                  <span className="r-vote" style={{ color: c.ok ? "#22e06b" : "#ff4d4d" }}>
                    {c.ok ? "양호" : "미흡"}
                  </span>
                </div>
              ))}
              <div className="tf-explain">
                → 5개 중 4+ 충족 = 추세전환 신뢰 / 2~3 = 관망 / 1이하 = 데드캣(기술적 반등) 주의.
              </div>
            </>
          )}
          {rb && !rb.active && (
            <div className="muted" style={{ paddingTop: 8 }}>
              최근 저점 ${rb.lowVal.toLocaleString()} 대비 +{rb.bouncePct}% ({rb.daysSinceLow}일).
              <b> 3% 이상 반등하면</b> 자동으로 기술적 반등 / 추세전환 여부를 판정합니다.
            </div>
          )}
        </section>
      ),
    },
    {
      key: "market",
      title: "MARKET REGIME",
      node: (
        <section className="indicators">
          <div className="label">MARKET REGIME · ON-CHAIN & SENTIMENT</div>
          {marketRows.map((r) => (
            <div key={r.label} style={{ marginBottom: 6 }}>
              <div className="row">
                <span className="r-label">{r.label}</span>
                <span className="r-value">{r.value}</span>
                <span className="r-vote" data-vote={r.vote}>
                  {r.vote}
                </span>
              </div>
              {r.desc && <div className="muted" style={{ padding: "0 0 2px 0", fontSize: 11 }}>{r.desc}</div>}
            </div>
          ))}
          <div className="row">
            <span className="r-label">
              MVRV Z-SCORE <span className="tag">ON-CHAIN</span>
            </span>
            <span className="r-value">키 필요 (README)</span>
            <span className="r-vote" data-vote="NEUTRAL">
              N/A
            </span>
          </div>
          {!mkt && <div className="muted">acquiring market data…</div>}
          <div className="muted">
            역발상 기준: 극단적 공포·음수 펀딩비 = BUY, 과열 = SELL. BTC도미넌스·MVRV는 참고용 컨텍스트.
          </div>
        </section>
      ),
    },
    {
      key: "volume",
      title: "VOLUME / 매도압력",
      node: (
        <section className="indicators">
          <div className="label">VOLUME · 최근 30일 매수/매도 거래대금 (USDT, 테이커 기준)</div>
          {vol ? (
            <>
              <div className="vol-summary">
                <span>
                  30일 누적 <b>{fmtUSD(vol.totalUSD)}</b> · 매수비중{" "}
                  <b style={{ color: vol.buyPct >= 50 ? "#22e06b" : "#ff4d4d" }}>{vol.buyPct}%</b>
                </span>
                {today && (
                  <span>
                    오늘 매수 <b style={{ color: "#22e06b" }}>{fmtUSD(today.buy)}</b> / 매도{" "}
                    <b style={{ color: "#ff4d4d" }}>{fmtUSD(today.sell)}</b> ({today.buyPct}% 매수)
                  </span>
                )}
              </div>
              <div className="vol-bars">
                {volDays.map((d) => (
                  <div
                    className={"vol-col" + (d.down ? " down" : "")}
                    key={d.date}
                    title={`${d.date}  등락 ${d.change >= 0 ? "+" : ""}${d.change}% · 총 ${fmtUSD(d.total)} · 매수 ${d.buyPct}% / 매도 ${d.sellPct}%`}
                  >
                    <div className="vol-bar" style={{ height: `${(d.total / maxVol) * 100}%` }}>
                      <div className="vol-sell" style={{ height: `${d.sellPct}%` }} />
                      <div className="vol-buy" style={{ height: `${d.buyPct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="vol-legend">
                <span>
                  <i className="sw buy" /> 매수(테이커)
                </span>
                <span>
                  <i className="sw sell" /> 매도(테이커)
                </span>
                <span>
                  <i className="sw down" /> 하락 마감일
                </span>
                <span className="muted" style={{ padding: 0 }}>
                  막대 높이 = 총 거래대금 · 마우스 올리면 상세
                </span>
              </div>
              {sp && (
                <div className="sell-trend">
                  <div className="st-row">
                    <span className="st-label">매도 압력 추세 (테이커 매도 비중)</span>
                    <span className="st-dir" style={{ color: spColor }}>
                      {spDir}
                    </span>
                  </div>
                  <div className="muted" style={{ padding: 0 }}>
                    최근 7일 평균 {sp.recentAvg}% (이전 7일 {sp.priorAvg}%) · 하락 마감일 평균 매도비중{" "}
                    {sp.downDayAvg}% ({sp.downDayCount}일)
                  </div>
                </div>
              )}
              {vol.decline && (
                <div className="sell-trend">
                  <div className="st-row">
                    <span className="st-label">하락의 성격 (거래량 동반 여부)</span>
                    <span
                      className="st-dir"
                      style={{
                        color:
                          vol.decline.tone === "bad"
                            ? "#ff4d4d"
                            : vol.decline.tone === "warn"
                            ? "#f5c518"
                            : "var(--muted)",
                        fontSize: "13px",
                        textAlign: "right",
                      }}
                    >
                      {vol.decline.label}
                    </span>
                  </div>
                  <div className="muted" style={{ padding: 0 }}>
                    하락일 평균 거래량 {fmtUSD(vol.decline.downVol)} vs 상승일 {fmtUSD(vol.decline.upVol)} (
                    {vol.decline.ratio}×) · 30일 평균 {fmtUSD(vol.decline.avgVol)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="muted">acquiring volume data…</div>
          )}
        </section>
      ),
    },
    {
      key: "bull",
      title: "🟢 BULL TARGETS",
      node: (
        <section className="indicators" style={{ borderColor: "#1e3a2a" }}>
          <div className="label" style={{ color: "#22e06b" }}>
            🟢 강세 기관 · BULL TARGETS (YE2026)
          </div>
          {BULL_TARGETS.map((t) => {
            const upside = price ? (t.target / price - 1) * 100 : null;
            const eta = price ? fmtEta(etaMonths(price, t.target)) : "—";
            return (
              <div className="row trow" key={t.firm}>
                <span className="r-label">
                  {t.firm} <span className="tag">{t.note}</span>
                </span>
                <span className="r-eta">{eta}</span>
                <span className="r-value">${t.target.toLocaleString()}</span>
                <span className="r-vote" style={{ color: "#22e06b" }}>
                  {upside === null ? "—" : `+${upside.toFixed(0)}%`}
                </span>
              </div>
            );
          })}
          <div className="muted">ETA = 추세 가정(+{Math.round(ASSUMED_CAGR * 100)}%/yr) 시 도달까지 존버 기간</div>
        </section>
      ),
    },
    {
      key: "bear",
      title: "🔴 BEAR / DOWNSIDE",
      node: (
        <section className="indicators" style={{ borderColor: "#3a1e1e" }}>
          <div className="label" style={{ color: "#ff4d4d" }}>
            🔴 약세 기관 · BEAR / DOWNSIDE
          </div>
          {BEAR_TARGETS.map((t) => {
            const downside = price ? (t.target / price - 1) * 100 : null;
            return (
              <div className="row" key={t.firm}>
                <span className="r-label">
                  {t.firm} <span className="tag">{t.note}</span>
                </span>
                <span className="r-value">${t.target.toLocaleString()}</span>
                <span className="r-vote" style={{ color: "#ff4d4d" }}>
                  {downside === null ? "—" : `${downside.toFixed(0)}%`}
                </span>
              </div>
            );
          })}
          <div className="row">
            <span className="r-label">
              JPMORGAN <span className="tag">의견</span>
            </span>
            <span className="r-value">약세 · 수치 미공개</span>
            <span className="r-vote" style={{ color: "#ff4d4d" }}>
              BEAR
            </span>
          </div>
          <div className="muted">하방 %는 현재가 대비 하락폭 · 거시 충격·ETF 유출 지속 시 시나리오</div>
        </section>
      ),
    },
    {
      key: "news",
      title: "CRYPTO NEWS",
      node: (
        <section className="indicators">
          <div className="label">CRYPTO NEWS · 이더리움 / 비트코인 (최신순)</div>
          {news?.items ? (
            news.items.map((it: any, i: number) => (
              <a className="news-row" href={it.link} target="_blank" rel="noopener noreferrer" key={i}>
                <span className={"news-tag " + (it.tag === "ETH" ? "eth" : "btc")}>{it.tag}</span>
                <span className="news-title">{it.title}</span>
                {it.sentiment && <span className={"news-sent " + it.sentiment.tone}>{it.sentiment.label}</span>}
                <span className="news-time">{it.ts ? ago(it.ts) : ""}</span>
              </a>
            ))
          ) : (
            <div className="muted">뉴스 불러오는 중…</div>
          )}
          <div className="muted">출처: Cointelegraph RSS · 클릭 시 원문(새 탭)</div>
        </section>
      ),
    },
  ];

  return (
    <main className="wrap">
      <header className="top">
        <div className="head-left">
          <div className="brand">ETH&nbsp;WATCH</div>
          <div className="sub">ETHEREUM SIGNAL TERMINAL · ETHUSDT</div>
        </div>
      </header>

      <div className="toolbar">
        <span className="muted" style={{ padding: 0 }}>
          ⠿ 패널 제목줄을 드래그해 이동 · 오른쪽-아래 모서리로 크기 조절 · 배치는 자동 저장됩니다
        </span>
        <button className="tf-btn" onClick={resetLayout}>
          레이아웃 초기화
        </button>
      </div>

      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1100, md: 850, sm: 600, xs: 0 }}
          cols={{ lg: 12, md: 12, sm: 6, xs: 1 }}
          rowHeight={30}
          margin={[14, 14]}
          draggableHandle=".panel-drag"
          onLayoutChange={onLayoutChange}
          compactType="vertical"
        >
          {panels.map((p) => (
            <div
              key={p.key}
              className={"panel" + (p.glow ? " glow" : "")}
              style={p.glow ? ({ "--glow": p.glow } as any) : undefined}
            >
              <div className="panel-drag">⠿ {p.title}</div>
              <div className="panel-body">{p.node}</div>
            </div>
          ))}
        </ResponsiveGridLayout>
      )}

      <footer className="foot">
        <div>{sig ? `LAST SYNC · ${new Date(sig.updated).toLocaleTimeString()}` : ""}</div>
        <div className="disclaimer">
          ⚠ NOT FINANCIAL ADVICE — rule-based technical signals only. Indicators ≠ guaranteed returns.
        </div>
      </footer>
    </main>
  );
}
