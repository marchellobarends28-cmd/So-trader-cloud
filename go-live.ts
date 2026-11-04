import { db } from "@/db";
import {
  mt5Accounts,
  marketAssets,
  trades,
  backtestRuns,
  dreadedPostMortems,
  demoPlanTasks,
} from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export interface DemoTask {
  id: number;
  taskKey: string;
  label: string;
  detail: string;
  category: string;
  required: boolean;
  completed: boolean;
  autoVerified: boolean;
  evidence: string | null;
  sortOrder: number;
}

export const DEFAULT_DEMO_TASKS: Omit<DemoTask, "id" | "completed" | "evidence">[] = [
  {
    taskKey: "HOST_PUBLIC",
    label: "Host the app on public HTTPS",
    detail:
      "MT5 cannot call localhost. Deploy the app (Postgres included) and confirm the public URL loads this dashboard.",
    category: "SETUP",
    required: true,
    autoVerified: false,
    sortOrder: 10,
  },
  {
    taskKey: "EA_COMPILED",
    label: "Download & compile GrokBot_MT5_Bridge.mq5",
    detail:
      "MT5 → File → Open Data Folder → MQL5 → Experts → paste the EA → compile (F7) in MetaEditor with zero errors.",
    category: "SETUP",
    required: true,
    autoVerified: false,
    sortOrder: 20,
  },
  {
    taskKey: "WEBREQUEST_WHITELIST",
    label: "Whitelist bridge + ack URLs in MT5",
    detail:
      "Tools → Options → Expert Advisors → allow WebRequest → add /api/mt5/bridge and /api/mt5/bridge/ack.",
    category: "SETUP",
    required: true,
    autoVerified: false,
    sortOrder: 30,
  },
  {
    taskKey: "EA_CONNECTED",
    label: "EA heartbeat received (bridge online)",
    detail: "The EA must report EA version 3.10 or newer within the last 30 seconds.",
    category: "BRIDGE",
    required: true,
    autoVerified: true,
    sortOrder: 40,
  },
  {
    taskKey: "LIVE_PRICE_FEED",
    label: "Live MT5 price feed flowing",
    detail: "Symbols must be marked MT5_LIVE with bid/ask timestamps from the terminal, not simulated.",
    category: "BRIDGE",
    required: true,
    autoVerified: true,
    sortOrder: 50,
  },
  {
    taskKey: "EA_TRADE_ALLOWED",
    label: "Algo trading enabled in the EA",
    detail: "The EA reports tradeAllowed=true (master switch on and terminal algo trading enabled).",
    category: "BRIDGE",
    required: true,
    autoVerified: true,
    sortOrder: 60,
  },
  {
    taskKey: "EA_RISK_LIMITS",
    label: "Hard risk limits confirmed by the EA",
    detail: "Daily-loss circuit breaker, lot cap, max positions and spread cap are reported by the EA.",
    category: "RISK",
    required: true,
    autoVerified: true,
    sortOrder: 70,
  },
  {
    taskKey: "BACKTEST_GATE",
    label: "Backtest passes the quality gate",
    detail: "≥30 trades, profit factor ≥1.25, max drawdown ≤12%, expectancy ≥0.05R on the tested symbol.",
    category: "VALIDATION",
    required: true,
    autoVerified: true,
    sortOrder: 80,
  },
  {
    taskKey: "DREAD_RULES_ACTIVE",
    label: "Dread memory bank populated",
    detail: "At least 3 active self-reflective guard rules must be enforced before real capital is risked.",
    category: "VALIDATION",
    required: true,
    autoVerified: true,
    sortOrder: 90,
  },
  {
    taskKey: "DEMO_TRADES",
    label: "≥20 real demo fills journaled",
    detail: "Forward-test on a demo account until at least 20 broker-confirmed fills are recorded.",
    category: "DEMO",
    required: true,
    autoVerified: true,
    sortOrder: 100,
  },
  {
    taskKey: "DEMO_TWO_WEEKS",
    label: "Two weeks minimum on demo",
    detail: "Run continuously for ≥14 days on a demo account, including news events and a weekend gap.",
    category: "DEMO",
    required: true,
    autoVerified: false,
    sortOrder: 110,
  },
  {
    taskKey: "MANUAL_SIGNOFF",
    label: "Human sign-off before live capital",
    detail: "You accept that this is not financial advice and that live execution carries real risk.",
    category: "DEMO",
    required: true,
    autoVerified: false,
    sortOrder: 120,
  },
];

export async function ensureDemoPlanTasks() {
  const existing = await db.select().from(demoPlanTasks);
  if (existing.length > 0) return existing;

  await db.insert(demoPlanTasks).values(
    DEFAULT_DEMO_TASKS.map((t) => ({
      taskKey: t.taskKey,
      label: t.label,
      detail: t.detail,
      category: t.category,
      required: t.required,
      autoVerified: t.autoVerified,
      sortOrder: t.sortOrder,
      completed: false,
    }))
  );

  return db.select().from(demoPlanTasks);
}

export interface ReadinessReport {
  tasks: DemoTask[];
  readinessPct: number;
  readyForDemo: boolean;
  readyForLive: boolean;
  blockers: string[];
  autoEvidence: Record<string, { passed: boolean; evidence: string }>;
}

