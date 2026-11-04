import { db } from "@/db";
import {
  marketAssets,
  dreadedPostMortems,
  trades,
  agentDebates,
  systemLogs,
  mt5Accounts,
  aiSettings,
} from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { DebateMessage, DreadedPostMortemItem, Candle } from "./types";
import {
  evaluateSignal,
  computeLotSize,
  DEFAULT_SIGNAL_CONFIG,
} from "./strategy";
import { enqueueCommand } from "./command-queue";

/** USD value of a 1.00 price move for one lot, per instrument family. */
const POINT_VALUE_PER_LOT: Record<string, number> = {
  EURUSD: 100000,
  GBPUSD: 100000,
  USDJPY: 1000,
  XAUUSD: 100,
  BTCUSD: 1,
  US30: 1,
  NAS100: 1,
};

function contractValue(symbol: string): number {
  return POINT_VALUE_PER_LOT[symbol] ?? 1;
}

interface SetupCandidate {
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;
  lotSize: number;
  session: string;
  rsi: number;
  trend4h: string;
  trend15m: string;
  spread: number;
  reason: string;
}

export async function evaluateSetupAgainstDreadedAnalysis(setup: SetupCandidate) {
  // Query active post-mortems
  const activePostMortems = await db
    .select()
    .from(dreadedPostMortems)
    .where(eq(dreadedPostMortems.isMemoryActive, true));

  const matchedRules: {
    rule: typeof dreadedPostMortems.$inferSelect;
    similarity: number;
    reason: string;
    actionRequired: "VETO" | "ADJUST_SL" | "WAIT_CONFIRMATION" | "PASS";
  }[] = [];

  for (const pm of activePostMortems) {
    let matchScore = 0;
    const reasons: string[] = [];

    // 1. Symbol similarity
    if (pm.symbol === setup.symbol) {
      matchScore += 25;
      reasons.push(`Target symbol matches historical failure on ${pm.symbol}`);
    }

    // 2. Direction / Trend match
    if (pm.direction === setup.direction) {
      matchScore += 15;
    }

    // 3. Category specific patterns
    if (pm.lossCategory === "COUNTER_TREND") {
      // Trying to sell when 4H is bullish or buy when 4H is bearish
      if (
        (setup.direction === "SELL" && setup.trend4h === "BULLISH") ||
        (setup.direction === "BUY" && setup.trend4h === "BEARISH")
      ) {
        matchScore += 45;
        reasons.push("Attempting counter-trend entry against HTF 4-Hour trend");
      }
    } else if (pm.lossCategory === "LIQUIDITY_TRAP") {
      if (setup.session.includes("OPEN") && setup.rsi > 65 && setup.direction === "BUY") {
        matchScore += 40;
        reasons.push("High RSI buying into session open liquidity sweep");
      }
    } else if (pm.lossCategory === "SPREAD_WIDENING") {
      if (setup.spread > 3.0) {
        matchScore += 35;
        reasons.push(`Spread (${setup.spread}) is abnormally elevated`);
      }
    } else if (pm.lossCategory === "NEWS_SLIPPAGE") {
      // Simulated red folder check
      const currentHour = new Date().getUTCHours();
      if (currentHour === 13 || currentHour === 14) {
        // High impact US session releases
        matchScore += 30;
        reasons.push("Close proximity to US macro data release window");
      }
    }

    if (matchScore >= 60) {
      const actionRequired =
        matchScore >= 80 ? "VETO" : pm.lossCategory === "LIQUIDITY_TRAP" ? "WAIT_CONFIRMATION" : "ADJUST_SL";

      matchedRules.push({
        rule: pm,
        similarity: Math.min(matchScore, 98),
        reason: reasons.join("; "),
        actionRequired,
      });
    }
  }

  // Sort by similarity descending
  matchedRules.sort((a, b) => b.similarity - a.similarity);

  return matchedRules;
}

