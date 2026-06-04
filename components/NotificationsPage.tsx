"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Alert {
  id: number;
  ticker: string;
  kind: "price" | "score" | "technical" | "news" | "ai";
  field: string;
  operator: "above" | "below" | null;
  value: number | null;
  description: string;
  status: "active" | "triggered" | "disabled";
  company_name: string | null;
  created_at: string;
  triggered_at: string | null;
  last_checked_at: string | null;
}

const KIND_LABEL: Record<Alert["kind"], string> = {
  price: "Price",
  score: "AI Score",
  technical: "Technical",
  news: "News",
  ai: "Smart (AI)",
};

const STATUS_STYLE: Record<Alert["status"], string> = {
  active: "border-emerald-700/50 bg-emerald-900/20 text-emerald-400",
  triggered: "border-indigo-700/50 bg-indigo-900/20 text-indigo-300",
  disabled: "border-gray-700 bg-gray-800/40 text-gray-500",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function remove(id: number) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/alerts?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function sendTest() {
    setTesting(true);
    setNote(null);
    try {
      const res = await fetch("/api/alerts/test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const channels = Array.isArray(data.delivered) && data.delivered.length > 0
          ? data.delivered.join(" + ")
          : "your configured channels";
        const partial = Array.isArray(data.errors) && data.errors.length > 0
          ? ` (but ${data.errors.join("; ")})`
          : "";
        setNote(`Test notification sent via ${channels}.${partial}`);
      } else {
        const why = Array.isArray(data.errors) && data.errors.length > 0
          ? data.errors.join("; ")
          : data.error ?? "unknown error";
        setNote(`Couldn't send test: ${why}`);
      }
    } catch {
      setNote("Couldn't send the test notification.");
    } finally {
      setTesting(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    setNote(null);
    try {
      const res = await fetch("/api/alerts/evaluate", { method: "POST" });
      const data = await res.json();
      const n = Array.isArray(data.triggered) ? data.triggered.length : 0;
      if (n === 0) {
        setNote("Checked. Nothing triggered.");
      } else {
        // A channel delivered if it reported no error (evaluate sets pushError/
        // emailError when a channel is unconfigured or its send failed).
        const delivered: string[] = [];
        if (!data.pushError) delivered.push("Telegram");
        if (!data.emailError) delivered.push("email");
        const plural = `${n} alert${n > 1 ? "s" : ""}`;
        if (delivered.length > 0) {
          setNote(`${plural} just fired — notified via ${delivered.join(" + ")}.`);
        } else {
          const why = [data.pushError, data.emailError].filter(Boolean).join("; ");
          setNote(`${plural} fired, but no notification went out: ${why}`);
        }
      }
      await load();
    } catch {
      setNote("Could not run the check.");
    } finally {
      setChecking(false);
    }
  }

  const active = alerts.filter((a) => a.status === "active");
  const triggered = alerts.filter((a) => a.status === "triggered");
  const other = alerts.filter((a) => a.status === "disabled");

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-xs text-gray-500 hover:text-white transition-colors shrink-0">
          ← Back
        </Link>
        <span className="text-sm font-bold tracking-[0.12em] uppercase" style={{ color: "#F4EFE6" }}>
          Notifications
        </span>
        <div className="flex-1" />
        <button
          onClick={sendTest}
          disabled={testing}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
        >
          {testing ? "Sending…" : "Send test"}
        </button>
        <button
          onClick={checkNow}
          disabled={checking}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Your alerts</h1>
              <p className="mt-1 text-xs text-gray-500">
                Set these up by asking the AI chat — e.g. “email me when NVDA drops below $100”.
              </p>
            </div>
            <span className="text-xs text-gray-600">{alerts.length} total</span>
          </div>

          {note && (
            <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-xs text-gray-300">
              {note}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-600">Loading…</p>
          ) : alerts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-800 px-6 py-12 text-center">
              <p className="text-sm text-gray-400">No alerts yet.</p>
              <p className="mt-1 text-xs text-gray-600">
                Open the AI chat and describe what you want to be notified about.
              </p>
            </div>
          ) : (
            <>
              <Section title="Active" count={active.length} alerts={active} onRemove={remove} />
              <Section title="Triggered" count={triggered.length} alerts={triggered} onRemove={remove} />
              {other.length > 0 && (
                <Section title="Disabled" count={other.length} alerts={other} onRemove={remove} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Section({
  title,
  count,
  alerts,
  onRemove,
}: {
  title: string;
  count: number;
  alerts: Alert[];
  onRemove: (id: number) => void;
}) {
  if (count === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title} <span className="text-gray-700">· {count}</span>
      </h2>
      <div className="space-y-2">
        {alerts.map((a) => (
          <div
            key={a.id}
            className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-3"
          >
            <span className="mt-0.5 rounded-md bg-gray-800 px-2 py-0.5 text-xs font-bold text-gray-200">
              {a.ticker}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white">{a.description}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span className="rounded border border-gray-700 px-1.5 py-px text-gray-400">
                  {KIND_LABEL[a.kind]}
                </span>
                <span>Set {fmtTime(a.created_at)}</span>
                {a.status === "triggered" && <span>Fired {fmtTime(a.triggered_at)}</span>}
                {a.status === "active" && a.last_checked_at && (
                  <span>Checked {fmtTime(a.last_checked_at)}</span>
                )}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_STYLE[a.status]}`}
            >
              {a.status}
            </span>
            <button
              onClick={() => onRemove(a.id)}
              title="Delete alert"
              className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
