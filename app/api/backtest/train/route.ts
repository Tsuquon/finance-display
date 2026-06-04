import { NextRequest, NextResponse } from "next/server";
import { runTrainPipeline, type TrainBacktestRequest } from "@/lib/trainPipeline";

export async function POST(req: NextRequest) {
  try {
    const body: TrainBacktestRequest = await req.json();
    const result = await runTrainPipeline(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (err) {
    console.error("Train backtest error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
