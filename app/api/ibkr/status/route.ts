import { NextResponse } from "next/server";
import { getAuthStatus, tickle, PAPER_MODE } from "@/lib/ibkr";

export async function GET() {
  try {
    const status = await getAuthStatus();
    // Keep session alive
    if (status.authenticated) await tickle().catch(() => {});
    return NextResponse.json({
      connected: !!(status.authenticated && status.connected),
      authenticated: status.authenticated,
      competing: status.competing,
      message: status.message,
      paper: PAPER_MODE,
    });
  } catch (err) {
    return NextResponse.json(
      { connected: false, error: "Gateway unreachable. Start IBKR Client Portal Gateway." },
      { status: 503 }
    );
  }
}
