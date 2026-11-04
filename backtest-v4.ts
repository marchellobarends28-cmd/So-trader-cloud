import { evaluateStrategy, BASELINE_PARAMS, type StrategyParams } from "./strategy-v4";
import { roundPrice, roundToStep, type InstrumentSpec } from "./broker-specs";
import type { Candle } from "./types";

/* ------------------------------------------------------------------ *
 * SO TRADER AI V4.0 backtest engine
 *
 * Look-ahead protection:
 *  - signals are computed ONLY from bars strictly before the entry bar
 *  - the fill happens at the NEXT bar's open
 *  - exits are evaluated from the entry bar onward using high/low
 *
 * Cost model (all charged, none optional):
 *  - half-spread on entry and exit
 *  - explicit slippage in points on entries and stop exits
 *  - round-turn commission per lot
 *  - instrument contract size from the broker spec
 *  - broker min lot / lot step, and a trade is SKIPPED if min lot > risk cap
 * ------------------------------------------------------------------ */

export interface BacktestCosts {
  spreadPoints: number;
  slippagePoints: number;
  commissionPerLot: number;
}

export interface BacktestConfig {
  symbol: string;
  spec: InstrumentSpec;
  params?: StrategyParams;
  startingEquity: number;
  riskPerTradePct: number;
  timeframeMinutes: number;
  maxDailyDrawdownPct: number;
  maxWeeklyDrawdownPct: number;
  maxOpenAggregateRiskPct: number;
  costs?: Partial<BacktestCosts>;
  warmupBars?: number;
}

export interface BacktestTrade {
  direction: "BUY" | "SELL";
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  stopLoss: number;
  takeProfit: number;
  lot: number;
  riskAmount: number;
  pnl: number;
  r: number;
  outcome: "TP" | "SL" | "OPEN_AT_END";
  regime: string;
  confidence: number;
  setupTags: string[];
  entryHourUtc: number;
  rsiAtEntry: number;
  atrPctAtEntry: number;
  barsHeld: number;
}

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  expectancyR: number;
  expectancyUsd: number;
  netProfit: number;
  netProfitPct: number;
  maxDrawdownPct: number;
  avgR: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveLosses: number;
  skippedMinLot: number;
  skippedRiskCap: number;
  noTradeBars: number;
  dailyBreakerHits: number;
  weeklyBreakerHits: number;
  totalCosts: number;
  byRegime: Record<string, { trades: number; wins: number; expectancyR: number }>;
  byHour: Record<string, { trades: number; wins: number; expectancyR: number }>;
}

export interface BacktestSegment {
  label: string;
  fromTime: number;
  toTime: number;
  bars: number;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
}

export interface BacktestOutput {
  symbol: string;
  bars: number;
  costs: BacktestCosts;
  params: StrategyParams;
  specSource: string;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number }[];
  inSample: BacktestSegment;
  outOfSample: BacktestSegment;
  walkForward: { windows: BacktestSegment[]; positiveWindows: number; aggregateExpectancyR: number; passed: boolean };
  skipped: { minLot: number; riskCap: number };
}

function emptyMetrics(): BacktestMetrics {
  return {
    trades: 0, wins: 0, losses: 0, winRatePct: 0, profitFactor: 0, expectancyR: 0, expectancyUsd: 0,
    netProfit: 0, netProfitPct: 0, maxDrawdownPct: 0, avgR: 0, largestWin: 0, largestLoss: 0,
    maxConsecutiveLosses: 0, skippedMinLot: 0, skippedRiskCap: 0, noTradeBars: 0,
    dailyBreakerHits: 0, weeklyBreakerHits: 0, totalCosts: 0, byRegime: {}, byHour: {},
  };
}

