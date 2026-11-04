import { db } from "@/db";
import {
  mt5Accounts,
  mt5Commands,
  mt5Positions,
  marketAssets,
  trades,
  systemLogs,
} from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { generatePostMortemForClosedTrade } from "./agent-engine";
import { buildExpertAdvisorCode } from "./mql5-ea";
import { enqueueCommand, getPendingCommands, expireStaleCommands } from "./command-queue";
import { verifyApiKey } from "./auth";
import { updateSpecsFromBroker } from "./broker-specs";
import { getState, setState, recordRiskEvent } from "./risk";

export { enqueueCommand, getPendingCommands };
import type { Candle } from "./types";

export { EA_SETUP_STEPS } from "./mql5-ea";

interface IncomingQuote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  point?: number;
  digits?: number;
  pipSize?: number;
  time?: number;
}

interface IncomingPosition {
  ticket: string;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl?: number;
  tp?: number;
  profit: number;
  swap?: number;
  commission?: number;
  magic?: number;
  comment?: string;
}

export interface HeartbeatPayload {
  apiKey?: string;
  type?: string;
  eaVersion?: string;
  accountNumber?: string | number;
  broker?: string;
  server?: string;
  currency?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  leverage?: number;
  isDemo?: boolean;
  tradeAllowed?: boolean;
  riskBreaker?: boolean;
  riskProfile?: Record<string, unknown>;
  symbolSpecs?: {
    symbol: string;
    digits?: number;
    point?: number;
    contractSize?: number;
    tickSize?: number;
    tickValue?: number;
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
    stopsLevelPoints?: number;
    freezeLevelPoints?: number;
    commissionPerLot?: number;
    typicalSpreadPoints?: number;
  }[];
  quotes?: IncomingQuote[];
  positions?: IncomingPosition[];
  recentDeals?: Record<string, unknown>[];
}

export function buildEA(serverUrl: string, apiKey: string, symbols: string[]) {
  return buildExpertAdvisorCode({ serverUrl, apiKey, symbols });
}

/* ------------------------------------------------------------------ *
 * Heartbeat ingest: real prices, positions, deals
 * ------------------------------------------------------------------ */

