"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Company } from "@/types";
import type { BatchScoreMap } from "@/app/api/scores/batch/route";
import { cats } from "@/data/categories";
import CompanyCard from "./CompanyCard";
import NewsTicker from "./NewsTicker";
import LoadingScreen from "./LoadingScreen";

const StockPanel = dynamic(() => import("./StockPanel"), { ssr: false });
const AIChat = dynamic(() => import("./AIChat"), { ssr: false });

const CUSTOM_KEY = "finance-custom-companies";

export default function Dashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [selected, setSelected] = useState<Company | null>(null);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");
  const [chatOpen, setChatOpen] = useState(false);

  const [sortBy, setSortBy] = useState<"default" | "shortTerm" | "longTerm">("default");
  const [scores, setScores] = useState<BatchScoreMap>({});
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
    fetch("/api/scores/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    })
      .then((r) => r.json())
      .then((data) => { setScores(data); setScoresLoading(false); })
      .catch(() => setScoresLoading(false));
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
      const key = sortBy === "shortTerm" ? "st" : "lt";
      return (scores[b.ticker]?.[key] ?? 0) - (scores[a.ticker]?.[key] ?? 0);
    };
    return {
      future: filtered.filter((c) => c.category === "future").sort(sortFn),
      stable: filtered.filter((c) => c.category === "stable").sort(sortFn),
      fading: filtered.filter((c) => c.category === "fading").sort(sortFn),
    };
  }, [filtered, sortBy, scores]);

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <LoadingScreen visible={loading} tokens={tokensUsed} />
      {chatOpen && (
        <div className="w-80 shrink-0 z-30 flex flex-col">
          <AIChat companies={companies} onClose={() => setChatOpen(false)} />
        </div>
      )}

      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 bg-gray-950/90 px-6 py-3 backdrop-blur">
          <h1 className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
            Portfolio Lens
          </h1>

          <div className="flex flex-1 items-center gap-2 max-w-xl">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none"
            />
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-sm text-white focus:border-gray-500 focus:outline-none"
            >
              {industries.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          {/* Compact toggle */}
          <button
            onClick={() => setCompact((c) => !c)}
            title={compact ? "Expanded view" : "Compact view"}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              compact
                ? "border-indigo-500 bg-indigo-900/50 text-indigo-300"
                : "border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-500 hover:text-white"
            }`}
          >
            {compact ? "⊟" : "⊞"}
          </button>

          {/* Add company */}
          <div className="relative">
            <button
              onClick={() => { setAddOpen((o) => !o); setAddError(""); setAddTicker(""); }}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-sm font-semibold text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
            >
              + Add
            </button>
            {addOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-gray-700 bg-gray-900 p-3 shadow-xl">
                <p className="mb-2 text-xs font-semibold text-gray-400">Add by ticker</p>
                <div className="flex gap-2">
                  <input
                    ref={addInputRef}
                    value={addTicker}
                    onChange={(e) => { setAddTicker(e.target.value.toUpperCase()); setAddError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder="e.g. AAPL"
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs font-mono text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                  />
                  <button
                    onClick={handleAdd}
                    disabled={addLoading || !addTicker.trim()}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                  >
                    {addLoading ? "…" : "Add"}
                  </button>
                </div>
                {addError && <p className="mt-1.5 text-xs text-red-400">{addError}</p>}
              </div>
            )}
          </div>

          <Link
            href="/portfolio"
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-sm font-semibold text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
          >
            <span>◈</span> Portfolio
          </Link>

          <button
            onClick={() => setChatOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              chatOpen
                ? "border-indigo-500 bg-indigo-900/50 text-indigo-300"
                : "border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-500 hover:text-white"
            }`}
          >
            <span>✦</span> AI Chat
          </button>
        </header>

        {/* Sort bar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-800/60 px-6 py-2">
          <span className="text-xs text-gray-600">Sort by</span>
          {([
            { key: "default",   label: "Default" },
            { key: "shortTerm", label: "Short Term" },
            { key: "longTerm",  label: "Long Term"  },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                sortBy === key
                  ? "bg-indigo-900/50 text-indigo-300 border border-indigo-500/50"
                  : "text-gray-500 hover:text-gray-300 border border-transparent"
              }`}
            >
              {label}
              {scoresLoading && sortBy === key && (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-indigo-400 border-t-transparent" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {filtered.length === 0 && !loading ? (
            <div className="flex h-64 items-center justify-center text-gray-600">
              No companies match your search.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {(["future", "stable", "fading"] as const).map((cat) => (
                <div key={cat}>
                  <div className={`mb-3 flex items-center gap-2 border-b pb-2 ${cats[cat].border}`}>
                    <span className={`text-sm font-bold uppercase tracking-wider ${cats[cat].text}`}>
                      {cats[cat].label}
                    </span>
                    <span className="text-xs text-gray-600">{categorized[cat].length}</span>
                  </div>
                  <div className="space-y-3">
                    {categorized[cat].map((company) => (
                      <CompanyCard
                        key={company.id}
                        company={company}
                        selected={selected?.id === company.id}
                        compact={compact}
                        sortScore={sortBy !== "default" ? (sortBy === "shortTerm" ? scores[company.ticker]?.st : scores[company.ticker]?.lt) : undefined}
                        sortLabel={sortBy === "shortTerm" ? "ST" : sortBy === "longTerm" ? "LT" : undefined}
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
            className={`fixed inset-0 z-20 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${panelVisible ? "opacity-100" : "opacity-0"}`}
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
