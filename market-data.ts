import { db } from "@/db";
import { marketBars, dataQualityReports, marketAssets, systemLogs } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Candle } from "./types";

export type DataSource = "MT5_HISTORY" | "MT5_LIVE" | "SIMULATION";
export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1";

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  H1: 60,
  H4: 240,
  D1: 1440,
};

export interface IncomingBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface QualityReport {
  symbol: string;
  timeframe: string;
  bars: number;
  firstBarTime: number | null;
  lastBarTime: number | null;
  duplicates: number;
  outOfOrder: number;
  gaps: number;
  marketClosures: number;
  largestGapMinutes: number;
  invalidOhlc: number;
  futureBars: number;
  staleMinutes: number;
  priceDeviationPct: number | null;
  passed: boolean;
  issues: string[];
  source: DataSource | "MIXED" | "NONE";
}

const MIN_BARS_FOR_VALIDATION = 300;

export async function ingestBars(params: {
  symbol: string;
  timeframe: Timeframe;
  bars: IncomingBar[];
  source: DataSource;
}): Promise<{ inserted: number; skipped: number }> {
  const { symbol, timeframe, source } = params;

  // Never allow simulation rows to masquerade as market history.
  const clean = params.bars
    .filter(
      (b) =>
        Number.isFinite(b.time) &&
        Number.isFinite(b.open) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close) &&
        b.time > 0 &&
        b.open > 0 &&
        b.close > 0
    )
    .map((b) => ({ ...b, time: Math.floor(b.time) }))
    .sort((a, b) => a.time - b.time);

  let inserted = 0;
  let skipped = params.bars.length - clean.length;

  for (const b of clean) {
    try {
      await db
        .insert(marketBars)
        .values({
          symbol,
          timeframe,
          time: b.time,
          open: b.open.toString(),
          high: b.high.toString(),
          low: b.low.toString(),
          close: b.close.toString(),
          volume: Math.max(0, Math.floor(b.volume ?? 0)),
          source,
        })
        .onConflictDoUpdate({
          target: [marketBars.symbol, marketBars.timeframe, marketBars.time],
          set: {
            open: b.open.toString(),
            high: b.high.toString(),
            low: b.low.toString(),
            close: b.close.toString(),
            volume: Math.max(0, Math.floor(b.volume ?? 0)),
            source,
            importedAt: new Date(),
          },
        });
      inserted++;
    } catch {
      skipped++;
    }
  }

  if (inserted > 0) {
    await db.insert(systemLogs).values({
      level: "INFO",
      source: "Market Data",
      message: `Imported ${inserted} ${source} bar(s) for ${symbol} ${timeframe}.`,
    });
  }

  return { inserted, skipped };
}

export async function loadBars(symbol: string, timeframe: Timeframe, limit = 5000): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(marketBars)
    .where(and(eq(marketBars.symbol, symbol), eq(marketBars.timeframe, timeframe)))
    .orderBy(desc(marketBars.time))
    .limit(limit);

  return rows
    .map((r) => ({
      time: Number(r.time) * 1000,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: r.volume,
    }))
    .sort((a, b) => a.time - b.time);
}

export async function loadBarSources(symbol: string, timeframe: Timeframe): Promise<DataSource | "MIXED" | "NONE"> {
  const rows = await db
    .select({ source: marketBars.source })
    .from(marketBars)
    .where(and(eq(marketBars.symbol, symbol), eq(marketBars.timeframe, timeframe)))
    .limit(2000);

  if (rows.length === 0) return "NONE";
  const set = new Set(rows.map((r) => r.source));
  if (set.size > 1) return "MIXED";
  return [...set][0] as DataSource;
}

/**
 * Deterministic integrity audit of the stored series.
 * Checks ordering, duplicates, OHLC sanity, future timestamps, session gaps,
 * staleness and deviation from the live quote.
 */