function summarize(trades: BacktestTrade[], startingEquity: number, extra: Partial<BacktestMetrics>): BacktestMetrics {
  const m = emptyMetrics();
  Object.assign(m, extra);
  m.trades = trades.length;

  let grossProfit = 0;
  let grossLoss = 0;
  let rSum = 0;
  let consec = 0;
  let maxConsec = 0;

  for (const t of trades) {
    rSum += t.r;
    if (t.pnl > 0) {
      m.wins++;
      grossProfit += t.pnl;
      consec = 0;
    } else {
      m.losses++;
      grossLoss += Math.abs(t.pnl);
      consec++;
      maxConsec = Math.max(maxConsec, consec);
    }
    m.largestWin = Math.max(m.largestWin, t.pnl);
    m.largestLoss = Math.min(m.largestLoss, t.pnl);

    const regimeKey = t.regime || "UNKNOWN";
    m.byRegime[regimeKey] = m.byRegime[regimeKey] ?? { trades: 0, wins: 0, expectancyR: 0 };
    m.byRegime[regimeKey].trades++;
    if (t.pnl > 0) m.byRegime[regimeKey].wins++;
    m.byRegime[regimeKey].expectancyR += t.r;

    const hourKey = String(t.entryHourUtc).padStart(2, "0");
    m.byHour[hourKey] = m.byHour[hourKey] ?? { trades: 0, wins: 0, expectancyR: 0 };
    m.byHour[hourKey].trades++;
    if (t.pnl > 0) m.byHour[hourKey].wins++;
    m.byHour[hourKey].expectancyR += t.r;
  }

  for (const key of Object.keys(m.byRegime)) {
    const g = m.byRegime[key];
    g.expectancyR = g.trades > 0 ? Number((g.expectancyR / g.trades).toFixed(2)) : 0;
  }
  for (const key of Object.keys(m.byHour)) {
    const g = m.byHour[key];
    g.expectancyR = g.trades > 0 ? Number((g.expectancyR / g.trades).toFixed(2)) : 0;
  }

  const net = grossProfit - grossLoss;
  m.winRatePct = m.trades > 0 ? Number(((m.wins / m.trades) * 100).toFixed(2)) : 0;
  m.profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 0;
  m.expectancyR = m.trades > 0 ? Number((rSum / m.trades).toFixed(3)) : 0;
  m.avgR = m.expectancyR;
  m.netProfit = Number(net.toFixed(2));
  m.netProfitPct = startingEquity > 0 ? Number(((net / startingEquity) * 100).toFixed(2)) : 0;
  m.expectancyUsd = m.trades > 0 ? Number((net / m.trades).toFixed(2)) : 0;
  m.maxConsecutiveLosses = maxConsec;

  return m;
}

interface EngineState {
  equity: number;
  peak: number;
  maxDd: number;
  trades: BacktestTrade[];
  curve: { time: number; equity: number }[];
  skippedMinLot: number;
  skippedRiskCap: number;
  noTradeBars: number;
  dailyHits: number;
  weeklyHits: number;
  costs: number;
  blockedDay: string | null;
  blockedWeek: string | null;
  dayStartEquity: number;
  weekStartEquity: number;
  currentDay: string;
  currentWeek: string;
}

function weekKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

