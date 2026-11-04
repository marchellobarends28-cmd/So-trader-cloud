import { NextResponse } from "next/server";
import { computeValidationReport, startDemoForwardRun } from "@/lib/validation-gates";
import { auditBars, loadBars, type Timeframe } from "@/lib/market-data";
import { getAllSpecs } from "@/lib/broker-specs";
import { setState } from "@/lib/risk";
import { requireAuth, unauthorized } from "@/lib/auth";
import { db } from "@/db";
import { mt5Accounts, demoForwardRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getBridgeStatus } from "@/lib/mt5-bridge";

export const dynamic = "force-dynamic";

const SYMBOLS = ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "US30", "NAS100"];

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(auth);
  const [report, specs, runs] = await Promise.all([
    computeValidationReport(),
    getAllSpecs(),
    db.select().from(demoForwardRuns).orderBy(desc(demoForwardRuns.startedAt)).limit(5),
  ]);
  return NextResponse.json({ success: true, report, specs, forwardRuns: runs });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireAuth(request, body.apiKey);
  if (!auth.ok) return unauthorized(auth);

  const action = String(body.action || "").toUpperCase();

  if (action === "AUDIT_DATA") {
    const results = [];
    for (const symbol of SYMBOLS) {
      const bars = await loadBars(symbol, "M15" as Timeframe, 50);
      if (bars.length === 0) {
        results.push({ symbol, skipped: true, reason: "no stored bars" });
        continue;
      }
      results.push(await auditBars(symbol, "M15"));
    }
    return NextResponse.json({ success: true, results });
  }

  if (action === "START_DEMO_RUN") {
    const [account] = await db.select().from(mt5Accounts).limit(1);
    const bridge = await getBridgeStatus();
    if (!account || !account.isDemo || !bridge?.isLive || !account.accountNumber || account.accountNumber === "NOT_CONNECTED") {
      return NextResponse.json({ success: false, error: "A live-connected MT5 demo account is required before starting the 30-day forward test." }, { status: 409 });
    }
    const run = await startDemoForwardRun({
      accountNumber: account.accountNumber,
      isDemo: true,
    });
    return NextResponse.json({ success: true, run });
  }

  if (action === "APPROVE_LIVE") {
    const report = await computeValidationReport();
    if (!report.passed) {
      return NextResponse.json(
        { success: false, error: "Gates not passed. Live execution stays locked.", blockers: report.blockers },
        { status: 409 }
      );
    }
    await setState("live_override", {
      allowed: true,
      approvedAt: new Date().toISOString(),
      approvedBy: auth.via === "BRIDGE_KEY" ? "bridge-key" : "dashboard-user",
    });
    return NextResponse.json({ success: true, message: "Live override approved for this account." });
  }

  if (action === "REVOKE_LIVE") {
    await setState("live_override", { allowed: false, revokedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, message: "Live override revoked." });
  }

  return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
}
