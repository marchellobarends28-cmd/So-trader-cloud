import { db } from "@/db";
import {
  trades,
  tradeLearnings,
  learningProposals,
  strategyVersions,
  systemLogs,
  systemState,
  symbolSpecs,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { BASELINE_PARAMS, sanitizeParams, type StrategyParams } from "./strategy-v4";
import { runBacktestV4, type BacktestMetrics, type BacktestOutput } from "./backtest-v4";
import { loadBars, loadBarSources, type Timeframe } from "./market-data";
import { getSpecs, ensureSymbolSpecs } from "./broker-specs";
import { getState, setState } from "./risk";

/* ------------------------------------------------------------------ *
 * DETERMINISTIC self-learning engine.
 *
 * It is NOT a neural network. It performs statistical attribution on real
 * closed trades and a bounded parameter search validated on genuinely
 * out-of-sample data. Proposals are never auto-applied.
 * ------------------------------------------------------------------ */

const MIN_TRADES_FOR_PROPOSAL = 300;
const MIN_OOS_TRADES = 40;

export interface ConditionStat {
  key: string;
  trades: number;
  wins: number;
  winRatePct: number;
  expectancyR: number;
}

export interface Mistake {
  code: string;
  label: string;
  occurrences: number;
  expectancyR: number;
  suggestion: string;
}

export interface LearningProgress {
  tradesAnalyzed: number;
  mistakes: Mistake[];
  conditions: {
    byRegime: ConditionStat[];
    byHour: ConditionStat[];
    bySymbol: ConditionStat[];
    bySetup: ConditionStat[];
  };
  proposals: {
    id: number;
    title: string;
    status: string;
    independentSupport: boolean;
    oosExpectancy: number | null;
    baselineOosExpectancy: number | null;
    createdAt: string;
  }[];
  activeVersion: { id: number; label: string; params: StrategyParams; origin: string; approvedAt: string | null } | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
}

function stat(map: Map<string, { trades: number; wins: number; r: number }>, key: string) {
  const bucket = map.get(key) ?? { trades: 0, wins: 0, r: 0 };
  return bucket;
}

function toStats(map: Map<string, { trades: number; wins: number; r: number }>): ConditionStat[] {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      trades: v.trades,
      wins: v.wins,
      winRatePct: v.trades > 0 ? Number(((v.wins / v.trades) * 100).toFixed(1)) : 0,
      expectancyR: v.trades > 0 ? Number((v.r / v.trades).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.trades - a.trades);
}

/** Deterministic attribution for one closed trade. */
export async function analyzeClosedTrade(trade: {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: string | number;
  closePrice: string | number | null;
  stopLoss: string | number;
  pnl: string | number;
  closeReason: string | null;
  lotSize: string | number;
  openTime: Date | string;
  closeTime: Date | string | null;
  isSimulated?: boolean;
}) {
  const existing = await db.select().from(tradeLearnings).where(eq(tradeLearnings.tradeId, trade.id)).limit(1);
  if (existing.length > 0) return existing[0];

  const entry = Number(trade.entryPrice);
  const exit = Number(trade.closePrice ?? trade.entryPrice);
  const stop = Number(trade.stopLoss);
  const pnl = Number(trade.pnl);
  const riskDistance = Math.abs(entry - stop);
  const rMultiple = riskDistance > 0 ? (Number(trade.direction === "BUY" ? exit - entry : entry - exit)) / riskDistance : 0;
  const outcome = pnl > 0.01 ? "WIN" : pnl < -0.01 ? "LOSS" : "BREAKEVEN";
  const openDate = new Date(trade.openTime);
  const closeDate = trade.closeTime ? new Date(trade.closeTime) : null;
  const heldMinutes = closeDate ? Math.round((closeDate.getTime() - openDate.getTime()) / 60000) : null;

  const mistakeTags: string[] = [];
  if (outcome === "LOSS") {
    if (trade.closeReason === "SL_HIT") mistakeTags.push("STOPPED_OUT");
    if (rMultiple < -1.2) mistakeTags.push("EXCESSIVE_LOSS_VS_RISK");
    if (heldMinutes !== null && heldMinutes < 15) mistakeTags.push("ENTERED_TOO_EARLY");
    if (openDate.getUTCHours() >= 21 || openDate.getUTCHours() < 6) mistakeTags.push("OUTSIDE_LIQUIDITY_WINDOW");
  }
  if (outcome === "WIN" && rMultiple < 0.6) mistakeTags.push("CUT_WINNER_SHORT");
  if (!trade.isSimulated && trade.closeReason === "BROKER_REJECTED") mistakeTags.push("BROKER_REJECTED");

  const [row] = await db
    .insert(tradeLearnings)
    .values({
      tradeId: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      regime: null,
      setupTag: trade.closeReason ?? "UNKNOWN",
      riskReward: riskDistance > 0 ? "1.00" : "0",
      outcome,
      rMultiple: rMultiple.toFixed(2),
      pnl: pnl.toFixed(2),
      mistakeTags,
      conditions: {
        heldMinutes,
        openHourUtc: openDate.getUTCHours(),
        closeReason: trade.closeReason,
        isSimulated: trade.isSimulated ?? false,
        rMultiple: Number(rMultiple.toFixed(2)),
      },
    })
    .returning();

  return row;
}

export async function backfillLearnings(): Promise<number> {
  const closed = await db.select().from(trades).where(eq(trades.status, "CLOSED")).limit(500);
  let created = 0;
  for (const t of closed) {
    const exists = await db.select().from(tradeLearnings).where(eq(tradeLearnings.tradeId, t.id)).limit(1);
    if (exists.length > 0) continue;
    await analyzeClosedTrade(t);
    created++;
  }
  return created;
}

export async function getActiveStrategy(): Promise<{ id: number | null; params: StrategyParams; origin: string; approvedAt: string | null; label: string }> {
  const [active] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.status, "ACTIVE"))
    .orderBy(desc(strategyVersions.approvedAt))
    .limit(1);

  if (!active) {
    const seeded = await ensureBaselineVersion();
    return { id: seeded.id, params: BASELINE_PARAMS, origin: "BASELINE", approvedAt: null, label: BASELINE_PARAMS.label };
  }

  return {
    id: active.id,
    params: sanitizeParams(active.params as Partial<StrategyParams>, BASELINE_PARAMS),
    origin: active.origin,
    approvedAt: active.approvedAt ? new Date(active.approvedAt).toISOString() : null,
    label: active.label,
  };
}

