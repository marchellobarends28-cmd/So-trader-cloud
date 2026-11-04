import type { Candle } from "./types";

/* ------------------------------------------------------------------ *
 * Deterministic indicator + signal engine.
 * No Math.random() anywhere: every decision is derived from price data,
 * so the same candles always produce the same signal.
 * ------------------------------------------------------------------ */

export interface IndicatorSnapshot {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  atr14: number;
  swingHigh: number;
  swingLow: number;
  lastClose: number;
  lastOpen: number;
  lastHigh: number;
  lastLow: number;
  momentumPct: number;
  volatilityPct: number;
}

export interface SignalConfig {
  riskRewardTp1: number;
  riskRewardTp2: number;
  riskRewardTp3: number;
  atrStopMultiplier: number;
  minConfidence: number;
  maxSpreadPoints: number;
  allowLong: boolean;
  allowShort: boolean;
  sessionUtcHour: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  riskRewardTp1: 2.2,
  riskRewardTp2: 3.4,
  riskRewardTp3: 4.8,
  atrStopMultiplier: 1.5,
  minConfidence: 62,
  maxSpreadPoints: 35,
  allowLong: true,
  allowShort: true,
  sessionUtcHour: 10,
};

export interface SignalResult {
  shouldTrade: boolean;
  direction: "BUY" | "SELL" | "NONE";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskReward: number;
  confidence: number;
  reasons: string[];
  blockers: string[];
  regime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "INSUFFICIENT_DATA";
  indicators: IndicatorSnapshot | null;
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return average(values);
  const k = 2 / (period + 1);
  let prev = average(values.slice(0, period));
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const prevClose = slice[i - 1].close;
    const tr = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - prevClose),
      Math.abs(slice[i].low - prevClose)
    );
    sum += tr;
  }
  return sum / period;
}

