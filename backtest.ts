import {
  evaluateSignal,
  DEFAULT_SIGNAL_CONFIG,
  buildSyntheticCandles,
  type SignalConfig,
} from "./strategy";
import type { Candle } from "./types";

export interface BacktestParams {
  symbol: string;
  digits: number;
  candles: Candle[];
  startingEquity: number;
  riskPerTradePct: number;
  spreadPoints: number;
  pointValuePerLot: number;
  commissionPerLot: number;
  config?: SignalConfig;
  warmupBars?: number;
}

export interface BacktestTrade {
  index: number;
  direction: "BUY" | "SELL";
  entry: number;
  exit: number;
  stopLoss: number;
  takeProfit: number;
  lot: number;
  rMultiple: number;
  pnl: number;
  outcome: "TP" | "SL" | "SESSION_END";
  regime: string;
  confidence: number;
  entryTime: number;
  exitTime: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: { index: number; equity: number }[];
  metrics: {
    tradesTaken: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    maxDrawdownPct: number;
    netProfit: number;
    netProfitPct: number;
    expectancyR: number;
    averageR: number;
    largestWin: number;
    largestLoss: number;
    noTradeBars: number;
  };
  passedGate: boolean;
  gateFailures: string[];
}

export const GATE_CRITERIA = {
  minTrades: 30,
  minProfitFactor: 1.25,
  maxDrawdownPct: 12,
  minExpectancyR: 0.05,
};

