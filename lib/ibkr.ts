import https from "node:https";
import http from "node:http";

const GATEWAY = (process.env.IBKR_GATEWAY_URL ?? "https://localhost:5001").replace(/\/$/, "");
export const PAPER_MODE = process.env.IBKR_PAPER === "true";
export const MOCK_MODE  = process.env.IBKR_MOCK  === "true";
// Demo mode: real Yahoo Finance + real AI, but IBKR is still simulated (requires IBKR_MOCK=true)
export const DEMO_MODE  = process.env.DEMO_MODE   === "true";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

async function req(
  path: string,
  opts: { method?: string; body?: Json } = {}
): Promise<{ ok: boolean; status: number; data: Json }> {
  return new Promise((resolve, reject) => {
    const url = new URL(GATEWAY + path);
    const isHttps = url.protocol === "https:";
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: parseInt(url.port) || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PortfolioLens/1.0",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
      rejectUnauthorized: false,
    };

    const transport = isHttps ? https : (http as unknown as typeof https);
    const r = transport.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ ok: (res.statusCode ?? 500) < 300, status: res.statusCode ?? 500, data: JSON.parse(raw) });
        } catch {
          resolve({ ok: (res.statusCode ?? 500) < 300, status: res.statusCode ?? 500, data: raw });
        }
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthStatus {
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
  message?: string;
}

export interface ContractInfo {
  conid: number;
  symbol: string;
  companyName: string;
  secType: string;
  exchange: string;
}

export interface OrderResult {
  order_id?: string;
  order_status?: string;
  local_order_id?: string;
  error?: string;
  /** IBKR confirmation reply ID (needs a second call) */
  id?: string;
  message?: string[];
}

// ── API ────────────────────────────────────────────────────────────────────

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await req("/v1/api/iserver/auth/status");
  return res.data as unknown as AuthStatus;
}

export async function tickle(): Promise<void> {
  await req("/v1/api/tickle", { method: "POST" });
}

export async function reauthenticate(): Promise<void> {
  await req("/v1/api/iserver/reauthenticate", { method: "POST" });
}

export async function getAccounts(): Promise<string[]> {
  const res = await req("/v1/api/iserver/accounts");
  const d = res.data as { accounts?: string[] } | string[];
  if (Array.isArray(d)) return d as string[];
  return (d as { accounts?: string[] }).accounts ?? [];
}

export async function searchContract(symbol: string): Promise<ContractInfo | null> {
  const res = await req(
    `/v1/api/iserver/contract/search?symbol=${encodeURIComponent(symbol)}&secType=STK&name=false`
  );
  if (!res.ok || !Array.isArray(res.data)) return null;

  type RawContract = {
    conid?: number;
    symbol?: string;
    companyName?: string;
    description?: string;
    sections?: { secType: string; exchange: string }[];
  };

  for (const c of res.data as RawContract[]) {
    if (!c.conid) continue;
    const stkSection = c.sections?.find((s) => s.secType === "STK");
    if (stkSection) {
      return {
        conid: c.conid,
        symbol: c.symbol ?? symbol,
        companyName: c.companyName ?? c.description ?? symbol,
        secType: "STK",
        exchange: stkSection.exchange ?? "SMART",
      };
    }
  }
  return null;
}

export async function getPrice(conid: number): Promise<number | null> {
  // IBKR snapshot: first call subscribes, subsequent calls return data
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await req(`/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=31,84,86`);
    if (res.ok && Array.isArray(res.data)) {
      const snap = (res.data as Array<{ "31"?: string | number }>)[0];
      if (snap?.["31"] && snap["31"] !== "C" && snap["31"] !== "--") {
        const price = parseFloat(String(snap["31"]));
        if (!isNaN(price) && price > 0) return price;
      }
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

export async function placeOrder(
  accountId: string,
  conid: number,
  side: "BUY" | "SELL",
  quantity: number,
  orderType: "MKT" | "LMT" = "MKT",
  limitPrice?: number
): Promise<OrderResult> {
  const body = {
    orders: [
      {
        conid,
        secType: `${conid}:STK`,
        orderType,
        side,
        quantity,
        tif: "DAY",
        ...(orderType === "LMT" && limitPrice ? { price: limitPrice } : {}),
      },
    ],
  };

  const res = await req(`/v1/api/iserver/account/${accountId}/orders`, { method: "POST", body });
  if (!res.ok) return { error: `HTTP ${res.status}` };

  const result = res.data;

  // IBKR may return a list; first item might be a confirmation dialog
  if (Array.isArray(result) && result.length > 0) {
    const first = result[0] as OrderResult;

    // If it has 'id' but no 'order_id', it's a confirmation prompt
    if (first.id && !first.order_id) {
      const confirm = await req(`/v1/api/iserver/reply/${first.id}`, {
        method: "POST",
        body: { confirmed: true },
      });
      if (!confirm.ok) return { error: "Confirmation failed" };
      const confirmed = confirm.data;
      if (Array.isArray(confirmed) && confirmed[0]) return confirmed[0] as OrderResult;
      return confirmed as OrderResult;
    }

    return first;
  }

  return result as OrderResult;
}

export async function getPositions(accountId: string): Promise<
  Array<{ conid: number; ticker: string; position: number; mktValue: number; avgCost: number }>
> {
  const res = await req(`/v1/api/portfolio/${accountId}/positions/0`);
  if (!res.ok || !Array.isArray(res.data)) return [];

  type RawPos = {
    conid?: number;
    ticker?: string;
    contractDesc?: string;
    position?: number;
    mktValue?: number;
    avgCost?: number;
  };

  return (res.data as RawPos[]).map((p) => ({
    conid: p.conid ?? 0,
    ticker: p.ticker ?? p.contractDesc ?? "",
    position: p.position ?? 0,
    mktValue: p.mktValue ?? 0,
    avgCost: p.avgCost ?? 0,
  }));
}
