"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Company } from "@/types";

const AIChat = dynamic(() => import("./AIChat"), { ssr: false });

/**
 * App-wide chat launcher. Mounted once in the root layout so the conversation
 * (and its open/closed state) survives navigation between tabs. Loads BOTH the
 * US and ASX portfolios so the AI can answer about either market regardless of
 * which page you're on. The Dashboard's "AI Chat" button toggles this via a
 * `toggle-ai-chat` window event.
 */
export default function PersistentAIChat() {
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Let other components (e.g. the Dashboard toolbar button) toggle the chat.
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("toggle-ai-chat", toggle);
    return () => window.removeEventListener("toggle-ai-chat", toggle);
  }, []);

  // Lazily load both markets the first time the chat is opened.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;

    Promise.all([
      fetch("/api/companies?market=us").then((r) => r.json()).catch(() => []),
      fetch("/api/companies?market=au").then((r) => r.json()).catch(() => []),
    ]).then(([us, au]) => {
      if (cancelled) return;
      const combined = [
        ...(Array.isArray(us) ? (us as Company[]) : []),
        ...(Array.isArray(au) ? (au as Company[]) : []),
      ];
      // Dedupe by ticker in case a name appears in both feeds.
      const seen = new Set<string>();
      const deduped = combined.filter((c) => {
        const k = c.ticker?.toUpperCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setCompanies(deduped);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
      />

      {/* Left-side drawer — always mounted so the conversation persists */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-[22rem] max-w-[90vw] transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AIChat companies={companies} onClose={() => setOpen(false)} />
      </div>

      {/* Floating launcher (hidden while open) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Open AI Chat"
          className="fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-full border border-indigo-500/40 bg-gray-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl transition-colors hover:bg-gray-800"
        >
          <span className="text-indigo-400">✦</span> AI Chat
        </button>
      )}
    </>
  );
}
