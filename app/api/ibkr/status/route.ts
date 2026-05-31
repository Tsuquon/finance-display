import { NextResponse } from "next/server";
import { getAuthStatus, tickle, PAPER_MODE } from "@/lib/ibkr";

export async function GET() {
  try {
    const status = await getAuthStatus();
    if (status.authenticated) await tickle().catch(() => {});

    const connected = !!(status.authenticated && status.connected);

    return NextResponse.json({
      connected,
      authenticated: status.authenticated,
      competing: status.competing,
      message: status.message,
      paper: PAPER_MODE,
      // surfaced to help the UI distinguish states
      gatewayReachable: true,
      needsLogin: !status.authenticated,
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      gatewayReachable: false,
      needsLogin: false,
      error: String(err),
      paper: PAPER_MODE,
    }, { status: 503 });
  }
}
