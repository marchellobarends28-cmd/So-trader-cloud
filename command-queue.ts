import { db } from "@/db";
import { mt5Commands, systemLogs } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";

export type CommandType =
  | "EXECUTE_TRADE"
  | "MODIFY_POSITION"
  | "CLOSE_POSITION"
  | "CLOSE_ALL"
  | "SYNC_HISTORY"
  | "PING";

/** Durable, idempotent command queue polled by the MT5 Expert Advisor. */
export async function enqueueCommand(input: {
  type: CommandType;
  symbol?: string;
  direction?: "BUY" | "SELL";
  lot?: number;
  stopLoss?: number;
  takeProfit?: number;
  ticket?: string;
  payload?: Record<string, unknown>;
  source?: "AGENT" | "MANUAL" | "RISK";
  localTradeId?: number;
}): Promise<{ commandId: string; id: number }> {
  const commandId = `cmd_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  const [row] = await db
    .insert(mt5Commands)
    .values({
      commandId,
      type: input.type,
      symbol: input.symbol ?? null,
      direction: input.direction ?? null,
      lot: input.lot !== undefined ? input.lot.toString() : null,
      stopLoss: input.stopLoss !== undefined ? input.stopLoss.toString() : null,
      takeProfit: input.takeProfit !== undefined ? input.takeProfit.toString() : null,
      ticket: input.ticket ?? null,
      payload: input.payload ?? {},
      source: input.source ?? "AGENT",
      status: "PENDING",
      localTradeId: input.localTradeId ?? null,
    })
    .returning();

  await db.insert(systemLogs).values({
    level: "INFO",
    source: "MT5 Command Queue",
    message: `Queued ${input.type}${input.symbol ? ` ${input.direction ?? ""} ${input.symbol}` : ""} for EA pickup (${commandId}).`,
  });

  return { commandId, id: row.id };
}

export async function getPendingCommands(limit = 10) {
  // Only PENDING commands are handed out, and each is marked SENT exactly once.
  // This is what prevents a duplicate broker order on the next poll.
  const pending = await db
    .select()
    .from(mt5Commands)
    .where(eq(mt5Commands.status, "PENDING"))
    .orderBy(asc(mt5Commands.createdAt))
    .limit(limit);

  for (const cmd of pending) {
    await db
      .update(mt5Commands)
      .set({ status: "SENT", sentAt: new Date(), attempts: cmd.attempts + 1 })
      .where(and(eq(mt5Commands.id, cmd.id), eq(mt5Commands.status, "PENDING")));
  }

  return pending.map((c) => ({
    commandId: c.commandId,
    type: c.type,
    symbol: c.symbol,
    direction: c.direction,
    lot: c.lot ? Number(c.lot) : 0,
    stopLoss: c.stopLoss ? Number(c.stopLoss) : 0,
    takeProfit: c.takeProfit ? Number(c.takeProfit) : 0,
    ticket: c.ticket ?? "",
    comment: `GROK5 ${c.source.toLowerCase()}`,
    createdAt: new Date(c.createdAt).toISOString(),
  }));
}

/** Expire commands the EA never acknowledged so the queue cannot grow forever. */
export async function expireStaleCommands() {
  const stale = await db
    .select()
    .from(mt5Commands)
    .where(eq(mt5Commands.status, "SENT"))
    .orderBy(desc(mt5Commands.createdAt))
    .limit(50);

  for (const cmd of stale) {
    const sentMs = cmd.sentAt ? new Date(cmd.sentAt).getTime() : new Date(cmd.createdAt).getTime();
    if (Date.now() - sentMs > 120_000) {
      await db
        .update(mt5Commands)
        .set({ status: "EXPIRED", resultText: "EA did not acknowledge within 120s" })
        .where(eq(mt5Commands.id, cmd.id));
    }
  }
}
