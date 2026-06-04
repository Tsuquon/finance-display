"use client";

import { useState } from "react";
import TradingEngine from "./TradingEngine";

export default function PersistentTradingEngine() {
  const [open, setOpen]           = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  function close() {
    setFullscreen(false);
    setOpen(false);
  }

  return (
    <>
      {/* Backdrop (only in non-fullscreen mode) */}
      {!fullscreen && (
        <div
          className={`fixed inset-0 z-30 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
            open ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={close}
        />
      )}

      {/* Drawer — always mounted so the engine keeps running */}
      <div
        className={`fixed inset-x-0 z-40 border-t border-gray-800 bg-gray-950 shadow-2xl transition-all duration-300 ease-in-out overflow-y-auto ${
          open ? "translate-y-0" : "translate-y-full"
        } ${fullscreen ? "top-0 bottom-0" : "bottom-0"}`}
        style={!fullscreen ? { maxHeight: "80vh" } : undefined}
      >
        {/* Header bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-950 px-6 py-3">
          <div className="flex items-center gap-3">
            {/* Drag handle (non-fullscreen) */}
            {!fullscreen && (
              <div className="w-8 h-1 rounded-full bg-gray-700 cursor-pointer" onClick={close} />
            )}
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Trading Engine
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFullscreen((v) => !v)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:text-white transition-colors"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? "⊡" : "⊞"}
            </button>
            <button
              onClick={close}
              className="rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-6 pb-10">
          <TradingEngine open={open} />
        </div>
      </div>

      {/* Bottom-center tab */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-t-xl border border-b-0 px-5 py-2 text-xs font-semibold transition-colors shadow-lg ${
          open
            ? "border-gray-700 bg-gray-900 text-white"
            : "border-gray-700 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
        Trading Engine
        <span className="text-gray-600">{open ? "▼" : "▲"}</span>
      </button>
    </>
  );
}
