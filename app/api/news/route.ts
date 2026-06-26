import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Cointelegraph tag RSS feeds — keyless, ETH-first then BTC.
const FEEDS = [
  { url: "https://cointelegraph.com/rss/tag/ethereum", tag: "ETH" },
  { url: "https://cointelegraph.com/rss/tag/bitcoin", tag: "BTC" },
];

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function pick(seg: string, tag: string): string {
  const m = seg.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
}

// Keyword-based headline sentiment. Transparent heuristic, not an LLM.
const BULL = [
  "surge", "surges", "soar", "soars", "rally", "rallies", "gain", "gains", "jump", "jumps",
  "rise", "rises", "climb", "climbs", "breakout", "record", "ath", "adoption", "approve",
  "approval", "approved", "inflow", "inflows", "buy", "buys", "buying", "accumulate",
  "accumulation", "bullish", "boost", "boosts", "partnership", "upgrade", "wins", "win",
  "pump", "recover", "recovery", "rebound", "rebounds", "support", "tops", "double",
  "bounce", "bounces", "inflows", "rallies", "outperform", "outperforms",
];
const BEAR = [
  "crash", "crashes", "plunge", "plunges", "drop", "drops", "fall", "falls", "fell", "slump",
  "sink", "sinks", "rout", "routs", "selloff", "sell-off", "dump", "dumps", "liquidation",
  "liquidations", "hack", "hacked", "exploit", "ban", "banned", "lawsuit", "outflow",
  "outflows", "bearish", "low", "lows", "weak", "weakness", "fails", "fail", "fear",
  "warning", "warn", "risk", "below", "loss", "losses", "capitulation", "breakdown", "bear",
  "bears", "crackdown", "dip", "tumble", "loses", "lose", "losing", "failure", "underperform",
  "sells", "downturn", "pressure",
];

function sentiment(title: string) {
  const t = title.toLowerCase();
  const count = (words: string[]) =>
    words.reduce((n, w) => (new RegExp(`\\b${w}\\b`).test(t) ? n + 1 : n), 0);
  const score = count(BULL) - count(BEAR);
  if (score > 0) return { label: "호재", tone: "good" };
  if (score < 0) return { label: "악재", tone: "bad" };
  return { label: "중립", tone: "neutral" };
}

function parseItems(xml: string, tag: string) {
  const out: { title: string; link: string; ts: number; tag: string }[] = [];
  const blocks = xml.split("<item>").slice(1);
  for (const b of blocks) {
    const seg = b.split("</item>")[0];
    const title = pick(seg, "title");
    const link = pick(seg, "link");
    const pub = pick(seg, "pubDate");
    if (title && link) out.push({ title, link, ts: pub ? Date.parse(pub) : 0, tag });
  }
  return out;
}

export async function GET() {
  try {
    const texts = await Promise.all(
      FEEDS.map((f) =>
        fetch(f.url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (eth-watch)" } })
          .then((r) => (r.ok ? r.text() : ""))
          .then((t) => parseItems(t, f.tag))
          .catch(() => [])
      )
    );

    const seen = new Set<string>();
    const items = texts
      .flat()
      .filter((i) => (seen.has(i.link) ? false : (seen.add(i.link), true)))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 14)
      .map((i) => ({ ...i, sentiment: sentiment(i.title) }));

    if (!items.length) throw new Error("no items");
    return NextResponse.json({ items, updated: Date.now() });
  } catch {
    return NextResponse.json({ error: "news unavailable" }, { status: 502 });
  }
}
