"use client";

import { useEffect, useState } from "react";
import type { Company, Signal } from "@/types";
import SignalItem from "./SignalItem";
import AIAnalysis from "./AIAnalysis";
import NewsSection from "./NewsSection";
import InvestScore from "./InvestScore";
import TrendAnalysis from "./TrendAnalysis";
import CompositeScore from "./CompositeScore";
import QuantScore from "./QuantScore";
import AnalystRatings from "./AnalystRatings";
import Financials from "./Financials";

interface Props {
  company: Company;
}

// The full research stack for a company: thesis, scores, trend, AI analysis,
// market signals and news. Extracted from StockPanel so the Market panel and the
// Graph View sidebar render identical research from a single source of truth.
export default function CompanyResearch({ company }: Props) {
  const [sourcedSignals, setSourcedSignals] = useState<Signal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);

  useEffect(() => {
    setSignalsLoading(true);
    setSourcedSignals([]);
    fetch(`/api/signals/sourced/${company.ticker}`)
      .then((r) => r.json())
      .then((data: Signal[]) => {
        setSourcedSignals(data.length > 0 ? data : company.signals);
        setSignalsLoading(false);
      })
      .catch(() => {
        setSourcedSignals(company.signals);
        setSignalsLoading(false);
      });
  }, [company.ticker, company.signals]);

  return (
    <div className="space-y-4">
      {/* Thesis */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Investment Thesis</h4>
        <p className="text-sm text-gray-300 leading-relaxed">{company.reason}</p>
      </div>

      {/* Composite Score */}
      <CompositeScore company={company} />

      {/* Quant Score */}
      <QuantScore company={company} />

      {/* Trend Analysis */}
      <TrendAnalysis ticker={company.ticker} />

      {/* Investment Score */}
      <InvestScore company={company} />

      {/* Analyst Ratings & Forecast */}
      <AnalystRatings ticker={company.ticker} />

      {/* Financials */}
      <Financials ticker={company.ticker} />

      {/* AI Analysis */}
      <AIAnalysis company={company} />

      {/* Signals */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Market Signals</h4>
        {signalsLoading ? (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
            Loading signals…
          </div>
        ) : (
          <div className="space-y-1">
            {sourcedSignals.map((signal, i) => (
              <SignalItem key={i} signal={signal} company={company} />
            ))}
          </div>
        )}
      </div>

      {/* News */}
      <NewsSection ticker={company.ticker} name={company.name} />
    </div>
  );
}
