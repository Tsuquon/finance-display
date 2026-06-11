// Free-form notes the user jots down from any page. Stored only in localStorage
// (like custom tickers and the chat transcript) — there's no hosted backend for
// per-user data. Each note can reference stocks via @TICKER tokens typed with the
// "@" autocomplete; the referenced tickers are cached on the note so they can be
// surfaced/filtered without re-parsing.

export const NOTES_KEY = "finance-notes";

export interface Note {
  id: string;
  text: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  tickers: string[]; // @TICKER references, uppercase, deduped
}

// Matches an @TICKER token: starts with a letter, then letters/digits and the
// "." / "-" that appear in real symbols (e.g. BHP.AX, BRK-B). Kept in sync with
// the token the autocomplete inserts.
const MENTION_RE = /@([A-Za-z][A-Za-z0-9.\-]*)/g;

/** Pull the unique, uppercased @TICKER references out of a note body. */
export function extractTickers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const t = m[1].toUpperCase();
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** Safely read notes from localStorage. Returns [] on missing/corrupt data. */
export function loadNotes(): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

/** Persist notes. Best-effort — ignores quota/serialization failures. */
export function saveNotes(notes: Note[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    /* ignore */
  }
}
