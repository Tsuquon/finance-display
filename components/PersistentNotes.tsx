"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import NotesPanel from "./NotesPanel";
import { loadNotes } from "@/lib/notes";

/**
 * App-wide notes scratchpad. Mounted once in the root layout (next to
 * PersistentAIChat) so it's reachable from every page and its drawer state
 * survives navigation. The Graph view has its own Notes tab in the research
 * sidebar (sharing the same localStorage store), so the floating launcher is
 * hidden there to avoid overlapping it. Anything can open the drawer by
 * dispatching a `toggle-notes` event.
 */
export default function PersistentNotes() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  // Keep the launcher badge in sync with the stored note count (updated by the
  // panel via the `notes-changed` event, and on open).
  useEffect(() => {
    const sync = () => setCount(loadNotes().length);
    sync();
    window.addEventListener("notes-changed", sync);
    return () => window.removeEventListener("notes-changed", sync);
  }, []);
  useEffect(() => { if (open) setCount(loadNotes().length); }, [open]);

  // Let other components (e.g. a header button) toggle the panel.
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("toggle-notes", toggle);
    return () => window.removeEventListener("toggle-notes", toggle);
  }, []);

  // The Graph view surfaces notes as a sidebar tab, so don't double up there.
  if (pathname === "/graph") return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
      />

      {/* Right-side drawer — always mounted so its state persists while closed */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-[22rem] max-w-[90vw] flex-col border-l border-gray-700/50 bg-gray-950 transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-700/50 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-white">Notes</h3>
            <p className="text-xs text-gray-500">Jot points · type @ to tag a stock</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 p-3">
          <NotesPanel />
        </div>
      </div>

      {/* Floating launcher (hidden while open) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Open Notes"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-amber-500/40 bg-gray-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl transition-colors hover:bg-gray-800"
        >
          <span className="text-amber-400">✎</span> Notes
          {count > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300 tabular-nums">
              {count}
            </span>
          )}
        </button>
      )}
    </>
  );
}
