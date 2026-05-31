import type { CategoryConfig } from "@/types";

export const cats: Record<string, CategoryConfig> = {
  future: {
    label: "Future",
    color: "#818cf8",
    bg: "bg-indigo-950/50",
    border: "border-indigo-500/30",
    text: "text-indigo-300",
    accent: "text-indigo-400",
  },
  stable: {
    label: "Stable",
    color: "#34d399",
    bg: "bg-emerald-950/50",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
    accent: "text-emerald-400",
  },
  fading: {
    label: "Fading",
    color: "#f87171",
    bg: "bg-red-950/50",
    border: "border-red-500/30",
    text: "text-red-300",
    accent: "text-red-400",
  },
};

export const industries = [
  "All",
  "Technology",
  "Automotive",
  "Financials",
  "Healthcare",
  "Consumer",
  "Media",
];
