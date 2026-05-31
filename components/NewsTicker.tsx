"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { FeaturedNewsItem } from "@/app/api/news/featured/route";
import type { ImpactResult } from "@/app/api/news/impact/route";
import type { Company } from "@/types";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const EFFECT_STYLE = {
  positive: { dot: "bg-emerald-400", text: "text-emerald-400", badge: "bg-emerald-900/40 text-emerald-400" },
  negative: { dot: "bg-red-400",     text: "text-red-400",     badge: "bg-red-900/40 text-red-400"         },
  neutral:  { dot: "bg-gray-500",    text: "text-gray-400",    badge: "bg-gray-800 text-gray-400"           },
};

type HoveredItem = FeaturedNewsItem & { x: number };

export default function NewsTicker({ companies }: { companies: Company[] }) {
  const [items, setItems] = useState<FeaturedNewsItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState<HoveredItem | null>(null);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const impactCache = useRef<Map<string, ImpactResult>>(new Map());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/news/featured")
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {});
  }, []);

  const fetchImpact = useCallback(async (item: FeaturedNewsItem) => {
    if (!companies.length) return;
    const cached = impactCache.current.get(item.uuid);
    if (cached) { setImpact(cached); return; }
    setImpactLoading(true);
    setImpact(null);
    try {
      const res = await fetch("/api/news/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: item.uuid, title: item.title, publisher: item.publisher, companies }),
      });
      const data: ImpactResult = await res.json();
      impactCache.current.set(item.uuid, data);
      setImpact(data);
    } catch { /* silent */ }
    finally { setImpactLoading(false); }
  }, [companies]);

  function handleMouseEnter(item: FeaturedNewsItem, e: React.MouseEvent) {
    setPaused(true);
    const x = Math.min(e.clientX, window.innerWidth - 420);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setHovered({ ...item, x });
      fetchImpact(item);
    }, 300);
  }

  function handleMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setPaused(false);
    setHovered(null);
    setImpact(null);
  }

  if (items.length === 0) return (
    <div className="flex shrink-0 items-center border-t border-gray-800 bg-gray-900/80 px-6 py-1.5">
      <span className="shrink-0 rounded bg-indigo-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white mr-4">News</span>
      <span className="text-xs text-gray-600">Loading headlines…</span>
    </div>
  );

  const doubled = [...items, ...items];
  const duration = `${items.length * 4}s`;

  return (
    <>
      <div
        className="flex shrink-0 items-center border-t border-gray-800 bg-gray-900/80 overflow-hidden"
        onMouseLeave={handleMouseLeave}
      >
        <div className="shrink-0 z-10 flex items-center bg-gray-900 pl-6 pr-4 py-1.5 border-r border-gray-800/60">
          <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
            News
          </span>
        </div>

        <div className="flex-1 overflow-hidden py-1.5">
          <div
            className="flex w-max"
            style={{
              animation: `ticker ${duration} linear infinite`,
              animationPlayState: paused ? "paused" : "running",
            }}
          >
            {doubled.map((item, i) => (
              <a
                key={`${item.uuid}-${i}`}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-6 text-xs text-gray-400 hover:text-white transition-colors whitespace-nowrap group cursor-pointer"
                onMouseEnter={(e) => handleMouseEnter(item, e)}
              >
                <span className="text-gray-600 group-hover:text-indigo-400 transition-colors">{item.publisher}</span>
                <span className="text-gray-700">·</span>
                <span>{item.title}</span>
                <span className="text-gray-700 text-xs ml-1">({timeAgo(item.publishedAt)})</span>
                <span className="mx-4 text-gray-700">|</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Hover popover */}
      {hovered && (
        <div
          className="fixed bottom-[40px] z-50 w-[400px] rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
          style={{ left: hovered.x }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={handleMouseLeave}
        >
          {/* Article header */}
          <div className="border-b border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-indigo-400 font-semibold">{hovered.publisher}</span>
              <span className="text-gray-700 text-xs">·</span>
              <span className="text-xs text-gray-600">{timeAgo(hovered.publishedAt)} ago</span>
            </div>
            <a
              href={hovered.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors leading-snug line-clamp-3"
            >
              {hovered.title} ↗
            </a>
          </div>

          {/* AI impact */}
          <div className="p-4">
            {impactLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-indigo-400" />
                Analysing market impact…
              </div>
            ) : impact ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 leading-relaxed">{impact.summary}</p>
                {impact.impacts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">Portfolio Impact</p>
                    {impact.impacts.map((imp) => {
                      const s = EFFECT_STYLE[imp.effect];
                      return (
                        <div key={imp.ticker} className="flex items-start gap-2">
                          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
                          <div className="min-w-0">
                            <span className={`text-xs font-mono font-bold ${s.text}`}>{imp.ticker}</span>
                            <span className="text-xs text-gray-500 ml-1.5">{imp.reason}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {impact.impacts.length === 0 && (
                  <p className="text-xs text-gray-600 italic">No direct portfolio impact identified.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