export async function ensureBaselineVersion() {
  const [existing] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.status, "ACTIVE"))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(strategyVersions)
    .values({
      label: BASELINE_PARAMS.label,
      params: BASELINE_PARAMS,
      status: "ACTIVE",
      origin: "BASELINE",
      notes: "Baseline deterministic trend-pullback model. Not machine learning.",
    })
    .returning();
  return created;
}

function metricsSummary(m: BacktestMetrics) {
  return {
    trades: m.trades,
    winRatePct: m.winRatePct,
    profitFactor: m.profitFactor,
    expectancyR: m.expectancyR,
    maxDrawdownPct: m.maxDrawdownPct,
    netProfit: m.netProfit,
    skippedMinLot: m.skippedMinLot,
  };
}

interface Variant {
  key: string;
  title: string;
  patch: Partial<StrategyParams>;
  hypothesis: string;
}

function buildVariants(baseline: StrategyParams, stats: { byRegime: ConditionStat[]; byHour: ConditionStat[] }): Variant[] {
  const variants: Variant[] = [
    {
      key: "TIGHTER_PULLBACK",
      title: "Tighter pullback entry (0.35 ATR)",
      patch: { pullbackAtr: Math.max(0.2, baseline.pullbackAtr - 0.2) },
      hypothesis: "Late entries chase price; demanding a deeper pullback should improve average R.",
    },
    {
      key: "WIDER_STOP",
      title: `Wider structural stop (${(baseline.stopAtrMult + 0.4).toFixed(1)} ATR)`,
      patch: { stopAtrMult: baseline.stopAtrMult + 0.4 },
      hypothesis: "If losses cluster at the stop, the buffer is too tight for current volatility.",
    },
    {
      key: "TIGHTER_STOP",
      title: `Tighter stop (${(baseline.stopAtrMult - 0.3).toFixed(1)} ATR)`,
      patch: { stopAtrMult: Math.max(0.8, baseline.stopAtrMult - 0.3) },
      hypothesis: "Smaller risk distance allows more size for the same risk budget.",
    },
    {
      key: "HIGHER_CONFIDENCE",
      title: "Higher conviction filter (confidence ≥ 72)",
      patch: { minConfidence: Math.min(90, baseline.minConfidence + 10) },
      hypothesis: "Filtering weaker signals should lift expectancy even if trade count drops.",
    },
    {
      key: "TREND_ONLY_LONG",
      title: "Long-only in trending regimes",
      patch: { allowShort: false },
      hypothesis: "Shorting pullbacks underperforms in a structurally bullish sample.",
    },
    {
      key: "TARGET_2R",
      title: "Faster 2.0R first target",
      patch: { tp1R: 2.0, tp2R: 3.0, tp3R: 4.0 },
      hypothesis: "A nearer target raises hit rate; only worth it if expectancy rises.",
    },
  ];

  // Data-driven variant: if short trades underperform, test disabling them.
  const trendDown = stats.byRegime.find((r) => r.key === "TREND_DOWN");
  if (trendDown && trendDown.trades >= 30 && trendDown.expectancyR < 0) {
    variants.push({
      key: "DISABLE_SHORTS_OBSERVED",
      title: "Disable shorts (observed negative expectancy)",
      patch: { allowShort: false },
      hypothesis: `Live/backtest TREND_DOWN trades show ${trendDown.expectancyR}R expectancy over ${trendDown.trades} samples.`,
    });
  }

  const badHour = stats.byHour.filter((h) => h.trades >= 20 && h.expectancyR < -0.1);
  if (badHour.length > 0) {
    variants.push({
      key: "RAISE_CONFIDENCE_FOR_WEAK_HOURS",
      title: "Raise conviction after weak-hour evidence",
      patch: { minConfidence: Math.min(90, baseline.minConfidence + 6) },
      hypothesis: `Hours ${badHour.map((h) => h.key).join(", ")} show negative expectancy in the sample.`,
    });
  }

  return variants;
}

