import { evaluateAlerts } from "@/lib/alerts";

// Called by the client-side poller while the app is open. Checks every active
// alert against live data and notifies (push/email) any that newly fire.
// The same evaluateAlerts() also runs headless from the GitHub Actions cron.
export async function POST() {
  try {
    const result = await evaluateAlerts();
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "evaluation failed" },
      { status: 500 }
    );
  }
}
