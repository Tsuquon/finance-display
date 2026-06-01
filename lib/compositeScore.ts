import type { SignalLevel } from "./technicalAnalysis";
import type { Company } from "@/types";

type CategoryKey = "future" | "stable" | "fading";

const CATEGORY_OFFSET: Record<CategoryKey, number> = {
  future: 8,
  stable: 0,
  fading: -15,
};

// Technical signal sets an upper bound on the final score
const SIGNAL_CAP: Record<SignalLevel, number> = {
  "strong-buy":  100,
  "buy":         100,
  "neutral":     65,
  "sell":        40,
  "strong-sell": 25,
};

export interface CompositeInput {
  aiST: number;          // 1–10
  aiLT: number;          // 1–10
  techScore: number;     // 0–100
  techSignal: SignalLevel;
  signals: Company["signals"];
  category: CategoryKey;
}

export interface CompositeResult {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  label: string;
  breakdown: { ai: number; tech: number; sentiment: number };
}

export function computeComposite({
  aiST,
  aiLT,
  techScore,
  techSignal,
  signals,
  category,
}: CompositeInput): CompositeResult {
  const aiNorm = (aiST + aiLT) / 20;
  const techNorm = techScore / 100;
  const positiveCount = signals.filter((s) => s.type === "positive").length;
  const sentimentNorm = signals.length > 0 ? positiveCount / signals.length : 0.5;

  // Weighted additive base, each component contribution on 0–100
  const aiContrib = 0.5 * aiNorm * 100;
  const techContrib = 0.35 * techNorm * 100;
  const sentimentContrib = 0.15 * sentimentNorm * 100;
  const base = aiContrib + techContrib + sentimentContrib;

  const withCategory = base + CATEGORY_OFFSET[category];
  const capped = Math.min(SIGNAL_CAP[techSignal], withCategory);
  const score = Math.round(Math.max(0, Math.min(100, capped)));

  const grade: CompositeResult["grade"] =
    score >= 80 ? "A" :
    score >= 65 ? "B" :
    score >= 50 ? "C" :
    score >= 35 ? "D" : "F";

  const label =
    score >= 75 ? "Strong conviction" :
    score >= 60 ? "Favorable" :
    score >= 45 ? "Mixed signals" :
    score >= 30 ? "Cautious" :
    "Avoid";

  return {
    score,
    grade,
    label,
    breakdown: {
      ai: Math.round(aiContrib),
      tech: Math.round(techContrib),
      sentiment: Math.round(sentimentContrib),
    },
  };
}
