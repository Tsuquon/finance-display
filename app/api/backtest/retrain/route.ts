import { NextRequest, NextResponse } from "next/server";
import { dateKey, type Rebalance } from "@/lib/backtestEngine";
import { runTrainPipeline, type Market } from "@/lib/trainPipeline";
import { AU_BENCHMARK } from "@/lib/universeAU";
import type { Objective } from "@/lib/strategyTrainer";

// Headless, auto-dated training — the endpoint the auto-pilot scheduler hits on a
// timer. It always trains on the most recent `trainWindowMonths` of data (walk-forward:
// the older part is in-sample, the most recent part is the held-out test), so each call
// re-optimizes the strategy against the latest market regime rather than a fixed window.

interface RetrainRequest {
  objective?: Objective;
  trainWindowMonths?: number;  // size of the rolling train+test window (default 12)
  topN?: number;
  initialCapital?: number;
  benchmark?: string | null;
  rebalance?: Rebalance;
  equalWeight?: boolean;
  iterations?: number;
  trainFraction?: number;
  market?: Market;             // which universe to retrain on (default "US")
}

export async function POST(req: NextRequest) {
  try {
    const body: RetrainRequest = await req.json().catch(() => ({}));
    const {
      objective = "sharpe",
      trainWindowMonths = 12,
      topN = 5,
      initialCapital = 10_000,
      rebalance = "monthly",
      equalWeight = false,
      iterations = 200,
      trainFraction = 0.7,
      market = "US",
    } = body;

    // Default the benchmark to each market's broad index when the caller omits one.
    const benchmark =
      body.benchmark !== undefined ? body.benchmark : market === "AU" ? AU_BENCHMARK : "SPY";

    const months = Math.max(3, Math.min(60, trainWindowMonths));
    const end = new Date();
    const asOf = new Date(end);
    asOf.setMonth(asOf.getMonth() - months);

    const result = await runTrainPipeline({
      asOfDate: dateKey(asOf),
      endDate: dateKey(end),
      topN,
      initialCapital,
      rebalance,
      benchmark,
      equalWeight,
      objective,
      iterations,
      trainFraction,
      market,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ...result.data, trainWindowMonths: months });
  } catch (err) {
    console.error("Retrain error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
