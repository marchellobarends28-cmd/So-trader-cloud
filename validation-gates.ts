import { db } from "@/db";
import {
  backtestRuns,
  dataQualityReports,
  demoForwardRuns,
  riskEvents,
  mt5Commands,
  mt5Accounts,
  trades,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * Automated validation gates. Live trading stays disabled until ALL
 * required gates pass. These are minimums, not proof of profitability.
 * ------------------------------------------------------------------ */

export const VALIDATION_TARGETS = {
  minHistoricalTrades: 300,
  minProfitFactor: 1.25,
  maxDrawdownPct: 10,
  minOutOfSampleExpectancyR: 0.01,
  minDemoDays: 30,
  maxCriticalErrors: 0,
  minSymbolsWithGenuineData: 3,
  minBarsPerSymbol: 300,
};

export interface Gate {
  id: string;
  label: string;
  target: string;
  actual: string;
  passed: boolean;
  required: boolean;
  evidence: string;
}

export interface ValidationReport {
  gates: Gate[];
  passed: boolean;
  blockers: string[];
  liveAllowed: boolean;
  demoRequired: boolean;
  criticalErrors: number;
  demoDaysElapsed: number;
  generatedAt: string;
}

interface StoredBacktestMetrics {
  profitFactor?: number;
  expectancyR?: number;
  maxDrawdownPct?: number;
  trades?: number;
  netProfit?: number;
}

interface StoredEvidence {
  barsSource?: string;
  eligibleForValidation?: boolean;
  inSample?: StoredBacktestMetrics;
  outOfSample?: StoredBacktestMetrics;
  walkForward?: { passed?: boolean; positiveWindows?: number; windows?: unknown[] };
}

export async function computeValidationReport(): Promise<ValidationReport> {
  const gates: Gate[] = [];

  // ---------- 1. Genuine data integrity ----------
  const quality = await db.select().from(dataQualityReports).orderBy(desc(dataQualityReports.createdAt)).limit(120);
  const latestBySymbol = new Map<string, (typeof quality)[number]>();
  for (const q of quality) if (!latestBySymbol.has(q.symbol)) latestBySymbol.set(q.symbol, q);

  const genuine = [...latestBySymbol.values()].filter((q) => q.passed && q.bars >= VALIDATION_TARGETS.minBarsPerSymbol);
  gates.push({
    id: "DATA_INTEGRITY",
    label: "Genuine MT5 data audited",
    target: `≥${VALIDATION_TARGETS.minSymbolsWithGenuineData} symbols, ≥${VALIDATION_TARGETS.minBarsPerSymbol} clean bars each`,
    actual: `${genuine.length} symbol(s) passed integrity audit`,
    passed: genuine.length >= VALIDATION_TARGETS.minSymbolsWithGenuineData,
    required: true,
    evidence:
      genuine.length > 0
        ? genuine.map((g) => `${g.symbol}: ${g.bars} bars, gaps ${g.gaps}, dupes ${g.duplicates}, dev ${g.priceDeviationPct ?? "n/a"}%`).join(" · ")
        : "No genuine MT5 history audited yet - import bars from the EA (SYNC_HISTORY).",
  });

  // ---------- 2. Backtests on genuine data ----------
  const runs = await db.select().from(backtestRuns).orderBy(desc(backtestRuns.createdAt)).limit(200);
  const latestRunBySymbol = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latestRunBySymbol.has(r.symbol)) latestRunBySymbol.set(r.symbol, r);

  const usableRuns = [...latestRunBySymbol.values()].filter((r) => r.barsSource === "MT5_HISTORY");
  const totalTrades = usableRuns.reduce((a, r) => a + r.tradesTaken, 0);
  const avgPf = usableRuns.length
    ? usableRuns.reduce((a, r) => a + Number(r.profitFactor), 0) / usableRuns.length
    : 0;
  const worstDd = usableRuns.length ? Math.max(...usableRuns.map((r) => Number(r.maxDrawdownPct))) : 0;
  const oosExpectancies = usableRuns.map((r) => {
    const ev = (r.metrics ?? {}) as StoredEvidence;
    return Number(ev.outOfSample?.expectancyR ?? 0);
  });
  const avgOos = oosExpectancies.length > 0 ? oosExpectancies.reduce((a, b) => a + b, 0) / oosExpectancies.length : 0;
  const walkForwardPassed = usableRuns.length > 0 && usableRuns.every((r) => Boolean(((r.metrics ?? {}) as StoredEvidence).walkForward?.passed));

  gates.push({
    id: "HISTORICAL_TRADES",
    label: "Historical trade sample",
    target: `≥${VALIDATION_TARGETS.minHistoricalTrades} trades on genuine MT5 data`,
    actual: `${totalTrades} trades across ${usableRuns.length} genuine symbol run(s)`,
    passed: totalTrades >= VALIDATION_TARGETS.minHistoricalTrades,
    required: true,
    evidence: usableRuns.length
      ? usableRuns.map((r) => `${r.symbol} ${r.tradesTaken}t`).join(" · ")
      : "No backtest has been run on genuine MT5_HISTORY bars.",
  });

  gates.push({
    id: "PROFIT_FACTOR",
    label: "Profit factor",
    target: `> ${VALIDATION_TARGETS.minProfitFactor}`,
    actual: `${avgPf.toFixed(2)} (avg of genuine runs)`,
    passed: usableRuns.length > 0 && avgPf > VALIDATION_TARGETS.minProfitFactor,
    required: true,
    evidence: usableRuns.map((r) => `${r.symbol} PF ${r.profitFactor}`).join(" · ") || "No genuine-data runs.",
  });

  gates.push({
    id: "OOS_EXPECTANCY",
    label: "Positive out-of-sample expectancy",
    target: `> ${VALIDATION_TARGETS.minOutOfSampleExpectancyR}R average`,
    actual: `${avgOos.toFixed(3)}R`,
    passed: usableRuns.length > 0 && avgOos > VALIDATION_TARGETS.minOutOfSampleExpectancyR,
    required: true,
    evidence: usableRuns.length
      ? usableRuns.map((r) => `${r.symbol} OOS ${Number(((r.metrics ?? {}) as StoredEvidence).outOfSample?.expectancyR ?? 0).toFixed(2)}R`).join(" · ")
      : "No out-of-sample data.",
  });

  gates.push({
    id: "DRAWDOWN",
    label: "Maximum drawdown",
    target: `< ${VALIDATION_TARGETS.maxDrawdownPct}%`,
    actual: `${worstDd.toFixed(2)}%`,
    passed: usableRuns.length > 0 && worstDd < VALIDATION_TARGETS.maxDrawdownPct,
    required: true,
    evidence: usableRuns.map((r) => `${r.symbol} DD ${r.maxDrawdownPct}%`).join(" · ") || "No genuine-data runs.",
  });

  gates.push({
    id: "WALK_FORWARD",
    label: "Walk-forward consistency",
    target: "≥60% windows positive on every genuine symbol",
    actual: walkForwardPassed ? "All tested symbols passed" : "Not satisfied",
    passed: walkForwardPassed,
    required: true,
    evidence: usableRuns
      .map((r) => `${r.symbol}: ${JSON.stringify(((r.metrics ?? {}) as StoredEvidence).walkForward ?? {})}`)
      .join(" · ") || "No walk-forward data.",
  });

  // ---------- 3. Demo forward test ----------
  const [forward] = await db.select().from(demoForwardRuns).orderBy(desc(demoForwardRuns.startedAt)).limit(1);
  const [account] = await db.select().from(mt5Accounts).limit(1);
  const demoStart = forward ? new Date(forward.startedAt) : null;
  const demoDaysElapsed = demoStart ? Math.floor((Date.now() - demoStart.getTime()) / 86400000) : 0;
  const forwardAccountMatches = Boolean(forward && account && forward.accountNumber === account.accountNumber);
  const validDemoRun = Boolean(forward && forward.isDemo && account?.isDemo && forwardAccountMatches && forward.status !== "FAILED");

  gates.push({
    id: "DEMO_FORWARD",
    label: "Demo forward test",
    target: `≥${VALIDATION_TARGETS.minDemoDays} days on the currently connected demo account`,
    actual: validDemoRun ? `${demoDaysElapsed} day(s) elapsed` : "No valid matching demo-account run",
    passed: Boolean(validDemoRun && demoDaysElapsed >= VALIDATION_TARGETS.minDemoDays),
    required: true,
    evidence: demoStart
      ? `Started ${demoStart.toISOString().slice(0, 10)} on account ${forward?.accountNumber ?? "unknown"}; demo=${Boolean(forward?.isDemo)}; matches current account=${forwardAccountMatches}`
      : "Start the demo forward run from the Validation tab after connecting an MT5 demo account.",
  });

  // ---------- 4. Zero critical errors ----------
  const criticalSince = demoStart ?? new Date(Date.now() - 30 * 86400000);
  const critical = await db
    .select()
    .from(riskEvents)
    .where(and(eq(riskEvents.severity, "CRITICAL"), gte(riskEvents.createdAt, criticalSince)));
  const failedCommands = await db
    .select()
    .from(mt5Commands)
    .where(and(inArray(mt5Commands.status, ["FAILED", "EXPIRED"]), gte(mt5Commands.createdAt, criticalSince)));

  gates.push({
    id: "ZERO_CRITICAL_ERRORS",
    label: "Zero critical execution/risk errors",
    target: "0 critical risk events and 0 failed/expired commands during the demo run",
    actual: `${critical.length} critical risk event(s), ${failedCommands.length} failed/expired command(s)`,
    passed: critical.length === 0 && failedCommands.length === 0,
    required: true,
    evidence:
      critical.length + failedCommands.length === 0
        ? "Clean execution/risk journal for the demo window."
        : [...critical.map((c) => c.type), ...failedCommands.map((f) => `${f.type}:${f.resultText ?? ""}`)].slice(0, 5).join(" · "),
  });

  // ---------- 5. Account identity / demo state ----------
  const brokerFills = demoStart && validDemoRun
    ? await db
        .select()
        .from(trades)
        .where(and(
          eq(trades.isSimulated, false),
          inArray(trades.status, ["CLOSED", "OPEN"]),
          gte(trades.openTime, demoStart),
          isNotNull(trades.externalTicket),
        ))
    : [];

  gates.push({
    id: "BROKER_CONFIRMED_EXECUTION",
    label: "Broker-confirmed executions",
    target: "≥20 broker-acknowledged fills opened during the matching demo run",
    actual: `${brokerFills.length} broker-confirmed trade(s) during this demo run`,
    passed: brokerFills.length >= 20,
    required: true,
    evidence: "Only non-simulated trades with an external broker ticket opened after the current demo run started are counted.",
  });

  gates.push({
    id: "ACCOUNT_DEMO_OR_VALIDATED",
    label: "Demo account or fully validated",
    target: "Demo account, or live account after all gates pass",
    actual: account ? (account.isDemo ? "Demo account" : "LIVE account") : "No account",
    passed: Boolean(account?.isDemo) || gates.every((g) => g.passed),
    required: true,
    evidence: "Demo mode is mandatory until every gate passes.",
  });

  const required = gates.filter((g) => g.required);
  const blockers = required.filter((g) => !g.passed).map((g) => `${g.label}: ${g.actual} (target ${g.target})`);
  const passed = blockers.length === 0;

  return {
    gates,
    passed,
    blockers,
    liveAllowed: passed,
    demoRequired: !passed,
    criticalErrors: critical.length,
    demoDaysElapsed,
    generatedAt: new Date().toISOString(),
  };
}

export async function allGatesPassed(): Promise<{ passed: boolean; blockers: string[] }> {
  const report = await computeValidationReport();
  return { passed: report.passed, blockers: report.blockers };
}

export async function startDemoForwardRun(params: { accountNumber?: string; isDemo: boolean }) {
  await db
    .update(demoForwardRuns)
    .set({ endedAt: new Date(), status: "FAILED", notes: "Superseded by a new run" })
    .where(eq(demoForwardRuns.status, "RUNNING"));

  const [run] = await db
    .insert(demoForwardRuns)
    .values({
      accountNumber: params.accountNumber ?? null,
      isDemo: params.isDemo,
      daysRequired: VALIDATION_TARGETS.minDemoDays,
      status: "RUNNING",
      notes: "Forward test started. Demo mode enforced until all gates pass.",
    })
    .returning();
  return run;
}
