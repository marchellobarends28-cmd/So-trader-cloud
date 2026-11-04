import { db } from "@/db";
import {
  trades,
  mt5Accounts,
  aiSettings,
  systemLogs,
  riskEvents,
  systemState,
  marketAssets,
  mt5Commands,
} from "@/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getSpecs, validateProtection, roundLotSafe } from "./broker-specs";

/* ------------------------------------------------------------------ *
 * Advanced risk management (deterministic, no ML).
 * Hard limits are enforced here AND independently inside the EA.
 * ------------------------------------------------------------------ */

export const RISK_LIMITS = {
  riskPerTradePct: 0.5,
  maxDailyDrawdownPct: 2,
  maxWeeklyDrawdownPct: 4,
  maxAggregateOpenRiskPct: 1,
  maxOpenPositions: 3,
  maxPriceAgeSeconds: 180,
  duplicateWindowSeconds: 300,
};

export interface RiskBaseline {
  dayKey: string;
  weekKey: string;
  dayStartEquity: number;
  weekStartEquity: number;
  highWaterEquity: number;
  accountNumber?: string;
}

export interface RiskSnapshot {
  equity: number;
  balance: number;
  floatingPnl: number;
  openPositions: number;
  openRiskPct: number;
  openRiskUsd: number;
  dailyPnlUsd: number;
  dailyDrawdownPct: number;
  weeklyDrawdownPct: number;
  maxDailyDrawdownPct: number;
  maxWeeklyDrawdownPct: number;
  maxAggregateOpenRiskPct: number;
  riskPerTradePct: number;
  emergencyStop: boolean;
  emergencyReason: string | null;
  priceAgeSeconds: number;
  dataFresh: boolean;
  breakers: string[];
  canOpenNewTrades: boolean;
  isDemo: boolean;
  marginLevelPct: number;
}

const DAY_MS = 86400000;

function dayKeyOf(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function weekKeyOf(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = t.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diff / (7 * DAY_MS));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function getState<T = Record<string, unknown>>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(systemState).where(eq(systemState.key, key)).limit(1);
  if (!row) return fallback;
  return (row.value as T) ?? fallback;
}

export async function setState(key: string, value: Record<string, unknown>) {
  await db
    .insert(systemState)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
}

