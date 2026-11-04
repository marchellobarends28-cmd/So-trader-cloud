"use client";

import React from "react";
import { QualityReportItem, ValidationReportItem, BacktestRunItem, InstrumentSpecItem } from "@/lib/types";
import {
  ShieldCheck,
  ShieldX,
  Database,
  FlaskConical,
  CalendarClock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Unlock,
  Info,
} from "lucide-react";

interface ValidationPanelProps {
  validation: ValidationReportItem | null;
  quality: QualityReportItem[];
  backtests: BacktestRunItem[];
  specs: Record<string, InstrumentSpecItem>;
  onRunBacktest: () => Promise<void>;
  onAuditData: () => Promise<void>;
  onSyncHistory: () => Promise<void>;
  isSyncing: boolean;
  onStartDemo: () => Promise<void>;
  onApproveLive: () => Promise<void>;
  onRevokeLive: () => Promise<void>;
  isRunningBacktest: boolean;
  isAuditing: boolean;
  authenticated: boolean;
  onRequestLogin: () => void;
}

const SOURCE_STYLE: Record<string, string> = {
  MT5_HISTORY: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  MT5_LIVE: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  SIMULATION: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  MIXED: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  NONE: "text-slate-400 border-slate-600/40 bg-slate-700/20",
};

export const ValidationPanelV4: React.FC<ValidationPanelProps> = ({
  validation,
  quality,
  backtests,
  specs,
  onRunBacktest,
  onAuditData,
  onSyncHistory,
  isSyncing,
  onStartDemo,
  onApproveLive,
  onRevokeLive,
  isRunningBacktest,
  isAuditing,
  authenticated,
  onRequestLogin,
}) => {
  const gate = (id: string) => validation?.gates.find((g) => g.id === id);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3 text-[11px] text-amber-200 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <strong>Minimum requirements, not guarantees.</strong> Live trading stays locked until every gate passes on genuine
          MT5 data. These thresholds reduce the chance of deploying a broken system; they cannot promise profit.
        </div>
      </div>

      {/* Gates */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            {validation?.passed ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldX className="w-4 h-4 text-amber-400" />}
            Validation gates ({validation?.gates.filter((g) => g.passed).length ?? 0}/{validation?.gates.length ?? 0})
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={authenticated ? onApproveLive : onRequestLogin}
              disabled={!validation?.passed}
              className="flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 text-[10px] font-bold text-white"
            >
              <Unlock className="w-3 h-3" /> Approve live
            </button>
            <button
              onClick={authenticated ? onRevokeLive : onRequestLogin}
              className="flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-300"
            >
              <Lock className="w-3 h-3" /> Revoke live
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          {(validation?.gates ?? []).map((g) => (
            <div
              key={g.id}
              className={`rounded-lg border p-2 ${g.passed ? "border-emerald-900/40 bg-emerald-950/15" : "border-slate-800 bg-slate-950/60"}`}
            >
              <div className="flex items-start gap-2">
                {g.passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-slate-600 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-slate-200">{g.label}</span>
                    <span className="text-[9px] font-mono text-slate-400">{g.actual}</span>
                  </div>
                  <div className="text-[10px] text-slate-500">Target: {g.target}</div>
                  {!g.passed && <div className="text-[10px] text-amber-400/90 mt-0.5">{g.evidence}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data integrity */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-blue-400" /> Market data integrity
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={authenticated ? onSyncHistory : onRequestLogin}
              disabled={isSyncing}
              className="flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-500 px-2.5 py-1.5 text-[10px] font-bold text-white"
            >
              {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
              Sync history from EA
            </button>
            <button
              onClick={authenticated ? onAuditData : onRequestLogin}
              disabled={isAuditing}
              className="flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-200"
            >
              {isAuditing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
              Re-audit
            </button>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-[10px] text-left">
            <thead className="text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-1.5 pr-2">Symbol</th>
                <th className="py-1.5 pr-2">Source</th>
                <th className="py-1.5 pr-2">Bars</th>
                <th className="py-1.5 pr-2">Gaps</th>
                <th className="py-1.5 pr-2">Dupes</th>
                <th className="py-1.5 pr-2">Bad OHLC</th>
                <th className="py-1.5 pr-2">Dev %</th>
                <th className="py-1.5">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {quality.map((q) => (
                <tr key={q.symbol}>
                  <td className="py-1.5 pr-2 font-bold text-slate-200">{q.symbol}</td>
                  <td className="py-1.5 pr-2">
                    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${SOURCE_STYLE[q.source] ?? SOURCE_STYLE.NONE}`}>
                      {q.source}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-slate-300">{q.bars}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{q.gaps}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{q.duplicates}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{q.invalidOhlc}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{q.priceDeviationPct ?? "—"}</td>
                  <td className="py-1.5">
                    {q.passed ? <span className="text-emerald-400 font-bold">PASS</span> : <span className="text-amber-400">needs data</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          Simulation rows are rejected for validation. Import genuine history from the EA (Validation tab → the EA syncs via
          SYNC_HISTORY) before running profitability tests.
        </p>
      </div>

      {/* Backtest */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <FlaskConical className="w-3.5 h-3.5 text-purple-400" /> Institutional backtests (genuine data only)
          </h3>
          <button
            onClick={authenticated ? onRunBacktest : onRequestLogin}
            disabled={isRunningBacktest}
            className="flex items-center gap-1 rounded-md bg-purple-600 hover:bg-purple-500 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-60"
          >
            {isRunningBacktest ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
            Run all symbols
          </button>
        </div>

        {backtests.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            No genuine-data backtests yet. Costs modelled: spread, slippage, commission, contract size, broker min lot/step, 2%
            daily and 4% weekly breakers, chronological in-sample / out-of-sample split and walk-forward windows.
          </p>
        ) : (
          <div className="space-y-1.5">
            {backtests.slice(0, 6).map((b) => {
              const metrics = (b.metrics ?? {}) as {
                outOfSample?: { expectancyR?: number; trades?: number };
                walkForward?: { passed?: boolean; positiveWindows?: number };
                runGateFailures?: string[];
              };
              return (
                <div key={b.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-white">
                      {b.symbol} · {b.tradesTaken} trades · PF {b.profitFactor} · DD {b.maxDrawdownPct}% · {b.expectancyR}R
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${b.passedGate ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10"}`}>
                      {b.passedGate ? "GATE PASS" : "GATE FAIL"}
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                    {b.barsSource} · OOS {metrics.outOfSample?.expectancyR ?? "—"}R ({metrics.outOfSample?.trades ?? 0}t) · WF{" "}
                    {metrics.walkForward?.passed ? "pass" : "fail"} ({metrics.walkForward?.positiveWindows ?? 0} positive)
                  </div>
                  {!b.passedGate && metrics.runGateFailures && metrics.runGateFailures.length > 0 && (
                    <div className="text-[9px] text-amber-400/80 mt-0.5">{metrics.runGateFailures.join(" · ")}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Instrument specs */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Broker instrument specifications</h3>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-[10px] text-left">
            <thead className="text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-1.5 pr-2">Symbol</th>
                <th className="py-1.5 pr-2">Contract</th>
                <th className="py-1.5 pr-2">Min lot</th>
                <th className="py-1.5 pr-2">Step</th>
                <th className="py-1.5 pr-2">Stops (pts)</th>
                <th className="py-1.5 pr-2">Comm/lot</th>
                <th className="py-1.5">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {Object.values(specs).map((s) => (
                <tr key={s.symbol}>
                  <td className="py-1.5 pr-2 font-bold text-slate-200">{s.symbol}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{s.contractSize}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{s.minLot}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{s.lotStep}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{s.stopsLevelPoints}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{s.commissionPerLot}</td>
                  <td className="py-1.5">
                    <span className={s.source === "BROKER" ? "text-emerald-400" : "text-amber-400"}>{s.source ?? "DEFAULT"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500">
          Defaults are conservative fallbacks. Values marked DEFAULT have not yet been confirmed by your terminal; the EA
          uploads the real values automatically on connect.
        </p>
      </div>

      {/* Demo forward test */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-amber-400" /> Demo forward test
          </h3>
          <button
            onClick={authenticated ? onStartDemo : onRequestLogin}
            className="flex items-center gap-1 rounded-md bg-amber-600 hover:bg-amber-500 px-2.5 py-1.5 text-[10px] font-bold text-white"
          >
            <CalendarClock className="w-3 h-3" /> Start / restart 30-day run
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
            <div className="text-[9px] text-slate-400 uppercase">Days elapsed</div>
            <div className="text-sm font-bold text-white">{validation?.demoDaysElapsed ?? 0}</div>
          </div>
          <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
            <div className="text-[9px] text-slate-400 uppercase">Required</div>
            <div className="text-sm font-bold text-white">30</div>
          </div>
          <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
            <div className="text-[9px] text-slate-400 uppercase">Critical errors</div>
            <div className={`text-sm font-bold ${(validation?.criticalErrors ?? 0) === 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {validation?.criticalErrors ?? 0}
            </div>
          </div>
        </div>
        {validation && validation.blockers.length > 0 && (
          <div className="mt-2 text-[10px] text-slate-500 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-400 shrink-0" />
            <span>{validation.blockers.length} blocker(s) remain before live approval.</span>
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-slate-500">
          Demo mode is enforced by the server and the EA. Restarting the run resets the clock — the 30 days must be continuous.
        </p>
      </div>
    </div>
  );
};
