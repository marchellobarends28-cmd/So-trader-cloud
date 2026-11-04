import { db } from "@/db";
import { marketAssets, trades, mt5Accounts, systemLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generatePostMortemForClosedTrade } from "./agent-engine";
import { Candle } from "./types";

const LIVE_TICK_FRESH_MS = 60_000;

/**
 * Simulation loop.
 *
 * IMPORTANT: assets whose `dataSource` is MT5_LIVE and that have a fresh tick
 * are never synthesised - the broker is the source of truth for both price and
 * P&L on those symbols. The synthetic walk only runs for explicitly simulated
 * symbols (no EA connected yet), so nothing fake is presented as a real quote.
 */
export async function tickMarketAndEvaluateTrades() {
  const assets = await db.select().from(marketAssets);
  const openTrades = await db.select().from(trades).where(eq(trades.status, "OPEN"));
  const [account] = await db.select().from(mt5Accounts).limit(1);

  const bridgeFresh = Boolean(
    account &&
      account.eaVersion !== "0.0.0" &&
      Date.now() - new Date(account.lastHeartbeat).getTime() < 30_000
  );

  let simulatedFloatingPnl = 0;

  for (const asset of assets) {
    const lastTickMs = asset.lastTickAt ? new Date(asset.lastTickAt).getTime() : 0;
    const isLiveFeed = asset.dataSource === "MT5_LIVE" && Date.now() - lastTickMs < LIVE_TICK_FRESH_MS;

    if (isLiveFeed) {
      // Real quotes already arrived from the EA. Do not touch the price.
      continue;
    }

    const currentPrice = parseFloat(asset.currentPrice);
    const digits = asset.digits;

    const volatility =
      asset.symbol === "BTCUSD"
        ? 45.0
        : asset.symbol === "XAUUSD"
        ? 0.8
        : asset.symbol.includes("USD")
        ? 0.00012
        : 6.0;

    // Deterministic-free synthetic walk is confined to simulation mode.
    const drift = (Math.random() - 0.495) * volatility;
    const newPrice = Number((currentPrice + drift).toFixed(digits));

    const candles = (asset.candles as Candle[]) || [];
    if (candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      const now = Date.now();
      if (now - lastCandle.time < 15 * 60 * 1000) {
        lastCandle.close = newPrice;
        lastCandle.high = Math.max(lastCandle.high, newPrice);
        lastCandle.low = Math.min(lastCandle.low, newPrice);
        lastCandle.volume += Math.floor(Math.random() * 5);
      } else {
        candles.push({
          time: now,
          open: newPrice,
          high: newPrice,
          low: newPrice,
          close: newPrice,
          volume: 10,
        });
        if (candles.length > 240) candles.shift();
      }
    }

    await db
      .update(marketAssets)
      .set({
        currentPrice: newPrice.toString(),
        high24h: Math.max(parseFloat(asset.high24h), newPrice).toString(),
        low24h: Math.min(parseFloat(asset.low24h), newPrice).toString(),
        candles,
        dataSource: "SIMULATION", // this branch only runs when the symbol is being synthesised
        updatedAt: new Date(),
      })
      .where(eq(marketAssets.id, asset.id));

    // Only SIMULATED trades are managed locally. Live broker trades are
    // closed by the EA at the broker and reconciled via heartbeat.
    const symbolTrades = openTrades.filter((t) => t.symbol === asset.symbol && t.isSimulated);

    for (const trade of symbolTrades) {
      const entryPrice = parseFloat(trade.entryPrice);
      const stopLoss = parseFloat(trade.stopLoss);
      const tp1 = parseFloat(trade.takeProfit1);
      const lotSize = parseFloat(trade.lotSize);
      const isBuy = trade.direction === "BUY";

      let pnl = 0;
      if (asset.symbol === "EURUSD" || asset.symbol === "GBPUSD") {
        pnl = (isBuy ? newPrice - entryPrice : entryPrice - newPrice) * lotSize * 100000;
      } else if (asset.symbol === "XAUUSD") {
        pnl = (isBuy ? newPrice - entryPrice : entryPrice - newPrice) * lotSize * 100;
      } else if (asset.symbol === "BTCUSD") {
        pnl = (isBuy ? newPrice - entryPrice : entryPrice - newPrice) * lotSize;
      } else {
        pnl = (isBuy ? newPrice - entryPrice : entryPrice - newPrice) * lotSize;
      }

      simulatedFloatingPnl += pnl;

      const slHit = isBuy ? newPrice <= stopLoss : newPrice >= stopLoss;
      const tpHit = isBuy ? newPrice >= tp1 : newPrice <= tp1;

      if (slHit) {
        await db
          .update(trades)
          .set({
            status: "CLOSED",
            currentPrice: newPrice.toString(),
            closePrice: newPrice.toString(),
            closeTime: new Date(),
            closeReason: "SL_HIT",
            pnl: pnl.toFixed(2),
            pnlPercent: ((pnl / 50000) * 100).toFixed(2),
          })
          .where(eq(trades.id, trade.id));

        await generatePostMortemForClosedTrade({
          tradeId: trade.id,
          symbol: trade.symbol,
          direction: trade.direction as "BUY" | "SELL",
          entryPrice,
          exitPrice: newPrice,
          pnl,
          pnlPercent: (pnl / 50000) * 100,
          closeReason: "SL_HIT",
        });
      } else if (tpHit) {
        await db
          .update(trades)
          .set({
            status: "CLOSED",
            currentPrice: newPrice.toString(),
            closePrice: newPrice.toString(),
            closeTime: new Date(),
            closeReason: "TP1_HIT",
            pnl: pnl.toFixed(2),
            pnlPercent: ((pnl / 50000) * 100).toFixed(2),
          })
          .where(eq(trades.id, trade.id));

        await db.insert(systemLogs).values({
          level: "TRADE_EXEC",
          source: "Paper Engine",
          message: `Take Profit 1 reached on simulated trade #${trade.ticket} ${trade.symbol}.`,
        });
      } else {
        await db
          .update(trades)
          .set({
            currentPrice: newPrice.toString(),
            pnl: pnl.toFixed(2),
            pnlPercent: ((pnl / 50000) * 100).toFixed(2),
          })
          .where(eq(trades.id, trade.id));
      }
    }
  }

  // Never overwrite broker-reported equity while a live EA is heartbeating.
  if (!bridgeFresh && account) {
    const balance = parseFloat(account.balance);
    const equity = balance + simulatedFloatingPnl;
    const margin = parseFloat(account.margin);
    const freeMargin = equity - margin;
    const marginLevel = margin > 0 ? (equity / margin) * 100 : 0;

    await db
      .update(mt5Accounts)
      .set({
        equity: equity.toFixed(2),
        freeMargin: freeMargin.toFixed(2),
        marginLevel: marginLevel.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(mt5Accounts.id, account.id));
  }
}