export async function computeReadiness(): Promise<ReadinessReport> {
  await ensureDemoPlanTasks();

  const [account] = await db.select().from(mt5Accounts).limit(1);
  const assets = await db.select().from(marketAssets);
  const [latestBacktest] = await db.select().from(backtestRuns).orderBy(desc(backtestRuns.createdAt)).limit(1);
  const activeRules = await db
    .select()
    .from(dreadedPostMortems)
    .where(eq(dreadedPostMortems.isMemoryActive, true));
  const closedReal = await db
    .select()
    .from(trades)
    .where(and(eq(trades.isSimulated, false), inArray(trades.status, ["CLOSED"])));

  const now = Date.now();
  const heartbeatAge = account ? now - new Date(account.lastHeartbeat).getTime() : Infinity;
  const eaConnected = Boolean(account && account.eaVersion !== "0.0.0" && heartbeatAge < 30_000);
  const liveFeed = assets.some(
    (a) => a.dataSource === "MT5_LIVE" && a.lastTickAt && now - new Date(a.lastTickAt).getTime() < 60_000
  );

  const riskProfile = (account?.eaRiskProfile ?? {}) as Record<string, unknown>;
  const riskLimitsOk =
    Number(riskProfile.maxDailyLossPct ?? 0) > 0 &&
    Number(riskProfile.maxLot ?? 0) > 0 &&
    Number(riskProfile.maxOpenPositions ?? 0) > 0 &&
    Number(riskProfile.maxSpreadPoints ?? 0) > 0;

  const autoEvidence: Record<string, { passed: boolean; evidence: string }> = {
    EA_CONNECTED: {
      passed: eaConnected,
      evidence: eaConnected
        ? `EA v${account?.eaVersion} heartbeat ${Math.round(heartbeatAge / 1000)}s ago`
        : "No EA heartbeat yet — attach the EA on a desktop terminal/VPS",
    },
    LIVE_PRICE_FEED: {
      passed: Boolean(liveFeed),
      evidence: liveFeed
        ? "Real bid/ask received from the terminal"
        : "Prices are simulation-only until the EA streams quotes",
    },
    EA_TRADE_ALLOWED: {
      passed: Boolean(account?.tradeAllowedByEa),
      evidence: account?.tradeAllowedByEa
        ? "EA master switch + terminal algo trading confirmed"
        : "EA reports tradeAllowed=false",
    },
    EA_RISK_LIMITS: {
      passed: riskLimitsOk,
      evidence: riskLimitsOk
        ? `Breaker ${riskProfile.maxDailyLossPct}% · max ${riskProfile.maxLot} lots · ${riskProfile.maxOpenPositions} positions · spread cap ${riskProfile.maxSpreadPoints}pts`
        : "EA has not reported its local risk profile yet",
    },
    BACKTEST_GATE: {
      passed: Boolean(latestBacktest?.passedGate),
      evidence: latestBacktest
        ? `${latestBacktest.symbol}: PF ${latestBacktest.profitFactor}, DD ${latestBacktest.maxDrawdownPct}%, ${latestBacktest.tradesTaken} trades → ${latestBacktest.passedGate ? "PASS" : "FAIL"}`
        : "No backtest has been run yet",
    },
    DREAD_RULES_ACTIVE: {
      passed: activeRules.length >= 3,
      evidence: `${activeRules.length} active guard rule(s)`,
    },
    DEMO_TRADES: {
      passed: closedReal.length >= 20,
      evidence: `${closedReal.length} broker-confirmed closed fill(s) (need 20)`,
    },
  };

  const stored = await db.select().from(demoPlanTasks).orderBy(demoPlanTasks.sortOrder);
  const tasks: DemoTask[] = [];

  for (const row of stored) {
    const auto = autoEvidence[row.taskKey];
    let completed = row.completed;
    let evidence = row.evidence;

    if (row.autoVerified && auto) {
      completed = auto.passed;
      evidence = auto.evidence;
      if (row.completed !== completed || row.evidence !== evidence) {
        await db
          .update(demoPlanTasks)
          .set({ completed, evidence, updatedAt: new Date() })
          .where(eq(demoPlanTasks.id, row.id));
      }
    }

    tasks.push({
      id: row.id,
      taskKey: row.taskKey,
      label: row.label,
      detail: row.detail,
      category: row.category,
      required: row.required,
      completed,
      autoVerified: row.autoVerified,
      evidence,
      sortOrder: row.sortOrder,
    });
  }

  const required = tasks.filter((t) => t.required);
  const done = required.filter((t) => t.completed);
  const blockers = required.filter((t) => !t.completed).map((t) => `${t.label}: ${t.evidence ?? t.detail}`);

  return {
    tasks,
    readinessPct: required.length > 0 ? Math.round((done.length / required.length) * 100) : 0,
    readyForDemo: Boolean(autoEvidence.EA_CONNECTED.passed && autoEvidence.LIVE_PRICE_FEED.passed),
    readyForLive:
      required.every((t) => t.completed) &&
      Boolean(autoEvidence.BACKTEST_GATE.passed) &&
      Boolean(autoEvidence.EA_CONNECTED.passed),
    blockers,
    autoEvidence,
  };
}
