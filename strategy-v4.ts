import { ema, rsi, atr } from "./strategy";
import type { Candle } from "./types";

/* ------------------------------------------------------------------ *
 * DETERMINISTIC trading model (no machine learning).
 * Trend continuation after an ATR-relative pullback, with a trigger
 * candle, RSI regime band and room-to-structure filter.
 * The same function is used by the live council, the backtester and the
 * learning engine so "tested" and "traded" logic can never drift apart.
 * ------------------------------------------------------------------ */

export interface StrategyParams {
  label: string;
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsiPeriod: number;
  rsiLongMin: number;
  rsiLongMax: number;
  rsiShortMin: number;
  rsiShortMax: number;
  pullbackAtr: number;
  triggerRequired: boolean;
  stopAtrMult: number;
  roomAtr: number;
  tp1R: number;
  tp2R: number;
  tp3R: number;
  minConfidence: number;
  allowLong: boolean;
  allowShort: boolean;
}

export const BASELINE_PARAMS: StrategyParams = {
  label: "SOT-4.1 trend-pullback",
  emaFast: 20,
  emaSlow: 50,
  emaTrend: 200,
  rsiPeriod: 14,
  rsiLongMin: 44,
  rsiLongMax: 68,
  rsiShortMin: 32,
  rsiShortMax: 56,
  pullbackAtr: 0.55,
  triggerRequired: true,
  stopAtrMult: 1.5,
  roomAtr: 0.6,
  tp1R: 2.2,
  tp2R: 3.4,
  tp3R: 4.8,
  minConfidence: 62,
  allowLong: true,
  allowShort: true,
};

export interface IndicatorSet {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsi: number;
  atr: number;
  swingHigh: number;
  swingLow: number;
  close: number;
  open: number;
  momentumPct: number;
  atrPct: number;
}

export interface SignalV4 {
  direction: "BUY" | "SELL" | "NONE";
  regime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "INSUFFICIENT_DATA";
  confidence: number;
  referenceEntry: number;
  riskDistance: number;
  tp1R: number;
  tp2R: number;
  tp3R: number;
  reasons: string[];
  blockers: string[];
  setupTags: string[];
  indicators: IndicatorSet | null;
}

export function computeIndicatorSet(candles: Candle[], params: StrategyParams): IndicatorSet | null {
  if (!candles || candles.length < Math.max(params.emaTrend, params.emaSlow) + 5) return null;

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const recent = candles.slice(-30);
  const atrVal = atr(candles, 14);
  const prior = closes[closes.length - 6] ?? closes[0];

  return {
    emaFast: ema(closes, params.emaFast),
    emaSlow: ema(closes, params.emaSlow),
    emaTrend: ema(closes, params.emaTrend),
    rsi: rsi(closes, params.rsiPeriod),
    atr: atrVal,
    swingHigh: Math.max(...recent.map((c) => c.high)),
    swingLow: Math.min(...recent.map((c) => c.low)),
    close: last.close,
    open: last.open,
    momentumPct: prior !== 0 ? ((last.close - prior) / prior) * 100 : 0,
    atrPct: last.close !== 0 ? (atrVal / last.close) * 100 : 0,
  };
}

