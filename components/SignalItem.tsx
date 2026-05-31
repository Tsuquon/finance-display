"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Signal, Company } from "@/types";
import { readStream } from "@/lib/streaming";

interface Props {
  signal: Signal;
  company: Company;
}

export default function SignalItem({ signal, company }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [enrichment, setEnrichment] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (enrichment) return;

    setLoading(true);
    setEnrichment("");
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, signal }),
      });
      if (!res.ok) throw new Error("Request failed");
      await readStream(res, (chunk) => setEnrichment((prev) => prev + chunk));
    } catch {
      setEnrichment("Unable to load enrichment.");
    } finally {
      setLoading(false);
    }
  }

  const dot =
    signal.type === "positive"
      ? "bg-emerald-400"
      : signal.type === "negative"
      ? "bg-red-400"
      : "bg-gray-500";

  const textColor =
    signal.type === "positive"
      ? "text-emerald-300"
      : signal.type === "negative"
      ? "text-red-300"
      : "text-gray-400";

  return (
    <div className="group">
      <button
        onClick={handleExpand}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className={`flex-1 text-xs ${textColor}`}>{signal.text}</span>
        <span className="text-xs text-gray-600 group-hover:text-gray-400">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="mx-2 mb-2 rounded-lg bg-gray-800/60 px-3 py-2 text-xs text-gray-300 leading-relaxed">
          {loading ? (
            <span className="animate-pulse text-gray-500">Analyzing signal…</span>
          ) : enrichment ? (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                strong: ({ children }) => <span className="font-semibold text-white">{children}</span>,
                em: ({ children }) => <span className="italic text-gray-400">{children}</span>,
                ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                li: ({ children }) => <li>{children}</li>,
              }}
            >
              {enrichment}
            </ReactMarkdown>
          ) : (
            <span className="text-gray-500">No data.</span>
          )}
        </div>
      )}
    </div>
  );
}
