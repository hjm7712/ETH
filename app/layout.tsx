import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ETH WATCH — Signal Terminal",
  description: "Real-time Ethereum buy/sell signal dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