export function evaluateStrategy(
  candles: Candle[],
  params: StrategyParams = BASELINE_PARAMS,
  options: { checkSession?: boolean; sessionHourUtc?: number; maxSpreadPoints?: number; spreadPoints?: number } = {}
): SignalV4 {
  const ind = computeIndicatorSet(candles, params);

  const base: SignalV4 = {
    direction: "NONE",
    regime: "INSUFFICIENT_DATA",
    confidence: 0,
    referenceEntry: 0,
    riskDistance: 0,
    tp1R: params.tp1R,
    tp2R: params.tp2R,
    tp3R: params.tp3R,
    reasons: [],
    blockers: [],
    setupTags: [],
    indicators: ind,
  };

  if (!ind) {
    return { ...base, blockers: ["Insufficient closed bars for the configured indicator windows"] };
  }
  if (ind.atr <= 0) {
    return { ...base, blockers: ["ATR is zero - unusable volatility for sizing"] };
  }

  const reasons: string[] = [];
  const blockers: string[] = [];
  const setupTags: string[] = [];

  const emaGapPct = ind.close !== 0 ? (Math.abs(ind.emaFast - ind.emaSlow) / ind.close) * 100 : 0;

  let regime: SignalV4["regime"] = "RANGE";
  if (ind.emaFast > ind.emaSlow && ind.emaSlow >= ind.emaTrend * 0.999 && emaGapPct > 0.02) regime = "TREND_UP";
  else if (ind.emaFast < ind.emaSlow && ind.emaSlow <= ind.emaTrend * 1.001 && emaGapPct > 0.02) regime = "TREND_DOWN";

  if (regime === "TREND_UP") { reasons.push("EMA stack up (fast > slow >= trend)"); setupTags.push("REGIME_TREND_UP"); }
  if (regime === "TREND_DOWN") { reasons.push("EMA stack down (fast < slow <= trend)"); setupTags.push("REGIME_TREND_DOWN"); }
  if (regime === "RANGE") blockers.push("EMA stack compressed: no continuation regime");

  if (ind.atrPct < 0.015) blockers.push("ATR% below 0.015 - volatility too thin after costs");

  if (options.checkSession) {
    const h = options.sessionHourUtc ?? new Date().getUTCHours();
    const inSession = (h >= 7 && h < 17) || (h >= 12 && h < 21);
    if (!inSession) blockers.push("Outside London/New York liquidity window");
  }

  if (options.spreadPoints !== undefined && options.maxSpreadPoints !== undefined) {
    if (options.spreadPoints > options.maxSpreadPoints) {
      blockers.push(`Spread ${options.spreadPoints.toFixed(1)}pts exceeds cap ${options.maxSpreadPoints}pts`);
    }
  }

  const lastIsBull = ind.close > ind.open;
  const lastIsBear = ind.close < ind.open;
  const nearEma = Math.abs(ind.close - ind.emaFast) <= ind.atr * params.pullbackAtr;
  const roomUp = ind.swingHigh - ind.close > ind.atr * params.roomAtr;
  const roomDown = ind.close - ind.swingLow > ind.atr * params.roomAtr;

  let direction: SignalV4["direction"] = "NONE";
  let confidence = 0;

  if (regime === "TREND_UP" && params.allowLong) {
    const aboveSlow = ind.close > ind.emaSlow;
    const rsiOk = ind.rsi >= params.rsiLongMin && ind.rsi <= params.rsiLongMax;
    const triggerOk = !params.triggerRequired || lastIsBull;

    confidence = 54 + (nearEma ? 12 : 0) + (triggerOk ? 10 : 0) + (rsiOk ? 10 : 0) + (roomUp ? 4 : 0);

    if (nearEma) { reasons.push("Pullback into fast EMA value area"); setupTags.push("PULLBACK_EMA"); }
    if (triggerOk) { reasons.push("Bullish trigger candle"); setupTags.push("TRIGGER_BULL"); }
    if (rsiOk) reasons.push(`RSI ${ind.rsi.toFixed(1)} inside ${params.rsiLongMin}-${params.rsiLongMax}`);
    if (roomUp) reasons.push("Room to swing high");

    if (!aboveSlow) blockers.push("Close below slow EMA - uptrend unconfirmed");
    if (!nearEma) blockers.push("Price extended from fast EMA (chasing risk)");
    if (!triggerOk) blockers.push("Missing bullish trigger candle");
    if (!rsiOk) blockers.push(`RSI ${ind.rsi.toFixed(1)} outside ${params.rsiLongMin}-${params.rsiLongMax}`);
    if (!roomUp) blockers.push("Resistance closer than room filter");

    if (aboveSlow && nearEma && triggerOk && rsiOk && roomUp) direction = "BUY";
  } else if (regime === "TREND_DOWN" && params.allowShort) {
    const belowSlow = ind.close < ind.emaSlow;
    const rsiOk = ind.rsi >= params.rsiShortMin && ind.rsi <= params.rsiShortMax;
    const triggerOk = !params.triggerRequired || lastIsBear;

    confidence = 54 + (nearEma ? 12 : 0) + (triggerOk ? 10 : 0) + (rsiOk ? 10 : 0) + (roomDown ? 4 : 0);

    if (nearEma) { reasons.push("Rally into fast EMA value area"); setupTags.push("PULLBACK_EMA"); }
    if (triggerOk) { reasons.push("Bearish trigger candle"); setupTags.push("TRIGGER_BEAR"); }
    if (rsiOk) reasons.push(`RSI ${ind.rsi.toFixed(1)} inside ${params.rsiShortMin}-${params.rsiShortMax}`);
    if (roomDown) reasons.push("Room to swing low");

    if (!belowSlow) blockers.push("Close above slow EMA - downtrend unconfirmed");
    if (!nearEma) blockers.push("Price extended from fast EMA (chasing risk)");
    if (!triggerOk) blockers.push("Missing bearish trigger candle");
    if (!rsiOk) blockers.push(`RSI ${ind.rsi.toFixed(1)} outside ${params.rsiShortMin}-${params.rsiShortMax}`);
    if (!roomDown) blockers.push("Support closer than room filter");

    if (belowSlow && nearEma && triggerOk && rsiOk && roomDown) direction = "SELL";
  } else if (regime === "TREND_UP" && !params.allowLong) {
    blockers.push("Long trades disabled in this strategy version");
  } else if (regime === "TREND_DOWN" && !params.allowShort) {
    blockers.push("Short trades disabled in this strategy version");
  }

  if (blockers.length > 0) confidence -= Math.min(24, blockers.length * 6);
  confidence = Math.max(0, Math.min(97, confidence));

  if (direction === "NONE") {
    if (reasons.length === 0) blockers.push("No structural edge - standing aside");
    return { ...base, regime, confidence, reasons, blockers, setupTags, indicators: ind };
  }
  if (confidence < params.minConfidence || blockers.length > 0) {
    return {
      ...base,
      regime,
      confidence,
      reasons,
      blockers: blockers.length > 0 ? blockers : [`Confidence ${confidence} below ${params.minConfidence}`],
      setupTags,
      indicators: ind,
    };
  }

  const riskDistance = Math.max(ind.atr * params.stopAtrMult, ind.atr * 0.8);

  return {
    direction,
    regime,
    confidence,
    referenceEntry: ind.close,
    riskDistance,
    tp1R: params.tp1R,
    tp2R: params.tp2R,
    tp3R: params.tp3R,
    reasons,
    blockers: [],
    setupTags: [...setupTags, `CONF_${Math.round(confidence / 10) * 10}`],
    indicators: ind,
  };
}