export async function recordRiskEvent(input: {
  severity: "INFO" | "WARN" | "CRITICAL";
  type: string;
  message: string;
  symbol?: string;
  tradeId?: number;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(riskEvents).values({
    severity: input.severity,
    type: input.type,
    message: input.message,
    symbol: input.symbol ?? null,
    tradeId: input.tradeId ?? null,
    metadata: input.metadata ?? {},
  });

  await db.insert(systemLogs).values({
    level: input.severity === "CRITICAL" ? "ERROR" : "WARN",
    source: "Risk Manager",
    message: input.message,
    metadata: { type: input.type, ...(input.metadata ?? {}) },
  });
}

async function refreshBaseline(equity: number): Promise<RiskBaseline> {
  const now = new Date();
  const dayKey = dayKeyOf(now);
  const weekKey = weekKeyOf(now);
  const existing = await getState<RiskBaseline | null>("risk_baseline", null);
  const [acct] = await db.select().from(mt5Accounts).limit(1);
  const accountNumber = acct?.accountNumber ?? "";

  // A different broker account is a different risk context: never inherit the
  // previous account's equity baseline (that would fabricate a huge drawdown).
  if (!existing || !existing.accountNumber || existing.accountNumber !== accountNumber) {
    const fresh: RiskBaseline = {
      dayKey,
      weekKey,
      dayStartEquity: equity,
      weekStartEquity: equity,
      highWaterEquity: equity,
      accountNumber,
    };
    await setState("risk_baseline", fresh as unknown as Record<string, unknown>);
    return fresh;
  }

  let changed = false;
  const next = { ...existing };
  if (!next.accountNumber) {
    next.accountNumber = accountNumber;
    changed = true;
  }
  if (existing.dayKey !== dayKey) {
    next.dayKey = dayKey;
    next.dayStartEquity = equity;
    changed = true;
  }
  if (existing.weekKey !== weekKey) {
    next.weekKey = weekKey;
    next.weekStartEquity = equity;
    changed = true;
  }
  if (equity > existing.highWaterEquity) {
    next.highWaterEquity = equity;
    changed = true;
  }
  if (changed) await setState("risk_baseline", next as unknown as Record<string, unknown>);
  return next;
}

export async function getRiskSnapshot(): Promise<RiskSnapshot> {
  const [account] = await db.select().from(mt5Accounts).limit(1);
  const [settings] = await db.select().from(aiSettings).limit(1);
  const equity = account ? Number(account.equity) : 0;
  const balance = account ? Number(account.balance) : 0;

  const baseline = await refreshBaseline(equity || balance || 1);

  const open = await db
    .select()
    .from(trades)
    .where(inArray(trades.status, ["OPEN", "PENDING"]));
  // Once an MT5 EA is connected, paper/demo seed rows must not contaminate broker risk.
  const riskPositions = account?.bridgeMode === "mql5_ea" ? open.filter((t) => !t.isSimulated) : open;

  const floatingPnl = riskPositions.reduce((a, t) => a + Number(t.pnl || 0), 0);
  const openPositions = riskPositions.length;

  // Aggregate open risk includes both broker-open and pending real orders.
  let openRiskUsd = 0;
  for (const t of riskPositions) {
    if (t.status !== "OPEN" && t.status !== "PENDING") continue;
    const spec = await getSpecs(t.symbol);
    const distance = Math.abs(Number(t.entryPrice) - Number(t.stopLoss));
    const perUnit = spec.tickSize > 0 && spec.tickValue > 0 ? spec.tickValue / spec.tickSize : spec.contractSize;
    openRiskUsd += distance * perUnit * Number(t.lotSize);
  }
  const openRiskPct = equity > 0 ? (openRiskUsd / equity) * 100 : 0;

  const since = new Date(Date.now() - 8 * DAY_MS);
  const closedRows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.status, "CLOSED"), gte(trades.closeTime, since)));
  const closed = account?.bridgeMode === "mql5_ea" ? closedRows.filter((t) => !t.isSimulated) : closedRows;

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekKey = weekKeyOf(now);
  const dailyPnlUsd = closed
    .filter((t) => t.closeTime && new Date(t.closeTime) >= dayStart)
    .reduce((a, t) => a + Number(t.pnl || 0), 0);
  const weeklyPnlUsd = closed
    .filter((t) => t.closeTime && weekKeyOf(new Date(t.closeTime)) === weekKey)
    .reduce((a, t) => a + Number(t.pnl || 0), 0);

  const dailyDrawdownPct =
    baseline.dayStartEquity > 0 ? Math.max(0, ((baseline.dayStartEquity - (equity + 0)) / baseline.dayStartEquity) * 100) : 0;
  const weeklyDrawdownPct =
    baseline.weekStartEquity > 0 ? Math.max(0, ((baseline.weekStartEquity - equity) / baseline.weekStartEquity) * 100) : 0;

  const emergency = await getState<{ active: boolean; reason: string | null; at: string | null }>("emergency_stop", {
    active: false,
    reason: null,
    at: null,
  });

  const assets = await db.select().from(marketAssets);
  const freshest = assets
    .map((a) => (a.lastTickAt ? new Date(a.lastTickAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const priceAgeSeconds = freshest > 0 ? Math.round((Date.now() - freshest) / 1000) : 999999;

  const heartbeatAge = account ? Date.now() - new Date(account.lastHeartbeat).getTime() : Number.POSITIVE_INFINITY;
  const eaLive = Boolean(account && account.isConnected && account.bridgeMode === "mql5_ea" && account.eaVersion !== "0.0.0" && account.eaVersion !== "unknown" && heartbeatAge >= 0 && heartbeatAge < 30000);
  const dataFresh = eaLive ? priceAgeSeconds <= RISK_LIMITS.maxPriceAgeSeconds : false;

  const breakers: string[] = [];
  if (emergency.active) breakers.push(`Emergency stop active: ${emergency.reason ?? "manual"}`);
  if (dailyDrawdownPct >= RISK_LIMITS.maxDailyDrawdownPct)
    breakers.push(`Daily drawdown ${dailyDrawdownPct.toFixed(2)}% ≥ ${RISK_LIMITS.maxDailyDrawdownPct}% limit`);
  if (weeklyDrawdownPct >= RISK_LIMITS.maxWeeklyDrawdownPct)
    breakers.push(`Weekly drawdown ${weeklyDrawdownPct.toFixed(2)}% ≥ ${RISK_LIMITS.maxWeeklyDrawdownPct}% limit`);
  if (openRiskPct >= RISK_LIMITS.maxAggregateOpenRiskPct)
    breakers.push(`Aggregate open risk ${openRiskPct.toFixed(2)}% ≥ ${RISK_LIMITS.maxAggregateOpenRiskPct}% limit`);
  if (openPositions >= RISK_LIMITS.maxOpenPositions)
    breakers.push(`Max open positions reached (${openPositions}/${RISK_LIMITS.maxOpenPositions})`);
  if (settings && !settings.autopilotEnabled) breakers.push("Autopilot is paused in settings");
  if (account && Number(account.marginLevel) > 0 && Number(account.marginLevel) < 200)
    breakers.push(`Margin level ${Number(account.marginLevel).toFixed(0)}% below 200% safety floor`);

  return {
    equity,
    balance,
    floatingPnl: Number(floatingPnl.toFixed(2)),
    openPositions,
    openRiskPct: Number(openRiskPct.toFixed(2)),
    openRiskUsd: Number(openRiskUsd.toFixed(2)),
    dailyPnlUsd: Number(dailyPnlUsd.toFixed(2)),
    dailyDrawdownPct: Number(dailyDrawdownPct.toFixed(2)),
    weeklyDrawdownPct: Number(weeklyDrawdownPct.toFixed(2)),
    maxDailyDrawdownPct: RISK_LIMITS.maxDailyDrawdownPct,
    maxWeeklyDrawdownPct: RISK_LIMITS.maxWeeklyDrawdownPct,
    maxAggregateOpenRiskPct: RISK_LIMITS.maxAggregateOpenRiskPct,
    riskPerTradePct: settings ? Math.min(RISK_LIMITS.riskPerTradePct, Math.max(0.01, Number(settings.riskPerTradePct) || RISK_LIMITS.riskPerTradePct)) : RISK_LIMITS.riskPerTradePct,
    emergencyStop: emergency.active,
    emergencyReason: emergency.reason,
    priceAgeSeconds,
    dataFresh,
    breakers,
    canOpenNewTrades: breakers.length === 0,
    isDemo: account ? account.isDemo : true,
    marginLevelPct: account ? Number(account.marginLevel) : 0,
  };
}

export interface TradePermission {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  snapshot: RiskSnapshot;
}

/** Full pre-trade gate. Risk Manager veto is final. */
export async function checkTradePermission(input: {
  symbol: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lot: number;
  isDemoAllowed?: boolean;
}): Promise<TradePermission> {
  const snapshot = await getRiskSnapshot();
  const blockers: string[] = [...snapshot.breakers];
  const warnings: string[] = [];
  const spec = await getSpecs(input.symbol);
  const [symbolAsset] = await db.select().from(marketAssets).where(eq(marketAssets.symbol, input.symbol)).limit(1);

  // 1. Emergency stop / breakers already included.
  // 2. Require a fresh quote for THIS symbol, not merely any recently updated symbol.
  const symbolTickAge = symbolAsset?.lastTickAt ? Math.floor((Date.now() - new Date(symbolAsset.lastTickAt).getTime()) / 1000) : Number.POSITIVE_INFINITY;
  if (!symbolAsset || symbolAsset.dataSource !== "MT5_LIVE" || !symbolAsset.bid || !symbolAsset.ask || symbolTickAge < 0 || symbolTickAge > RISK_LIMITS.maxPriceAgeSeconds) {
    blockers.push(`No fresh MT5 live bid/ask for ${input.symbol}; last symbol tick age ${Number.isFinite(symbolTickAge) ? symbolTickAge : "unknown"}s (maximum ${RISK_LIMITS.maxPriceAgeSeconds}s).`);
  }
  if (spec.source !== "BROKER") {
    blockers.push(`Broker instrument specifications for ${input.symbol} have not been received from MT5; fallback specifications cannot authorize a real order.`);
  }

  // 3. SL/TP vs broker stops level + correct geometry.
  const protection = validateProtection({
    direction: input.direction,
    entry: input.entry,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    spec,
  });
  if (!protection.valid) blockers.push(protection.reason ?? "Invalid SL/TP");

  // 4. Lot validity (step, min, max).
  const lotCheck = roundLotSafe(input.lot, spec);
  if (!lotCheck.valid) blockers.push(lotCheck.reason ?? "Invalid lot size");
  else if (Math.abs(lotCheck.lot - input.lot) > 1e-8) {
    blockers.push(`Lot size ${input.lot} is not an exact broker volume step; use ${lotCheck.lot}. No automatic rounding is applied to live orders.`);
  }

  // 5. Duplicate order prevention: same symbol open, pending, or very recent.
  const openSameRows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.symbol, input.symbol), inArray(trades.status, ["OPEN", "PENDING"])));
  const [currentAccount] = await db.select().from(mt5Accounts).limit(1);
  const openSame = currentAccount?.bridgeMode === "mql5_ea" ? openSameRows.filter((t) => !t.isSimulated) : openSameRows;
  if (openSame.length > 0) {
    blockers.push(`Duplicate blocked: ${openSame.length} open/pending broker position(s) already exist on ${input.symbol}`);
  }

  const recent = new Date(Date.now() - RISK_LIMITS.duplicateWindowSeconds * 1000);
  const recentCommands = await db
    .select()
    .from(mt5Commands)
    .where(and(eq(mt5Commands.symbol, input.symbol), gte(mt5Commands.createdAt, recent)));
  if (recentCommands.length > 0) {
    blockers.push(`Duplicate blocked: a command for ${input.symbol} was queued in the last ${RISK_LIMITS.duplicateWindowSeconds}s`);
  }

  // 6. Per-trade risk check.
  const riskDistance = Math.abs(input.entry - input.stopLoss);
  const perUnit = spec.tickSize > 0 && spec.tickValue > 0 ? spec.tickValue / spec.tickSize : spec.contractSize;
  const tradeRiskUsd = riskDistance * perUnit * input.lot + spec.commissionPerLot * input.lot;
  const tradeRiskPct = snapshot.equity > 0 ? (tradeRiskUsd / snapshot.equity) * 100 : 100;
  if (tradeRiskPct > snapshot.riskPerTradePct + 0.001) {
    blockers.push(
      `Trade risk ${tradeRiskPct.toFixed(3)}% exceeds the ${snapshot.riskPerTradePct}% per-trade limit (${tradeRiskUsd.toFixed(2)} USD)`
    );
  }

  // 7. Aggregate open risk cap.
  const newAggregate = snapshot.openRiskPct + tradeRiskPct;
  if (newAggregate > snapshot.maxAggregateOpenRiskPct) {
    blockers.push(
      `Aggregate open risk would reach ${newAggregate.toFixed(2)}% (cap ${snapshot.maxAggregateOpenRiskPct}%)`
    );
  }

  // 8. Never scale up to recover losses (martingale guard).
  const closedRecent = await db
    .select()
    .from(trades)
    .where(and(eq(trades.status, "CLOSED"), gte(trades.closeTime, new Date(Date.now() - 3600 * 1000))));
  const losingStreak = closedRecent.filter((t) => Number(t.pnl) < 0).length;
  if (losingStreak >= 3) {
    blockers.push(`3+ losses in the last hour: no size increase permitted, new entries blocked for cooldown`);
  }

  if (!snapshot.isDemo) warnings.push("Account is LIVE. Demo mode is only bypassed when every validation gate has passed.");

  return { allowed: blockers.length === 0, blockers, warnings, snapshot };
}

export async function activateEmergencyStop(reason: string) {
  await setState("emergency_stop", { active: true, reason, at: new Date().toISOString() });
  await recordRiskEvent({
    severity: "CRITICAL",
    type: "EMERGENCY_STOP",
    message: `Emergency stop activated: ${reason}. All new entries are blocked.`,
  });
}

export async function clearEmergencyStop(by: string) {
  await setState("emergency_stop", { active: false, reason: null, at: null, clearedBy: by, clearedAt: new Date().toISOString() });
  await recordRiskEvent({
    severity: "INFO",
    type: "EMERGENCY_STOP",
    message: `Emergency stop cleared by ${by}.`,
  });
}

export async function recentRiskEvents(limit = 20) {
  return db.select().from(riskEvents).orderBy(desc(riskEvents.createdAt)).limit(limit);
}