export function runBacktest(params: BacktestParams): BacktestResult {
  const {
    candles,
    digits,
    startingEquity,
    riskPerTradePct,
    spreadPoints,
    pointValuePerLot,
    commissionPerLot,
    config = DEFAULT_SIGNAL_CONFIG,
    warmupBars = 220,
  } = params;

  const trades: BacktestTrade[] = [];
  const equityCurve: { index: number; equity: number }[] = [{ index: 0, equity: startingEquity }];
  let equity = startingEquity;
  let noTradeBars = 0;
  let peakEquity = startingEquity;
  let maxDrawdownPct = 0;

  let open: {
    direction: "BUY" | "SELL";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lot: number;
    riskDistance: number;
    entryIndex: number;
    entryTime: number;
    regime: string;
    confidence: number;
  } | null = null;

  for (let i = warmupBars; i < candles.length; i++) {
    const bar = candles[i];
    const spreadPrice = spreadPoints * (digits === 2 ? 0.01 : 0.00001);

    // 1. Manage an open position against this bar
    if (open) {
      const hitSl =
        open.direction === "BUY" ? bar.low <= open.stopLoss : bar.high >= open.stopLoss;
      const hitTp =
        open.direction === "BUY" ? bar.high >= open.takeProfit : bar.low <= open.takeProfit;

      let outcome: "TP" | "SL" | null = null;
      let exit = 0;

      // Conservative: if both levels touched in the same bar, assume stop first.
      if (hitSl) {
        outcome = "SL";
        exit = open.stopLoss;
      } else if (hitTp) {
        outcome = "TP";
        exit = open.takeProfit;
      }

      if (outcome) {
        const grossR =
          open.direction === "BUY"
            ? (exit - open.entry) / open.riskDistance
            : (open.entry - exit) / open.riskDistance;
        const pnl = grossR * open.riskDistance * open.lot * pointValuePerLot - open.lot * commissionPerLot;
        equity += pnl;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - equity) / peakEquity) * 100);

        trades.push({
          index: i,
          direction: open.direction,
          entry: open.entry,
          exit,
          stopLoss: open.stopLoss,
          takeProfit: open.takeProfit,
          lot: open.lot,
          rMultiple: grossR,
          pnl,
          outcome,
          regime: open.regime,
          confidence: open.confidence,
          entryTime: open.entryTime,
          exitTime: bar.time,
        });

        equityCurve.push({ index: i, equity: Number(equity.toFixed(2)) });
        open = null;
      }
    }

    // 2. Look for a new setup on the closed history only
    if (!open) {
      const window = candles.slice(Math.max(0, i - 400), i + 1);
      const signal = evaluateSignal(window, digits, spreadPoints, config, false);

      if (signal.shouldTrade && signal.direction !== "NONE") {
        const riskDistance = Math.abs(signal.entry - signal.stopLoss);
        const riskAmount = equity * (riskPerTradePct / 100);
        const lot = Math.max(
          0.01,
          Math.min(5, Number((riskAmount / Math.max(riskDistance * pointValuePerLot, 0.0001)).toFixed(2)))
        );

        open = {
          direction: signal.direction,
          entry: signal.entry + (signal.direction === "BUY" ? spreadPrice : 0),
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit1,
          lot,
          riskDistance,
          entryIndex: i,
          entryTime: bar.time,
          regime: signal.regime,
          confidence: signal.confidence,
        };
      } else {
        noTradeBars++;
      }
    }
  }

  // Mark leftover open trade at final close
  if (open) {
    const last = candles[candles.length - 1];
    const grossR =
      open.direction === "BUY"
        ? (last.close - open.entry) / open.riskDistance
        : (open.entry - last.close) / open.riskDistance;
    const pnl = grossR * open.riskDistance * open.lot * pointValuePerLot - open.lot * commissionPerLot;
    equity += pnl;
    trades.push({
      index: candles.length - 1,
      direction: open.direction,
      entry: open.entry,
      exit: last.close,
      stopLoss: open.stopLoss,
      takeProfit: open.takeProfit,
      lot: open.lot,
      rMultiple: grossR,
      pnl,
      outcome: "SESSION_END",
      regime: open.regime,
      confidence: open.confidence,
      entryTime: open.entryTime,
      exitTime: last.time,
    });
    equityCurve.push({ index: candles.length - 1, equity: Number(equity.toFixed(2)) });
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const netProfit = trades.reduce((a, t) => a + t.pnl, 0);
  const averageR = trades.length > 0 ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0;

  const metrics = {
    tradesTaken: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 0,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    netProfitPct: Number(((netProfit / startingEquity) * 100).toFixed(2)),
    expectancyR: Number(averageR.toFixed(2)),
    averageR: Number(averageR.toFixed(2)),
    largestWin: trades.length ? Number(Math.max(...trades.map((t) => t.pnl)).toFixed(2)) : 0,
    largestLoss: trades.length ? Number(Math.min(...trades.map((t) => t.pnl)).toFixed(2)) : 0,
    noTradeBars,
  };

  const gateFailures: string[] = [];
  if (metrics.tradesTaken < GATE_CRITERIA.minTrades)
    gateFailures.push(`Only ${metrics.tradesTaken} trades (need ≥ ${GATE_CRITERIA.minTrades} for statistical significance)`);
  if (metrics.profitFactor < GATE_CRITERIA.minProfitFactor)
    gateFailures.push(`Profit factor ${metrics.profitFactor} < ${GATE_CRITERIA.minProfitFactor}`);
  if (metrics.maxDrawdownPct > GATE_CRITERIA.maxDrawdownPct)
    gateFailures.push(`Max drawdown ${metrics.maxDrawdownPct}% > ${GATE_CRITERIA.maxDrawdownPct}%`);
  if (metrics.expectancyR < GATE_CRITERIA.minExpectancyR)
    gateFailures.push(`Expectancy ${metrics.expectancyR}R < ${GATE_CRITERIA.minExpectancyR}R`);

  return {
    trades,
    equityCurve,
    metrics,
    passedGate: gateFailures.length === 0,
    gateFailures,
  };
}

export function defaultBacktestCandles(symbol: string, bars = 1500): Candle[] {
  const presets: Record<string, { start: number; volatility: number; digits: number; drift: number }> = {
    EURUSD: { start: 1.085, volatility: 0.0009, digits: 5, drift: 0.00001 },
    GBPUSD: { start: 1.272, volatility: 0.0011, digits: 5, drift: -0.000005 },
    XAUUSD: { start: 2745, volatility: 0.0022, digits: 2, drift: 0.00003 },
    BTCUSD: { start: 94500, volatility: 0.006, digits: 2, drift: 0.00004 },
    US30: { start: 43880, volatility: 0.0018, digits: 1, drift: 0.000008 },
    NAS100: { start: 20875, volatility: 0.0021, digits: 1, drift: 0.00002 },
  };
  const p = presets[symbol] ?? presets.EURUSD;
  const hash = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 7);

  return buildSyntheticCandles({
    seed: 1337 + hash,
    count: bars,
    startPrice: p.start,
    digits: p.digits,
    volatility: p.volatility,
    drift: p.drift,
  });
}
