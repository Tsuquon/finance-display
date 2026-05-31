"use client";

import { useState } from "react";
import type { Company } from "@/types";
import { cats } from "@/data/categories";

interface Props {
  company: Company;
  currentPrice: number;
}

export default function TradeWidget({ company, currentPrice }: Props) {
  const [activeTab, setActiveTab] = useState<"shares" | "options">("shares");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("100");
  const cat = cats[company.category];

  const total = (parseFloat(qty) || 0) * currentPrice;

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/60 p-4">
      <div className="mb-3 flex gap-1 rounded-lg bg-gray-900/60 p-1">
        {(["shares", "options"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
              activeTab === t ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-1 rounded-lg bg-gray-900/60 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
              side === s
                ? s === "buy"
                  ? "bg-emerald-600 text-white"
                  : "bg-red-600 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {activeTab === "shares" ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Shares</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-lg border border-gray-600 bg-gray-900/60 px-3 py-2 text-sm text-white focus:border-gray-400 focus:outline-none"
              min="1"
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Market Price</span>
            <span className="text-white font-mono">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Est. Total</span>
            <span className="font-mono font-bold text-white">${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
          <button
            className={`w-full rounded-lg py-2.5 text-sm font-bold text-white transition-colors ${
              side === "buy" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
            }`}
          >
            {side === "buy" ? "Buy" : "Sell"} {company.ticker}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {["Call $+5% exp 30d", "Put $−5% exp 30d", "Call $+10% exp 60d"].map((opt) => (
            <button
              key={opt}
              className={`w-full rounded-lg border py-2 text-xs text-left px-3 transition-colors ${cat.border} ${cat.bg} ${cat.text} hover:opacity-80`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
