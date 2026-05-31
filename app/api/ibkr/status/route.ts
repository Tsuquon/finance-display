import { NextResponse } from "next/server";
import { getAuthStatus, tickle, reauthenticate, PAPER_MODE } from "@/lib/ibkr";

export async function GET() {
  try {
    let status = await getAuthStatus();

    // Gateway reachable but session not yet synced after browser login —
    // call reauthenticate and check again.
    if (!status.authenticated) {
      await reauthenticate().catch(() => {});
      status = await getAuthStatus();
    }

    if (status.authenticated) await tickle().catch(() => {});

    const connected = !!(status.authenticated && status.connected);

    return NextResponse.json({
      connected,
      authenticated: status.authenticated,
      competing: status.competing,
      message: status.message,
      paper: PAPER_MODE,
      gatewayReachable: true,
      needsLogin: !status.authenticated,
    });
  } catch {
    return NextResponse.json({
      connected: false,
      gatewayReachable: false,
      needsLogin: false,
      paper: PAPER_MODE,
    }, { status: 503 });
  }
}
