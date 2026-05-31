import type { ScoreResult } from "@/app/api/score/route";

export type StoredScore = { data: ScoreResult; at: number };
export const scoreStore = new Map<string, StoredScore>();
export const SCORE_TTL = 60 * 60 * 1000; // 1 hour
