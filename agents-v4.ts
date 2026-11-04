import { db } from "@/db";
import {
  marketAssets,
  agents,
  agentDebates,
  trades,
  mt5Accounts,
  systemLogs,
  learningProposals,
  backtestRuns,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { evaluateStrategy, BASELINE_PARAMS, type StrategyParams } from "./strategy-v4";
import { getActiveStrategy } from "./learning";
import { checkTradePermission, getRiskSnapshot, recordRiskEvent, getState } from "./risk";
import { getSpecs, validateProtection, sizePosition } from "./broker-specs";
import { loadBars, loadBarSources, type Timeframe } from "./market-data";
import { enqueueCommand } from "./command-queue";
import { allGatesPassed } from "./validation-gates";
import type { DebateMessage } from "./types";

/* ------------------------------------------------------------------ *
 * Agent council V4.0
 *
 * HONEST INTELLIGENCE LABELLING:
 *  - Every agent below is DETERMINISTIC (explicit rules + statistics).
 *  - No neural network, no language model is used to make trade decisions.
 *  - The only optional LLM hook is narrative wording, and it is disabled
 *    unless an API key is configured; it never affects order decisions.
 * ------------------------------------------------------------------ */

export type IntelligenceKind = "DETERMINISTIC" | "STATISTICAL" | "LLM_OPTIONAL";

export interface AgentDefinition {
  agentId: string;
  name: string;
  avatar: string;
  role: string;
  responsibility: string;
  intelligence: IntelligenceKind;
  vetoPower: boolean;
  color: string;
}

export const AGENT_DEFS: AgentDefinition[] = [
  {
    agentId: "market_analyst",
    name: "Market Analyst",
    avatar: "🌍",
    role: "Macro & session context",
    responsibility:
      "Checks data provenance/freshness, spread, volatility (ATR%), session window and news-window risk before anything else runs.",
    intelligence: "DETERMINISTIC",
    vetoPower: false,
    color: "#f59e0b",
  },
  {
    agentId: "trend_analyst",
    name: "Trend Analyst",
    avatar: "📈",
    role: "Regime & trend structure",
    responsibility: "Classifies the regime from the EMA stack, RSI band and momentum, and only endorses trades aligned with it.",
    intelligence: "DETERMINISTIC",
    vetoPower: false,
    color: "#3b82f6",
  },
  {
    agentId: "liquidity_analyst",
    name: "Liquidity Analyst",
    avatar: "💧",
    role: "Value area & stop placement",
    responsibility:
      "Measures the pullback into the fast EMA, room to swing extremes and whether the structural stop sits outside broker stops level.",
    intelligence: "DETERMINISTIC",
    vetoPower: false,
    color: "#06b6d4",
  },
  {
    agentId: "risk_manager",
    name: "Risk Manager",
    avatar: "🛡️",
    role: "Capital protection",
    responsibility:
      "Enforces 0.5% per trade, 2% daily, 4% weekly, 1% aggregate open risk, lot/SL validity, duplicate prevention. VETO IS FINAL.",
    intelligence: "DETERMINISTIC",
    vetoPower: true,
    color: "#ef4444",
  },
  {
    agentId: "strategy_developer",
    name: "Strategy Developer",
    avatar: "🧪",
    role: "Parameter research",
    responsibility:
      "Owns the active strategy version, proposes parameter changes from observed evidence, and only allows changes approved after independent testing.",
    intelligence: "STATISTICAL",
    vetoPower: false,
    color: "#a855f7",
  },
  {
    agentId: "execution_agent",
    name: "Trade Execution Agent",
    avatar: "🎯",
    role: "Broker interface",
    responsibility:
      "Queues broker orders with SL/TP, requires an EA acknowledgement with the real ticket, and rejects timeouts, duplicates and expired commands.",
    intelligence: "DETERMINISTIC",
    vetoPower: false,
    color: "#8b5cf6",
  },
  {
    agentId: "performance_analyst",
    name: "Performance Analyst",
    avatar: "📊",
    role: "Evidence & learning",
    responsibility:
      "Reviews out-of-sample expectancy, profit factor, drawdown and per-condition statistics; reports learning progress and mistakes.",
    intelligence: "STATISTICAL",
    vetoPower: false,
    color: "#10b981",
  },
];

const LEGACY_AGENT_IDS = ["grok_sentiment", "smc_quant", "risk_sentinel", "execution_sniper", "post_mortem_critic"];

export async function ensureAgentsV4() {
  // Retire the legacy 5-agent roster once the V4 council is present.
  for (const legacy of LEGACY_AGENT_IDS) {
    await db.delete(agents).where(eq(agents.agentId, legacy));
  }

  for (const def of AGENT_DEFS) {
    const [existing] = await db.select().from(agents).where(eq(agents.agentId, def.agentId)).limit(1);
    if (existing) continue;
    await db.insert(agents).values({
      agentId: def.agentId,
      name: def.name,
      role: def.role,
      avatar: def.avatar,
      description: def.responsibility,
      status: "active",
      confidence: 80,
      color: def.color,
    });
  }
}

export interface CouncilDecision {
  symbol: string;
  action: "BUY" | "SELL" | "HOLD" | "VETOED";
  executed: boolean;
  executionMode: "LIVE_MT5" | "PAPER" | "NONE";
  reasons: string[];
  vetoes: string[];
  debateId: number;
  tradeId: number | null;
  commandId: string | null;
  dataKind: "LIVE" | "HISTORICAL" | "SIMULATION";
  strategyLabel: string;
  confidence: number;
  riskBlockers: string[];
}

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function runCouncilCycle(symbol: string): Promise<CouncilDecision> {
  await ensureAgentsV4();

  const [asset] = await db.select().from(marketAssets).where(eq(marketAssets.symbol, symbol)).limit(1);
  if (!asset) throw new Error(`Unknown symbol ${symbol}`);

  const { params, label: strategyLabel } = await getActiveStrategy();
  const spec = await getSpecs(symbol);
  const riskSnapshot = await getRiskSnapshot();

  // ---- Data provenance: genuine MT5 bars preferred, simulation never trades live ----
  const storedBars = await loadBars(symbol, "M15" as Timeframe, 1200);
  const sources = await loadBarSources(symbol, "M15" as Timeframe);
  const usingStored = storedBars.length >= Math.max(260, params.emaTrend + 40);
  const candles = usingStored ? storedBars : ((asset.candles as { time: number; open: number; high: number; low: number; close: number; volume: number }[]) ?? []);
  const dataKind: CouncilDecision["dataKind"] = usingStored
    ? sources === "MT5_HISTORY"
      ? "HISTORICAL"
      : "LIVE"
    : "SIMULATION";

  const signal = evaluateStrategy(candles, params, {
    checkSession: true,
    spreadPoints: Number(asset.spread),
    maxSpreadPoints: Math.max(60, spec.typicalSpreadPoints * 3),
  });

  const reasons: string[] = [];
  const vetoes: string[] = [];
  const messages: DebateMessage[] = [];

  const push = (
    def: AgentDefinition,
    stance: DebateMessage["stance"],
    confidence: number,
    message: string,
    dreadWarningRef?: string
  ) => {
    messages.push({
      agentId: def.agentId,
      agentName: def.name,
      avatar: def.avatar,
      role: def.role,
      stance,
      confidence,
      message,
      timestamp: ts(),
      ...(dreadWarningRef ? { dreadWarningRef } : {}),
    });
  };

  // 1. Market Analyst
  const market = AGENT_DEFS[0];
  const dataNote = usingStored
    ? `genuine ${sources === "MT5_HISTORY" ? "MT5 history" : "MT5 data"} (${storedBars.length} bars)`
    : `SIMULATION candles (${candles.length}) - not valid for validation, paper only`;
  const marketVeto = dataKind === "HISTORICAL" || dataKind === "LIVE" ? null : "No genuine MT5 bars imported for this symbol";
  if (marketVeto) vetoes.push(marketVeto);
  push(
    market,
    marketVeto ? "VETO" : "NEUTRAL",
    marketVeto ? 95 : 78,
    `Feed: ${dataNote}. Spread ${asset.spread} pts vs broker typical ${spec.typicalSpreadPoints} pts. ATR ${signal.indicators?.atrPct.toFixed(3) ?? "n/a"}% of price. Session filter applied.`
  );

  // 2. Trend Analyst
  const trend = AGENT_DEFS[1];
  const trendStance: DebateMessage["stance"] =
    signal.regime === "TREND_UP" ? "BULLISH" : signal.regime === "TREND_DOWN" ? "BEARISH" : "NEUTRAL";
  push(
    trend,
    trendStance,
    82,
    `Regime ${signal.regime}. RSI ${signal.indicators?.rsi.toFixed(1) ?? "n/a"}. ${
      signal.reasons.slice(0, 2).join("; ") || "No qualifying trend structure"
    }. ${signal.blockers.length > 0 ? `Blocked by: ${signal.blockers[0]}` : "Structure aligned."}`
  );

  // 3. Liquidity Analyst
  const liq = AGENT_DEFS[2];
  const proposedEntry = signal.referenceEntry || Number(asset.currentPrice);
  const proposedStop = signal.direction === "SELL" ? proposedEntry + signal.riskDistance : proposedEntry - signal.riskDistance;
  const proposedTp =
    signal.direction === "SELL"
      ? proposedEntry - signal.riskDistance * params.tp1R
      : proposedEntry + signal.riskDistance * params.tp1R;
  const protection = validateProtection({
    direction: signal.direction === "SELL" ? "SELL" : "BUY",
    entry: proposedEntry,
    stopLoss: proposedStop,
    takeProfit: proposedTp,
    spec,
  });
  if (!protection.valid) vetoes.push(protection.reason ?? "Invalid stop/target geometry");
  push(
    liq,
    protection.valid ? trendStance : "VETO",
    protection.valid ? 80 : 96,
    `Structural stop ${Math.abs(proposedEntry - proposedStop).toFixed(spec.digits)} away (${params.stopAtrMult} ATR), target ${(
      signal.riskDistance * params.tp1R
    ).toFixed(spec.digits)}. Broker stops level ${(protection.minDistance).toFixed(spec.digits)}. ${
      protection.valid ? "Geometry valid." : protection.reason
    }`
  );

  // 4. Strategy Developer
  const dev = AGENT_DEFS[4];
  const pendingProposals = await db
    .select()
    .from(learningProposals)
    .where(eq(learningProposals.status, "PENDING"));
  push(
    dev,
    "NEUTRAL",
    75,
    `Active version "${strategyLabel}". ${pendingProposals.length} learning proposal(s) awaiting approval. The live strategy will not change without explicit approval.`
  );

  // 5. Risk Manager (veto)
  const riskAgent = AGENT_DEFS[3];
  let riskAllowed = true;
  let tradeBlockers: string[] = [];
  let lot = 0;

  if (signal.direction !== "NONE" && signal.riskDistance > 0) {
    const sizing = sizePosition({
      equity: riskSnapshot.equity,
      riskPct: riskSnapshot.riskPerTradePct,
      entry: proposedEntry,
      stopLoss: proposedStop,
      spec,
    });
    lot = sizing.lot;
    if (!sizing.valid) tradeBlockers.push(sizing.reason ?? "Invalid position size");

    const permission = await checkTradePermission({
      symbol,
      direction: signal.direction === "SELL" ? "SELL" : "BUY",
      entry: proposedEntry,
      stopLoss: proposedStop,
      takeProfit: proposedTp,
      lot: Math.max(sizing.lot, spec.minLot),
    });
    riskAllowed = permission.allowed;
    tradeBlockers = [...tradeBlockers, ...permission.blockers];
  } else {
    tradeBlockers.push(...riskSnapshot.breakers);
  }

  const allVetoes = [...vetoes, ...tradeBlockers];
  if (!riskAllowed || allVetoes.length > 0) riskAgent.vetoPower = true;
  push(
    riskAgent,
    allVetoes.length > 0 ? "VETO" : "NEUTRAL",
    allVetoes.length > 0 ? 99 : 90,
    allVetoes.length > 0
      ? `VETO. ${allVetoes.slice(0, 3).join(" | ")}. Risk budget: ${riskSnapshot.riskPerTradePct}% per trade, open risk ${riskSnapshot.openRiskPct}% of ${riskSnapshot.maxAggregateOpenRiskPct}%, daily DD ${riskSnapshot.dailyDrawdownPct}%.`
      : `Cleared. Size ${lot.toFixed(2)} lots risks ≤${riskSnapshot.riskPerTradePct}% of equity. Open risk ${riskSnapshot.openRiskPct.toFixed(2)}%, daily DD ${riskSnapshot.dailyDrawdownPct.toFixed(2)}% of 2%, weekly ${riskSnapshot.weeklyDrawdownPct.toFixed(2)}% of 4%.`
  );

  // 6. Performance Analyst
  const perf = AGENT_DEFS[6];
  const [latestBacktest] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.symbol, symbol))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(1);
  push(
    perf,
    "NEUTRAL",
    77,
    latestBacktest
      ? `Latest ${symbol} backtest (${latestBacktest.barsSource}): ${latestBacktest.tradesTaken} trades, PF ${latestBacktest.profitFactor}, expectancy ${latestBacktest.expectancyR}R, max DD ${latestBacktest.maxDrawdownPct}%.`
      : `No backtest recorded for ${symbol} yet. Live capital is blocked until validation gates pass.`
  );

  // 7. Execution Agent + demo gate
  const exec = AGENT_DEFS[5];
  const gates = await allGatesPassed();
  const [account] = await db.select().from(mt5Accounts).limit(1);
  const eaFresh = Boolean(
    account && account.eaVersion !== "0.0.0" && Date.now() - new Date(account.lastHeartbeat).getTime() < 30000
  );
  const demoLock = await getState<{ active: boolean; reason?: string }>("demo_lock", { active: false });

  let executionMode: CouncilDecision["executionMode"] = "NONE";
  let action: CouncilDecision["action"] = "HOLD";
  let commandId: string | null = null;
  let tradeId: number | null = null;

  const wantsTrade = signal.direction !== "NONE";

  if (wantsTrade && allVetoes.length === 0) {
    if (account && !account.isDemo && !gates.passed) {
      vetoes.push("LIVE ACCOUNT BLOCKED: demo mode is mandatory until every validation gate passes");
      push(exec, "VETO", 100, `Refusing to send real orders: ${gates.blockers.slice(0, 2).join(" | ")}`);
      action = "VETOED";
    } else if (demoLock.active) {
      vetoes.push(`Demo lock active: ${demoLock.reason ?? "validation incomplete"}`);
      push(exec, "VETO", 100, `Execution locked by validation policy. ${demoLock.reason ?? ""}`);
      action = "VETOED";
    } else if (eaFresh && account) {
      executionMode = "LIVE_MT5";
      action = signal.direction === "BUY" ? "BUY" : "SELL";

      const [pendingTrade] = await db
        .insert(trades)
        .values({
          ticket: 0,
          symbol,
          direction: action,
          lotSize: Math.max(lot, spec.minLot).toFixed(2),
          entryPrice: proposedEntry.toFixed(spec.digits),
          currentPrice: proposedEntry.toFixed(spec.digits),
          stopLoss: proposedStop.toFixed(spec.digits),
          takeProfit1: proposedTp.toFixed(spec.digits),
          takeProfit2: (signal.direction === "SELL"
            ? proposedEntry - signal.riskDistance * params.tp2R
            : proposedEntry + signal.riskDistance * params.tp2R
          ).toFixed(spec.digits),
          takeProfit3: (signal.direction === "SELL"
            ? proposedEntry - signal.riskDistance * params.tp3R
            : proposedEntry + signal.riskDistance * params.tp3R
          ).toFixed(spec.digits),
          pnl: "0.00",
          pnlPercent: "0.00",
          commission: "0.00",
          swap: "0.00",
          status: "PENDING",
          riskReward: params.tp1R.toFixed(2),
          strategy: `${strategyLabel} · ${signal.regime} · ${signal.setupTags.join("/")}`,
          dreadChecked: true,
          dreadCheckSummary: `Risk Manager cleared: ${riskSnapshot.riskPerTradePct}% risk, aggregate ${riskSnapshot.openRiskPct.toFixed(2)}%`,
          isSimulated: false,
        })
        .returning();

      const queued = await enqueueCommand({
        type: "EXECUTE_TRADE",
        symbol,
        direction: action,
        lot: Math.max(lot, spec.minLot),
        stopLoss: proposedStop,
        takeProfit: proposedTp,
        payload: {
          strategy: strategyLabel,
          regime: signal.regime,
          confidence: signal.confidence,
          setupTags: signal.setupTags,
        },
        source: "AGENT",
        localTradeId: pendingTrade.id,
      });

      commandId = queued.commandId;
      tradeId = pendingTrade.id;
      await db.update(trades).set({ commandId }).where(eq(trades.id, pendingTrade.id));

      push(
        exec,
        "NEUTRAL",
        94,
        `EXECUTE_TRADE queued (${queued.commandId}) for ${action} ${Math.max(lot, spec.minLot).toFixed(2)} lots ${symbol}. Awaiting EA acknowledgement with the real broker ticket - no fill is assumed.`
      );
    } else {
      executionMode = "PAPER";
      action = signal.direction === "BUY" ? "BUY" : "SELL";

      const anyTrades = await db.select({ id: trades.id }).from(trades);
      const [paper] = await db
        .insert(trades)
        .values({
          ticket: 950001 + anyTrades.length,
          symbol,
          direction: action,
          lotSize: Math.max(lot, spec.minLot).toFixed(2),
          entryPrice: proposedEntry.toFixed(spec.digits),
          currentPrice: proposedEntry.toFixed(spec.digits),
          stopLoss: proposedStop.toFixed(spec.digits),
          takeProfit1: proposedTp.toFixed(spec.digits),
          pnl: "0.00",
          pnlPercent: "0.00",
          status: "OPEN",
          riskReward: params.tp1R.toFixed(2),
          strategy: `PAPER · ${strategyLabel} · ${signal.regime}`,
          dreadChecked: true,
          dreadCheckSummary: "Paper trade - no EA connected, so no broker execution claimed",
          isSimulated: true,
        })
        .returning();
      tradeId = paper.id;

      push(
        exec,
        "NEUTRAL",
        70,
        `No live EA heartbeat: booked a clearly-labelled PAPER trade instead of pretending a broker fill. Connect the EA for real execution.`
      );
    }
  } else if (wantsTrade) {
    action = allVetoes.length > 0 ? "VETOED" : "HOLD";
    push(exec, "VETO", 99, `Order not sent. ${allVetoes.slice(0, 2).join(" | ")}`);
    await recordRiskEvent({
      severity: "WARN",
      type: "AGENT_BLOCK",
      message: `Council blocked a ${signal.direction} on ${symbol}: ${allVetoes.slice(0, 2).join("; ")}`,
      symbol,
    });
  } else {
    push(exec, "NEUTRAL", 72, `No order. ${signal.blockers[0] ?? "No structural edge this cycle."}`);
  }

  const synthesis =
    action === "VETOED"
      ? `Blocked by Risk Manager. ${allVetoes.slice(0, 2).join(" | ")}`
      : action === "HOLD"
      ? `Stood aside. ${signal.blockers.slice(0, 2).join(" | ") || "No qualifying setup."}`
      : `${action} dispatched via ${executionMode}. ${signal.reasons.slice(0, 2).join("; ")}.`;

  const [debate] = await db
    .insert(agentDebates)
    .values({
      symbol,
      timeframe: "15m",
      action,
      confidenceScore: signal.confidence,
      proposedLot: Math.max(lot, wantsTrade ? spec.minLot : 0).toFixed(2),
      proposedEntry: proposedEntry.toFixed(spec.digits),
      proposedSL: proposedStop.toFixed(spec.digits),
      proposedTP: proposedTp.toFixed(spec.digits),
      riskReward: params.tp1R.toFixed(2),
      dreadWarningActive: allVetoes.length > 0,
      dreadWarningDetails: allVetoes.length > 0 ? allVetoes.slice(0, 3).join(" | ") : null,
      historicalLossMatchId: null,
      messages,
      synthesis,
      executedTradeId: tradeId,
      status: action === "VETOED" ? "REJECTED" : "CONCLUDED",
    })
    .returning();

  await db.insert(systemLogs).values({
    level: action === "VETOED" ? "WARN" : "INFO",
    source: "Agent Council",
    message: `${symbol} council decision: ${action} (${executionMode}). ${synthesis}`,
  });

  return {
    symbol,
    action,
    executed: tradeId !== null,
    executionMode,
    reasons: signal.reasons,
    vetoes: allVetoes,
    debateId: debate.id,
    tradeId,
    commandId,
    dataKind,
    strategyLabel,
    confidence: signal.confidence,
    riskBlockers: allVetoes,
  };
}

export async function getActiveParamsForUi(): Promise<StrategyParams> {
  const { params } = await getActiveStrategy();
  return params ?? BASELINE_PARAMS;
}