async function backtestSymbol(symbol: string, params: StrategyParams): Promise<BacktestOutput | null> {
  await ensureSymbolSpecs();
  const spec = await getSpecs(symbol);
  const bars = await loadBars(symbol, "M15" as Timeframe, 5000);
  if (bars.length < 500) return null;
  const source = await loadBarSources(symbol, "M15" as Timeframe);
  if (source !== "MT5_HISTORY") return null;

  return runBacktestV4(bars, {
    symbol,
    spec,
    params,
    startingEquity: 10000,
    riskPerTradePct: 0.5,
    timeframeMinutes: 15,
    maxDailyDrawdownPct: 2,
    maxWeeklyDrawdownPct: 4,
    maxOpenAggregateRiskPct: 1,
  });
}

export interface LearningRunResult {
  ran: boolean;
  reason?: string;
  symbolsUsed: string[];
  tradesAnalyzed: number;
  baseline: { aggregateOosExpectancy: number; aggregateInSampleTrades: number; aggregateOosTrades: number } | null;
  tested: { variant: string; oosExpectancy: number; oosPf: number; walkForwardPassed: boolean; accepted: boolean }[];
  proposalsCreated: number;
}

/**
 * Full learning cycle. Candidate parameters are accepted ONLY when:
 *  - ≥300 in-sample trades across all tested symbols
 *  - ≥40 out-of-sample trades per symbol set
 *  - OOS expectancy > 0 AND OOS expectancy > baseline OOS expectancy
 *  - OOS profit factor > 1.05
 *  - walk-forward windows majority positive
 * Results are persisted as PENDING proposals - never auto-applied.
 */
