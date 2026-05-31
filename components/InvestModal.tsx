"use client";

import { useState, useEffect } from "react";
import type { InvestmentRecord } from "@/lib/portfolios";

interface AllocInput {
  ticker: string;
  name: string;
  dollar: number;
}

interface PreviewOrder {
  ticker: string;
  name: string;
  dollar: number;
  conid?: number;
  price?: number;
  shares?: number;
  estimatedCost?: number;
  error?: string;
}

interface ExecuteResult {
  ticker: string;
  orderId?: string;
  status?: string;
  error?: string;
  shares: number;
  price: number;
}

type Step = "previewing" | "confirming" | "executing" | "done" | "error";

interface Props {
  allocations: AllocInput[];
  onClose: () => void;
  onInvested: (record: InvestmentRecord) => void;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function InvestModal({ allocations, onClose, onInvested }: Props) {
  const [step, setStep]           = useState<Step>("previewing");
  const [preview, setPreview]     = useState<{ accountId: string; orders: PreviewOrder[]; totalEstimated: number; skipped: number } | null>(null);
  const [results, setResults]     = useState<ExecuteResult[]>([]);
  const [investRecord, setInvestRecord] = useState<InvestmentRecord | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");
  const [executing, setExecuting] = useState<string[]>([]); // tickers in progress
  const [paper, setPaper]         = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ibkr/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allocations }),
        });
        if (cancelled) return;
        if (!res.ok) { setStep("error"); setErrorMsg("Preview failed — check IBKR connection."); return; }
        const data = await res.json();
        if (data.error) { setStep("error"); setErrorMsg(data.error); return; }
        // Check paper mode
        fetch("/api/ibkr/status").then((r) => r.json()).then((s) => { if (s.paper) setPaper(true); }).catch(() => {});
        setPreview(data);
        setStep("confirming");
      } catch {
        if (!cancelled) { setStep("error"); setErrorMsg("Could not reach server."); }
      }
    })();
    return () => { cancelled = true; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    if (!preview) return;
    const validOrders = preview.orders.filter((o) => !o.error && (o.shares ?? 0) > 0);
    setStep("executing");
    setExecuting(validOrders.map((o) => o.ticker));

    try {
      const res = await fetch("/api/ibkr/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: preview.accountId, orders: validOrders }),
      });
      const data = await res.json();
      if (data.error) { setStep("error"); setErrorMsg(data.error); return; }
      setResults(data.results ?? []);
      setInvestRecord(data.investmentRecord);
      setStep("done");
    } catch {
      setStep("error");
      setErrorMsg("Execution failed.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-white">
              {step === "previewing"  && "Loading Order Preview…"}
              {step === "confirming"  && "Review Orders"}
              {step === "executing"   && "Placing Orders…"}
              {step === "done"        && "Investment Complete"}
              {step === "error"       && "Something Went Wrong"}
            </h2>
            {preview && step !== "done" && (
              <p className="text-xs text-gray-500 mt-0.5">Account {preview.accountId}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors text-sm">✕</button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Previewing */}
          {step === "previewing" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-indigo-400" />
              <p className="text-xs text-gray-500">Fetching live prices from IBKR…</p>
            </div>
          )}

          {/* Paper mode banner */}
          {step === "confirming" && paper && (
            <div className="mx-6 mt-4 rounded-lg bg-yellow-900/30 border border-yellow-700/40 px-4 py-2.5 flex items-center gap-2">
              <span className="text-yellow-400 text-sm">⚠</span>
              <p className="text-xs text-yellow-300 font-semibold">Paper Trading Mode — no real money will be used</p>
            </div>
          )}

          {/* Confirming */}
          {step === "confirming" && preview && (
            <div className="divide-y divide-gray-800/60 mt-2">
              {preview.orders.map((o) => (
                <div key={o.ticker} className={`flex items-center gap-4 px-6 py-3 ${o.error ? "opacity-40" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white font-mono">{o.ticker}</span>
                      <span className="text-xs text-gray-500 truncate">{o.name}</span>
                    </div>
                    {o.error ? (
                      <p className="text-xs text-red-400 mt-0.5">{o.error}</p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {o.shares} shares @ {fmt(o.price ?? 0)}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {!o.error && (
                      <>
                        <p className="text-sm font-semibold text-white font-mono">{fmt(o.estimatedCost ?? 0)}</p>
                        <p className="text-xs text-gray-600">of {fmt(o.dollar)}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Executing */}
          {step === "executing" && preview && (
            <div className="divide-y divide-gray-800/60">
              {preview.orders
                .filter((o) => !o.error && (o.shares ?? 0) > 0)
                .map((o) => {
                  const result = results.find((r) => r.ticker === o.ticker);
                  const inProgress = executing.includes(o.ticker) && !result;
                  return (
                    <div key={o.ticker} className="flex items-center gap-4 px-6 py-3">
                      <div className="w-4 shrink-0 flex items-center justify-center">
                        {result?.error ? (
                          <span className="text-red-400 text-xs">✗</span>
                        ) : result ? (
                          <span className="text-emerald-400 text-xs">✓</span>
                        ) : inProgress ? (
                          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-indigo-400" />
                        ) : (
                          <div className="h-1.5 w-1.5 rounded-full bg-gray-700" />
                        )}
                      </div>
                      <span className="text-sm font-mono text-white">{o.ticker}</span>
                      <span className="text-xs text-gray-500 flex-1">{o.shares} shares</span>
                      {result && (
                        <span className={`text-xs ${result.error ? "text-red-400" : "text-gray-500"}`}>
                          {result.error ?? `#${result.orderId ?? "placed"}`}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* Done */}
          {step === "done" && investRecord && (
            <div className="px-6 py-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-900/40">
                  <span className="text-emerald-400 text-lg">✓</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {results.filter((r) => !r.error).length} orders placed
                  </p>
                  <p className="text-xs text-gray-500">
                    {fmt(investRecord.totalInvested)} invested via {investRecord.ibkrAccountId}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/40 divide-y divide-gray-800/50">
                {results.map((r) => (
                  <div key={r.ticker} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`text-xs ${r.error ? "text-red-400" : "text-emerald-400"}`}>
                      {r.error ? "✗" : "✓"}
                    </span>
                    <span className="text-sm font-mono text-white flex-1">{r.ticker}</span>
                    {!r.error && (
                      <span className="text-xs text-gray-500">
                        {r.shares} shares · {fmt(r.shares * r.price)}
                      </span>
                    )}
                    {r.error && <span className="text-xs text-red-400">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div className="flex flex-col items-center justify-center py-10 px-6 gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-900/40">
                <span className="text-red-400">✗</span>
              </div>
              <p className="text-sm text-red-300">{errorMsg}</p>
              <p className="text-xs text-gray-600 max-w-xs">
                Make sure the IBKR Client Portal Gateway is running at{" "}
                <span className="font-mono text-gray-500">localhost:5000</span> and you&apos;re authenticated.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-4 flex gap-3 justify-end">
          {step === "done" ? (
            <button
              onClick={() => { if (investRecord) onInvested(investRecord); onClose(); }}
              className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors"
            >
              Done
            </button>
          ) : step === "confirming" && preview ? (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <div className="flex-1 text-right">
                <p className="text-xs text-gray-600 mb-1">
                  Estimated total: <span className="text-white font-mono font-semibold">{fmt(preview.totalEstimated)}</span>
                  {preview.skipped > 0 && (
                    <span className="ml-2 text-yellow-500">{preview.skipped} skipped</span>
                  )}
                </p>
                <button
                  onClick={handleConfirm}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
                >
                  Confirm &amp; Place Orders
                </button>
              </div>
            </>
          ) : step === "error" ? (
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
