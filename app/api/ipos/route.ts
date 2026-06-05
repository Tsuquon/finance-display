import { NextResponse } from "next/server";
import { fetchIpoCalendar, finnhubConfigured, type IpoListing } from "@/lib/finnhub";

export interface IposResponse {
  configured: boolean;       // false when FINNHUB_API_KEY is unset
  upcoming: IpoListing[];    // priced/expected on or after today, soonest first
  recent: IpoListing[];      // already listed, most recent first
}

// How far back/forward to pull the calendar.
const PAST_DAYS = 30;
const FUTURE_DAYS = 45;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Upcoming + recent IPO listings from Finnhub's calendar, split around today so
 * the UI can show two columns. Degrades to empty lists (configured:false) when
 * no Finnhub key is present rather than erroring.
 */
export async function GET() {
  if (!finnhubConfigured()) {
    return NextResponse.json<IposResponse>({ configured: false, upcoming: [], recent: [] });
  }

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - PAST_DAYS);
  const to = new Date(now);
  to.setDate(to.getDate() + FUTURE_DAYS);

  const all = await fetchIpoCalendar(ymd(from), ymd(to));
  const today = ymd(now);

  const upcoming = all.filter((i) => i.date >= today);
  // Most recent first for the "recent" column.
  const recent = all.filter((i) => i.date < today).reverse();

  return NextResponse.json<IposResponse>({ configured: true, upcoming, recent });
}