export async function runLearningCycle(): Promise<LearningRunResult> {
  await ensureSymbolSpecs();
  const analyzed = await backfillLearnings();
  const { params: baseline } = await getActiveStrategy();

  const specs = await db.select().from(symbolSpecs);
  const symbols = specs.map((s) => s.symbol);

  const perSymbolBaseline: { symbol: string; run: BacktestOutput }[] = [];
  for (const symbol of symbols) {
    const run = await backtestSymbol(symbol, baseline);
    if (run) perSymbolBaseline.push({ symbol, run });
  }

  if (perSymbolBaseline.length === 0) {
    const summary = "Learning cycle skipped: no genuine MT5_HISTORY bars stored. Import history from the EA first.";
    await setState("learning_last_run", { at: new Date().toISOString(), summary, ran: false });
    await db.insert(systemLogs).values({ level: "WARN", source: "Learning Engine", message: summary });
    return { ran: false, reason: summary, symbolsUsed: [], tradesAnalyzed: analyzed, baseline: null, tested: [], proposalsCreated: 0 };
  }

  const baselineOosAgg = average(perSymbolBaseline.map((s) => s.run.outOfSample.metrics.expectancyR));
  const baselineTradesIn = perSymbolBaseline.reduce((a, s) => a + s.run.inSample.metrics.trades, 0);
  const baselineTradesOut = perSymbolBaseline.reduce((a, s) => a + s.run.outOfSample.metrics.trades, 0);

  // Aggregate observed conditions for hypothesis generation.
  const learnings = await db.select().from(tradeLearnings);
  const regimeMap = new Map<string, { trades: number; wins: number; r: number }>();
  const hourMap = new Map<string, { trades: number; wins: number; r: number }>();
  for (const l of learnings) {
    const r = Number(l.rMultiple ?? 0);
    const regime = l.regime ?? "UNCLASSIFIED";
    const b1 = stat(regimeMap, regime);
    regimeMap.set(regime, { trades: b1.trades + 1, wins: b1.wins + (r > 0 ? 1 : 0), r: b1.r + r });
    const hour = String((l.conditions as { openHourUtc?: number })?.openHourUtc ?? 0).padStart(2, "0");
    const b2 = stat(hourMap, hour);
    hourMap.set(hour, { trades: b2.trades + 1, wins: b2.wins + (r > 0 ? 1 : 0), r: b2.r + r });
  }

  const variants = buildVariants(baseline, { byRegime: toStats(regimeMap), byHour: toStats(hourMap) });
  const tested: LearningRunResult["tested"] = [];
  let proposalsCreated = 0;

  for (const variant of variants) {
    const candidate = sanitizeParams({ ...baseline, ...variant.patch }, baseline);
    const results: { symbol: string; run: BacktestOutput }[] = [];
    for (const symbol of symbols) {
      const run = await backtestSymbol(symbol, candidate);
      if (run) results.push({ symbol, run });
    }
    if (results.length === 0) continue;

    const oosExpectancy = average(results.map((r) => r.run.outOfSample.metrics.expectancyR));
    const oosPf = average(results.map((r) => r.run.outOfSample.metrics.profitFactor));
    const oosTrades = results.reduce((a, r) => a + r.run.outOfSample.metrics.trades, 0);
    const allWalkForwardPassed = results.every((r) => r.run.walkForward.passed);
    const positiveEverySymbol = results.every((r) => r.run.outOfSample.metrics.expectancyR > 0);

    const accepted =
      baselineTradesIn >= MIN_TRADES_FOR_PROPOSAL &&
      oosTrades >= MIN_OOS_TRADES &&
      positiveEverySymbol &&
      oosExpectancy > baselineOosAgg &&
      oosPf > 1.05 &&
      allWalkForwardPassed;

    tested.push({
      variant: variant.key,
      oosExpectancy: Number(oosExpectancy.toFixed(3)),
      oosPf: Number(oosPf.toFixed(2)),
      walkForwardPassed: allWalkForwardPassed,
      accepted,
    });

    if (accepted) {
      const evidence = {
        baselineOosExpectancy: Number(baselineOosAgg.toFixed(3)),
        candidateOosExpectancy: Number(oosExpectancy.toFixed(3)),
        candidateOosProfitFactor: Number(oosPf.toFixed(2)),
        oosTrades,
        inSampleTrades: baselineTradesIn,
        symbols: results.map((r) => ({
          symbol: r.symbol,
          oosExpectancy: r.run.outOfSample.metrics.expectancyR,
          oosTrades: r.run.outOfSample.metrics.trades,
          walkForward: r.run.walkForward.positiveWindows + "/" + r.run.walkForward.windows.length,
        })),
        criteria: {
          minInSampleTrades: MIN_TRADES_FOR_PROPOSAL,
          minOosTrades: MIN_OOS_TRADES,
          requiredOosExpectancy: "> 0 and > baseline",
          requiredOosPf: "> 1.05",
          walkForward: "≥60% windows positive",
        },
        generatedAt: new Date().toISOString(),
      };

      const existing = await db
        .select()
        .from(learningProposals)
        .where(and(eq(learningProposals.title, variant.title), eq(learningProposals.status, "PENDING")))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(learningProposals).values({
          title: variant.title,
          hypothesis: variant.hypothesis,
          rationale: `Out-of-sample expectancy improved from ${baselineOosAgg.toFixed(3)}R to ${oosExpectancy.toFixed(3)}R across ${results.length} symbol(s) with ${oosTrades} OOS trades.`,
          changes: variant.patch,
          evidence,
          independentSupport: true,
          status: "PENDING",
        });
        proposalsCreated++;
      }
    }
  }

  const summary = `${tested.length} parameter variants evaluated on ${perSymbolBaseline.length} symbol(s); ${proposalsCreated} new proposal(s) retained for approval.`;
  await setState("learning_last_run", { at: new Date().toISOString(), summary, ran: true });
  await db.insert(systemLogs).values({ level: "INFO", source: "Learning Engine", message: summary });

  return {
    ran: true,
    symbolsUsed: perSymbolBaseline.map((s) => s.symbol),
    tradesAnalyzed: analyzed,
    baseline: {
      aggregateOosExpectancy: Number(baselineOosAgg.toFixed(3)),
      aggregateInSampleTrades: baselineTradesIn,
      aggregateOosTrades: baselineTradesOut,
    },
    tested,
    proposalsCreated,
  };
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Apply an approved proposal: promotes a new ACTIVE strategy version. */
export async function applyProposal(id: number, reviewedBy: string) {
  const [proposal] = await db.select().from(learningProposals).where(eq(learningProposals.id, id)).limit(1);
  if (!proposal) throw new Error("Proposal not found");
  if (!proposal.independentSupport) throw new Error("Proposal lacks independent out-of-sample support");
  if (proposal.status === "APPLIED") throw new Error("Proposal already applied");

  const { params } = await getActiveStrategy();
  const nextParams = sanitizeParams({ ...params, ...(proposal.changes as Partial<StrategyParams>) }, params);
  nextParams.label = `SOT-4.${Date.now().toString().slice(-2)} ${proposal.title.slice(0, 28)}`;

  await db.update(strategyVersions).set({ status: "RETIRED" }).where(eq(strategyVersions.status, "ACTIVE"));

  const [version] = await db
    .insert(strategyVersions)
    .values({
      label: nextParams.label,
      params: nextParams,
      status: "ACTIVE",
      origin: "LEARNING",
      outOfSample: (proposal.evidence as Record<string, unknown>) ?? {},
      approvedBy: reviewedBy,
      approvedAt: new Date(),
      notes: proposal.hypothesis,
    })
    .returning();

  await db
    .update(learningProposals)
    .set({ status: "APPLIED", reviewedBy, reviewedAt: new Date(), appliedVersionId: version.id })
    .where(eq(learningProposals.id, id));

  await db.insert(systemLogs).values({
    level: "INFO",
    source: "Learning Engine",
    message: `Proposal #${id} approved by ${reviewedBy}; strategy version ${nextParams.label} is now active.`,
  });

  return version;
}

