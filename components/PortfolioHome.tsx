"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PortfolioDashboard from "./PortfolioDashboard";
import {
  loadPortfolios,
  persistPortfolios,
  type SavedPortfolio,
  type InvestmentRecord,
  type InvestedPosition,
} from "@/lib/portfolios";

const MODE_STYLES = {
  aggressive:   { bg: "bg-red-900/30",    text: "text-red-400",    label: "Aggressive"    },
  balanced:     { bg: "bg-indigo-900/30", text: "text-indigo-400", label: "Balanced"      },
  conservative: { bg: "bg-amber-900/30",  text: "text-amber-400",  label: "Conservative"  },
};

interface PnLResult {
  pnl: number;
  pnlPct: number;
  totalCurrentValue: number;
  totalCostBasis: number;
}

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, ...opts });
}

async function fetchPnL(positions: InvestedPosition[]): Promise<PnLResult | null> {
  try {
    const res = await fetch("/api/ibkr/pnl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export default function PortfolioHome() {
  const [portfolios, setPortfolios]   = useState<SavedPortfolio[]>([]);
  const [sheetOpen, setSheetOpen]     = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [active, setActive]           = useState<SavedPortfolio | null>(null);
  const [ibkrConnected, setIbkrConnected]   = useState<boolean | null>(null);
  const [ibkrPaper, setIbkrPaper]           = useState(false);
  const [ibkrNeedsLogin, setIbkrNeedsLogin] = useState(false);
  const [ibkrGateway, setIbkrGateway]       = useState(false);
  const [pnlMap, setPnlMap]           = useState<Record<string, PnLResult>>({});

  useEffect(() => {
    setPortfolios(loadPortfolios());
  }, []);

  // Check IBKR connection
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/ibkr/status");
        const data = await res.json();
        if (alive) {
          setIbkrConnected(!!data.connected);
          setIbkrPaper(!!data.paper);
          setIbkrNeedsLogin(!!data.needsLogin);
          setIbkrGateway(!!data.gatewayReachable);
        }
      } catch {
        if (alive) setIbkrConnected(false);
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Fetch P&L for all invested portfolios
  useEffect(() => {
    const invested = portfolios.filter((p) => p.investment && p.investment.positions.length > 0);
    if (invested.length === 0) return;

    for (const p of invested) {
      fetchPnL(p.investment!.positions).then((result) => {
        if (result) setPnlMap((prev) => ({ ...prev, [p.id]: result }));
      });
    }
  }, [portfolios]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeSheet(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function openSheet(portfolio: SavedPortfolio | null) {
    setActive(portfolio);
    setSheetMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetOpen(true)));
  }

  function closeSheet() {
    setSheetOpen(false);
    setTimeout(() => setSheetMounted(false), 460);
  }

  const handleSaved = useCallback((p: SavedPortfolio) => {
    setPortfolios((prev) => {
      const updated = [...prev.filter((x) => x.id !== p.id), p];
      persistPortfolios(updated);
      return updated;
    });
    closeSheet();
  }, []);

  const handleInvested = useCallback((portfolioId: string, record: InvestmentRecord) => {
    setPortfolios((prev) => {
      const updated = prev.map((p) =>
        p.id === portfolioId ? { ...p, investment: record } : p
      );
      persistPortfolios(updated);
      return updated;
    });
    // Fetch P&L immediately after investing
    fetchPnL(record.positions).then((result) => {
      if (result) setPnlMap((prev) => ({ ...prev, [portfolioId]: result }));
    });
  }, []);

  function deletePortfolio(id: string) {
    setPortfolios((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      persistPortfolios(updated);
      return updated;
    });
    setPnlMap((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  const sorted = [...portfolios].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <svg viewBox="-110 -110 220 220" width="28" height="28" fill="none">
            <rect x="-95" y="-95" width="190" height="190" rx="64" stroke="#F4EFE6" strokeWidth="13" />
            <circle cx="0" cy="2" r="42" stroke="#E0703F" strokeWidth="13" />
          </svg>
          <span className="text-sm font-bold tracking-[0.12em] uppercase" style={{ color: "#F4EFE6" }}>
            Portfolio Lens
          </span>
        </div>
        <div className="flex-1" />

        {/* IBKR status */}
        {ibkrConnected === null ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="h-2 w-2 rounded-full bg-gray-700 animate-pulse" />
            IBKR…
          </div>
        ) : ibkrConnected ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            {ibkrPaper ? "IBKR Paper" : "IBKR Live"}
          </div>
        ) : ibkrNeedsLogin ? (
          <a
            href="https://localhost:5000"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-yellow-700/40 bg-yellow-900/20 px-2.5 py-1 text-xs text-yellow-400 hover:border-yellow-600 transition-colors"
          >
            <div className="h-2 w-2 rounded-full bg-yellow-400" />
            Login to IBKR →
          </a>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-gray-600" title="Start the IBKR Client Portal Gateway">
            <div className="h-2 w-2 rounded-full bg-red-800" />
            IBKR offline
          </div>
        )}

        <Link
          href="/market"
          className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1"
        >
          Market Data →
        </Link>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Title + new button */}
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">My Portfolios</h1>
              <p className="text-sm text-gray-500 mt-1">
                {portfolios.length === 0
                  ? "Create your first portfolio to get started"
                  : `${portfolios.length} saved portfolio${portfolios.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              onClick={() => openSheet(null)}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              <span className="text-base leading-none">+</span>
              New Portfolio
            </button>
          </div>

          {/* Empty state */}
          {portfolios.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <svg viewBox="-210 -210 420 420" width="80" height="80" fill="none" className="opacity-20 mb-6">
                <circle cx="0" cy="0" r="190" stroke="#F4EFE6" strokeWidth="8" />
                <rect x="-95" y="-95" width="190" height="190" rx="64" stroke="#F4EFE6" strokeWidth="13" />
                <circle cx="0" cy="2" r="42" stroke="#E0703F" strokeWidth="13" />
              </svg>
              <p className="text-gray-400 text-sm mb-1">No portfolios yet</p>
              <p className="text-gray-600 text-xs mb-6 max-w-xs">
                Build a portfolio using AI scores, technicals, and market signals. When ready, invest directly via IBKR.
              </p>
              <button
                onClick={() => openSheet(null)}
                className="rounded-xl border border-gray-700 bg-gray-800 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:border-indigo-500 hover:text-white transition-colors"
              >
                Create Portfolio
              </button>
            </div>
          )}

          {/* Portfolio grid */}
          {sorted.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sorted.map((p) => {
                const ms = MODE_STYLES[p.mode];
                const date = new Date(p.savedAt).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                });
                const pnl = pnlMap[p.id];
                const invested = p.investment;
                const investDate = invested
                  ? new Date(invested.investedAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })
                  : null;

                return (
                  <div
                    key={p.id}
                    className="group rounded-2xl border border-gray-800 bg-gray-900/60 p-5 flex flex-col gap-3 hover:border-gray-700 transition-colors"
                  >
                    {/* Name + delete */}
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-bold text-white truncate">{p.name}</h2>
                      <button
                        onClick={() => deletePortfolio(p.id)}
                        title="Delete"
                        className="shrink-0 text-gray-700 hover:text-red-400 transition-colors text-sm mt-0.5 opacity-0 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Config badges */}
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${ms.bg} ${ms.text}`}>
                        {ms.label}
                      </span>
                      <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs font-mono text-gray-300">
                        ${parseInt(p.portfolioSize).toLocaleString()}
                      </span>
                      <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
                        {p.maxPositions > 0 ? `${p.maxPositions} pos` : "All pos"}
                      </span>
                      {p.excluded.length > 0 && (
                        <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-600">
                          −{p.excluded.length} excl
                        </span>
                      )}
                    </div>

                    {/* Investment status */}
                    {invested ? (
                      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-3 py-2.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1.5">
                            ● Invested {investDate}
                            {invested.paper && (
                              <span className="rounded-md bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-400 font-semibold">
                                PAPER
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-mono text-gray-400">
                            {fmt(invested.totalInvested)}
                          </span>
                        </div>
                        {pnl ? (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">
                              Current value
                            </span>
                            <div className="text-right">
                              <span className="text-xs font-mono text-white">
                                {fmt(pnl.totalCurrentValue)}
                              </span>
                              <span className={`ml-2 text-xs font-semibold font-mono ${pnl.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {pnl.pnl >= 0 ? "+" : ""}{fmt(pnl.pnl)} ({pnl.pnlPct >= 0 ? "+" : ""}{pnl.pnlPct.toFixed(2)}%)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <div className="h-2 w-2 animate-spin rounded-full border border-gray-700 border-t-gray-500" />
                            Fetching P&amp;L…
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-600">
                        Not yet invested
                        {!ibkrConnected && <span className="ml-1">· Connect IBKR to invest</span>}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-800 mt-auto">
                      <span className="text-xs text-gray-600">Saved {date}</span>
                      <button
                        onClick={() => openSheet(p)}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-indigo-600 hover:text-white transition-colors"
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* "New portfolio" card */}
              <button
                onClick={() => openSheet(null)}
                className="rounded-2xl border-2 border-dashed border-gray-800 bg-transparent p-5 flex flex-col items-center justify-center gap-2 text-gray-700 hover:border-gray-600 hover:text-gray-500 transition-colors min-h-[200px]"
              >
                <span className="text-3xl leading-none">+</span>
                <span className="text-sm font-semibold">New Portfolio</span>
              </button>
            </div>
          )}
        </div>
      </main>

      {/* ── Bottom sheet ── */}
      {sheetMounted && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 transition-opacity duration-300"
            style={{ opacity: sheetOpen ? 1 : 0 }}
            onClick={closeSheet}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-gray-800 bg-gray-950 shadow-2xl"
            style={{
              height: "92vh",
              transform: sheetOpen ? "translateY(0)" : "translateY(100%)",
              transition: "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          >
            <div className="shrink-0 flex justify-center pt-3 pb-1 cursor-pointer" onClick={closeSheet}>
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="flex-1 overflow-hidden">
              <PortfolioDashboard
                sheetMode
                initial={active ?? undefined}
                onClose={closeSheet}
                onSaved={handleSaved}
                onInvested={handleInvested}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