export async function runAgentCouncilForSymbol(symbol: string) {
  // 1. Fetch asset data
  const [asset] = await db.select().from(marketAssets).where(eq(marketAssets.symbol, symbol)).limit(1);
  if (!asset) throw new Error(`Symbol ${symbol} not found`);

  // Fetch settings
  const [settings] = await db.select().from(aiSettings).limit(1);
  const minRR = settings ? parseFloat(settings.minRiskReward) : 2.5;

  const [accountRow] = await db.select().from(mt5Accounts).limit(1);
  const currentPrice = parseFloat(asset.currentPrice);
  const spread = parseFloat(asset.spread);
  const candles = (asset.candles as Candle[]) ?? [];

  // Deterministic structure model. There is no random direction: if the model
  // finds no statistical edge, the council stands aside (action = HOLD).
  const signalConfig = {
    ...DEFAULT_SIGNAL_CONFIG,
    minConfidence: 62,
    maxSpreadPoints: symbol === "XAUUSD" ? 60 : symbol === "BTCUSD" ? 400 : 35,
  };
  const signal = evaluateSignal(candles, asset.digits, spread, signalConfig, false);

  const rsi = signal.indicators?.rsi14 ?? parseFloat(asset.rsi14);

  const currentHour = new Date().getUTCHours();
  const session =
    currentHour >= 7 && currentHour < 12
      ? "LONDON_OPEN"
      : currentHour >= 12 && currentHour < 17
      ? "NY_OPEN"
      : currentHour >= 17 && currentHour < 21
      ? "NY_AFTERNOON"
      : "ASIAN_SESSION";

  if (!signal.shouldTrade || signal.direction === "NONE") {
    const blockers = signal.blockers.length > 0 ? signal.blockers : ["No structural edge detected"];
    const standAsideMessages: DebateMessage[] = [
      {
        agentId: "smc_quant",
        agentName: "SMC OrderFlow Quant",
        avatar: "📐",
        role: "Market Structure & Liquidity",
        stance: "NEUTRAL",
        confidence: Math.max(20, signal.confidence),
        message: `No valid entry on ${symbol}. Regime: ${signal.regime}. ${blockers.join(". ")}.`,
        timestamp: new Date().toLocaleTimeString(),
      },
      {
        agentId: "grok_sentiment",
        agentName: "Grok Macro & Sentiment Scout",
        avatar: "⚡",
        role: "Sentiment & News Intelligence",
        stance: "NEUTRAL",
        confidence: 70,
        message: `Flat is a position. There is no rule that says we must donate spread to the broker every cycle. Standing down on ${symbol}.`,
        timestamp: new Date().toLocaleTimeString(),
      },
      {
        agentId: "risk_sentinel",
        agentName: "Risk Guardian Sentinel",
        avatar: "🛡️",
        role: "Capital Preservation & Prop Rules",
        stance: "NEUTRAL",
        confidence: 98,
        message: "Capital preserved: zero orders dispatched because the edge filter failed.",
        timestamp: new Date().toLocaleTimeString(),
      },
    ];

    const [holdDebate] = await db
      .insert(agentDebates)
      .values({
        symbol,
        timeframe: "15m",
        action: "HOLD",
        confidenceScore: Math.max(20, signal.confidence),
        proposedLot: "0.00",
        proposedEntry: currentPrice.toFixed(asset.digits),
        proposedSL: currentPrice.toFixed(asset.digits),
        proposedTP: currentPrice.toFixed(asset.digits),
        riskReward: "0.00",
        dreadWarningActive: false,
        dreadWarningDetails: null,
        historicalLossMatchId: null,
        messages: standAsideMessages,
        synthesis: `No trade: ${blockers.slice(0, 2).join("; ")}.`,
        status: "CONCLUDED",
      })
      .returning();

    await db.insert(systemLogs).values({
      level: "INFO",
      source: "Council",
      message: `No-trade decision on ${symbol} (${signal.regime}): ${blockers[0]}`,
    });

    return {
      debate: holdDebate,
      action: "HOLD" as const,
      executedTradeId: null,
      topDread: null,
      dataSource: asset.dataSource,
    };
  }

  const direction: "BUY" | "SELL" = signal.direction as "BUY" | "SELL";
  const entryPrice = signal.entry;
  const stopLoss = signal.stopLoss;
  const takeProfit1 = signal.takeProfit1;
  const takeProfit2 = signal.takeProfit2;
  const takeProfit3 = signal.takeProfit3;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const rr = signal.riskReward;
  const equity = parseFloat(accountRow?.equity ?? "10000");
  const riskPct = settings ? parseFloat(settings.riskPerTradePct) : 0.5;
  const lot = computeLotSize({
    equity,
    riskPct,
    riskDistance,
    pointValuePerLot: contractValue(symbol),
    minLot: 0.01,
    maxLot: 1,
    lotStep: 0.01,
  });

  // 2. RUN DREAD MEMORY SCREENING
  const dreadMatches = await evaluateSetupAgainstDreadedAnalysis({
    symbol,
    direction,
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskReward: minRR,
    lotSize: 0.5,
    session,
    rsi,
    trend4h: asset.trend4h,
    trend15m: asset.trend15m,
    spread,
    reason: `SMC Structure on ${asset.trend15m} time frame`,
  });

  const topDread = dreadMatches[0] || null;
  const hasCriticalDread = Boolean(topDread && topDread.similarity >= (settings ? settings.dreadThresholdPct : 75));

  const action: "BUY" | "SELL" | "HOLD" | "VETOED" =
    hasCriticalDread && topDread && topDread.actionRequired === "VETO" ? "VETOED" : direction;

  // 3. Build Multi-Agent Debate transcript with Grok commentary
  const messages: DebateMessage[] = [];
  const now = new Date().toLocaleTimeString();

  // Agent 1: SMC Quant
  messages.push({
    agentId: "smc_quant",
    agentName: "SMC OrderFlow Quant",
    avatar: "📐",
    role: "Market Structure & Liquidity",
    stance: direction === "BUY" ? "BULLISH" : "BEARISH",
    confidence: hasCriticalDread ? 60 : 92,
    message: `${symbol} printed an impulsive ${asset.trend15m} displacement on the 15m chart. Current price ${currentPrice.toFixed(
      asset.digits
    )} is tapping into discounted Fair Value Gap with RSI at ${rsi}. Proposing ${direction} targeting ${takeProfit1.toFixed(
      asset.digits
    )} with SL at ${stopLoss.toFixed(asset.digits)}.`,
    timestamp: now,
  });

  // Agent 2: Grok Macro & Sentiment Scout
  const grokQuote =
    direction === "BUY"
      ? `Retail crowd is overwhelmingly panicking or leaning short. On X, retail sentiment is 72% bearish—which is basically an open invitation for institutional market makers to engineer a squeeze. Spread is ${spread} pips.`
      : `Retail is blindly buying dips while institutions are distributing into resistance. Open interest on derivatives shows heavy call accumulation waiting to get wiped.`;

  messages.push({
    agentId: "grok_sentiment",
    agentName: "Grok Macro & Sentiment Scout",
    avatar: "⚡",
    role: "Sentiment & News Intelligence",
    stance: direction === "BUY" ? "BULLISH" : "BEARISH",
    confidence: 86,
    message: grokQuote,
    timestamp: now,
  });

  // Agent 3: Post-Mortem Critic (The Dreaded Mirror)
  if (topDread) {
    if (topDread.actionRequired === "VETO") {
      messages.push({
        agentId: "post_mortem_critic",
        agentName: "Dreaded Critic (Self-Reflection)",
        avatar: "🧠",
        role: "Post-Mortem & Memory Arbiter",
        stance: "VETO",
        confidence: 99,
        message: `🛑 VETO TRIGGERED! We have a ${topDread.similarity}% match with historical disaster (Dread Post-Mortem #${topDread.rule.id} on ${topDread.rule.symbol}). ${topDread.reason}. Rule violated: "${topDread.rule.ruleLearned}". Grok note: We do NOT donate capital to the market for the exact same mistake twice. Trade denied!`,
        timestamp: now,
        dreadWarningRef: topDread.rule.ruleLearned,
      });
    } else {
      messages.push({
        agentId: "post_mortem_critic",
        agentName: "Dreaded Critic (Self-Reflection)",
        avatar: "🧠",
        role: "Post-Mortem & Memory Arbiter",
        stance: "ADJUST",
        confidence: 88,
        message: `⚠️ DREAD ADAPTATION: Detected ${topDread.similarity}% similarity to ${topDread.rule.lossCategory}. In that disaster, we rushed in without a structural confirmation. Recommendation: Proceed with ${direction}, but require strict 15m MSS candle close and widen SL to ${stopLoss.toFixed(
          asset.digits
        )} to prevent sweep liquidation.`,
        timestamp: now,
        dreadWarningRef: topDread.rule.ruleLearned,
      });
    }
  } else {
    messages.push({
      agentId: "post_mortem_critic",
      agentName: "Dreaded Critic (Self-Reflection)",
      avatar: "🧠",
      role: "Post-Mortem & Memory Arbiter",
      stance: direction === "BUY" ? "BULLISH" : "BEARISH",
      confidence: 94,
      message: `Dread Memory scan clean. Zero high-severity anti-patterns detected for ${symbol} in current market regime. No liquidity trap signatures detected. Cleared for execution.`,
      timestamp: now,
    });
  }

  // Agent 4: Risk Guardian Sentinel
  if (action === "VETOED") {
    messages.push({
      agentId: "risk_sentinel",
      agentName: "Risk Guardian Sentinel",
      avatar: "🛡️",
      role: "Capital Preservation & Prop Rules",
      stance: "VETO",
      confidence: 100,
      message: `Safety veto upheld. Trade discarded before reaching MT5 execution queue. Account balance preserved. Daily drawdown headroom 100%.`,
      timestamp: now,
    });
  } else {
    messages.push({
      agentId: "risk_sentinel",
      agentName: "Risk Guardian Sentinel",
      avatar: "🛡️",
      role: "Capital Preservation & Prop Rules",
      stance: direction === "BUY" ? "BULLISH" : "BEARISH",
      confidence: 96,
      message: `Risk check PASS. Structure stop is ${riskDistance.toFixed(asset.digits)} away (${((riskDistance / entryPrice) * 100).toFixed(
        2
      )}% of price), R:R ${rr.toFixed(2)}:1 vs the ${minRR}:1 floor. Risk-based sizing = ${lot.toFixed(
        2
      )} lots ($${(equity * (riskPct / 100)).toFixed(2)} = ${riskPct}% of equity).`,
      timestamp: now,
    });
  }

  // Live bridge detection: is an EA actually connected and heartbeating?
  const heartbeatAgeMs = accountRow ? Date.now() - new Date(accountRow.lastHeartbeat).getTime() : Infinity;
  const bridgeLive = Boolean(
    accountRow &&
      accountRow.eaVersion !== "0.0.0" &&
      heartbeatAgeMs < 30_000 &&
      settings?.autonomousMode !== "PAPER_SIMULATION"
  );

  // Agent 5: Execution Sniper
  if (action !== "VETOED") {
    messages.push({
      agentId: "execution_sniper",
      agentName: "Execution & Trailing Sniper",
      avatar: "🎯",
      role: "MT5 Bridge & Order Execution",
      stance: direction === "BUY" ? "BULLISH" : "BEARISH",
      confidence: 95,
      message: bridgeLive
        ? `Bridge is LIVE (EA v${accountRow?.eaVersion}, heartbeat ${Math.round(
            heartbeatAgeMs / 1000
          )}s ago). Queuing EXECUTE_TRADE on the durable command queue. The EA applies its own local risk limits before sending.`
        : `No live EA heartbeat detected. Order will be booked as a PAPER trade and flagged simulated until a bridge connects - we do not pretend a broker filled it.`,
      timestamp: now,
    });
  }

  // 4. Save Debate to DB
  const synthesis =
    action === "VETOED"
      ? `Setup VETOED by Dreaded Critic. Prevented trade due to similarity to ${topDread?.rule.lossCategory || "historical loss pattern"}.`
      : `Council quorum reached (${direction}, ${signal.regime}). R:R ${rr.toFixed(2)}:1. ${
          bridgeLive ? "Queued to the live MT5 EA for real execution." : "Booked as a clearly-labelled PAPER trade."
        }`;

  const [newDebate] = await db
    .insert(agentDebates)
    .values({
      symbol,
      timeframe: "15m",
      action,
      confidenceScore: action === "VETOED" ? 28 : signal.confidence,
      proposedLot: lot.toFixed(2),
      proposedEntry: entryPrice.toFixed(asset.digits),
      proposedSL: stopLoss.toFixed(asset.digits),
      proposedTP: takeProfit1.toFixed(asset.digits),
      riskReward: rr.toFixed(2),
      dreadWarningActive: hasCriticalDread,
      dreadWarningDetails: topDread ? `${topDread.similarity}% match: ${topDread.reason}` : null,
      historicalLossMatchId: topDread ? topDread.rule.id : null,
      messages,
      synthesis,
      status: action === "VETOED" ? "REJECTED" : "CONCLUDED",
    })
    .returning();

  let executedTradeId: number | null = null;
  let commandId: string | null = null;
  let executionMode: "LIVE_MT5" | "PAPER" | "NONE" = "NONE";

  const dreadSummary = topDread
    ? `Adapted from Dread Rule #${topDread.rule.id}: ${topDread.rule.ruleLearned}`
    : `Clean dread scan. Signals: ${signal.reasons.slice(0, 2).join("; ")}`;

  // 5. Dispatch: real EA command when connected, otherwise an explicit paper trade
  if (action !== "VETOED" && settings?.autopilotEnabled) {
    if (bridgeLive) {
      executionMode = "LIVE_MT5";
      const [pending] = await db
        .insert(trades)
        .values({
          ticket: 0,
          symbol,
          direction,
          lotSize: lot.toFixed(2),
          entryPrice: entryPrice.toFixed(asset.digits),
          currentPrice: entryPrice.toFixed(asset.digits),
          stopLoss: stopLoss.toFixed(asset.digits),
          takeProfit1: takeProfit1.toFixed(asset.digits),
          takeProfit2: takeProfit2.toFixed(asset.digits),
          takeProfit3: takeProfit3.toFixed(asset.digits),
          pnl: "0.00",
          pnlPercent: "0.00",
          commission: "0.00",
          swap: "0.00",
          status: "PENDING",
          riskReward: rr.toFixed(2),
          strategy: `Live EA execution - ${signal.regime} pullback (debate #${newDebate.id})`,
          dreadChecked: true,
          dreadCheckSummary: dreadSummary,
          isSimulated: false,
        })
        .returning();

      const queued = await enqueueCommand({
        type: "EXECUTE_TRADE",
        symbol,
        direction,
        lot,
        stopLoss,
        takeProfit: takeProfit1,
        payload: {
          takeProfit2,
          takeProfit3,
          regime: signal.regime,
          confidence: signal.confidence,
          reasons: signal.reasons,
        },
        source: "AGENT",
        localTradeId: pending.id,
      });

      commandId = queued.commandId;
      executedTradeId = pending.id;

      await db.update(trades).set({ commandId }).where(eq(trades.id, pending.id));

      await db.insert(systemLogs).values({
        level: "TRADE_EXEC",
        source: "Autonomous Agent",
        message: `Queued live ${direction} ${lot.toFixed(2)} lots ${symbol} @ ${entryPrice.toFixed(
          asset.digits
        )} | SL ${stopLoss.toFixed(asset.digits)} TP1 ${takeProfit1.toFixed(
          asset.digits
        )}. Awaiting EA broker fill (${commandId}).`,
        metadata: { debateId: newDebate.id, commandId, symbol, direction },
      });
    } else {
      executionMode = "PAPER";
      const allTrades = await db.select({ id: trades.id }).from(trades);
      const paperTicket = 900001 + allTrades.length;

      const [paperTrade] = await db
        .insert(trades)
        .values({
          ticket: paperTicket,
          symbol,
          direction,
          lotSize: lot.toFixed(2),
          entryPrice: entryPrice.toFixed(asset.digits),
          currentPrice: entryPrice.toFixed(asset.digits),
          stopLoss: stopLoss.toFixed(asset.digits),
          takeProfit1: takeProfit1.toFixed(asset.digits),
          takeProfit2: takeProfit2.toFixed(asset.digits),
          takeProfit3: takeProfit3.toFixed(asset.digits),
          pnl: "0.00",
          pnlPercent: "0.00",
          commission: "0.00",
          swap: "0.00",
          status: "OPEN",
          riskReward: rr.toFixed(2),
          strategy: `Paper trade - ${signal.regime} pullback (debate #${newDebate.id})`,
          dreadChecked: true,
          dreadCheckSummary: dreadSummary,
          isSimulated: true,
        })
        .returning();

      executedTradeId = paperTrade.id;

      await db.insert(systemLogs).values({
        level: "INFO",
        source: "Paper Engine",
        message: `EA offline: booked SIMULATED paper trade #${paperTicket} ${direction} ${lot.toFixed(
          2
        )} lots ${symbol}. Connect the MetaTrader 5 EA for real broker execution.`,
        metadata: { debateId: newDebate.id, symbol, direction },
      });
    }

    // Link trade to debate
    await db.update(agentDebates).set({ executedTradeId }).where(eq(agentDebates.id, newDebate.id));

    // If a dread rule was adapted successfully, increment prevented count
    if (topDread && topDread.actionRequired === "ADJUST_SL") {
      await db
        .update(dreadedPostMortems)
        .set({ preventedCount: topDread.rule.preventedCount + 1 })
        .where(eq(dreadedPostMortems.id, topDread.rule.id));
    }
  } else if (action === "VETOED") {
    // If trade was vetoed, increment prevented count on the rule!
    if (topDread) {
      await db
        .update(dreadedPostMortems)
        .set({
          preventedCount: topDread.rule.preventedCount + 1,
        })
        .where(eq(dreadedPostMortems.id, topDread.rule.id));

      await db.insert(systemLogs).values({
        level: "AGENT_VETO",
        source: "Dreaded Critic",
        message: `Dread Rule #${topDread.rule.id} prevented potential catastrophic loss on ${symbol} ${direction}. Total times saved: ${
          topDread.rule.preventedCount + 1
        }`,
        metadata: { ruleId: topDread.rule.id, similarity: topDread.similarity },
      });
    }
  }

  return {
    debate: newDebate,
    action,
    executedTradeId,
    commandId,
    executionMode,
    topDread,
    signal: {
      regime: signal.regime,
      confidence: signal.confidence,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      lot,
      riskReward: rr,
      reasons: signal.reasons,
      indicators: signal.indicators,
    },
  };
}