export async function rejectProposal(id: number, reviewedBy: string) {
  await db
    .update(learningProposals)
    .set({ status: "REJECTED", reviewedBy, reviewedAt: new Date() })
    .where(eq(learningProposals.id, id));
  await db.insert(systemLogs).values({
    level: "INFO",
    source: "Learning Engine",
    message: `Proposal #${id} rejected by ${reviewedBy}. Active strategy unchanged.`,
  });
}

export async function getLearningProgress(): Promise<LearningProgress> {
  const learnings = await db.select().from(tradeLearnings);
  const proposals = await db.select().from(learningProposals).orderBy(desc(learningProposals.createdAt)).limit(12);
  const active = await getActiveStrategy();
  const lastRun = await getState<{ at?: string; summary?: string }>("learning_last_run", {});

  const regimeMap = new Map<string, { trades: number; wins: number; r: number }>();
  const hourMap = new Map<string, { trades: number; wins: number; r: number }>();
  const symbolMap = new Map<string, { trades: number; wins: number; r: number }>();
  const setupMap = new Map<string, { trades: number; wins: number; r: number }>();
  const mistakeCounts = new Map<string, { count: number; r: number }>();

  for (const l of learnings) {
    const r = Number(l.rMultiple ?? 0);
    const condition = (l.conditions as Record<string, unknown>) ?? {};
    const regime = l.regime ?? "UNCLASSIFIED";
    const hour = String(condition.openHourUtc ?? 0).padStart(2, "0");
    const setup = l.setupTag ?? "UNKNOWN";

    for (const [map, key] of [
      [regimeMap, regime],
      [hourMap, hour],
      [symbolMap, l.symbol],
      [setupMap, setup],
    ] as const) {
      const b = stat(map, key);
      map.set(key, { trades: b.trades + 1, wins: b.wins + (r > 0 ? 1 : 0), r: b.r + r });
    }

    for (const tag of (l.mistakeTags as string[]) ?? []) {
      const c = mistakeCounts.get(tag) ?? { count: 0, r: 0 };
      mistakeCounts.set(tag, { count: c.count + 1, r: c.r + r });
    }
  }

  const mistakeLabels: Record<string, { label: string; suggestion: string }> = {
    STOPPED_OUT: { label: "Stopped out", suggestion: "Review stop distance versus ATR and structure." },
    EXCESSIVE_LOSS_VS_RISK: { label: "Loss exceeded 1R", suggestion: "Slippage or gap risk is eating the stop - reduce size around news." },
    ENTERED_TOO_EARLY: { label: "Closed within 15 minutes", suggestion: "Entries may be premature or stops too tight for the timeframe." },
    OUTSIDE_LIQUIDITY_WINDOW: { label: "Traded outside London/NY", suggestion: "Restrict the session filter to liquid hours." },
    CUT_WINNER_SHORT: { label: "Winner cut below 0.6R", suggestion: "Targets or trailing stops may be too tight." },
    BROKER_REJECTED: { label: "Broker rejected the order", suggestion: "Check stops level, lot step, margin and symbol trading mode." },
  };

  const mistakes: Mistake[] = [...mistakeCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([code, v]) => ({
      code,
      label: mistakeLabels[code]?.label ?? code,
      occurrences: v.count,
      expectancyR: Number((v.r / Math.max(v.count, 1)).toFixed(2)),
      suggestion: mistakeLabels[code]?.suggestion ?? "Investigate this pattern.",
    }));

  return {
    tradesAnalyzed: learnings.length,
    mistakes,
    conditions: {
      byRegime: toStats(regimeMap),
      byHour: toStats(hourMap),
      bySymbol: toStats(symbolMap),
      bySetup: toStats(setupMap),
    },
    proposals: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      independentSupport: p.independentSupport,
      oosExpectancy:
        typeof (p.evidence as { candidateOosExpectancy?: number })?.candidateOosExpectancy === "number"
          ? (p.evidence as { candidateOosExpectancy: number }).candidateOosExpectancy
          : null,
      baselineOosExpectancy:
        typeof (p.evidence as { baselineOosExpectancy?: number })?.baselineOosExpectancy === "number"
          ? (p.evidence as { baselineOosExpectancy: number }).baselineOosExpectancy
          : null,
      createdAt: new Date(p.createdAt).toISOString(),
    })),
    activeVersion: {
      id: active.id ?? 0,
      label: active.label,
      params: active.params,
      origin: active.origin,
      approvedAt: active.approvedAt,
    },
    lastRunAt: lastRun.at ?? null,
    lastRunSummary: lastRun.summary ?? null,
  };
}
