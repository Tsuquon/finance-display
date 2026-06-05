"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Company } from "@/types";
import {
  loadCustomCompanies,
  loadActiveUniverse,
  CUSTOM_COMPANIES_KEY,
  CUSTOM_COMPANIES_KEY_AU,
} from "@/lib/portfolios";

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

  // Pull both market feeds AND the user's locally-added custom tickers, then
  // dedupe by ticker. Custom companies live only in localStorage (the screener
  // feed never contains them), so without merging them the AI reports a stock
  // the user just added "isn't in this portfolio". Runs on each open and on
  // every portfolio-changed event so the list is always current.
  const loadCompanies = useCallback(async () => {
    const [us, au] = await Promise.all([
      fetch("/api/companies?market=us").then((r) => r.json()).catch(() => []),
      fetch("/api/companies?market=au").then((r) => r.json()).catch(() => []),
    ]);
    const custom = [
      ...loadCustomCompanies(CUSTOM_COMPANIES_KEY),
      ...loadCustomCompanies(CUSTOM_COMPANIES_KEY_AU),
    ];
    // The Dashboard's currently-displayed list wins first: the US feed is a live
    // rotating screener, so a stock the user is looking at right now may be absent
    // from our own us/au fetch below. Merging the published universe in guarantees
    // the chat never claims a visible stock "isn't in this portfolio". Custom
    // tickers come next so a user-added entry beats a feed duplicate; the live
    // both-market fetch fills in anything the (single-market) snapshot lacks.
    const combined = [
      ...loadActiveUniverse(),
      ...custom,
      ...(Array.isArray(us) ? (us as Company[]) : []),
      ...(Array.isArray(au) ? (au as Company[]) : []),
    ];
    const seen = new Set<string>();
    const deduped = combined.filter((c) => {
      const k = c.ticker?.toUpperCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    setCompanies(deduped);
  }, []);

  // Let other components (e.g. the Dashboard toolbar button) toggle the chat.
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("toggle-ai-chat", toggle);
    return () => window.removeEventListener("toggle-ai-chat", toggle);
  }, []);

  // Refresh the portfolio when a company is added/removed elsewhere, even while
  // the chat is open.
  useEffect(() => {
    window.addEventListener("portfolio-changed", loadCompanies);
    return () => window.removeEventListener("portfolio-changed", loadCompanies);
  }, [loadCompanies]);

  // Reload both markets each time the chat is opened so the list is current.
  useEffect(() => {
    if (!open) return;
    loadCompanies();
  }, [open, loadCompanies]);

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
