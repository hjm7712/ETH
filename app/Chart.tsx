"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";

// Candlestick + volume chart from our Binance data, with LIVE updates:
// initial history via /api/klines, then the forming candle streams in over a
// Binance kline WebSocket and updates in real time.
export default function Chart({ interval }: { interval: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const intraday = interval === "15m" || interval === "1h";
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0d1117" },
        textColor: "#8b98a8",
        fontFamily: "ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "rgba(28,37,48,0.5)" },
        horzLines: { color: "rgba(28,37,48,0.5)" },
      },
      rightPriceScale: { borderColor: "#1c2530" },
      timeScale: { borderColor: "#1c2530", timeVisible: intraday, rightOffset: 4 },
      crosshair: { mode: 0 },
    });

    const candle = chart.addCandlestickSeries({
      upColor: "#22e06b",
      downColor: "#ff4d4d",
      borderVisible: false,
      wickUpColor: "#22e06b",
      wickDownColor: "#ff4d4d",
    });
    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const greenV = "rgba(34,224,107,0.45)";
    const redV = "rgba(255,77,77,0.45)";

    let cancelled = false;
    let ws: WebSocket | undefined;

    fetch(`/api/klines?interval=${interval}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || d.error) return;
        candle.setData(d.candles);
        vol.setData(d.volume);
        chart.timeScale().fitContent();

        // Live: Binance pushes the forming candle continuously.
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/ethusdt@kline_${interval}`);
        ws.onmessage = (e) => {
          const k = JSON.parse(e.data)?.k;
          if (!k) return;
          const time = Math.floor(k.t / 1000);
          const up = parseFloat(k.c) >= parseFloat(k.o);
          candle.update({
            time,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          } as any);
          vol.update({ time, value: parseFloat(k.v), color: up ? greenV : redV } as any);
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      ws?.close();
      chart.remove();
    };
  }, [interval]);

  return <div ref={ref} className="chart-box" />;
}
