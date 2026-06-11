"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import MentionTextarea from "./MentionTextarea";
import { loadNotes, saveNotes, extractTickers, type Note } from "@/lib/notes";

/**
 * The notes composer + list. Shared by the app-wide PersistentNotes drawer and
 * the Graph view's research sidebar so both read/write the same localStorage
 * store. Pass `contextSymbol` (e.g. the charted ticker) to auto-tag new notes
 * with "@SYMBOL" and offer a "this symbol only" filter.
 */

interface Props {
  contextSymbol?: string;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Compact "time ago" for the note timestamp.
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Render a note body with @TICKER mentions highlighted. Kept visually in sync
// with the token MentionTextarea inserts.
function NoteBody({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z][A-Za-z0-9.\-]*)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-300">
      {parts.map((part, i) =>
        /^@[A-Za-z]/.test(part) ? (
          <span key={i} className="font-mono font-semibold text-indigo-300">{part}</span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

export default function NotesPanel({ contextSymbol }: Props) {
  const sym = contextSymbol?.toUpperCase();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // When charting a symbol, default to showing just that symbol's notes.
  const [scopedToSymbol, setScopedToSymbol] = useState(true);
  const prevSym = useRef<string | undefined>(undefined);

  // Load persisted notes once, on mount.
  useEffect(() => {
    setNotes(loadNotes());
    setHydrated(true);
  }, []);

  // Persist on change (but not before the initial load, so we don't clobber
  // stored notes with the empty initial state). Re-read on the `notes-changed`
  // event so the drawer and the graph tab stay in sync when both are open.
  useEffect(() => {
    if (!hydrated) return;
    saveNotes(notes);
  }, [notes, hydrated]);

  useEffect(() => {
    const sync = () => setNotes(loadNotes());
    window.addEventListener("notes-changed", sync);
    return () => window.removeEventListener("notes-changed", sync);
  }, []);

  // Auto-seed a new note with "@SYMBOL " when charting a symbol, so notes are
  // tagged to the chart by default. Only touches an empty / untouched draft, and
  // swaps the tag when the symbol changes without clobbering real input.
  useEffect(() => {
    if (!sym || editingId) { prevSym.current = sym; return; }
    const tag = `@${sym} `;
    const prevTag = prevSym.current ? `@${prevSym.current} ` : "";
    setDraft((d) => (d === "" || d === prevTag ? tag : d));
    prevSym.current = sym;
  }, [sym, editingId]);

  function persist(next: Note[]) {
    setNotes(next);
    saveNotes(next);
    window.dispatchEvent(new Event("notes-changed"));
  }

  function commitDraft() {
    const text = draft.trim();
    if (!text) return;
    const tickers = extractTickers(text);
    if (editingId) {
      persist(notes.map((n) => (n.id === editingId ? { ...n, text, tickers, updatedAt: Date.now() } : n)));
      setEditingId(null);
      setDraft("");
    } else {
      const now = Date.now();
      const note: Note = { id: uid(), text, tickers, createdAt: now, updatedAt: now };
      persist([note, ...notes]);
      // Reset to a fresh tagged draft when charting a symbol, else empty.
      setDraft(sym ? `@${sym} ` : "");
    }
  }

  function startEdit(note: Note) {
    setEditingId(note.id);
    setDraft(note.text);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(sym ? `@${sym} ` : "");
  }

  function remove(id: string) {
    persist(notes.filter((n) => n.id !== id));
    if (editingId === id) cancelEdit();
  }

  const visible =
    sym && scopedToSymbol ? notes.filter((n) => n.tickers.includes(sym)) : notes;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Scope filter — only when charting a symbol */}
      {sym && (
        <div className="flex shrink-0 items-center gap-1.5 px-1 pb-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-gray-700">Show</span>
          <div className="flex items-center rounded-lg border border-gray-800/80 bg-gray-900/80 p-0.5 gap-px">
            <button
              onClick={() => setScopedToSymbol(true)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all ${
                scopedToSymbol ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:text-gray-300"
              }`}
            >
              @{sym}
            </button>
            <button
              onClick={() => setScopedToSymbol(false)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all ${
                !scopedToSymbol ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:text-gray-300"
              }`}
            >
              All
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          onSubmit={commitDraft}
          placeholder={editingId ? "Edit note…" : "Add a note… type @ to tag a stock"}
          rows={3}
          className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-gray-700">
            Enter to {editingId ? "save" : "add"} · Shift+Enter for newline
          </span>
          <div className="flex items-center gap-1.5">
            {editingId && (
              <button
                onClick={cancelEdit}
                className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
              >
                Cancel
              </button>
            )}
            <button
              onClick={commitDraft}
              disabled={!draft.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {editingId ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>

      {/* Notes list */}
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <span className="text-2xl text-gray-800">✎</span>
            <p className="text-xs text-gray-600">
              {sym && scopedToSymbol ? `No notes on @${sym} yet.` : "No notes yet."}
            </p>
            <p className="text-[11px] text-gray-700">
              Jot a thought above. Type <span className="font-mono text-indigo-400">@</span> to
              reference a stock.
            </p>
          </div>
        ) : (
          visible.map((note) => (
            <div
              key={note.id}
              className={`group rounded-xl border bg-gray-900/50 p-3 transition-colors ${
                editingId === note.id ? "border-indigo-500/50" : "border-gray-800/80 hover:border-gray-700"
              }`}
            >
              <NoteBody text={note.text} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-gray-600">{timeAgo(note.updatedAt)}</span>
                <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => startEdit(note)} className="text-[11px] text-gray-500 hover:text-indigo-300">edit</button>
                  <button onClick={() => remove(note.id)} className="text-[11px] text-gray-500 hover:text-red-400">✕</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
