"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  loadTimedTrades,
  persistTimedTrades,
  type TimedTrade,
} from "@/lib/timedTrades";
import TimedTradeModal from "./TimedTradeModal";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<TimedTrade["status"], { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-gray-800 text-gray-400" },
  buying:   { label: "Buying…",  cls: "bg-indigo-900/50 text-indigo-300 animate-pulse" },
  bought:   { label: "Bought",   cls: "bg-emerald-900/40 text-emerald-400" },
  selling:  { label: "Selling…", cls: "bg-orange-900/40 text-orange-300 animate-pulse" },
  sold:     { label: "Sold",     cls: "bg-sky-900/40 text-sky-300" },
  failed:   { label: "Failed",   cls: "bg-red-900/40 text-red-400" },
};

// ── Trade card ────────────────────────────────────────────────────────────────

function TradeCard({
  trade,
  now,
  onDelete,
}: {
  trade: TimedTrade;
  now: number;
  onDelete: () => void;
}) {
  const badge = STATUS_STYLE[trade.status];
  const pnl =
    trade.buyPrice != null && trade.sellPrice != null && trade.shares != null
      ? (trade.sellPrice - trade.buyPrice) * trade.shares
      : null;
  const pnlPct =
    trade.buyPrice && trade.sellPrice
      ? ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * 100
      : null;

  return (
    <div className="group rounded-2xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3 hover:border-gray-700 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white font-mono">{trade.ticker}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          {trade.name !== trade.ticker && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{trade.name}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-mono font-semibold text-gray-300">
            {fmt(trade.dollarAmount)}
          </span>
          {(trade.status === "sold" || trade.status === "failed") && (
            <button
              onClick={onDelete}
              title="Remove"
              className="text-gray-700 hover:text-red-400 transition-colors text-xs opacity-0 group-hover:opacity-100"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="grid grid-cols-2 gap-2">
        {/* Buy */}
        <div className={`rounded-xl px-3 py-2 ${
          trade.status === "bought" || trade.status === "selling" || trade.status === "sold"
            ? "bg-emerald-950/40 border border-emerald-900/40"
            : "bg-gray-800/50 border border-gray-800"
        }`}>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">Buy</p>
          {trade.buyPrice != null ? (
            <>
              <p className="text-xs font-mono text-emerald-400 font-semibold">{fmt(trade.buyPrice)}</p>
              <p className="text-[10px] text-gray-600">{fmtDate(trade.buyAt)}</p>
            </>
          ) : (
            <>
              <p className="text-xs font-mono text-white">{fmtDate(trade.buyAt)}</p>
              {trade.status === "pending" && trade.buyAt > now && (
                <p className="text-[10px] text-indigo-400">in {countdown(trade.buyAt, now)}</p>
              )}
              {trade.status === "buying" && (
                <p className="text-[10px] text-indigo-300 animate-pulse">Executing…</p>
              )}
            </>
          )}
        </div>

        {/* Sell */}
        <div className={`rounded-xl px-3 py-2 ${
          trade.status === "sold"
            ? "bg-sky-950/40 border border-sky-900/40"
            : "bg-gray-800/50 border border-gray-800"
        }`}>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">Sell</p>
          {trade.sellPrice != null ? (
            <>
              <p className="text-xs font-mono text-sky-400 font-semibold">{fmt(trade.sellPrice)}</p>
              <p className="text-[10px] text-gray-600">{fmtDate(trade.sellAt)}</p>
            </>
          ) : (
            <>
              <p className="text-xs font-mono text-white">{fmtDate(trade.sellAt)}</p>
              {(trade.status === "bought" || trade.status === "pending") && trade.sellAt > now && (
                <p className="text-[10px] text-sky-400">in {countdown(trade.sellAt, now)}</p>
              )}
              {trade.status === "selling" && (
                <p className="text-[10px] text-sky-300 animate-pulse">Executing…</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* P&L row (after sold) */}
      {pnl != null && pnlPct != null && (
        <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${
          pnl >= 0 ? "bg-emerald-950/30 border border-emerald-900/30" : "bg-red-950/30 border border-red-900/30"
        }`}>
          <span className="text-xs text-gray-500">P&amp;L</span>
          <span className={`text-sm font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : ""}{fmt(pnl)}{" "}
            <span className="text-xs font-normal">
              ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
            </span>
          </span>
        </div>
      )}

      {/* Error */}
      {trade.status === "failed" && trade.error && (
        <p className="text-xs text-red-400 px-1">{trade.error}</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TimedTrades() {
  const [trades, setTrades]     = useState<TimedTrade[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [now, setNow]           = useState(Date.now());

  const tradesRef = useRef<TimedTrade[]>([]);
  tradesRef.current = trades;

  useEffect(() => {
    setTrades(loadTimedTrades());
  }, []);

  // Tick every second for countdown display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const updateTrade = useCallback((id: string, patch: Partial<TimedTrade>) => {
    setTrades((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      persistTimedTrades(updated);
      return updated;
    });
  }, []);

  const updateRef = useRef(updateTrade);
  updateRef.current = updateTrade;

  // ── Auto-executor ──────────────────────────────────────────────────────────
  useEffect(() => {
    const inFlight = new Set<string>();

    async function executeBuy(trade: TimedTrade) {
      updateRef.current(trade.id, { status: "buying" });
      try {
        const previewRes = await fetch("/api/ibkr/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocations: [{ ticker: trade.ticker, name: trade.name, dollar: trade.dollarAmount }],
          }),
        });
        const preview = await previewRes.json();
        if (preview.error) throw new Error(preview.error);

        const order = preview.orders?.[0];
        if (!order || order.error) throw new Error(order?.error ?? "Preview returned no order");
        if (!order.shares || order.shares <= 0) throw new Error("Allocation too small for 1 share");

        const execRes = await fetch("/api/ibkr/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: preview.accountId, orders: [order] }),
        });
        const exec = await execRes.json();
        if (exec.error) throw new Error(exec.error);

        const result = exec.results?.[0];
        if (!result || result.error) throw new Error(result?.error ?? "Order not placed");

        updateRef.current(trade.id, {
          status:   "bought",
          accountId: preview.accountId,
          conid:    order.conid,
          shares:   result.shares,
          buyPrice: result.price,
          buyOrderId: result.orderId,
        });
      } catch (err) {
        updateRef.current(trade.id, { status: "failed", error: String(err) });
      }
    }

    async function executeSell(trade: TimedTrade) {
      updateRef.current(trade.id, { status: "selling" });
      try {
        const res = await fetch("/api/ibkr/sell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: trade.accountId,
            conid:     trade.conid,
            shares:    trade.shares,
            ticker:    trade.ticker,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        updateRef.current(trade.id, {
          status:      "sold",
          sellPrice:   data.price ?? undefined,
          sellOrderId: data.orderId ?? undefined,
        });
      } catch (err) {
        updateRef.current(trade.id, { status: "failed", error: String(err) });
      }
    }

    function check() {
      const ts = Date.now();
      for (const trade of tradesRef.current) {
        if (inFlight.has(trade.id)) continue;
        if (trade.status === "pending" && trade.buyAt <= ts) {
          inFlight.add(trade.id);
          executeBuy(trade).finally(() => inFlight.delete(trade.id));
        } else if (trade.status === "bought" && trade.sellAt <= ts) {
          inFlight.add(trade.id);
          executeSell(trade).finally(() => inFlight.delete(trade.id));
        }
      }
    }

    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations ──────────────────────────────────────────────────────────────

  function addTrade(partial: Omit<TimedTrade, "id" | "status" | "createdAt">) {
    const trade: TimedTrade = {
      ...partial,
      id:        crypto.randomUUID(),
      status:    "pending",
      createdAt: Date.now(),
    };
    setTrades((prev) => {
      const updated = [...prev, trade];
      persistTimedTrades(updated);
      return updated;
    });
  }

  function deleteTrade(id: string) {
    setTrades((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      persistTimedTrades(updated);
      return updated;
    });
  }

  const sorted = [...trades].sort((a, b) => a.buyAt - b.buyAt);
  const active = sorted.filter((t) => t.status !== "sold" && t.status !== "failed");
  const history = sorted.filter((t) => t.status === "sold" || t.status === "failed");

  return (
    <section className="space-y-4">
      {/* Section header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Quant Trades</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Schedule timed buy &amp; sell orders for single stocks
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-indigo-500 hover:text-white transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Trade
        </button>
      </div>

      {/* Active trades */}
      {active.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((t) => (
            <TradeCard
              key={t.id}
              trade={t}
              now={now}
              onDelete={() => deleteTrade(t.id)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {trades.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-800 px-6 py-10 text-center">
          <p className="text-sm text-gray-600 mb-1">No timed trades scheduled</p>
          <p className="text-xs text-gray-700">
            Set a buy and sell time — the app will automatically execute both orders.
          </p>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-gray-600">History</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {history.map((t) => (
              <TradeCard
                key={t.id}
                trade={t}
                now={now}
                onDelete={() => deleteTrade(t.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <TimedTradeModal
          onSave={addTrade}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}