export async function processBridgeHeartbeat(data: HeartbeatPayload) {
  const [account] = await db.select().from(mt5Accounts).limit(1);
  if (!account) return null;

  // --- Authentication: every bridge call needs the correct key ---
  const keyCheck = await verifyApiKey(data.apiKey);
  if (!keyCheck.ok) {
    await recordRiskEvent({
      severity: "CRITICAL",
      type: "AUTH_FAILURE",
      message: `Bridge heartbeat rejected: ${keyCheck.reason ?? "invalid API key"}`,
      metadata: { accountNumber: data.accountNumber ?? null },
    });
    throw new Error(keyCheck.reason ?? "Invalid bridge API key");
  }

  // --- Account identity verification / first-use adoption ---
  const reported = data.accountNumber !== undefined ? String(data.accountNumber) : "";
  const bound = await getState<{ accountNumber: string | null; adoptedAt: string | null }>("bridge_account", {
    accountNumber: null,
    adoptedAt: null,
  });

  if (bound.accountNumber && reported && bound.accountNumber !== reported) {
    await recordRiskEvent({
      severity: "CRITICAL",
      type: "ACCOUNT_MISMATCH",
      message: `Bridge account mismatch: expected ${bound.accountNumber}, received ${reported}. Heartbeat refused.`,
      metadata: { expected: bound.accountNumber, received: reported },
    });
    throw new Error(`Account identity mismatch: this bridge is bound to ${bound.accountNumber}`);
  }
  if (!bound.accountNumber && reported) {
    await setState("bridge_account", { accountNumber: reported, adoptedAt: new Date().toISOString() });
  }

  // --- Demo enforcement: a live account stays locked until gates are approved ---
  const liveOverride = await getState<{ allowed: boolean; approvedAt?: string }>("live_override", { allowed: false });
  if (data.isDemo === false && !liveOverride.allowed) {
    const lock = await getState<{ active: boolean; reason?: string }>("demo_lock", { active: false });
    if (!lock.active) {
      await setState("demo_lock", {
        active: true,
        reason: "Live account detected. Demo mode is mandatory until every validation gate passes.",
      });
      await recordRiskEvent({
        severity: "CRITICAL",
        type: "DEMO_LOCK",
        message: "LIVE account connected. Execution locked; attach a demo account until validation gates pass.",
      });
    }
  } else if (data.isDemo === true) {
    await setState("demo_lock", { active: false, reason: "Demo account connected." });
  }

  const now = new Date();

  await db
    .update(mt5Accounts)
    .set({
      balance: data.balance !== undefined ? data.balance.toFixed(2) : account.balance,
      equity: data.equity !== undefined ? data.equity.toFixed(2) : account.equity,
      margin: data.margin !== undefined ? data.margin.toFixed(2) : account.margin,
      freeMargin: data.freeMargin !== undefined ? data.freeMargin.toFixed(2) : account.freeMargin,
      leverage: data.leverage ?? account.leverage,
      isDemo: data.isDemo ?? account.isDemo,
      accountNumber: reported || account.accountNumber,
      broker: data.broker || account.broker,
      serverName: data.server || account.serverName,
      currency: data.currency || account.currency,
      isConnected: true,
      eaVersion: data.eaVersion ?? "unknown",
      tradeAllowedByEa: Boolean(data.tradeAllowed),
      eaRiskProfile: data.riskProfile ?? {},
      bridgeMode: "mql5_ea",
      lastHeartbeat: now,
      updatedAt: now,
    })
    .where(eq(mt5Accounts.id, account.id));

  const quotes = Array.isArray(data.quotes) ? data.quotes : [];
  let quotesApplied = 0;

  for (const q of quotes) {
    if (!q?.symbol) continue;
    const [asset] = await db.select().from(marketAssets).where(eq(marketAssets.symbol, q.symbol)).limit(1);
    if (!asset) continue;

    const bid = Number(q.bid);
    const ask = Number(q.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) continue;

    const mid = (bid + ask) / 2;
    const digits = q.digits ?? asset.digits;
    const candles = (asset.candles as Candle[]) ?? [];

    // Build/extend 1-minute candles directly from live ticks
    const bucket = Math.floor((q.time ? q.time * 1000 : Date.now()) / 60000) * 60000;
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      if (bucket <= last.time) {
        last.high = Math.max(last.high, mid);
        last.low = Math.min(last.low, mid);
        last.close = Number(mid.toFixed(digits));
      } else {
        candles.push({
          time: bucket,
          open: Number(mid.toFixed(digits)),
          high: Number(mid.toFixed(digits)),
          low: Number(mid.toFixed(digits)),
          close: Number(mid.toFixed(digits)),
          volume: 1,
        });
        if (candles.length > 900) candles.shift();
      }
    } else {
      candles.push({
        time: bucket,
        open: mid,
        high: mid,
        low: mid,
        close: mid,
        volume: 1,
      });
    }

    await db
      .update(marketAssets)
      .set({
        currentPrice: mid.toFixed(5),
        bid: bid.toFixed(5),
        ask: ask.toFixed(5),
        spread: (q.spread ?? asset.spread).toString(),
        high24h: Math.max(Number(asset.high24h), mid).toFixed(5),
        low24h: Math.min(Number(asset.low24h), mid).toFixed(5),
        candles,
        dataSource: "MT5_LIVE",
        lastTickAt: now,
        updatedAt: now,
      })
      .where(eq(marketAssets.id, asset.id));

    quotesApplied++;
  }

  // --- Reconcile broker positions into local trade rows ---
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const openTicketSet = new Set(positions.map((p) => String(p.ticket)));

  for (const p of positions) {
    const ticket = String(p.ticket);
    await db
      .insert(mt5Positions)
      .values({
        ticket,
        symbol: p.symbol,
        direction: p.direction,
        volume: Number(p.volume).toString(),
        priceOpen: Number(p.priceOpen).toString(),
        priceCurrent: Number(p.priceCurrent).toString(),
        stopLoss: p.sl ? Number(p.sl).toString() : null,
        takeProfit: p.tp ? Number(p.tp).toString() : null,
        profit: Number(p.profit ?? 0).toFixed(2),
        swap: Number(p.swap ?? 0).toFixed(2),
        commission: Number(p.commission ?? 0).toFixed(2),
        magic: p.magic ?? 0,
        comment: p.comment ?? "",
        isOpen: true,
        reportedAt: now,
      })
      .onConflictDoUpdate({
        target: mt5Positions.ticket,
        set: {
          priceCurrent: Number(p.priceCurrent).toString(),
          volume: Number(p.volume).toString(),
          stopLoss: p.sl ? Number(p.sl).toString() : null,
          takeProfit: p.tp ? Number(p.tp).toString() : null,
          profit: Number(p.profit ?? 0).toFixed(2),
          swap: Number(p.swap ?? 0).toFixed(2),
          isOpen: true,
          reportedAt: now,
        },
      });

    // Journal a real broker position that the server did not create
    const existing = await db
      .select()
      .from(trades)
      .where(eq(trades.externalTicket, ticket))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(trades).values({
        ticket: Number(ticket.replace(/\D/g, "").slice(-9)) || Date.now() % 1000000000,
        externalTicket: ticket,
        symbol: p.symbol,
        direction: p.direction,
        lotSize: Number(p.volume).toFixed(2),
        entryPrice: Number(p.priceOpen).toFixed(5),
        currentPrice: Number(p.priceCurrent).toFixed(5),
        stopLoss: Number(p.sl ?? 0).toFixed(5),
        takeProfit1: Number(p.tp ?? 0).toFixed(5),
        pnl: Number(p.profit ?? 0).toFixed(2),
        commission: Number(p.commission ?? 0).toFixed(2),
        swap: Number(p.swap ?? 0).toFixed(2),
        status: "OPEN",
        strategy: p.comment || "MT5 broker position (unmanaged)",
        isSimulated: false,
        dreadChecked: false,
        dreadCheckSummary: "Opened outside the agent bridge - no Dread pre-trade check recorded",
      });
    } else {
      await db
        .update(trades)
        .set({
          currentPrice: Number(p.priceCurrent).toFixed(5),
          pnl: Number(p.profit ?? 0).toFixed(2),
          status: "OPEN",
          isSimulated: false,
        })
        .where(eq(trades.id, existing[0].id));
    }
  }

  // Positions that vanished were closed at the broker
  const locallyLive = await db
    .select()
    .from(trades)
    .where(and(eq(trades.isSimulated, false), eq(trades.status, "OPEN")));

  for (const t of locallyLive) {
    if (!t.externalTicket) continue;
    if (openTicketSet.has(t.externalTicket)) continue;

    const [mirror] = await db
      .select()
      .from(mt5Positions)
      .where(eq(mt5Positions.ticket, t.externalTicket))
      .limit(1);

    const exitPrice = mirror ? Number(mirror.priceCurrent) : Number(t.currentPrice);
    const realized = mirror ? Number(mirror.profit) : Number(t.pnl);

    await db
      .update(trades)
      .set({
        status: "CLOSED",
        closePrice: exitPrice.toFixed(5),
        closeTime: now,
        closeReason: "BROKER_CLOSED",
        pnl: realized.toFixed(2),
        pnlPercent: ((realized / Math.max(Number(account.balance), 1)) * 100).toFixed(2),
      })
      .where(eq(trades.id, t.id));

    await db
      .update(mt5Positions)
      .set({ isOpen: false })
      .where(eq(mt5Positions.ticket, t.externalTicket));

    if (realized < 0) {
      await generatePostMortemForClosedTrade({
        tradeId: t.id,
        symbol: t.symbol,
        direction: t.direction as "BUY" | "SELL",
        entryPrice: Number(t.entryPrice),
        exitPrice,
        pnl: realized,
        pnlPercent: (realized / Math.max(Number(account.balance), 1)) * 100,
        closeReason: "SL_HIT",
      });
    }
  }

  // --- Broker instrument specifications (real contract sizes, lot steps, stops level) ---
  if (Array.isArray(data.symbolSpecs) && data.symbolSpecs.length > 0) {
    await updateSpecsFromBroker(data.symbolSpecs);
  }

  // --- Expire commands the EA never acknowledged (no late execution) ---
  await expireStaleCommands();

  // Command polling: each PENDING command is delivered exactly once
  const commands = data.type === "heartbeat" || !data.type ? await getPendingCommands() : [];

  return {
    status: "OK",
    serverTime: Date.now(),
    accountNumber: reported || account.accountNumber,
    quotesApplied,
    positionsSeen: positions.length,
    commands,
  };
}