/** Clamp parameter mutations from the learning engine into safe bounds. */
export function sanitizeParams(candidate: Partial<StrategyParams>, base: StrategyParams): StrategyParams {
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const merged: StrategyParams = {
    ...base,
    ...candidate,
    label: typeof candidate.label === "string" ? candidate.label : base.label,
    emaFast: Math.round(num(candidate.emaFast, base.emaFast, 5, 60)),
    emaSlow: Math.round(num(candidate.emaSlow, base.emaSlow, 20, 150)),
    emaTrend: Math.round(num(candidate.emaTrend, base.emaTrend, 100, 300)),
    rsiPeriod: Math.round(num(candidate.rsiPeriod, base.rsiPeriod, 7, 21)),
    rsiLongMin: num(candidate.rsiLongMin, base.rsiLongMin, 30, 60),
    rsiLongMax: num(candidate.rsiLongMax, base.rsiLongMax, 55, 85),
    rsiShortMin: num(candidate.rsiShortMin, base.rsiShortMin, 15, 45),
    rsiShortMax: num(candidate.rsiShortMax, base.rsiShortMax, 40, 70),
    pullbackAtr: num(candidate.pullbackAtr, base.pullbackAtr, 0.2, 1.5),
    stopAtrMult: num(candidate.stopAtrMult, base.stopAtrMult, 0.8, 3.5),
    roomAtr: num(candidate.roomAtr, base.roomAtr, 0.2, 2),
    tp1R: num(candidate.tp1R, base.tp1R, 1, 4),
    tp2R: num(candidate.tp2R, base.tp2R, 1.5, 6),
    tp3R: num(candidate.tp3R, base.tp3R, 2, 9),
    minConfidence: Math.round(num(candidate.minConfidence, base.minConfidence, 45, 90)),
    triggerRequired: candidate.triggerRequired ?? base.triggerRequired,
    allowLong: candidate.allowLong ?? base.allowLong,
    allowShort: candidate.allowShort ?? base.allowShort,
  };

  if (merged.emaFast >= merged.emaSlow) merged.emaFast = Math.max(5, merged.emaSlow - 5);
  if (merged.emaSlow >= merged.emaTrend) merged.emaSlow = Math.max(20, merged.emaTrend - 20);
  if (merged.rsiLongMin >= merged.rsiLongMax) merged.rsiLongMax = merged.rsiLongMin + 8;
  if (merged.rsiShortMin >= merged.rsiShortMax) merged.rsiShortMax = merged.rsiShortMin + 8;
  if (merged.tp2R <= merged.tp1R) merged.tp2R = merged.tp1R + 0.5;
  if (merged.tp3R <= merged.tp2R) merged.tp3R = merged.tp2R + 0.8;

  return merged;
}
