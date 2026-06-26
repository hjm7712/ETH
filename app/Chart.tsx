"use client";
import { useEffect, useRef } from "react";

const INTERVAL_MAP: Record<string, string> = {
  "15m": "15",
  "1h": "60",
  "1d": "D",
  "1w": "W",
};

export default function Chart({ interval }: { interval: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tv = INTERVAL_MAP[interval] ?? "D";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: "BINANCE:ETHUSDT",
      interval: tv,
      timezone: "Asia/Seoul",
      theme: "dark",
      style: "1",
      locale: "kr",
      backgroundColor: "#0d1117",
      gridColor: "rgba(28,37,48,0.5)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    });

    const container = document.createElement("div");
    container.className = "tradingview-widget-container__widget";
    container.style.height = "100%";
    container.style.width = "100%";
    el.appendChild(container);
    el.appendChild(script);

    return () => {
      el.innerHTML = "";
    };
  }, [tv]);

  return (
    <div
      ref={ref}
      className="tradingview-widget-container chart-box"
      style={{ height: "100%", width: "100%" }}
    />
  );
}
