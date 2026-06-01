export interface EnginePosition {
  ticker: string;
  name: string;
  conid: number;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  dollarInvested: number;
  buyAt: number;
  accountId: string;
  orderId?: string;
}

export interface EngineDecision {
  at:    number;
  sells: { ticker: string; reason: string; pnlPct?: number; reinvested?: number; withdrawn?: number }[];
  buys:  { ticker: string; reason: string; allocated?: number }[];
  note?: string;
}

export interface EngineConfig {
  maxTrades:   number;  // 1–20
  intervalSec: number;  // eval interval in seconds
  poolTotal:   number;  // initial pool size ($)
  reinvestPct: number;  // 0–100: % of each profit to put back in pool
}

export interface PnLSnapshot {
  at:         number;  // ms timestamp
  poolValue:  number;  // poolCash + cost basis of open positions
  unrealized: number;  // sum of open position mark-to-market P&L
  personal:   number;  // cumulative personal profit withdrawn to date
}

export interface EngineState {
  config:         EngineConfig;
  positions:      EnginePosition[];
  decisions:      EngineDecision[];  // capped at 50
  pnlHistory:     PnLSnapshot[];     // capped at 500
  poolCash:       number;  // undeployed cash in pool
  personalProfit: number;  // cumulative profit withdrawn from pool
  realizedPnl:    number;  // cumulative realized gain/loss across all closed trades
}

const KEY = "trading_engine_v1";

function defaultState(): EngineState {
  return {
    config:         { maxTrades: 5, intervalSec: 60, poolTotal: 10_000, reinvestPct: 50 },
    positions:      [],
    decisions:      [],
    pnlHistory:     [],
    poolCash:       10_000,
    personalProfit: 0,
    realizedPnl:    0,
  };
}

export function loadEngineState(): EngineState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw) as Partial<EngineState>;
    const def   = defaultState();
    return {
      config:         { ...def.config, ...(saved.config ?? {}) },
      positions:      saved.positions      ?? [],
      decisions:      saved.decisions      ?? [],
      pnlHistory:     saved.pnlHistory     ?? [],
      poolCash:       saved.poolCash       ?? saved.config?.poolTotal ?? def.config.poolTotal,
      personalProfit: saved.personalProfit ?? 0,
      realizedPnl:    saved.realizedPnl    ?? 0,
    };
  } catch {
    return defaultState();
  }
}

export function persistEngineState(state: EngineState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    KEY,
    JSON.stringify({
      ...state,
      decisions:  state.decisions.slice(-50),
      pnlHistory: state.pnlHistory.slice(-500),
    })
  );
}

// ── Pool helpers ──────────────────────────────────────────────────────────────

/** Total pool value = cash + cost basis of open positions. */
export function poolTotal(state: Pick<EngineState, "poolCash" | "positions">): number {
  return state.poolCash + state.positions.reduce((s, p) => s + p.dollarInvested, 0);
}

/** How much to allocate to a new trade given available slots. */
export function tradeAllocation(
  poolCash: number,
  availableSlots: number
): number {
  if (availableSlots <= 0 || poolCash <= 0) return 0;
  return parseFloat((poolCash / availableSlots).toFixed(2));
}

/** Apply sell proceeds to the pool.  Returns the updated poolCash and delta personalProfit. */
export function applySell(
  poolCash: number,
  dollarInvested: number,
  proceeds: number,
  reinvestPct: number
): { poolCash: number; personalDelta: number; reinvested: number; withdrawn: number; tradePnl: number } {
  const profit = proceeds - dollarInvested;
  if (profit > 0) {
    const reinvested  = parseFloat((profit * reinvestPct / 100).toFixed(2));
    const withdrawn   = parseFloat((profit - reinvested).toFixed(2));
    return {
      poolCash:      parseFloat((poolCash + dollarInvested + reinvested).toFixed(2)),
      personalDelta: withdrawn,
      reinvested,
      withdrawn,
      tradePnl:      parseFloat(profit.toFixed(2)),
    };
  } else {
    return {
      poolCash:      parseFloat((poolCash + proceeds).toFixed(2)),
      personalDelta: 0,
      reinvested:    0,
      withdrawn:     0,
      tradePnl:      parseFloat(profit.toFixed(2)),
    };
  }
}
