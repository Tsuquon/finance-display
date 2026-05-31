"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PortfolioDashboard from "./PortfolioDashboard";
import {
  loadPortfolios,
  persistPortfolios,
  type SavedPortfolio,
} from "@/lib/portfolios";

const MODE_STYLES = {
  aggressive: { bg: "bg-red-900/30",    text: "text-red-400",    label: "Aggressive" },
  balanced:   { bg: "bg-indigo-900/30", text: "text-indigo-400", label: "Balanced"   },
  conservative:{ bg: "bg-amber-900/30", text: "text-amber-400",  label: "Conservative"},
};

export default function PortfolioHome() {
  const [portfolios, setPortfolios] = useState<SavedPortfolio[]>([]);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [active, setActive]         = useState<SavedPortfolio | null>(null);

  useEffect(() => {
    setPortfolios(loadPortfolios());
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSheet();
    }
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
      const without = prev.filter((x) => x.id !== p.id);
      const updated = [...without, p];
      persistPortfolios(updated);
      return updated;
    });
    closeSheet();
  }, []);

  function deletePortfolio(id: string) {
    setPortfolios((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      persistPortfolios(updated);
      return updated;
    });
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
          {/* Page title + new button */}
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
                Use the allocation algorithm to build a portfolio based on AI scores, technicals, and market signals.
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
                return (
                  <div
                    key={p.id}
                    className="group rounded-2xl border border-gray-800 bg-gray-900/60 p-5 flex flex-col gap-4 hover:border-gray-700 transition-colors"
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

                    {/* Badges */}
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${ms.bg} ${ms.text}`}>
                        {ms.label}
                      </span>
                      <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs font-mono text-gray-300">
                        ${parseInt(p.portfolioSize).toLocaleString()}
                      </span>
                      <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
                        {p.maxPositions > 0 ? `${p.maxPositions} positions` : "All positions"}
                      </span>
                      {p.excluded.length > 0 && (
                        <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-600">
                          −{p.excluded.length} excluded
                        </span>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-800">
                      <span className="text-xs text-gray-600">{date}</span>
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
                className="rounded-2xl border-2 border-dashed border-gray-800 bg-transparent p-5 flex flex-col items-center justify-center gap-2 text-gray-700 hover:border-gray-600 hover:text-gray-500 transition-colors min-h-[160px]"
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
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/60 transition-opacity duration-300"
            style={{ opacity: sheetOpen ? 1 : 0 }}
            onClick={closeSheet}
          />

          {/* Sheet */}
          <div
            className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-gray-800 bg-gray-950 shadow-2xl"
            style={{
              height: "92vh",
              transform: sheetOpen ? "translateY(0)" : "translateY(100%)",
              transition: "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          >
            {/* Drag handle */}
            <div
              className="shrink-0 flex justify-center pt-3 pb-1 cursor-pointer"
              onClick={closeSheet}
            >
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>

            {/* Dashboard fills the rest */}
            <div className="flex-1 overflow-hidden">
              <PortfolioDashboard
                sheetMode
                initial={active ?? undefined}
                onClose={closeSheet}
                onSaved={handleSaved}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
