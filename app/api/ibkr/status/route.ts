import { NextResponse } from "next/server";
import { getAuthStatus, tickle, reauthenticate, ssoValidate, PAPER_MODE, MOCK_MODE, DEMO_MODE } from "@/lib/ibkr";

export async function GET() {
  if (MOCK_MODE) {
    return NextResponse.json({
      connected: true,
      authenticated: true,
      competing: false,
      message: DEMO_MODE ? "demo" : "mock",
      paper: true,
      gatewayReachable: true,
      needsLogin: false,
      mock: true,
      demo: DEMO_MODE,
    });
  }

  try {
    // A /tickle initializes the brokerage session after a browser login.
    await tickle().catch(() => {});
    let status = await getAuthStatus();

    // Fresh browser SSO logins report authenticated:false until the session is
    // validated and the brokerage session is (re)established. Run IBKR's
    // documented recovery sequence, then re-check.
    if (!status.authenticated) {
      await ssoValidate().catch(() => {});
      await reauthenticate().catch(() => {});
      status = await getAuthStatus();
    }

    return NextResponse.json({
      connected: !!(status.authenticated && status.connected),
      authenticated: status.authenticated,
      competing: status.competing,
      message: status.message,
      paper: PAPER_MODE,
      demo: DEMO_MODE,
      gatewayReachable: true,
      needsLogin: !status.authenticated,
    });
  } catch {
    return NextResponse.json({
      connected: false,
      gatewayReachable: false,
      needsLogin: false,
      paper: PAPER_MODE,
      demo: DEMO_MODE,
    }, { status: 503 });
  }
}
