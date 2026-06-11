"use client";

import { useEffect, useState } from "react";
import type { Company } from "@/types";
import { findLoadedCompany } from "@/lib/portfolios";
import { cats } from "@/data/categories";
import { currencySymbol } from "@/lib/currency";
import CompanyResearch from "../CompanyResearch";
import NotesPanel from "../NotesPanel";

interface Props {
  symbol: string;
  open: boolean;
  lastPrice?: number;
  onClose: () => void;
}

type Status = "idle" | "loading" | "ready" | "error";
type Tab = "research" | "notes";

// Right-docked research panel for the charted symbol. Resolves the company from
// the Market page's published universe / custom lists first (free, identical to
// what the market shows), then synthesizes one via /api/companies/add only when
// the ticker was never loaded there. All work is gated on `open` so simply
// charting a symbol with the panel collapsed spends no AI tokens.
export default function CompanySidebar({ symbol, open, lastPrice, onClose }: Props) {
  const [company, setCompany] = useState<Company | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [tab, setTab] = useState<Tab>("research");

  useEffect(() => {
    // Gate research resolution on the Research tab being active so opening the
    // panel only for Notes spends no AI tokens.
    if (!open || !symbol || tab !== "research") return;
    let cancelled = false;

    // 1) Reuse the exact Company already loaded on the Market page / custom lists.
    const local = findLoadedCompany(symbol);
    if (local) {
      setCompany(local);
      setStatus("ready");
      return;
    }

    // 2) Otherwise synthesize a full, AI-classified Company (DB-cached server-side).
    setStatus("loading");
    setCompany(null);
    fetch("/api/companies/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: symbol, existingIds: [] }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<Company>;
      })
      .then((c) => {
        if (cancelled) return;
        setCompany(c);
        setStatus("ready");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });

    return () => { cancelled = true; };
  }, [symbol, open, tab]);

  if (!open) return null;

  const cat = company ? cats[company.category] : null;
  const cur = currencySymbol(symbol);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-800 bg-gray-900">
      {/* Header */}
      <div className={`sticky top-0 z-10 shrink-0 border-b px-4 py-3 ${cat?.bg ?? "bg-gray-900"} ${cat?.border ?? "border-gray-800"} bg-opacity-90 backdrop-blur`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {company ? (
              <>
                <div className="flex items-center gap-2">
                  {cat && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${cat.text}`}>{cat.label}</span>
                  )}
                  <span className="truncate text-[11px] text-gray-500">{company.industry}</span>
                </div>
                <h2 className="mt-0.5 truncate text-base font-bold text-white">{company.name}</h2>
                <span className={`font-mono text-xs ${cat?.accent ?? "text-gray-400"}`}>{company.ticker}</span>
              </>
            ) : (
              <span className="font-mono text-sm font-bold text-white">{symbol}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastPrice != null && (
              <span className="font-mono text-sm font-bold text-white">{cur}{lastPrice.toFixed(2)}</span>
            )}
            <button
              onClick={onClose}
              title="Hide research panel"
              className="rounded-md px-1.5 text-gray-500 hover:bg-gray-800 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Tabs — Research / Notes */}
      <div className="flex shrink-0 items-center gap-px border-b border-gray-800 bg-gray-950/40 px-3 py-2">
        {(["research", "notes"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-[11px] font-mono font-semibold tracking-wide capitalize transition-all ${
              tab === t ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      {tab === "research" ? (
        <div className="flex-1 overflow-y-auto p-4">
          {status === "loading" && (
            <div className="flex items-center gap-2 py-8 text-xs text-gray-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400" />
              Loading research for {symbol}…
            </div>
          )}
          {status === "error" && (
            <div className="py-8 text-xs text-gray-500">
              Couldn’t load research for {symbol}. It may not be a recognised equity, or the analysis service is unavailable.
            </div>
          )}
          {status === "ready" && company && <CompanyResearch company={company} />}
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-4">
          <NotesPanel contextSymbol={symbol} />
        </div>
      )}
    </aside>
  );
}
