"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, Company } from "@/types";
import { readStream } from "@/lib/streaming";

interface Props {
  companies: Company[];
  onClose: () => void;
}

export default function AIChat({ companies, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, companies }),
      });
      if (!res.ok) throw new Error("Request failed");
      await readStream(res, (chunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: "Error: unable to reach AI. Check ANTHROPIC_API_KEY." };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col bg-gray-950 border-r border-gray-700/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700/50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-white">Portfolio AI</h3>
          <p className="text-xs text-gray-500">Ask about any company</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-600 mb-4">Try asking:</p>
            {[
              "Compare NVDA and INTC in AI chips",
              "Which fading stocks have near-term catalysts?",
              "What are the macro risks in this portfolio?",
            ].map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="block w-full rounded-lg border border-gray-700/50 bg-gray-800/40 px-3 py-2 text-left text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-300"
              }`}
            >
              {msg.content ? (
                msg.role === "assistant" ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <p className="font-bold text-white mt-2 mb-1">{children}</p>,
                      h2: ({ children }) => <p className="font-bold text-white mt-2 mb-1">{children}</p>,
                      h3: ({ children }) => <p className="font-semibold text-gray-200 mt-1.5 mb-0.5">{children}</p>,
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      strong: ({ children }) => <span className="font-semibold text-white">{children}</span>,
                      em: ({ children }) => <span className="italic text-gray-400">{children}</span>,
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
                      li: ({ children }) => <li className="text-gray-300">{children}</li>,
                      hr: () => <hr className="border-gray-600 my-2" />,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-indigo-400 pl-2 text-gray-400 my-1">{children}</blockquote>,
                      code: ({ children }) => <code className="bg-gray-700 rounded px-1 font-mono">{children}</code>,
                      table: ({ children }) => <div className="overflow-x-auto my-2"><table className="w-full border-collapse text-xs">{children}</table></div>,
                      thead: ({ children }) => <thead className="border-b border-gray-600">{children}</thead>,
                      th: ({ children }) => <th className="text-left py-1 pr-3 text-gray-400 font-semibold">{children}</th>,
                      td: ({ children }) => <td className="py-1 pr-3 text-gray-300 border-b border-gray-700/50">{children}</td>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  msg.content
                )
              ) : (streaming && i === messages.length - 1 ? (
                <span className="animate-pulse text-gray-500">Thinking…</span>
              ) : null)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-700/50 p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about the portfolio…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ↑
          </button>
        </div>
        <p className="mt-1.5 text-center text-xs text-gray-700">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
