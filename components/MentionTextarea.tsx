"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadActiveUniverse,
  loadCustomCompanies,
  CUSTOM_COMPANIES_KEY,
  CUSTOM_COMPANIES_KEY_AU,
} from "@/lib/portfolios";

interface Suggestion {
  symbol: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  // Fired on Enter (without Shift) while the @-mention dropdown is closed, so a
  // parent can treat Enter as "save". Shift+Enter always inserts a newline.
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}

// The active "@token" being typed: the run of symbol characters immediately
// before the caret that follows an "@". Returns null when the caret isn't inside
// a mention (e.g. after a space, or no "@").
function activeMention(text: string, caret: number): { query: string; start: number } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      // "@" must be at start of text or preceded by whitespace to count.
      if (i === 0 || /\s/.test(text[i - 1])) {
        return { query: text.slice(i + 1, caret), start: i };
      }
      return null;
    }
    if (/[A-Za-z0-9.\-]/.test(ch)) { i--; continue; }
    return null; // hit whitespace / punctuation before an "@"
  }
  return null;
}

/**
 * A textarea with "@" stock-mention autocomplete. Suggestions come instantly from
 * the locally-known universe (Dashboard's published list + custom tickers) and are
 * topped up by a debounced Yahoo search so ANY ticker can be referenced, not just
 * loaded ones. Selecting one inserts an "@SYMBOL " token.
 */
export default function MentionTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 3,
  autoFocus,
  className = "",
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number; caret: number } | null>(null);
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // The instantly-available local universe ({symbol,name}), deduped by symbol.
  // Loaded once — anything missing here (including a just-added ticker) still
  // resolves through the debounced Yahoo search below, so it never goes stale.
  const local = useMemo<Suggestion[]>(() => {
    const pool = [
      ...loadActiveUniverse(),
      ...loadCustomCompanies(CUSTOM_COMPANIES_KEY),
      ...loadCustomCompanies(CUSTOM_COMPANIES_KEY_AU),
    ];
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const c of pool) {
      const s = c.ticker?.toUpperCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push({ symbol: s, name: c.name ?? s });
    }
    return out;
  }, []);

  // Debounced Yahoo search for the active query so unloaded tickers resolve too.
  useEffect(() => {
    if (!mention || mention.query.length < 1) { setRemote([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies/search?q=${encodeURIComponent(mention.query)}`);
        const data = await res.json();
        setRemote(Array.isArray(data) ? data : []);
      } catch {
        /* ignore — local matches still show */
      }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [mention?.query, mention]);

  // Merge local + remote, local first, deduped, filtered by the query, capped.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!mention) return [];
    const q = mention.query.toUpperCase();
    const matchLocal = local.filter(
      (s) => s.symbol.includes(q) || s.name.toUpperCase().includes(q),
    );
    const seen = new Set(matchLocal.map((s) => s.symbol));
    const merged = [...matchLocal];
    for (const r of remote) {
      const sym = r.symbol?.toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      merged.push({ symbol: sym, name: r.name ?? sym });
    }
    return merged.slice(0, 6);
  }, [local, remote, mention]);

  useEffect(() => { setActiveIdx(0); }, [mention?.query]);

  const syncMention = useCallback((text: string, caret: number) => {
    const m = activeMention(text, caret);
    setMention(m ? { ...m, caret } : null);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text);
    syncMention(text, e.target.selectionStart ?? text.length);
  }

  function insert(sym: string) {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.caret);
    const token = `@${sym} `;
    const next = before + token + after;
    onChange(next);
    setMention(null);
    setRemote([]);
    // Restore the caret just after the inserted token.
    const pos = before.length + token.length;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(suggestions[activeIdx].symbol); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setMention(null), 120)}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={className}
      />

      {mention && suggestions.length > 0 && (
        <ul className="absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/98 shadow-2xl backdrop-blur">
          {suggestions.map((s, i) => (
            <li
              key={s.symbol}
              onMouseDown={(e) => { e.preventDefault(); insert(s.symbol); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 transition-colors ${
                i === activeIdx ? "bg-indigo-950/70" : "hover:bg-gray-800/60"
              }`}
            >
              <span className="shrink-0 font-mono text-xs text-indigo-300">{s.symbol}</span>
              <span className="truncate text-right text-[11px] text-gray-500">{s.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
