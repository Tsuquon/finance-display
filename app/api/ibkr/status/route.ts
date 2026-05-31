import { NextResponse } from "next/server";
import { getAuthStatus, tickle, reauthenticate, PAPER_MODE, MOCK_MODE } from "@/lib/ibkr";

export async function GET() {
  if (MOCK_MODE) {
    return NextResponse.json({
      connected: true,
      authenticated: true,
      competing: false,
      message: "mock",
      paper: true,
      gatewayReachable: true,
      needsLogin: false,
      mock: true,
    });
  }

  try {
    let status = await getAuthStatus();
    if (!status.authenticated) {
      await reauthenticate().catch(() => {});
      status = await getAuthStatus();
    }
    if (status.authenticated) await tickle().catch(() => {});

    return NextResponse.json({
      connected: !!(status.authenticated && status.connected),
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