export function computeIndicators(candles: Candle[]): IndicatorSnapshot | null {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const recent = candles.slice(-30);
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const swingLow = Math.min(...recent.map((c) => c.low));
  const prior = closes[closes.length - 6] ?? closes[0];
  const atrValue = atr(candles, 14);

  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    atr14: atrValue,
    swingHigh,
    swingLow,
    lastClose: last.close,
    lastOpen: last.open,
    lastHigh: last.high,
    lastLow: last.low,
    momentumPct: prior !== 0 ? ((last.close - prior) / prior) * 100 : 0,
    volatilityPct: last.close !== 0 ? (atrValue / last.close) * 100 : 0,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Trend-pullback continuation model with ATR risk sizing.
 * Returns direction "NONE" whenever the edge is insufficient - the system is
 * explicitly allowed to not trade instead of guessing a direction.
 */
export function evaluateSignal(
  candles: Candle[],
  digits: number,
  spreadPoints: number,
  config: SignalConfig = DEFAULT_SIGNAL_CONFIG,
  requireTradableSession = true
): SignalResult {
  const ind = computeIndicators(candles);
  const empty: SignalResult = {
    shouldTrade: false,
    direction: "NONE",
    entry: 0,
    stopLoss: 0,
    takeProfit1: 0,
    takeProfit2: 0,
    takeProfit3: 0,
    riskReward: 0,
    confidence: 0,
    reasons: [],
    blockers: [],
    regime: "INSUFFICIENT_DATA",
    indicators: ind,
  };

  if (!ind) {
    return { ...empty, blockers: ["Need at least 30 closed candles to evaluate structure"] };
  }

  const reasons: string[] = [];
  const blockers: string[] = [];

  // --- Regime classification (deterministic EMA stack) ---
  const bullStack = ind.ema20 > ind.ema50 && ind.ema50 >= ind.ema200 * 0.999;
  const bearStack = ind.ema20 < ind.ema50 && ind.ema50 <= ind.ema200 * 1.001;
  const emaSpreadPct = ind.lastClose !== 0 ? (Math.abs(ind.ema20 - ind.ema50) / ind.lastClose) * 100 : 0;
  const atrVal = ind.atr14;
  const lastIsBull = ind.lastClose > ind.lastOpen;
  const lastIsBear = ind.lastClose < ind.lastOpen;

  let regime: SignalResult["regime"] = "RANGE";
  if (bullStack && emaSpreadPct > 0.02) regime = "TREND_UP";
  else if (bearStack && emaSpreadPct > 0.02) regime = "TREND_DOWN";

  if (regime === "TREND_UP") reasons.push("EMA20 > EMA50 > EMA200 with separation confirms an uptrend");
  if (regime === "TREND_DOWN") reasons.push("EMA20 < EMA50 < EMA200 with separation confirms a downtrend");
  if (regime === "RANGE") blockers.push("No trend stack: EMAs compressed - range conditions, no continuation edge");

  // --- Volatility & spread guards ---
  if (ind.volatilityPct < 0.015) blockers.push("ATR is compressed - volatility too thin to pay for spread");
  if (spreadPoints > config.maxSpreadPoints) {
    blockers.push(`Spread ${spreadPoints.toFixed(1)} pts exceeds max ${config.maxSpreadPoints} pts`);
  }

  // --- Session guard (London/NY liquidity window) ---
  if (requireTradableSession) {
    const h = config.sessionUtcHour;
    const inSession = (h >= 7 && h < 17) || (h >= 12 && h < 21);
    if (!inSession) blockers.push("Outside London/New York liquidity window");
  }

  let direction: "BUY" | "SELL" | "NONE" = "NONE";
  let confidence = 0;

  // Pullback must be ATR-relative so it works across FX, metals, crypto, indices.
  const nearEma = Math.abs(ind.lastClose - ind.ema20) <= atrVal * 0.5;
  const roomToTarget = (extreme: number) => Math.abs(extreme - ind.lastClose) > atrVal * 0.6;

  if (regime === "TREND_UP" && config.allowLong) {
    const aboveTrend = ind.lastClose > ind.ema50;
    const rsiOk = ind.rsi14 >= 44 && ind.rsi14 <= 66;
    const hasRoom = roomToTarget(ind.swingHigh);
    const momentumOk = ind.momentumPct > -0.15;

    confidence = 54 + (nearEma ? 12 : 0) + (lastIsBull ? 10 : 0) + (rsiOk ? 10 : 0) + (momentumOk ? 4 : 0);
    if (nearEma) reasons.push("Pullback into the EMA20 value area (ATR-relative)");
    if (lastIsBull) reasons.push("Trigger candle closed bullish off the pullback");
    if (rsiOk) reasons.push(`RSI ${ind.rsi14.toFixed(1)} inside 44-66 continuation band`);
    if (hasRoom) reasons.push("Clear room to the recent swing high (no immediate resistance)");

    if (!aboveTrend) blockers.push("Price is below EMA50 - trend not confirmed");
    if (!nearEma) blockers.push("Price extended from EMA20: chasing risk, waiting for a pullback");
    if (!lastIsBull) blockers.push("No bullish trigger candle at the pullback");
    if (!rsiOk) blockers.push(`RSI ${ind.rsi14.toFixed(1)} outside 44-66 band`);
    if (!hasRoom) blockers.push("Resistance too close: less than 0.6 ATR to swing high");

    if (aboveTrend && nearEma && lastIsBull && rsiOk && hasRoom && momentumOk) direction = "BUY";
  } else if (regime === "TREND_DOWN" && config.allowShort) {
    const belowTrend = ind.lastClose < ind.ema50;
    const rsiOk = ind.rsi14 <= 56 && ind.rsi14 >= 34;
    const hasRoom = roomToTarget(ind.swingLow);
    const momentumOk = ind.momentumPct < 0.15;

    confidence = 54 + (nearEma ? 12 : 0) + (lastIsBear ? 10 : 0) + (rsiOk ? 10 : 0) + (momentumOk ? 4 : 0);
    if (nearEma) reasons.push("Rally into the EMA20 value area (ATR-relative)");
    if (lastIsBear) reasons.push("Trigger candle closed bearish off the rally");
    if (rsiOk) reasons.push(`RSI ${ind.rsi14.toFixed(1)} inside 34-56 continuation band`);
    if (hasRoom) reasons.push("Clear room to the recent swing low (no immediate support)");

    if (!belowTrend) blockers.push("Price is above EMA50 - downtrend not confirmed");
    if (!nearEma) blockers.push("Price extended from EMA20: chasing risk, waiting for a pullback");
    if (!lastIsBear) blockers.push("No bearish trigger candle at the rally");
    if (!rsiOk) blockers.push(`RSI ${ind.rsi14.toFixed(1)} outside 34-56 band`);
    if (!hasRoom) blockers.push("Support too close: less than 0.6 ATR to swing low");

    if (belowTrend && nearEma && lastIsBear && rsiOk && hasRoom && momentumOk) direction = "SELL";
  } else if (regime === "TREND_UP" && !config.allowLong) {
    blockers.push("Longs disabled by configuration");
  } else if (regime === "TREND_DOWN" && !config.allowShort) {
    blockers.push("Shorts disabled by configuration");
  }

  if (blockers.length > 0) confidence -= Math.min(25, blockers.length * 6);
  confidence = Math.max(0, Math.min(97, confidence));

  const shouldTrade =
    direction !== "NONE" && confidence >= config.minConfidence && blockers.length === 0;

  if (direction === "NONE" && reasons.length === 0) {
    blockers.push("Model produced no structural edge - standing aside (no forced entry)");
  }

  if (!shouldTrade) {
    return {
      ...empty,
      direction: "NONE",
      confidence,
      reasons,
      blockers,
      regime,
      indicators: ind,
    };
  }

  const entry = ind.lastClose;
  const atrStop = ind.atr14 * config.atrStopMultiplier;
  const structuralStop =
    direction === "BUY"
      ? Math.max(atrStop, Math.abs(entry - ind.swingLow) * 0.9)
      : Math.max(atrStop, Math.abs(ind.swingHigh - entry) * 0.9);

  const risk = Math.max(structuralStop, ind.atr14 * 0.8);
  const stopLoss = direction === "BUY" ? entry - risk : entry + risk;
  const tp = (r: number) => (direction === "BUY" ? entry + risk * r : entry - risk * r);

  return {
    shouldTrade: true,
    direction,
    entry: round(entry, digits),
    stopLoss: round(stopLoss, digits),
    takeProfit1: round(tp(config.riskRewardTp1), digits),
    takeProfit2: round(tp(config.riskRewardTp2), digits),
    takeProfit3: round(tp(config.riskRewardTp3), digits),
    riskReward: config.riskRewardTp1,
    confidence,
    reasons,
    blockers,
    regime,
    indicators: ind,
  };
}

/** Position size from risk budget, tick value aware (contract multiplier configurable). */
export function computeLotSize(params: {
  equity: number;
  riskPct: number;
  riskDistance: number;
  pointValuePerLot: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
}): number {
  const { equity, riskPct, riskDistance, pointValuePerLot, minLot, maxLot, lotStep } = params;
  if (riskDistance <= 0 || pointValuePerLot <= 0) return minLot;
  const riskAmount = equity * (riskPct / 100);
  const raw = riskAmount / (riskDistance * pointValuePerLot);
  const stepped = Math.floor(raw / lotStep) * lotStep;
  return Math.max(minLot, Math.min(maxLot, Number(stepped.toFixed(2))));
}

/** Seeded PRNG so synthetic backtest history is reproducible and clearly labelled. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSyntheticCandles(params: {
  seed: number;
  count: number;
  startPrice: number;
  digits: number;
  volatility: number;
  drift: number;
  intervalMs?: number;
}): Candle[] {
  const rng = mulberry32(params.seed);
  const candles: Candle[] = [];
  let price = params.startPrice;
  const interval = params.intervalMs ?? 15 * 60 * 1000;
  const start = Date.now() - params.count * interval;

  for (let i = 0; i < params.count; i++) {
    const shock = (rng() - 0.5) * 2 * params.volatility;
    const trend = params.drift;
    const open = price;
    const close = Math.max(params.startPrice * 0.4, open * (1 + trend + shock));
    const wick = Math.abs(shock) * open * 0.8 + open * 0.00005;
    const high = Math.max(open, close) + wick * rng();
    const low = Math.min(open, close) - wick * rng();
    candles.push({
      time: start + i * interval,
      open: Number(open.toFixed(params.digits)),
      high: Number(high.toFixed(params.digits)),
      low: Number(low.toFixed(params.digits)),
      close: Number(close.toFixed(params.digits)),
      volume: Math.floor(120 + rng() * 880),
    });
    price = close;
  }
  return candles;
}
