import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import MarketStatusBanner from "@/components/MarketStatusBanner";
import PersistentTradingEngine from "@/components/PersistentTradingEngine";
import PersistentAIChat from "@/components/PersistentAIChat";
import AlertsPoller from "@/components/AlertsPoller";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portfolio Lens",
  description: "AI-powered equity research dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MarketStatusBanner />
        {children}
        <PersistentTradingEngine />
        <PersistentAIChat />
        <AlertsPoller />
      </body>
    </html>
  );
}