export async function auditBars(symbol: string, timeframe: Timeframe): Promise<QualityReport> {
  const rows = await db
    .select()
    .from(marketBars)
    .where(and(eq(marketBars.symbol, symbol), eq(marketBars.timeframe, timeframe)))
    .orderBy(asc(marketBars.time));

  const issues: string[] = [];
  const intervalSec = TIMEFRAME_MINUTES[timeframe] * 60;
  const nowSec = Math.floor(Date.now() / 1000);

  let duplicates = 0;
  let outOfOrder = 0;
  let gaps = 0;
  let marketClosures = 0;
  let largestGapMinutes = 0;
  let invalidOhlc = 0;
  let futureBars = 0;

  const seen = new Set<number>();
  let prevTime: number | null = null;

  for (const r of rows) {
    const t = Number(r.time);
    const o = Number(r.open);
    const h = Number(r.high);
    const l = Number(r.low);
    const c = Number(r.close);

    if (seen.has(t)) duplicates++;
    seen.add(t);

    if (prevTime !== null && t < prevTime) outOfOrder++;
    if (prevTime !== null) {
      const diff = t - prevTime;
      if (diff > intervalSec * 1.5) {
        const gapMinutes = Math.round(diff / 60);
        largestGapMinutes = Math.max(largestGapMinutes, gapMinutes);
        // Gaps longer than 24h are treated as market closures (weekends/holidays)
        if (gapMinutes >= 24 * 60) marketClosures++;
        else gaps++;
      }
    }
    prevTime = t;

    if (!(h >= Math.max(o, c) && l <= Math.min(o, c) && l > 0)) invalidOhlc++;
    if (t > nowSec + 120) futureBars++;
  }

  const lastBarTime = rows.length > 0 ? Number(rows[rows.length - 1].time) : null;
  const firstBarTime = rows.length > 0 ? Number(rows[0].time) : null;
  const staleMinutes = lastBarTime ? Math.max(0, Math.round((nowSec - lastBarTime) / 60)) : 0;

  const [asset] = await db.select().from(marketAssets).where(eq(marketAssets.symbol, symbol)).limit(1);
  let priceDeviationPct: number | null = null;
  if (asset && lastBarTime) {
    const live = Number(asset.currentPrice);
    const barClose = Number(rows[rows.length - 1].close);
    if (live > 0 && barClose > 0) {
      priceDeviationPct = Number((Math.abs(live - barClose) / live * 100).toFixed(3));
    }
  }

  const sourceMap = new Set(rows.map((r) => r.source));
  const source: DataSource | "MIXED" | "NONE" =
    rows.length === 0 ? "NONE" : sourceMap.size > 1 ? "MIXED" : ([...sourceMap][0] as DataSource);

  if (rows.length === 0) issues.push("No stored bars for this symbol/timeframe");
  if (rows.length > 0 && rows.length < MIN_BARS_FOR_VALIDATION)
    issues.push(`Only ${rows.length} bars stored (minimum ${MIN_BARS_FOR_VALIDATION})`);
  if (duplicates > 0) issues.push(`${duplicates} duplicate timestamp(s)`);
  if (outOfOrder > 0) issues.push(`${outOfOrder} out-of-order bar(s)`);
  if (invalidOhlc > 0) issues.push(`${invalidOhlc} bar(s) with invalid OHLC geometry`);
  if (futureBars > 0) issues.push(`${futureBars} bar(s) timestamped in the future`);
  if (gaps > 0) issues.push(`${gaps} unexpected session gap(s), largest ${largestGapMinutes} min`);
  if (priceDeviationPct !== null && priceDeviationPct > 1)
    issues.push(`Last bar close deviates ${priceDeviationPct}% from the live quote`);
  if (source === "SIMULATION") issues.push("Series contains simulation bars - not usable for validation");
  if (source === "MIXED") issues.push("Series mixes data sources - not usable for validation");

  const passed =
    rows.length >= MIN_BARS_FOR_VALIDATION &&
    duplicates === 0 &&
    outOfOrder === 0 &&
    invalidOhlc === 0 &&
    futureBars === 0 &&
    gaps <= Math.max(2, Math.floor(rows.length * 0.01)) &&
    (priceDeviationPct === null || priceDeviationPct <= 1) &&
    source === "MT5_HISTORY";

  const report: QualityReport = {
    symbol,
    timeframe,
    bars: rows.length,
    firstBarTime,
    lastBarTime,
    duplicates,
    outOfOrder,
    gaps,
    marketClosures,
    largestGapMinutes,
    invalidOhlc,
    futureBars,
    staleMinutes,
    priceDeviationPct,
    passed,
    issues,
    source,
  };

  await db.insert(dataQualityReports).values({
    symbol,
    timeframe,
    bars: report.bars,
    firstBarTime: report.firstBarTime,
    lastBarTime: report.lastBarTime,
    duplicates,
    outOfOrder,
    gaps,
    largestGapMinutes,
    invalidOhlc,
    futureBars,
    staleMinutes,
    priceDeviationPct: priceDeviationPct !== null ? priceDeviationPct.toString() : null,
    passed,
    issues,
  });

  return report;
}

export async function latestQualityReports(): Promise<QualityReport[]> {
  const symbols = ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "US30", "NAS100"];
  const reports: QualityReport[] = [];

  for (const symbol of symbols) {
    const [row] = await db
      .select()
      .from(dataQualityReports)
      .where(eq(dataQualityReports.symbol, symbol))
      .orderBy(desc(dataQualityReports.createdAt))
      .limit(1);

    if (!row) {
      reports.push({
        symbol,
        timeframe: "M15",
        bars: 0,
        firstBarTime: null,
        lastBarTime: null,
        duplicates: 0,
        outOfOrder: 0,
        gaps: 0,
        marketClosures: 0,
        largestGapMinutes: 0,
        invalidOhlc: 0,
        futureBars: 0,
        staleMinutes: 0,
        priceDeviationPct: null,
        passed: false,
        issues: ["No audit run yet - import history from the EA"],
        source: "NONE",
      });
      continue;
    }

    reports.push({
      symbol: row.symbol,
      timeframe: row.timeframe,
      bars: row.bars,
      firstBarTime: row.firstBarTime ? Number(row.firstBarTime) : null,
      lastBarTime: row.lastBarTime ? Number(row.lastBarTime) : null,
      duplicates: row.duplicates,
      outOfOrder: row.outOfOrder,
      gaps: row.gaps,
      marketClosures: 0,
      largestGapMinutes: row.largestGapMinutes,
      invalidOhlc: row.invalidOhlc,
      futureBars: row.futureBars,
      staleMinutes: row.staleMinutes,
      priceDeviationPct: row.priceDeviationPct ? Number(row.priceDeviationPct) : null,
      passed: row.passed,
      issues: (row.issues as string[]) ?? [],
      source: row.passed ? "MT5_HISTORY" : "MIXED",
    });
  }
  return reports;
}

export const DATA_SOURCE_LABEL: Record<string, string> = {
  MT5_HISTORY: "Genuine MT5 history",
  MT5_LIVE: "Live MT5 ticks",
  SIMULATION: "Simulation",
  MIXED: "Mixed (invalid for validation)",
  NONE: "No data",
};