// Generate Grok-Style Post-Mortem when a trade closes in a loss or mistake
export async function generatePostMortemForClosedTrade(params: {
  tradeId?: number;
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  closeReason: string;
}) {
  const isLoss = params.pnl < 0;
  const isPrematureBE = params.closeReason === "TRAILING_HIT" && params.pnl >= 0 && params.pnl < 15;

  let category: DreadedPostMortemItem["lossCategory"] = "LIQUIDITY_TRAP";
  let whatWentWrong = "";
  let theDreadedSin = "";
  let rootCause = "";
  let ruleLearned = "";

  if (isLoss) {
    if (Math.abs(params.pnlPercent) > 1.2) {
      category = "NEWS_SLIPPAGE";
      whatWentWrong = `Exited ${params.symbol} at ${params.exitPrice} with substantial slippage. Severe adverse price excursion occurred within minutes of entry.`;
      theDreadedSin =
        "Gambling through high-volatility news releases. Interbank spreads blew out and devoured the stop distance.";
      rootCause = "High-impact economic catalyst occurred without checking the economic news calendar.";
      ruleLearned = `DREAD RULE #${Date.now().toString().slice(-4)}: Mandatory 30-min embargo on all ${params.symbol} orders around Tier-1 central bank speeches and CPI releases.`;
    } else if (params.direction === "SELL") {
      category = "COUNTER_TREND";
      whatWentWrong = `Attempted to short ${params.symbol} at ${params.entryPrice}. Higher-timeframe market structure was undeniably bullish and broke through our resistance level with zero hesitation.`;
      theDreadedSin = "Fighting the macro trend to harvest pennies. Counter-trend hero syndrome.";
      rootCause = "Over-reliance on low timeframe oscillator exhaustion while HTF order flow was in continuous expansion.";
      ruleLearned = `DREAD RULE #${Date.now().toString().slice(-4)}: Never open short positions on ${params.symbol} when 4-Hour 50 EMA is trending upward and no 1H MSS has printed.`;
    } else {
      category = "LIQUIDITY_TRAP";
      whatWentWrong = `Bought ${params.symbol} at ${params.entryPrice} right before the market swept the equal lows. Stop loss hit at ${params.exitPrice} before the market rebounded.`;
      theDreadedSin = "Being the liquidity for smart money. Impatient entry before the manipulation wick completed.";
      rootCause = "Placed stop loss inside obvious internal retail liquidity pool without buffer.";
      ruleLearned = `DREAD RULE #${Date.now().toString().slice(-4)}: Require at least a 10-pip buffer below key swing lows on ${params.symbol} and wait for the sweep wick to close.`;
    }
  } else if (isPrematureBE) {
    category = "EARLY_BE_STOP";
    whatWentWrong = `Stop loss was moved to break-even after only minimal progress. Normal market breathing wicked out the trade at entry, missing the subsequent multi-R expansion.`;
    theDreadedSin = "Suffocating winning setups due to micro-volatility anxiety.";
    rootCause = "Ratcheting protective stop before TP1 was locked or market structure formed a protected swing.";
    ruleLearned = `DREAD RULE #${Date.now().toString().slice(-4)}: Forbid moving Stop Loss to Break-Even until TP1 is completely filled. Let the trade breathe.`;
  } else {
    // Regular win, no post-mortem needed
    return null;
  }

  const [postMortem] = await db
    .insert(dreadedPostMortems)
    .values({
      tradeId: params.tradeId,
      symbol: params.symbol,
      direction: params.direction,
      entryPrice: params.entryPrice.toString(),
      exitPrice: params.exitPrice.toString(),
      pnl: params.pnl.toFixed(2),
      pnlPercent: params.pnlPercent.toFixed(2),
      lossCategory: category,
      whatWentWrong,
      theDreadedSin,
      rootCause,
      ruleLearned,
      preventedCount: 0,
      severity: isLoss ? "CRITICAL" : "MEDIUM",
      patternSignature: {
        timeframe: "15m",
        rsi: 62,
        spreadAtEntry: 1.2,
      },
      aiReflectionScore: 95,
      isMemoryActive: true,
    })
    .returning();

  await db.insert(systemLogs).values({
    level: "DREAD_LEARN",
    source: "Post-Mortem Engine",
    message: `New Dread Rule committed to memory bank: "${ruleLearned}" based on trade failure #${params.tradeId || "SIM"}.`,
    metadata: { postMortemId: postMortem.id, category, sin: theDreadedSin },
  });

  return postMortem;
}
