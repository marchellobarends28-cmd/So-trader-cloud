import { db } from "@/db";
import { symbolSpecs, systemLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface InstrumentSpec {
  symbol: string;
  digits: number;
  point: number;
  contractSize: number;
  tickSize: number;
  tickValue: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  stopsLevelPoints: number;
  freezeLevelPoints: number;
  commissionPerLot: number;
  slippagePoints: number;
  typicalSpreadPoints: number;
  source?: string;
}

/**
 * Fallback specifications. These are conservative defaults (typical IC Markets
 * raw-account values) used ONLY until the EA uploads the real broker specs.
 * Anything sized with these is flagged `specSource: "DEFAULT"` downstream.
 */
export const DEFAULT_SPECS: Record<string, InstrumentSpec> = {
  EURUSD: {
    symbol: "EURUSD", digits: 5, point: 0.00001, contractSize: 100000, tickSize: 0.00001,
    tickValue: 1, minLot: 0.01, maxLot: 100, lotStep: 0.01, stopsLevelPoints: 10,
    freezeLevelPoints: 5, commissionPerLot: 7, slippagePoints: 8, typicalSpreadPoints: 8,
  },
  GBPUSD: {
    symbol: "GBPUSD", digits: 5, point: 0.00001, contractSize: 100000, tickSize: 0.00001,
    tickValue: 1, minLot: 0.01, maxLot: 100, lotStep: 0.01, stopsLevelPoints: 10,
    freezeLevelPoints: 5, commissionPerLot: 7, slippagePoints: 9, typicalSpreadPoints: 11,
  },
  XAUUSD: {
    symbol: "XAUUSD", digits: 2, point: 0.01, contractSize: 100, tickSize: 0.01,
    tickValue: 1, minLot: 0.01, maxLot: 50, lotStep: 0.01, stopsLevelPoints: 30,
    freezeLevelPoints: 10, commissionPerLot: 7, slippagePoints: 25, typicalSpreadPoints: 25,
  },
  BTCUSD: {
    symbol: "BTCUSD", digits: 2, point: 0.01, contractSize: 1, tickSize: 0.01,
    tickValue: 0.01, minLot: 0.01, maxLot: 20, lotStep: 0.01, stopsLevelPoints: 200,
    freezeLevelPoints: 50, commissionPerLot: 0, slippagePoints: 400, typicalSpreadPoints: 900,
  },
  US30: {
    symbol: "US30", digits: 1, point: 0.1, contractSize: 1, tickSize: 0.1,
    tickValue: 0.1, minLot: 0.1, maxLot: 50, lotStep: 0.1, stopsLevelPoints: 40,
    freezeLevelPoints: 20, commissionPerLot: 0, slippagePoints: 30, typicalSpreadPoints: 25,
  },
  NAS100: {
    symbol: "NAS100", digits: 1, point: 0.1, contractSize: 1, tickSize: 0.1,
    tickValue: 0.1, minLot: 0.1, maxLot: 50, lotStep: 0.1, stopsLevelPoints: 40,
    freezeLevelPoints: 20, commissionPerLot: 0, slippagePoints: 25, typicalSpreadPoints: 20,
  },
};

export const SUPPORTED_SYMBOLS = Object.keys(DEFAULT_SPECS);

export async function ensureSymbolSpecs() {
  const existing = await db.select().from(symbolSpecs);
  if (existing.length >= SUPPORTED_SYMBOLS.length) return existing;

  for (const symbol of SUPPORTED_SYMBOLS) {
    if (existing.some((s) => s.symbol === symbol)) continue;
    const d = DEFAULT_SPECS[symbol];
    await db.insert(symbolSpecs).values({
      symbol,
      digits: d.digits,
      point: d.point.toString(),
      contractSize: d.contractSize.toString(),
      tickSize: d.tickSize.toString(),
      tickValue: d.tickValue.toString(),
      minLot: d.minLot.toString(),
      maxLot: d.maxLot.toString(),
      lotStep: d.lotStep.toString(),
      stopsLevelPoints: d.stopsLevelPoints,
      freezeLevelPoints: d.freezeLevelPoints,
      commissionPerLot: d.commissionPerLot.toString(),
      slippagePoints: d.slippagePoints,
      typicalSpreadPoints: d.typicalSpreadPoints.toString(),
      source: "DEFAULT",
    });
  }
  return db.select().from(symbolSpecs);
}

export async function getSpecs(symbol: string): Promise<InstrumentSpec> {
  const [row] = await db.select().from(symbolSpecs).where(eq(symbolSpecs.symbol, symbol)).limit(1);
  if (!row) return DEFAULT_SPECS[symbol] ?? DEFAULT_SPECS.EURUSD;

  return {
    symbol: row.symbol,
    digits: row.digits,
    point: Number(row.point),
    contractSize: Number(row.contractSize),
    tickSize: Number(row.tickSize),
    tickValue: Number(row.tickValue),
    minLot: Number(row.minLot),
    maxLot: Number(row.maxLot),
    lotStep: Number(row.lotStep),
    stopsLevelPoints: row.stopsLevelPoints,
    freezeLevelPoints: row.freezeLevelPoints,
    commissionPerLot: Number(row.commissionPerLot),
    slippagePoints: row.slippagePoints,
    typicalSpreadPoints: Number(row.typicalSpreadPoints),
    source: row.source,
  };
}

export async function getAllSpecs(): Promise<Record<string, InstrumentSpec>> {
  await ensureSymbolSpecs();
  const rows = await db.select().from(symbolSpecs);
  const map: Record<string, InstrumentSpec> = {};
  for (const row of rows) {
    map[row.symbol] = {
      symbol: row.symbol,
      digits: row.digits,
      point: Number(row.point),
      contractSize: Number(row.contractSize),
      tickSize: Number(row.tickSize),
      tickValue: Number(row.tickValue),
      minLot: Number(row.minLot),
      maxLot: Number(row.maxLot),
      lotStep: Number(row.lotStep),
      stopsLevelPoints: row.stopsLevelPoints,
      freezeLevelPoints: row.freezeLevelPoints,
      commissionPerLot: Number(row.commissionPerLot),
      slippagePoints: row.slippagePoints,
      typicalSpreadPoints: Number(row.typicalSpreadPoints),
      source: row.source,
    };
  }
  return map;
}

export function roundToStep(value: number, step: number, mode: "down" | "nearest" = "down"): number {
  if (!Number.isFinite(value) || step <= 0) return 0;
  const units = value / step;
  const rounded = mode === "down" ? Math.floor(units + 1e-9) : Math.round(units);
  return Number((rounded * step).toFixed(8));
}

export function roundPrice(price: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(price * f) / f;
}

export interface LotSizingInput {
  equity: number;
  riskPct: number;
  entry: number;
  stopLoss: number;
  spec: InstrumentSpec;
}

export interface LotSizingResult {
  lot: number;
  riskAmount: number;
  riskPerLot: number;
  valid: boolean;
  reason?: string;
  minLotRiskPct?: number;
}

/**
 * Position sizing from a fixed risk budget.
 * Returns valid:false when the broker's minimum lot would exceed the permitted
 * risk - in that case the trade MUST be skipped, never rounded up.
 */
export function sizePosition({ equity, riskPct, entry, stopLoss, spec }: LotSizingInput): LotSizingResult {
  const distance = Math.abs(entry - stopLoss);
  const riskAmount = equity * (riskPct / 100);

  if (distance <= 0) {
    return { lot: 0, riskAmount, riskPerLot: 0, valid: false, reason: "Stop loss distance is zero" };
  }
  if (equity <= 0) {
    return { lot: 0, riskAmount, riskPerLot: 0, valid: false, reason: "Account equity is zero" };
  }

  // USD per 1.00 price unit for 1.00 lot. Broker tickValue already includes
  // contract size, so it must NOT be multiplied by contractSize again.
  const valuePerPriceUnit =
    spec.tickSize > 0 && spec.tickValue > 0 ? spec.tickValue / spec.tickSize : spec.contractSize;
  const riskPerLot = distance * valuePerPriceUnit + spec.commissionPerLot;
  const rawLot = riskAmount / riskPerLot;
  const lot = roundToStep(Math.min(rawLot, spec.maxLot), spec.lotStep, "down");
  const minLotRisk = spec.minLot * riskPerLot;
  const minLotRiskPct = (minLotRisk / equity) * 100;

  if (lot < spec.minLot) {
    return {
      lot: 0,
      riskAmount,
      riskPerLot,
      valid: false,
      minLotRiskPct,
      reason: `Minimum lot ${spec.minLot} would risk ${minLotRiskPct.toFixed(3)}% of equity (limit ${riskPct}%). Trade skipped rather than over-risked.`,
    };
  }

  return { lot, riskAmount, riskPerLot, valid: true, minLotRiskPct };
}

export interface ProtectionCheck {
  valid: boolean;
  reason?: string;
  minDistance: number;
}

/** Validate SL/TP against the broker stops level and correct side of the market. */
export function validateProtection(params: {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  spec: InstrumentSpec;
  currentBid?: number;
  currentAsk?: number;
}): ProtectionCheck {
  const { direction, entry, stopLoss, takeProfit, spec } = params;
  const minDistance = spec.stopsLevelPoints * spec.point;
  const slDistance = Math.abs(entry - stopLoss);
  const tpDistance = Math.abs(entry - takeProfit);

  if (!Number.isFinite(stopLoss) || !Number.isFinite(takeProfit) || stopLoss <= 0 || takeProfit <= 0) {
    return { valid: false, reason: "Stop loss and take profit are both required", minDistance };
  }
  if (direction === "BUY" && (stopLoss >= entry || takeProfit <= entry)) {
    return { valid: false, reason: "BUY geometry invalid: SL must be below and TP above entry", minDistance };
  }
  if (direction === "SELL" && (stopLoss <= entry || takeProfit >= entry)) {
    return { valid: false, reason: "SELL geometry invalid: SL must be above and TP below entry", minDistance };
  }
  if (slDistance < minDistance) {
    return {
      valid: false,
      reason: `Stop loss ${slDistance.toFixed(spec.digits)} is inside the broker stops level (${minDistance.toFixed(spec.digits)})`,
      minDistance,
    };
  }
  if (tpDistance < minDistance) {
    return {
      valid: false,
      reason: `Take profit ${tpDistance.toFixed(spec.digits)} is inside the broker stops level (${minDistance.toFixed(spec.digits)})`,
      minDistance,
    };
  }
  return { valid: true, minDistance };
}

export async function updateSpecsFromBroker(
  payload: {
    symbol: string;
    digits?: number;
    point?: number;
    contractSize?: number;
    tickSize?: number;
    tickValue?: number;
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
    stopsLevelPoints?: number;
    freezeLevelPoints?: number;
    commissionPerLot?: number;
    typicalSpreadPoints?: number;
  }[]
) {
  await ensureSymbolSpecs();
  let updated = 0;

  for (const p of payload) {
    if (!p.symbol || !SUPPORTED_SYMBOLS.includes(p.symbol)) continue;
    const base = DEFAULT_SPECS[p.symbol];
    await db
      .update(symbolSpecs)
      .set({
        digits: p.digits ?? base.digits,
        point: (p.point ?? base.point).toString(),
        contractSize: (p.contractSize ?? base.contractSize).toString(),
        tickSize: (p.tickSize ?? base.tickSize).toString(),
        tickValue: (p.tickValue ?? base.tickValue).toString(),
        minLot: (p.minLot ?? base.minLot).toString(),
        maxLot: (p.maxLot ?? base.maxLot).toString(),
        lotStep: (p.lotStep ?? base.lotStep).toString(),
        stopsLevelPoints: p.stopsLevelPoints ?? base.stopsLevelPoints,
        freezeLevelPoints: p.freezeLevelPoints ?? base.freezeLevelPoints,
        commissionPerLot: (p.commissionPerLot ?? base.commissionPerLot).toString(),
        typicalSpreadPoints: (p.typicalSpreadPoints ?? base.typicalSpreadPoints).toString(),
        source: "BROKER",
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(symbolSpecs.symbol, p.symbol));
    updated++;
  }

  if (updated > 0) {
    await db.insert(systemLogs).values({
      level: "INFO",
      source: "Broker Specs",
      message: `Updated ${updated} instrument specification(s) from the MT5 terminal.`,
    });
  }
  return updated;
}

/** Validate a requested lot against broker step/min/max rules. */
export function roundLotSafe(lot: number, spec: InstrumentSpec): { valid: boolean; reason?: string; lot: number } {
  if (!Number.isFinite(lot) || lot <= 0) return { valid: false, reason: "Lot size must be a positive number", lot: 0 };
  if (lot < spec.minLot - 1e-9)
    return { valid: false, reason: `Lot ${lot} is below the broker minimum ${spec.minLot}`, lot: 0 };
  if (lot > spec.maxLot + 1e-9)
    return { valid: false, reason: `Lot ${lot} exceeds the broker maximum ${spec.maxLot}`, lot: 0 };

  const steps = lot / spec.lotStep;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) {
    const corrected = roundToStep(lot, spec.lotStep, "down");
    if (corrected < spec.minLot)
      return { valid: false, reason: `Lot ${lot} is not a multiple of ${spec.lotStep} and rounds below the minimum`, lot: 0 };
    return { valid: true, lot: corrected, reason: `Rounded down to the ${spec.lotStep} volume step` };
  }
  return { valid: true, lot: Number(lot.toFixed(4)) };
}
