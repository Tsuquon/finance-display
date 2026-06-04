"use client";

import { useState, useEffect } from "react";

type NewsItem = {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  thumbnail: string | null;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NewsSection({ ticker, name }: { ticker: string; name?: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = name ? `?name=${encodeURIComponent(name)}` : "";
    fetch(`/api/news/${ticker}${qs}`)
      .then((r) => r.json())
      .then((data) => { setNews(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker, name]);

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Recent News
      </h4>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Loading…
        </div>
      ) : news.length === 0 ? (
        <p className="text-xs text-gray-600">No recent news found.</p>
      ) : (
        <div className="space-y-3">
          {news.map((item) => (
            <a
              key={item.uuid}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-2.5 rounded-lg p-2 transition-colors hover:bg-gray-700/40"
            >
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-md object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-200 line-clamp-2 leading-snug">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {item.publisher} · {timeAgo(item.publishedAt)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