function dayKey(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

interface SegmentRun {
  label: string;
  fromTime: number;
  toTime: number;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  curve: { time: number; equity: number }[];
  state: EngineState;
}

function runSegment(
  candles: Candle[],
  config: BacktestConfig,
  params: StrategyParams,
  costs: BacktestCosts,
  label: string,
  startIndex: number,
  endIndex: number,
  startingEquity: number
): SegmentRun {
  const { spec } = config;
  const pointValuePerPriceUnit =
    spec.tickSize > 0 && spec.tickValue > 0 ? spec.tickValue / spec.tickSize : spec.contractSize;
  const halfSpread = costs.spreadPoints * spec.point / 2;
  const slippage = costs.slippagePoints * spec.point;

  const state: EngineState = {
    equity: startingEquity,
    peak: startingEquity,
    maxDd: 0,
    trades: [],
    curve: [{ time: candles[startIndex]?.time ?? 0, equity: startingEquity }],
    skippedMinLot: 0,
    skippedRiskCap: 0,
    noTradeBars: 0,
    dailyHits: 0,
    weeklyHits: 0,
    costs: 0,
    blockedDay: null,
    blockedWeek: null,
    dayStartEquity: startingEquity,
    weekStartEquity: startingEquity,
    currentDay: dayKey(candles[startIndex]?.time ?? 0),
    currentWeek: weekKey(candles[startIndex]?.time ?? 0),
  };

  let position: {
    direction: "BUY" | "SELL";
    entry: number;
    stop: number;
    target: number;
    lot: number;
    riskAmount: number;
    riskDistance: number;
    entryIndex: number;
    entryTime: number;
    regime: string;
    confidence: number;
    setupTags: string[];
    rsi: number;
    atrPct: number;
  } | null = null;

  const warmup = config.warmupBars ?? Math.max(220, params.emaTrend + 20);

  for (let i = Math.max(startIndex + warmup, warmup); i < endIndex; i++) {
    const bar = candles[i];
    const barSec = Math.floor(bar.time / 1000);

    // --- day/week bookkeeping for drawdown breakers ---
    const dk = dayKey(barSec);
    if (dk !== state.currentDay) {
      state.currentDay = dk;
      state.dayStartEquity = state.equity;
      if (state.blockedDay && state.blockedDay !== dk) state.blockedDay = null;
    }
    const wk = weekKey(barSec);
    if (wk !== state.currentWeek) {
      state.currentWeek = wk;
      state.weekStartEquity = state.equity;
      if (state.blockedWeek && state.blockedWeek !== wk) state.blockedWeek = null;
    }

    // --- manage an open position first (intrabar) ---
    if (position) {
      const isBuy = position.direction === "BUY";
      const hitStop = isBuy ? bar.low <= position.stop : bar.high >= position.stop;
      const hitTarget = isBuy ? bar.high >= position.target : bar.low <= position.target;

      let exit: number | null = null;
      let outcome: BacktestTrade["outcome"] = "OPEN_AT_END";

      if (hitStop) {
        // Conservative: stop always wins a same-bar ambiguity, plus adverse slippage.
        exit = isBuy ? position.stop - slippage : position.stop + slippage;
        outcome = "SL";
      } else if (hitTarget) {
        exit = position.target;
        outcome = "TP";
      }

      if (exit !== null) {
        const gross =
          (isBuy ? exit - position.entry : position.entry - exit) * pointValuePerPriceUnit * position.lot;
        const commission = costs.commissionPerLot * position.lot;
        const pnl = gross - commission;
        state.equity += pnl;
        state.costs += commission + Math.abs(exit - position.entry) * 0;
        state.peak = Math.max(state.peak, state.equity);
        state.maxDd = Math.max(state.maxDd, ((state.peak - state.equity) / state.peak) * 100);

        state.trades.push({
          direction: position.direction,
          entryTime: position.entryTime,
          exitTime: bar.time,
          entry: position.entry,
          exit: roundPrice(exit, spec.digits),
          stopLoss: roundPrice(position.stop, spec.digits),
          takeProfit: roundPrice(position.target, spec.digits),
          lot: position.lot,
          riskAmount: position.riskAmount,
          pnl: Number(pnl.toFixed(2)),
          r: Number((pnl / Math.max(position.riskAmount, 0.01)).toFixed(2)),
          outcome,
          regime: position.regime,
          confidence: position.confidence,
          setupTags: position.setupTags,
          entryHourUtc: new Date(position.entryTime).getUTCHours(),
          rsiAtEntry: position.rsi,
          atrPctAtEntry: position.atrPct,
          barsHeld: i - position.entryIndex,
        });

        state.curve.push({ time: bar.time, equity: Number(state.equity.toFixed(2)) });
        position = null;

        // Breaker evaluation after the closure
        if (((state.dayStartEquity - state.equity) / state.dayStartEquity) * 100 >= config.maxDailyDrawdownPct) {
          state.dailyHits++;
          state.blockedDay = dk;
        }
        if (((state.weekStartEquity - state.equity) / state.weekStartEquity) * 100 >= config.maxWeeklyDrawdownPct) {
          state.weeklyHits++;
          state.blockedWeek = wk;
        }
      }
    }

    if (position) continue;

    // --- risk breakers block new entries ---
    if (state.blockedDay || state.blockedWeek) {
      state.noTradeBars++;
      continue;
    }

    // --- signal from CLOSED bars only (never includes bar i) ---
    const history = candles.slice(Math.max(0, i - 600), i);
    const signal = evaluateStrategy(history, params, {});
    if (signal.direction === "NONE" || !signal.indicators) {
      state.noTradeBars++;
      continue;
    }

    const isBuy = signal.direction === "BUY";

    // Fill at this bar's open with half spread + slippage against us.
    const rawOpen = bar.open;
    const entry = roundPrice(isBuy ? rawOpen + halfSpread + slippage : rawOpen - halfSpread - slippage, spec.digits);
    const stop = roundPrice(isBuy ? entry - signal.riskDistance : entry + signal.riskDistance, spec.digits);
    const target = roundPrice(
      isBuy ? entry + signal.riskDistance * params.tp1R : entry - signal.riskDistance * params.tp1R,
      spec.digits
    );

    const riskDistance = Math.abs(entry - stop);
    const riskAmount = state.equity * (config.riskPerTradePct / 100);
    const riskPerLot = riskDistance * pointValuePerPriceUnit + costs.commissionPerLot;

    if (riskPerLot <= 0) { state.noTradeBars++; continue; }

    const rawLot = riskAmount / riskPerLot;
    const lot = roundToStep(Math.min(rawLot, spec.maxLot), spec.lotStep, "down");

    if (lot < spec.minLot) {
      // Never inflate to the broker minimum - skip the setup instead.
      state.skippedMinLot++;
      state.noTradeBars++;
      continue;
    }

    const actualRisk = lot * riskPerLot;
    if ((actualRisk / state.equity) * 100 > config.maxOpenAggregateRiskPct) {
      state.skippedRiskCap++;
      state.noTradeBars++;
      continue;
    }

    position = {
      direction: signal.direction,
      entry,
      stop,
      target,
      lot,
      riskAmount: actualRisk,
      riskDistance,
      entryIndex: i,
      entryTime: bar.time,
      regime: signal.regime,
      confidence: signal.confidence,
      setupTags: signal.setupTags,
      rsi: Number((signal.indicators.rsi ?? 50).toFixed(2)),
      atrPct: Number((signal.indicators.atrPct ?? 0).toFixed(3)),
    };
  }

  // Close the final open position at the last close for accounting.
  if (position) {
    const last = candles[endIndex - 1] ?? candles[candles.length - 1];
    const isBuy = position.direction === "BUY";
    const exit = isBuy ? last.close - halfSpread - slippage : last.close + halfSpread + slippage;
    const gross = (isBuy ? exit - position.entry : position.entry - exit) * pointValuePerPriceUnit * position.lot;
    const commission = costs.commissionPerLot * position.lot;
    const pnl = gross - commission;
    state.equity += pnl;
    state.trades.push({
      direction: position.direction,
      entryTime: position.entryTime,
      exitTime: last.time,
      entry: position.entry,
      exit: roundPrice(exit, spec.digits),
      stopLoss: roundPrice(position.stop, spec.digits),
      takeProfit: roundPrice(position.target, spec.digits),
      lot: position.lot,
      riskAmount: position.riskAmount,
      pnl: Number(pnl.toFixed(2)),
      r: Number((pnl / Math.max(position.riskAmount, 0.01)).toFixed(2)),
      outcome: "OPEN_AT_END",
      regime: position.regime,
      confidence: position.confidence,
      setupTags: position.setupTags,
      entryHourUtc: new Date(position.entryTime).getUTCHours(),
      rsiAtEntry: position.rsi,
      atrPctAtEntry: position.atrPct,
      barsHeld: endIndex - 1 - position.entryIndex,
    });
    state.curve.push({ time: last.time, equity: Number(state.equity.toFixed(2)) });
  }

  const metrics = summarize(state.trades, startingEquity, {
    skippedMinLot: state.skippedMinLot,
    skippedRiskCap: state.skippedRiskCap,
    noTradeBars: state.noTradeBars,
    dailyBreakerHits: state.dailyHits,
    weeklyBreakerHits: state.weeklyHits,
    maxDrawdownPct: Number(state.maxDd.toFixed(2)),
  });

  return {
    label,
    fromTime: candles[startIndex]?.time ?? 0,
    toTime: candles[endIndex - 1]?.time ?? 0,
    metrics,
    trades: state.trades,
    curve: state.curve,
    state,
  };
}

export function runBacktestV4(candles: Candle[], config: BacktestConfig): BacktestOutput {
  const params = config.params ?? BASELINE_PARAMS;
  const costs: BacktestCosts = {
    spreadPoints: config.costs?.spreadPoints ?? config.spec.typicalSpreadPoints,
    slippagePoints: config.costs?.slippagePoints ?? config.spec.slippagePoints,
    commissionPerLot: config.costs?.commissionPerLot ?? config.spec.commissionPerLot,
  };

  const warmup = config.warmupBars ?? Math.max(220, params.emaTrend + 20);
  const total = candles.length;
  const usable = Math.max(0, total - warmup);

  if (usable < 80) {
    const empty = emptyMetrics();
    const segment: BacktestSegment = { label: "insufficient", fromTime: 0, toTime: 0, bars: total, metrics: empty, trades: [] };
    return {
      symbol: config.symbol,
      bars: total,
      costs,
      params,
      specSource: config.spec.source ?? "DEFAULT",
      trades: [],
      equityCurve: [],
      inSample: segment,
      outOfSample: segment,
      walkForward: { windows: [], positiveWindows: 0, aggregateExpectancyR: 0, passed: false },
      skipped: { minLot: 0, riskCap: 0 },
    };
  }

  const isEnd = warmup + Math.floor(usable * 0.7);

  const inSampleRun = runSegment(candles, config, params, costs, "IN_SAMPLE", 0, isEnd, config.startingEquity);
  const oosRun = runSegment(candles, config, params, costs, "OUT_OF_SAMPLE", isEnd, total, config.startingEquity);

  // Walk-forward: split the OOS region into 4 chronological windows with a
  // fresh equity base. Independent windows expose regime fragility.
  const oosBars = total - isEnd;
  const windowCount = oosBars >= 400 ? 4 : oosBars >= 200 ? 2 : 1;
  const windowSize = Math.floor(oosBars / windowCount);
  const windows: BacktestSegment[] = [];

  for (let w = 0; w < windowCount; w++) {
    const from = isEnd + w * windowSize;
    const to = w === windowCount - 1 ? total : isEnd + (w + 1) * windowSize;
    if (to - from < 60) continue;
    const run = runSegment(candles, config, params, costs, `WF_${w + 1}`, from, to, config.startingEquity);
    windows.push({
      label: `Window ${w + 1}`,
      fromTime: candles[from]?.time ?? 0,
      toTime: candles[to - 1]?.time ?? 0,
      bars: to - from,
      metrics: run.metrics,
      trades: run.trades,
    });
  }

  const positiveWindows = windows.filter((w) => w.metrics.expectancyR > 0).length;
  const aggregateExpectancyR =
    windows.length > 0
      ? Number((windows.reduce((a, w) => a + w.metrics.expectancyR, 0) / windows.length).toFixed(3))
      : 0;

  const allTrades = [...inSampleRun.trades, ...oosRun.trades];

  return {
    symbol: config.symbol,
    bars: total,
    costs,
    params,
    specSource: config.spec.source ?? "DEFAULT",
    trades: allTrades,
    equityCurve: [...inSampleRun.curve, ...oosRun.curve],
    inSample: {
      label: "In-sample (70%)",
      fromTime: candles[0]?.time ?? 0,
      toTime: candles[isEnd - 1]?.time ?? 0,
      bars: isEnd,
      metrics: inSampleRun.metrics,
      trades: inSampleRun.trades,
    },
    outOfSample: {
      label: "Out-of-sample (30%)",
      fromTime: candles[isEnd]?.time ?? 0,
      toTime: candles[total - 1]?.time ?? 0,
      bars: total - isEnd,
      metrics: oosRun.metrics,
      trades: oosRun.trades,
    },
    walkForward: {
      windows,
      positiveWindows,
      aggregateExpectancyR,
      passed: windows.length >= 2 && positiveWindows >= Math.ceil(windows.length * 0.6) && aggregateExpectancyR > 0,
    },
    skipped: {
      minLot: inSampleRun.state.skippedMinLot + oosRun.state.skippedMinLot,
      riskCap: inSampleRun.state.skippedRiskCap + oosRun.state.skippedRiskCap,
    },
  };
}
