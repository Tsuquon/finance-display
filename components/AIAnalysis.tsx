"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Company } from "@/types";
import { readStream } from "@/lib/streaming";

interface Props {
  company: Company;
}

export default function AIAnalysis({ company }: Props) {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    setDone(false);
    setAnalysis("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      if (!res.ok) throw new Error("Request failed");
      await readStream(res, (chunk) => setAnalysis((prev) => prev + chunk));
      setDone(true);
    } catch {
      setAnalysis("Unable to load analysis. Check ANTHROPIC_API_KEY.");
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">AI Analysis</h4>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Analyzing…" : done ? "Refresh" : "Analyze"}
        </button>
      </div>

      {analysis ? (
        <div className="text-xs text-gray-300 leading-relaxed">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
              strong: ({ children }) => <span className="font-semibold text-white">{children}</span>,
              em: ({ children }) => <span className="italic text-gray-400">{children}</span>,
              ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
            }}
          >
            {analysis}
          </ReactMarkdown>
          {loading && <span className="inline-block w-1 h-3 bg-indigo-400 ml-0.5 animate-pulse" />}
        </div>
      ) : (
        <p className="text-xs text-gray-600 italic">
          Click Analyze to get AI-powered equity research on {company.name}.
        </p>
      )}
    </div>
  );
}
