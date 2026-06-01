"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Company } from "@/types";
import type { BatchScoreMap } from "@/app/api/scores/batch/route";
import type { QuantScoreMap } from "@/app/api/quant/route";
import { cats } from "@/data/categories";
import CompanyCard from "./CompanyCard";
import NewsTicker from "./NewsTicker";
import LoadingScreen from "./LoadingScreen";

const StockPanel = dynamic(() => import("./StockPanel"), { ssr: false });
const AIChat = dynamic(() => import("./AIChat"), { ssr: false });

const CUSTOM_KEY = "finance-custom-companies";

function Divider() {
  return <div className="w-px h-4 shrink-0 bg-gray-800" />;
}

export default function Dashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [selected, setSelected] = useState<Company | null>(null);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");
  const [chatOpen, setChatOpen] = useState(false);

  const [sortBy, setSortBy] = useState<"default" | "shortTerm" | "longTerm" | "quant">("default");
  const [scores, setScores] = useState<BatchScoreMap>({});
  const [quantScores, setQuantScores] = useState<QuantScoreMap>({});
  const [scoresLoading, setScoresLoading] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [customTickers, setCustomTickers] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTicker, setAddTicker] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved: Company[] = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    setCustomTickers(new Set(saved.map((c) => c.ticker)));
    fetch("/api/companies")
      .then((r) => {
        const tok = r.headers.get("X-Tokens-Used");
        if (tok) setTokensUsed(Number(tok));
        return r.json() as Promise<Company[]>;
      })
      .then((data) => {
        const fetched = data.filter((c) => !saved.some((s) => s.ticker === c.ticker));
        setCompanies([...fetched, ...saved]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (sortBy === "default" || companies.length === 0) return;
    setScoresLoading(true);

    if (sortBy === "quant") {
      fetch("/api/quant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
      })
        .then((r) => r.json())
        .then((data) => { setQuantScores(data); setScoresLoading(false); })
        .catch(() => setScoresLoading(false));
    } else {
      fetch("/api/scores/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
      })
        .then((r) => r.json())
        .then((data) => { setScores(data); setScoresLoading(false); })
        .catch(() => setScoresLoading(false));
    }
  }, [sortBy, companies]);

  useEffect(() => {
    if (selected) requestAnimationFrame(() => setPanelVisible(true));
  }, [selected]);

  function closePanel() {
    setPanelVisible(false);
    setTimeout(() => setSelected(null), 300);
  }

  useEffect(() => {
    if (addOpen) setTimeout(() => addInputRef.current?.focus(), 50);
  }, [addOpen]);

  async function handleAdd() {
    const ticker = addTicker.trim().toUpperCase();
    if (!ticker) return;
    if (companies.some((c) => c.ticker === ticker)) {
      setAddError(`${ticker} is already in the list.`);
      return;
    }
    setAddLoading(true);
    setAddError("");
    try {
      const res = await fetch("/api/companies/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, existingIds: companies.map((c) => c.id) }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? "Failed."); return; }
      setCompanies((prev) => [...prev, data]);
      setCustomTickers((prev) => new Set([...prev, data.ticker]));
      const custom: Company[] = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
      localStorage.setItem(CUSTOM_KEY, JSON.stringify([...custom, data]));
      setAddTicker("");
      setAddOpen(false);
    } catch {
      setAddError("Network error.");
    } finally {
      setAddLoading(false);
    }
  }

  function handleRemove(ticker: string) {
    const updated = companies.filter((c) => c.ticker !== ticker);
    setCompanies(updated);
    if (selected?.ticker === ticker) setSelected(null);
    setCustomTickers((prev) => { const s = new Set(prev); s.delete(ticker); return s; });
    const custom: Company[] = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom.filter((c) => c.ticker !== ticker)));
  }

  const industries = useMemo(() => {
    const unique = Array.from(new Set(companies.map((c) => c.industry))).sort();
    return ["All", ...unique];
  }, [companies]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        c.reason.toLowerCase().includes(q);
      const matchIndustry = industry === "All" || c.industry === industry;
      return matchSearch && matchIndustry;
    });
  }, [companies, search, industry]);

  const categorized = useMemo(() => {
    const sortFn = (a: Company, b: Company) => {
      if (sortBy === "default") return 0;
      if (sortBy === "quant")
        return (quantScores[b.ticker]?.score ?? 0) - (quantScores[a.ticker]?.score ?? 0);
      const key = sortBy === "shortTerm" ? "st" : "lt";
      return (scores[b.ticker]?.[key] ?? 0) - (scores[a.ticker]?.[key] ?? 0);
    };
    return {
      future: filtered.filter((c) => c.category === "future").sort(sortFn),
      stable: filtered.filter((c) => c.category === "stable").sort(sortFn),
      fading: filtered.filter((c) => c.category === "fading").sort(sortFn),
    };
  }, [filtered, sortBy, scores]);

  const btnBase = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all duration-150 cursor-pointer";
  const btnIdle = "border-gray-800 bg-gray-900/50 text-gray-500 hover:border-gray-700 hover:text-gray-300";
  const btnActive = "border-indigo-500/50 bg-indigo-950/60 text-indigo-300";

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <LoadingScreen visible={loading} />
      {chatOpen && (
        <div className="w-80 shrink-0 z-30 flex flex-col">
          <AIChat companies={companies} onClose={() => setChatOpen(false)} />
        </div>
      )}

      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 items-center gap-2.5 border-b border-gray-800/80 bg-gray-950/95 px-5 py-2.5 backdrop-blur">

          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-indigo-600/20 border border-indigo-500/30 shrink-0">
              <span className="text-indigo-400 text-[10px] font-mono font-bold leading-none">PL</span>
            </div>
            <h1 className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
              Portfolio Lens
            </h1>
          </div>

          <Divider />

          {/* Search + filter */}
          <div className="flex flex-1 items-center max-w-md">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="flex-1 rounded-l-lg border border-r-0 border-gray-800 bg-gray-900/60 px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none transition-colors"
            />
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="rounded-r-lg border border-gray-800 bg-gray-900/60 px-2.5 py-1.5 text-xs text-gray-400 focus:border-gray-600 focus:outline-none transition-colors"
            >
              {industries.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          <Divider />

          {/* Tool buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setCompact((c) => !c)}
              title={compact ? "Expanded view" : "Compact view"}
              className={`${btnBase} ${compact ? btnActive : btnIdle}`}
            >
              {compact ? "⊟" : "⊞"}
            </button>

            <div className="relative">
              <button
                onClick={() => { setAddOpen((o) => !o); setAddError(""); setAddTicker(""); }}
                className={`${btnBase} ${addOpen ? btnActive : btnIdle}`}
              >
                + Add
              </button>
              {addOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-gray-700/80 bg-gray-900/95 p-3.5 shadow-2xl backdrop-blur">
                  <p className="mb-2.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-gray-500">
                    Add by ticker
                  </p>
                  <div className="flex gap-2">
                    <input
                      ref={addInputRef}
                      value={addTicker}
                      onChange={(e) => { setAddTicker(e.target.value.toUpperCase()); setAddError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                      placeholder="e.g. AAPL"
                      className="flex-1 rounded-lg border border-gray-700/80 bg-gray-800/60 px-2.5 py-1.5 text-xs font-mono text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                    />
                    <button
                      onClick={handleAdd}
                      disabled={addLoading || !addTicker.trim()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold font-mono text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                    >
                      {addLoading ? "…" : "Add"}
                    </button>
                  </div>
                  {addError && <p className="mt-2 text-[11px] text-red-400">{addError}</p>}
                </div>
              )}
            </div>
          </div>

          <Divider />

          {/* Nav */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Link href="/" className={`${btnBase} ${btnIdle}`}>
              <span className="text-gray-600">◈</span> Portfolios
            </Link>
            <button
              onClick={() => setChatOpen((o) => !o)}
              className={`${btnBase} ${chatOpen ? btnActive : btnIdle}`}
            >
              <span className={chatOpen ? "text-indigo-400" : "text-gray-600"}>✦</span> AI Chat
            </button>
          </div>
        </header>

        {/* Sort bar — segmented control */}
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-800/60 bg-gray-950/70 px-5 py-2">
          <span className="text-[10px] font-mono tracking-[0.15em] uppercase text-gray-700 select-none">
            Sort
          </span>
          <div className="flex items-center rounded-lg bg-gray-900/80 border border-gray-800/80 p-0.5 gap-px">
            {([
              { key: "default",   label: "Default"    },
              { key: "shortTerm", label: "Short Term" },
              { key: "longTerm",  label: "Long Term"  },
              { key: "quant",     label: "Quant"      },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all duration-150 ${
                  sortBy === key
                    ? "bg-gray-800 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-400"
                }`}
              >
                {label}
                {scoresLoading && sortBy === key && (
                  <span className="h-2 w-2 animate-spin rounded-full border border-gray-500 border-t-gray-200" />
                )}
              </button>
            ))}
          </div>
          {!loading && search && (
            <span className="ml-auto text-[10px] font-mono text-gray-700 tabular-nums">
              {filtered.length} / {companies.length}
            </span>
          )}
        </div>

        {/* Company grid */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {filtered.length === 0 && !loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2">
              <span className="text-2xl text-gray-800">◈</span>
              <span className="text-xs font-mono text-gray-600">No companies match your search.</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              {(["future", "stable", "fading"] as const).map((cat) => (
                <div key={cat}>
                  {/* Column header */}
                  <div className="mb-3.5">
                    <div
                      className="h-[2px] w-full rounded-full mb-3 opacity-70"
                      style={{ background: `linear-gradient(90deg, ${cats[cat].color}90, transparent)` }}
                    />
                    <div className="flex items-baseline justify-between px-0.5">
                      <span className={`text-[11px] font-mono font-bold uppercase tracking-[0.14em] ${cats[cat].text}`}>
                        {cats[cat].label}
                      </span>
                      <span className="text-[10px] font-mono text-gray-700 tabular-nums">
                        {categorized[cat].length}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {categorized[cat].map((company) => (
                      <CompanyCard
                        key={company.id}
                        company={company}
                        selected={selected?.id === company.id}
                        compact={compact}
                        sortScore={
                          sortBy === "shortTerm" ? scores[company.ticker]?.st :
                          sortBy === "longTerm"  ? scores[company.ticker]?.lt :
                          sortBy === "quant"     ? quantScores[company.ticker]?.score :
                          undefined
                        }
                        sortLabel={
                          sortBy === "shortTerm" ? "ST" :
                          sortBy === "longTerm"  ? "LT" :
                          sortBy === "quant"     ? "QT" :
                          undefined
                        }
                        sortScoreMax={sortBy === "quant" ? 100 : 10}
                        onClick={() => {
                          if (selected?.id === company.id) { closePanel(); }
                          else { setPanelVisible(false); setSelected(company); }
                        }}
                        onRemove={customTickers.has(company.ticker) ? () => handleRemove(company.ticker) : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <NewsTicker companies={companies} />
      </div>

      {selected && (
        <>
          <div
            className={`fixed inset-0 z-20 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${panelVisible ? "opacity-100" : "opacity-0"}`}
            onClick={closePanel}
          />
          <div
            className={`fixed right-0 top-0 z-30 h-full w-[560px] shadow-2xl transition-transform duration-300 ease-out ${panelVisible ? "translate-x-0" : "translate-x-full"}`}
          >
            <StockPanel company={selected} onClose={closePanel} />
          </div>
        </>
      )}
    </div>
  );
}
