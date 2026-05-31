const ALLOWED = [
  "Technology", "Financials", "Healthcare", "Consumer",
  "Industrials", "Energy", "Crypto", "Media", "Automotive",
] as const;

export type Industry = typeof ALLOWED[number];

export function normalizeIndustry(raw: string | undefined): Industry {
  if (!raw) return "Technology";
  const upper = raw.toUpperCase();
  for (const ind of ALLOWED) {
    if (upper.includes(ind.toUpperCase())) return ind;
  }
  if (/crypto|bitcoin|blockchain|coin/i.test(raw)) return "Crypto";
  if (/semi|chip|ai|compute|data.?center|cloud|software|tech|server/i.test(raw)) return "Technology";
  if (/bank|finance|insur|invest|payment|asset/i.test(raw)) return "Financials";
  if (/health|pharma|bio|medic|drug/i.test(raw)) return "Healthcare";
  if (/retail|food|beverage|consumer|e.?comm/i.test(raw)) return "Consumer";
  if (/oil|gas|energy|power|utility|electric/i.test(raw)) return "Energy";
  if (/media|stream|entertain|news|publish/i.test(raw)) return "Media";
  if (/auto|car|vehicle|ev|truck/i.test(raw)) return "Automotive";
  if (/industri|manufactur|aerospace|defense|logistic/i.test(raw)) return "Industrials";
  return "Technology";
}
