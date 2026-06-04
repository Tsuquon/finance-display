import { NextRequest } from "next/server";
import { listAlerts, deleteAlert, createAlert, type AlertStatus, type CreateAlertInput } from "@/lib/alerts";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as AlertStatus | null;
  const alerts = await listAlerts(status ?? undefined);
  return Response.json({ alerts });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateAlertInput;
  const { alert, error } = await createAlert(body);
  if (error) return Response.json({ error }, { status: 400 });
  return Response.json({ alert });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  const ok = await deleteAlert(id);
  return Response.json({ ok });
}