/* ------------------------------------------------------------------ *
 * Command acknowledgement from the EA
 * ------------------------------------------------------------------ */

export async function ackCommand(payload: {
  apiKey?: string;
  commandId: string;
  status: "ACKED" | "FAILED";
  brokerTicket?: string;
  fillPrice?: number;
  message?: string;
  errorCode?: number;
}) {
  const [cmd] = await db
    .select()
    .from(mt5Commands)
    .where(eq(mt5Commands.commandId, payload.commandId))
    .limit(1);

  if (!cmd) throw new Error("Unknown commandId");

  await db
    .update(mt5Commands)
    .set({
      status: payload.status,
      brokerTicket: payload.brokerTicket || null,
      fillPrice: payload.fillPrice ? payload.fillPrice.toString() : null,
      resultText: payload.message ?? null,
      errorCode: payload.errorCode ?? null,
      ackedAt: new Date(),
    })
    .where(eq(mt5Commands.id, cmd.id));

  // Reflect the real fill on the queued local trade record
  if (cmd.localTradeId) {
    if (payload.status === "ACKED" && cmd.type === "EXECUTE_TRADE") {
      await db
        .update(trades)
        .set({
          status: "OPEN",
          isSimulated: false,
          externalTicket: payload.brokerTicket || null,
          brokerFillPrice: payload.fillPrice ? payload.fillPrice.toString() : null,
          currentPrice: payload.fillPrice ? payload.fillPrice.toString() : undefined,
        })
        .where(eq(trades.id, cmd.localTradeId));
    } else if (payload.status === "FAILED") {
      await db
        .update(trades)
        .set({
          status: "CANCELLED",
          isSimulated: false,
          closeReason: "BROKER_REJECTED",
          dreadCheckSummary: payload.message ?? "Broker rejected the order",
        })
        .where(eq(trades.id, cmd.localTradeId));
    }
  }

  await db.insert(systemLogs).values({
    level: payload.status === "ACKED" ? "TRADE_EXEC" : "WARN",
    source: "MT5 EA",
    message:
      payload.status === "ACKED"
        ? `EA acknowledged ${cmd.type}${payload.brokerTicket ? ` (broker ticket ${payload.brokerTicket})` : ""}. ${payload.message ?? ""}`
        : `EA rejected ${cmd.type}: ${payload.message ?? "unknown reason"}`,
    metadata: { commandId: cmd.commandId, type: cmd.type },
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Emergency actions
 * ------------------------------------------------------------------ */

export async function panicCloseAllTrades() {
  const { commandId } = await enqueueCommand({ type: "CLOSE_ALL", source: "RISK" });

  const simulatedOpen = await db
    .select()
    .from(trades)
    .where(and(eq(trades.status, "OPEN"), eq(trades.isSimulated, true)));

  for (const trade of simulatedOpen) {
    await db
      .update(trades)
      .set({
        status: "CLOSED",
        closePrice: trade.currentPrice,
        closeTime: new Date(),
        closeReason: "PANIC_CLOSE",
      })
      .where(eq(trades.id, trade.id));
  }

  const liveOpen = await db
    .select()
    .from(trades)
    .where(and(eq(trades.status, "OPEN"), eq(trades.isSimulated, false)));

  return {
    commandId,
    simulatedClosed: simulatedOpen.length,
    liveCloseRequested: liveOpen.length,
    message:
      liveOpen.length > 0
        ? `CLOSE_ALL queued to EA for ${liveOpen.length} live broker position(s). They close on the next EA poll (≤ 2s).`
        : "No live broker positions. Paper positions flattened locally.",
  };
}

export async function getBridgeStatus() {
  const [account] = await db.select().from(mt5Accounts).limit(1);
  if (!account) return null;

  const ageMs = Date.now() - new Date(account.lastHeartbeat).getTime();
  const isLive = account.isConnected && account.bridgeMode === "mql5_ea" && account.eaVersion !== "0.0.0" && account.eaVersion !== "unknown" && ageMs >= 0 && ageMs < 30_000;

  const pending = await db
    .select()
    .from(mt5Commands)
    .where(inArray(mt5Commands.status, ["PENDING", "SENT"]))
    .limit(20);

  const recentAcks = await db
    .select()
    .from(mt5Commands)
    .where(inArray(mt5Commands.status, ["ACKED", "FAILED", "EXPIRED"]))
    .orderBy(desc(mt5Commands.ackedAt))
    .limit(10);

  const allAssets = await db.select().from(marketAssets);
  const liveAsset = allAssets.find(
    (a) => a.dataSource === "MT5_LIVE" && a.lastTickAt && Date.now() - new Date(a.lastTickAt).getTime() < 60_000
  );

  return {
    account,
    isLive,
    heartbeatAgeSeconds: Math.round(ageMs / 1000),
    dataSource: liveAsset ? "MT5_LIVE" : "SIMULATION",
    accountBound: Boolean((await getState<{ accountNumber: string | null }>("bridge_account", { accountNumber: null })).accountNumber),
    demoLock: await getState<{ active: boolean; reason?: string }>("demo_lock", { active: false }),
    liveOverride: await getState<{ allowed: boolean }>("live_override", { allowed: false }),
    pendingCommands: pending,
    recentAcks,
  };
}
