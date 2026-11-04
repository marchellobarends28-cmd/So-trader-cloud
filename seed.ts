import { db } from "@/db";
import {
  mt5Accounts,
  agents,
  marketAssets,
  dreadedPostMortems,
  trades,
  agentDebates,
  aiSettings,
  systemLogs,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { randomBytes } from "crypto";

function generateCandles(basePrice: number, count = 60, volatility = 0.002, digits = 5) {
  const candles = [];
  let current = basePrice;
  const now = Date.now();
  const stepMs = 15 * 60 * 1000; // 15m candles

  for (let i = count; i >= 0; i--) {
    const time = now - i * stepMs;
    const change = (Math.random() - 0.49) * volatility * current;
    const open = current;
    const close = Number((current + change).toFixed(digits));
    const high = Number((Math.max(open, close) + Math.random() * volatility * 0.7 * current).toFixed(digits));
    const low = Number((Math.min(open, close) - Math.random() * volatility * 0.7 * current).toFixed(digits));
    const volume = Math.floor(100 + Math.random() * 900);
    candles.push({ time, open, high, low, close, volume });
    current = close;
  }
  return candles;
}

export async function seedDatabaseIfNeeded() {
  try {
    const existingAccounts = await db.select().from(mt5Accounts).limit(1);
    if (existingAccounts.length > 0) {
      const existing = existingAccounts[0];
      if (!existing.apiKey || existing.apiKey === "mt5_live_bridge_x99a4c82b0" || existing.apiKey === "mt5_live_key_99fa1b483c" || existing.apiKey.length < 32) {
        await db.update(mt5Accounts).set({ apiKey: randomBytes(32).toString("hex"), updatedAt: new Date() }).where(sql`id = ${existing.id}`);
      }
      return; // already seeded; known/default bridge secrets are rotated above
    }

    console.log("Seeding database with MT5 and Autonomous Agent datasets...");

    // 1. MT5 Account
    await db.insert(mt5Accounts).values({
      accountNumber: "NOT_CONNECTED",
      broker: "Not connected",
      serverName: "Not connected",
      currency: "USD",
      balance: "0.00",
      equity: "0.00",
      margin: "0.00",
      freeMargin: "0.00",
      marginLevel: "0.00",
      leverage: 1,
      isDemo: true,
      isConnected: false,
      bridgeMode: "simulation",
      apiKey: randomBytes(32).toString("hex"),
    });

    // 2. Agents
    await db.insert(agents).values([
      {
        agentId: "grok_sentiment",
        name: "Grok Macro & Sentiment Scout",
        role: "Sentiment & News Intelligence",
        avatar: "⚡",
        description:
          "Monitors real-time X news flow, FOMC transcripts, retail positioning (IG client sentiment), and cuts through market noise with cynical clarity.",
        status: "active",
        confidence: 89,
        accuracyScore: "81.40",
        tradesEvaluated: 184,
        winsApproved: 132,
        lossesVetoed: 42,
        dreadWarningsTriggered: 31,
        color: "#f59e0b",
      },
      {
        agentId: "smc_quant",
        name: "SMC OrderFlow Quant",
        role: "Market Structure & Liquidity",
        avatar: "📐",
        description:
          "Algorithmic Smart Money Concepts analyzer. Maps liquidity sweeps, Fair Value Gaps (FVG), order blocks, and multi-timeframe structure shifts (MSS).",
        status: "active",
        confidence: 94,
        accuracyScore: "84.20",
        tradesEvaluated: 210,
        winsApproved: 156,
        lossesVetoed: 38,
        dreadWarningsTriggered: 24,
        color: "#3b82f6",
      },
      {
        agentId: "risk_sentinel",
        name: "Risk Guardian Sentinel",
        role: "Capital Preservation & Prop Rules",
        avatar: "🛡️",
        description:
          "Hard stop enforcement. Checks 3% max daily drawdown, 1% per-trade risk, spread slippage spikes, and mandates minimum 1:2.5 Risk:Reward.",
        status: "active",
        confidence: 98,
        accuracyScore: "95.10",
        tradesEvaluated: 210,
        winsApproved: 140,
        lossesVetoed: 70,
        dreadWarningsTriggered: 45,
        color: "#10b981",
      },
      {
        agentId: "execution_sniper",
        name: "Execution & Trailing Sniper",
        role: "MT5 Bridge & Order Execution",
        avatar: "🎯",
        description:
          "Dispatches sub-second orders to MetaTrader 5 via WebRequest EA bridge. Dynamically scales out at TP1 (50%), ratchets stop loss to break-even.",
        status: "active",
        confidence: 91,
        accuracyScore: "88.00",
        tradesEvaluated: 140,
        winsApproved: 118,
        lossesVetoed: 12,
        dreadWarningsTriggered: 18,
        color: "#8b5cf6",
      },
      {
        agentId: "post_mortem_critic",
        name: "Dreaded Critic (Self-Reflection)",
        role: "Post-Mortem & Memory Arbiter",
        avatar: "🧠",
        description:
          "The brutal internal mirror. Dissects every past loss, extracts anti-patterns, and vetoes incoming trades if they match previously dreaded catastrophic mistakes.",
        status: "analyzing",
        confidence: 96,
        accuracyScore: "91.80",
        tradesEvaluated: 198,
        winsApproved: 125,
        lossesVetoed: 58,
        dreadWarningsTriggered: 52,
        color: "#ef4444",
      },
    ]);

    // 3. Market Assets
    const eurusdCandles = generateCandles(1.0845, 60, 0.001, 5);
    const gbpusdCandles = generateCandles(1.272, 60, 0.0012, 5);
    const xauusdCandles = generateCandles(2745.5, 60, 0.003, 2);
    const btcusdCandles = generateCandles(94500.0, 60, 0.008, 2);
    const us30Candles = generateCandles(43920.0, 60, 0.0025, 1);
    const nas100Candles = generateCandles(20850.0, 60, 0.003, 1);

    await db.insert(marketAssets).values([
      {
        symbol: "EURUSD",
        name: "Euro / US Dollar",
        assetClass: "FOREX",
        currentPrice: "1.08520",
        change24h: "0.34",
        high24h: "1.08710",
        low24h: "1.08190",
        spread: "0.8",
        digits: 5,
        pipSize: "0.00010",
        sentimentScore: 68,
        trend4h: "BULLISH",
        trend15m: "BULLISH",
        rsi14: "56.40",
        candles: eurusdCandles,
      },
      {
        symbol: "GBPUSD",
        name: "British Pound / US Dollar",
        assetClass: "FOREX",
        currentPrice: "1.27185",
        change24h: "-0.18",
        high24h: "1.27620",
        low24h: "1.26940",
        spread: "1.1",
        digits: 5,
        pipSize: "0.00010",
        sentimentScore: 48,
        trend4h: "RANGE",
        trend15m: "BEARISH",
        rsi14: "46.20",
        candles: gbpusdCandles,
      },
      {
        symbol: "XAUUSD",
        name: "Gold / US Dollar",
        assetClass: "COMMODITIES",
        currentPrice: "2748.80",
        change24h: "1.12",
        high24h: "2754.20",
        low24h: "2731.50",
        spread: "18.0",
        digits: 2,
        pipSize: "0.10000",
        sentimentScore: 78,
        trend4h: "BULLISH",
        trend15m: "BULLISH",
        rsi14: "63.80",
        candles: xauusdCandles,
      },
      {
        symbol: "BTCUSD",
        name: "Bitcoin / US Dollar",
        assetClass: "CRYPTO",
        currentPrice: "94820.00",
        change24h: "2.45",
        high24h: "95400.00",
        low24h: "92100.00",
        spread: "120.0",
        digits: 2,
        pipSize: "1.00000",
        sentimentScore: 74,
        trend4h: "BULLISH",
        trend15m: "BULLISH",
        rsi14: "61.50",
        candles: btcusdCandles,
      },
      {
        symbol: "US30",
        name: "Dow Jones Industrial 30",
        assetClass: "INDICES",
        currentPrice: "43880.0",
        change24h: "-0.22",
        high24h: "44120.0",
        low24h: "43760.0",
        spread: "2.5",
        digits: 1,
        pipSize: "1.00000",
        sentimentScore: 51,
        trend4h: "RANGE",
        trend15m: "BEARISH",
        rsi14: "48.10",
        candles: us30Candles,
      },
      {
        symbol: "NAS100",
        name: "Nasdaq 100 Index",
        assetClass: "INDICES",
        currentPrice: "20875.5",
        change24h: "0.68",
        high24h: "20940.0",
        low24h: "20710.0",
        spread: "1.8",
        digits: 1,
        pipSize: "1.00000",
        sentimentScore: 66,
        trend4h: "BULLISH",
        trend15m: "BULLISH",
        rsi14: "58.90",
        candles: nas100Candles,
      },
    ]);

    // 4. Dreaded Post-Mortems (The Core Self-Reflective Dread Bank)
    await db.insert(dreadedPostMortems).values([
      {
        symbol: "EURUSD",
        direction: "BUY",
        entryPrice: "1.09240",
        exitPrice: "1.08860",
        pnl: "-380.00",
        pnlPercent: "-0.76",
        lossCategory: "LIQUIDITY_TRAP",
        whatWentWrong:
          "Bought London session breakout high at 08:05 GMT. Market promptly reversed 45 pips downward, sweeping all late buyers before continuing higher hours later.",
        theDreadedSin:
          "Classic FOMO breakout chasing at premium liquidity without waiting for the Judas swing reversal.",
        rootCause:
          "Failed to verify if Asian high was an engineering trap. Entered before 15m Market Structure Shift (MSS) confirmed.",
        ruleLearned:
          "DREAD RULE #104: Never long an Asian session breakout within the first 30 minutes of London Open without a confirmed 15m MSS candle close and FVG retest.",
        preventedCount: 14,
        severity: "CRITICAL",
        patternSignature: {
          session: "LONDON_OPEN",
          rsi: 69,
          distanceToKeyLevelPips: 3,
          spreadAtEntry: 0.9,
          timeframe: "15m",
        },
        aiReflectionScore: 97,
        isMemoryActive: true,
      },
      {
        symbol: "XAUUSD",
        direction: "SELL",
        entryPrice: "2720.50",
        exitPrice: "2738.00",
        pnl: "-875.00",
        pnlPercent: "-1.75",
        lossCategory: "NEWS_SLIPPAGE",
        whatWentWrong:
          "Attempted to scalp short 4 minutes prior to US Core PPI & Initial Jobless Claims release. Huge upside slippage triggered stop loss with $17.50 adverse excursion.",
        theDreadedSin:
          "Hubris. Thinking our sub-millisecond execution can outrun interbank liquidity vacuum during red-folder macro events.",
        rootCause:
          "Ignored economic calendar event blackout window. High spread spike expanded from 15 to 110 points instantaneously.",
        ruleLearned:
          "DREAD RULE #207: Mandatory full trading blackout 15 minutes before and 20 minutes after high-impact Red-Folder USD/EUR macro data releases.",
        preventedCount: 22,
        severity: "CRITICAL",
        patternSignature: {
          session: "NY_MORNING",
          rsi: 74,
          distanceToKeyLevelPips: 12,
          spreadAtEntry: 11.0,
          timeframe: "5m",
        },
        aiReflectionScore: 99,
        isMemoryActive: true,
      },
      {
        symbol: "GBPUSD",
        direction: "BUY",
        entryPrice: "1.26400",
        exitPrice: "1.26405",
        pnl: "2.50",
        pnlPercent: "0.01",
        lossCategory: "EARLY_BE_STOP",
        whatWentWrong:
          "Position reached +14 pips, bot hastily ratcheted Stop Loss to Break-Even. Normal retrace wicked out the trade for +$2.50, after which market soared +110 pips directly to TP3.",
        theDreadedSin:
          "Choking winning trades out of cowardice. Anxious premature break-even placement kills expectancy.",
        rootCause:
          "Trailing sniper moved SL to entry before price even tested the first internal order block or achieved TP1 (1.5R).",
        ruleLearned:
          "DREAD RULE #318: Never adjust Stop Loss to Break-Even until TP1 (minimum 1.5R) has been partially closed AND a higher-low swing structure is sealed.",
        preventedCount: 19,
        severity: "HIGH",
        patternSignature: {
          session: "LONDON_MIDDAY",
          rsi: 58,
          distanceToKeyLevelPips: 25,
          timeframe: "15m",
        },
        aiReflectionScore: 93,
        isMemoryActive: true,
      },
      {
        symbol: "BTCUSD",
        direction: "SELL",
        entryPrice: "89400.00",
        exitPrice: "91250.00",
        pnl: "-925.00",
        pnlPercent: "-1.85",
        lossCategory: "COUNTER_TREND",
        whatWentWrong:
          "Shorted Bitcoin on a 5m bearish engulfing candle while 4-Hour and Daily were violently bullish with continuous ETF institutional inflows.",
        theDreadedSin:
          "Standing in front of a freight train to pick up nickels. Counter-trend micro scalping against dominant institutional orderflow.",
        rootCause:
          "Overweighted lower timeframe oscillator (RSI 76) while completely disregarding HTF premium expansion regime.",
        ruleLearned:
          "DREAD RULE #405: Counter-trend shorting on Crypto/Indices is strictly forbidden when 4H EMA 20 > EMA 50 > EMA 200 and daily volume delta is positive.",
        preventedCount: 31,
        severity: "CRITICAL",
        patternSignature: {
          session: "NY_AFTERNOON",
          rsi: 76,
          distanceToKeyLevelPips: 140,
          timeframe: "5m",
        },
        aiReflectionScore: 98,
        isMemoryActive: true,
      },
      {
        symbol: "NAS100",
        direction: "BUY",
        entryPrice: "20780.0",
        exitPrice: "20710.0",
        pnl: "-350.00",
        pnlPercent: "-0.70",
        lossCategory: "SPREAD_WIDENING",
        whatWentWrong:
          "Market buy order fired exactly at 09:30:12 EST (opening bell). The broker spread spiked from 1.5 pts to 8.2 pts, eating half the stop distance upon execution.",
        theDreadedSin:
          "Jumping into the Wall Street opening bell pit with a market order like a blind gambler.",
        rootCause:
          "Did not require limit order or wait for opening 5-minute volatility settling.",
        ruleLearned:
          "DREAD RULE #512: Zero market orders permitted between 09:29:45 and 09:34:59 EST on US Indices. Wait for the opening 5-minute candle to print.",
        preventedCount: 16,
        severity: "MEDIUM",
        patternSignature: {
          session: "NY_OPEN",
          rsi: 52,
          distanceToKeyLevelPips: 18,
          spreadAtEntry: 8.2,
          timeframe: "1m",
        },
        aiReflectionScore: 91,
        isMemoryActive: true,
      },
    ]);

    // 5. Active Trades & Historical Trades
    await db.insert(trades).values([
      {
        ticket: 8842109,
        symbol: "EURUSD",
        direction: "BUY",
        lotSize: "0.75",
        entryPrice: "1.08410",
        currentPrice: "1.08520",
        stopLoss: "1.08180",
        takeProfit1: "1.08750",
        takeProfit2: "1.09100",
        takeProfit3: "1.09450",
        pnl: "82.50",
        pnlPercent: "0.15",
        commission: "3.75",
        swap: "-0.40",
        status: "OPEN",
        riskReward: "2.80",
        strategy: "SMC 15m FVG Mitigation + Dread Rule #104 Pass",
        dreadChecked: true,
        dreadCheckSummary:
          "Verified against Dread Rule #104: Waited for 15m MSS candle close at 08:35 GMT. Asian high already swept, entering on discount mitigation.",
      },
      {
        ticket: 8842115,
        symbol: "XAUUSD",
        direction: "BUY",
        lotSize: "0.40",
        entryPrice: "2738.20",
        currentPrice: "2748.80",
        stopLoss: "2731.00",
        takeProfit1: "2755.00",
        takeProfit2: "2768.00",
        takeProfit3: "2785.00",
        pnl: "424.00",
        pnlPercent: "0.78",
        commission: "4.00",
        swap: "-1.10",
        status: "OPEN",
        riskReward: "3.20",
        strategy: "Gold London Liquidity Grab & Bullish Order Block",
        dreadChecked: true,
        dreadCheckSummary:
          "Verified against Dread Rule #207: No USD red-folder events for next 3 hours. Spread stable at 18 pts.",
      },
      {
        ticket: 8841980,
        symbol: "BTCUSD",
        direction: "BUY",
        lotSize: "0.25",
        entryPrice: "92850.00",
        currentPrice: "94820.00",
        stopLoss: "91400.00",
        takeProfit1: "95200.00",
        takeProfit2: "97500.00",
        pnl: "492.50",
        pnlPercent: "0.91",
        commission: "2.50",
        swap: "0.00",
        status: "BE_ACTIVE",
        riskReward: "2.90",
        strategy: "HTF Trend Continuation + ETF Flow Influx",
        dreadChecked: true,
        dreadCheckSummary:
          "Followed Dread Rule #405: Long-only rule respected. TP1 almost reached, Stop Loss raised to Entry +$50 buffer.",
      },
      {
        ticket: 8841450,
        symbol: "US30",
        direction: "SELL",
        lotSize: "0.50",
        entryPrice: "44210.0",
        currentPrice: "43890.0",
        stopLoss: "44380.0",
        takeProfit1: "43890.0",
        closePrice: "43890.0",
        pnl: "160.00",
        pnlPercent: "0.30",
        commission: "5.00",
        swap: "-2.30",
        status: "CLOSED",
        riskReward: "2.60",
        strategy: "Daily Rejection at 44.2k Psychological Resistance",
        dreadChecked: true,
        dreadCheckSummary: "No counter-trend violations. TP1 reached and closed clean.",
        closeReason: "TP1_HIT",
      },
      {
        ticket: 8840920,
        symbol: "GBPUSD",
        direction: "BUY",
        lotSize: "0.60",
        entryPrice: "1.26600",
        currentPrice: "1.27450",
        stopLoss: "1.26250",
        takeProfit1: "1.27200",
        takeProfit2: "1.27450",
        closePrice: "1.27450",
        pnl: "510.00",
        pnlPercent: "0.94",
        commission: "3.00",
        swap: "-0.80",
        status: "CLOSED",
        riskReward: "3.10",
        strategy: "London Open MSS Bullish Expansion",
        dreadChecked: true,
        dreadCheckSummary:
          "Applied Dread Rule #318: Patiently held position without premature BE strangle until TP1 secured at 1.27200.",
        closeReason: "TP2_HIT",
      },
    ]);

    // 6. Recent Agent Debates (Council Room)
    await db.insert(agentDebates).values([
      {
        symbol: "EURUSD",
        timeframe: "15m",
        action: "BUY",
        confidenceScore: 88,
        proposedLot: "0.75",
        proposedEntry: "1.08410",
        proposedSL: "1.08180",
        proposedTP: "1.08750",
        riskReward: "2.80",
        dreadWarningActive: true,
        dreadWarningDetails:
          "Dread Memory Match: 81% similarity to Loss #104 (premature London breakout). Agent Council adjusted setup to require 15m MSS candle close.",
        historicalLossMatchId: 1,
        synthesis:
          "Council Quorum reached 4-1. SMC Quant and Grok confirmed liquidity grab completion. Dread Critic authorized execution after entry was refined to discount FVG.",
        executedTradeId: 1,
        status: "CONCLUDED",
        messages: [
          {
            agentId: "smc_quant",
            agentName: "SMC OrderFlow Quant",
            avatar: "📐",
            role: "Market Structure & Liquidity",
            stance: "BULLISH",
            message:
              "We have a confirmed sweep of the Asian session low at 1.08210 followed by an impulsive 15m candle closing above prior swing high. Fair Value Gap created between 1.08380-1.08420.",
            confidence: 91,
            timestamp: "10:14:22",
          },
          {
            agentId: "grok_sentiment",
            agentName: "Grok Macro & Sentiment Scout",
            avatar: "⚡",
            role: "Sentiment & News Intelligence",
            stance: "BULLISH",
            message:
              "ECB speakers were dovish earlier, but DXY is stalling at 104.40 resistance like an old diesel engine. Retail traders are 68% net-short EURUSD, meaning smart money is primed to squeeze them upward.",
            confidence: 85,
            timestamp: "10:15:05",
          },
          {
            agentId: "post_mortem_critic",
            agentName: "Dreaded Critic (Self-Reflection)",
            avatar: "🧠",
            role: "Post-Mortem & Memory Arbiter",
            stance: "ADJUST",
            message:
              "⚠️ HOLD ON! Memory alert: This looks suspiciously like Loss #104 where we bought prematurely and got chopped. However, in #104 we bought the high. Here, we swept the LOW and waited for the 15m close. If we place our entry at 1.08410 inside the FVG with SL below the sweep (1.08180), Dread Rule #104 is satisfied.",
            confidence: 94,
            timestamp: "10:15:40",
            dreadWarningRef: "DREAD RULE #104",
          },
          {
            agentId: "risk_sentinel",
            agentName: "Risk Guardian Sentinel",
            avatar: "🛡️",
            role: "Capital Preservation & Prop Rules",
            stance: "BULLISH",
            message:
              "Entry 1.08410, SL 1.08180 (23 pips). Target TP1 1.08750 (34 pips) gives 1.48R, TP2 1.09100 gives 3.0R. Account risk on 0.75 lots = $172.50, exactly 0.31% of equity. Well under our 1.0% limit.",
            confidence: 96,
            timestamp: "10:16:10",
          },
          {
            agentId: "execution_sniper",
            agentName: "Execution & Trailing Sniper",
            avatar: "🎯",
            role: "MT5 Bridge & Order Execution",
            stance: "BULLISH",
            message:
              "Ticket dispatched to MT5 Bridge server. Execution latency 14ms. Order filled at 1.08410. Trailing stop parameters locked to Dread Rule #318 (no BE movement until TP1).",
            confidence: 98,
            timestamp: "10:16:15",
          },
        ],
      },
      {
        symbol: "US30",
        timeframe: "5m",
        action: "VETOED",
        confidenceScore: 32,
        proposedLot: "0.50",
        proposedEntry: "43950.0",
        proposedSL: "44080.0",
        proposedTP: "43600.0",
        riskReward: "2.69",
        dreadWarningActive: true,
        dreadWarningDetails:
          "Dread Alert: Proposed trade matches Dread Rule #512 (Opening Bell Slippage) and Dread Rule #405 (Shorting without 1H alignment). VETOED by Dreaded Critic.",
        historicalLossMatchId: 5,
        synthesis:
          "Vetoed by Risk Sentinel and Dreaded Critic. Setup violated opening bell spread threshold and attempted counter-trend shorting on ambiguous volume.",
        executedTradeId: null,
        status: "REJECTED",
        messages: [
          {
            agentId: "smc_quant",
            agentName: "SMC OrderFlow Quant",
            avatar: "📐",
            role: "Market Structure & Liquidity",
            stance: "BEARISH",
            message:
              "Seeing minor 5m liquidity grab of 43950.0 with bearish displacement. Proposing short scalp.",
            confidence: 55,
            timestamp: "09:31:02",
          },
          {
            agentId: "post_mortem_critic",
            agentName: "Dreaded Critic (Self-Reflection)",
            avatar: "🧠",
            role: "Post-Mortem & Memory Arbiter",
            stance: "VETO",
            message:
              "🛑 ABSOLUTELY NOT. Have we learned nothing from Loss #1150? It is 09:31 EST! Opening bell spread on US30 is currently 4.8 points! Dread Rule #512 strictly mandates zero trades during the opening 5-minute bell.",
            confidence: 99,
            timestamp: "09:31:18",
            dreadWarningRef: "DREAD RULE #512",
          },
          {
            agentId: "risk_sentinel",
            agentName: "Risk Guardian Sentinel",
            avatar: "🛡️",
            role: "Capital Preservation & Prop Rules",
            stance: "VETO",
            message:
              "Seconding the veto. Spread slippage expectation is 40% of stop distance. Trade rejected by Sentinel safety protocol.",
            confidence: 100,
            timestamp: "09:31:25",
          },
        ],
      },
    ]);

    // 7. AI Settings
    await db.insert(aiSettings).values({
      autopilotEnabled: true,
      autonomousMode: "AUTONOMOUS",
      maxDailyDrawdownPct: "3.00",
      riskPerTradePct: "1.00",
      maxOpenTrades: 4,
      minRiskReward: "2.50",
      grokTone: "unfiltered",
      preferredSessions: "LONDON_AND_NY",
      postMortemFrequency: "IMMEDIATE_ON_CLOSE",
      minConsensusQuorum: 3,
      dreadThresholdPct: 70,
    });

    // 8. System Logs
    await db.insert(systemLogs).values([
      {
        level: "INFO",
        source: "MT5 Bridge",
        message: "MetaTrader 5 EA Bridge initialized. Ping: 14ms to ICMarketsSC-Live04.",
      },
      {
        level: "DREAD_ALERT",
        source: "Dreaded Critic",
        message:
          "Dread Rule #512 triggered on US30 5m short attempt. Prevented execution during opening bell chaos.",
      },
      {
        level: "TRADE_EXEC",
        source: "Execution Sniper",
        message: "Order #8842109 EURUSD BUY 0.75 filled at 1.08410. TP1: 1.08750, SL: 1.08180.",
      },
      {
        level: "INFO",
        source: "Autonomous Engine",
        message:
          "Council Quorum active. 5 agents online. Neural Dread memory bank loaded with 5 active guard rules.",
      },
    ]);

    console.log("Database seeded successfully!");
  } catch (err) {
    console.error("Error seeding database:", err);
  }
}
