"use client";

import { useEffect, useRef, useState } from "react";

const POLL_MS = 30 * 60 * 1000; // every 30 minutes while the app is open

interface Triggered {
  alert: { id: number; ticker: string; description: string };
  current: string;
}

/**
 * Invisible background poller. While the app is open it periodically asks the
 * server to evaluate active alerts; the server emails any that fire. We also
 * surface a brief in-app toast so the user sees it happen live.
 */
export default function AlertsPoller() {
  const [toasts, setToasts] = useState<Triggered[]>([]);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (running.current) return;
      running.current = true;
      try {
        const res = await fetch("/api/alerts/evaluate", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.triggered) && data.triggered.length > 0) {
          setToasts((prev) => [...prev, ...data.triggered]);
        }
      } catch {
        /* offline / transient — try again next tick */
      } finally {
        running.current = false;
      }
    }

    evaluate();
    const id = setInterval(evaluate, POLL_MS);
    // Re-check promptly whenever the tab regains focus.
    const onFocus = () => evaluate();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.alert.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.alert.id}
          className="flex items-start gap-3 rounded-xl border border-emerald-700/50 bg-gray-900 px-4 py-3 shadow-xl max-w-xs"
        >
          <span className="text-lg leading-none">🔔</span>
          <div className="flex-1">
            <p className="text-xs font-bold text-white">{t.alert.ticker} alert</p>
            <p className="text-xs text-gray-400">{t.alert.description}</p>
            <p className="mt-0.5 text-xs text-emerald-400">Now: {t.current} · emailed you</p>
          </div>
          <button
            onClick={() => dismiss(t.alert.id)}
            className="text-gray-600 hover:text-white text-xs"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
