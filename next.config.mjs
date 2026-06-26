/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com https://*.tradingview.com",
              "frame-src 'self' https://*.tradingview.com https://www.tradingview.com",
              "connect-src 'self' https://*.tradingview.com https://api.binance.com https://api.coingecko.com https://api.alternative.me https://fapi.binance.com wss://stream.binance.com wss://*.tradingview.com",
              "img-src 'self' data: https://*.tradingview.com",
              "style-src 'self' 'unsafe-inline' https://*.tradingview.com",
              "font-src 'self' https://*.tradingview.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
export default nextConfig;
