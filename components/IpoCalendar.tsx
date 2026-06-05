"use client";

import { useEffect, useState } from "react";
import type { IposResponse } from "@/app/api/ipos/route";
import type { IpoListing } from "@/lib/finnhub";

// Compact dollar deal size, e.g. $1.2B, $340M.
function dealSize(v: number | null): string | null {
  if (v == null || v <= 0) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// "2026-06-10" → "Jun 10". Falls back to the raw string if unparseable.
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatusPill({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  const cls =
    s === "priced"
      ? "border-emerald-500/30 bg-emerald-950/50 text-emerald-300"
      : s === "withdrawn" || s === "filed"
      ? "border-gray-700/60 bg-gray-800/60 text-gray-400"
      : "border-indigo-500/30 bg-indigo-950/50 text-indigo-300"; // expected / unknown
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wide border ${cls}`}>
      {status ?? "—"}
    </span>
  );
}

function IpoRow({ ipo }: { ipo: IpoListing }) {
  const size = dealSize(ipo.totalSharesValue);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-800/70 bg-gray-900/40 px-3 py-2.5 transition-colors hover:border-gray-700">
      <div className="flex w-14 shrink-0 flex-col items-center">
        <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">
          {shortDate(ipo.date).split(" ")[0]}
        </span>
        <span className="text-sm font-bold tabular-nums text-gray-200">
          {shortDate(ipo.date).split(" ")[1]}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {ipo.symbol && (
            <span className="font-mono text-xs font-bold text-indigo-300">{ipo.symbol}</span>
          )}
          <StatusPill status={ipo.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-300">{ipo.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono text-gray-500">
          {ipo.exchange && <span className="truncate">{ipo.exchange}</span>}
          {ipo.price && <span className="text-gray-400">${ipo.price}</span>}
          {size && <span className="text-gray-400">{size}</span>}
        </div>
      </div>
    </li>
  );
}

function Column({ title, items, empty }: { title: string; items: IpoListing[]; empty: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-mono font-semibold uppercase tracking-widest text-gray-400">
          {title}
        </h2>
        <span className="rounded bg-gray-800/70 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-gray-500">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-800 text-xs font-mono text-gray-600">
          {empty}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((ipo, i) => (
            <IpoRow key={`${ipo.symbol || ipo.name}-${ipo.date}-${i}`} ipo={ipo} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function IpoCalendar() {
  const [data, setData] = useState<IposResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Runs once on mount; loading/error already start true/false, so no
    // synchronous reset is needed here.
    let active = true;
    fetch("/api/ipos")
      .then((r) => r.json() as Promise<IposResponse>)
      .then((d) => { if (active) setData(d); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-indigo-400" />
        <span className="text-xs font-mono text-gray-600">Loading IPO calendar…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <span className="text-2xl text-gray-800">◈</span>
        <span className="text-xs font-mono text-gray-600">Couldn&apos;t load the IPO calendar.</span>
      </div>
    );
  }

  if (!data.configured) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <span className="text-2xl text-gray-800">◈</span>
        <span className="text-xs font-mono text-gray-600">
          IPO calendar needs a Finnhub API key (FINNHUB_API_KEY).
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-sm font-bold text-white">IPO Calendar</h1>
        <p className="mt-0.5 text-[11px] font-mono text-gray-500">
          Upcoming and recently priced US listings · Finnhub
        </p>
      </div>
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <Column title="Upcoming" items={data.upcoming} empty="No upcoming IPOs in range." />
        <Column title="Recently Listed" items={data.recent} empty="No recent IPOs in range." />
      </div>
    </div>
  );
}
