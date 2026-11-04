"use client";

import React, { useState } from "react";
import { BacktestRunItem, ReadinessItem, DemoPlanTaskItem } from "@/lib/types";
import {
  FlaskConical,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Lock,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  ClipboardCheck,
  Radio,
  AlertTriangle,
} from "lucide-react";

interface ValidationLabProps {
  backtests: BacktestRunItem[];
  readiness: ReadinessItem | null;
  defaultSymbol: string;
  onRunBacktest: (params: { symbol: string; bars: number; riskPerTradePct: number }) => Promise<void>;
  onToggleTask: (taskKey: string, completed: boolean) => Promise<void>;
  isRunning: boolean;
}

const categoryMeta: Record<string, { label: string; color: string }> = {
  SETUP: { label: "1 · Environment", color: "text-slate-300" },
  BRIDGE: { label: "2 · Bridge connectivity", color: "text-blue-300" },
  RISK: { label: "3 · Hard risk limits", color: "text-emerald-300" },
  VALIDATION: { label: "4 · Strategy validation", color: "text-purple-300" },
  DEMO: { label: "5 · Demo forward test", color: "text-amber-300" },
};

export const ValidationLab: React.FC<ValidationLabProps> = ({
  backtests,
  readiness,
  defaultSymbol,
  onRunBacktest,
  onToggleTask,
  isRunning,
}) => {
  const [symbol, setSymbol] = useState(defaultSymbol === "EURUSD" ? "XAUUSD" : defaultSymbol);
  const [bars, setBars] = useState(4000);
  const [riskPct, setRiskPct] = useState(0.5);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const latest = backtests[0];
  const curve = (latest?.equityCurve ?? []) as { index: number; equity: number }[];
  const maxEq = curve.length ? Math.max(...curve.map((p) => p.equity)) : 1;
  const minEq = curve.length ? Math.min(...curve.map((p) => p.equity)) : 0;

  const toggle = async (key: string, completed: boolean) => {
    setBusyTask(key);
    try {
      await onToggleTask(key, completed);
    } finally {
      setBusyTask(null);
    }
  };

  const grouped = (readiness?.tasks ?? []).reduce<Record<string, DemoPlanTaskItem[]>>((acc, t) => {
    acc[t.category] = acc[t.category] ? [...acc[t.category], t] : [t];
    return acc;
  }, {});

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Backtest lab */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
        <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Backtest Lab</h3>
            <p className="text-[11px] text-slate-400">
              Deterministic replay of the exact production signal model. No randomness: same inputs → same result. Test several
              symbols — a single green run is not proof of edge.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-md p-1.5 text-white">
            {["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "US30", "NAS100"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={bars} onChange={(e) => setBars(Number(e.target.value))} className="bg-slate-950 border border-slate-700 rounded-md p-1.5 text-white">
            {[800, 1500, 2500, 4000].map((b) => (
              <option key={b} value={b}>{b} bars</option>
            ))}
          </select>
          <select value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} className="bg-slate-950 border border-slate-700 rounded-md p-1.5 text-white">
            {[0.25, 0.5, 1, 2].map((r) => (
              <option key={r} value={r}>{r}% risk</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => onRunBacktest({ symbol, bars, riskPerTradePct: riskPct })}
          disabled={isRunning}
          className="w-full flex items-center justify-center gap-2 rounded-md p-2 text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-60"
        >
          {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {isRunning ? "Replaying bars…" : "Run backtest"}
        </button>

        {latest ? (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">
                {latest.symbol} · {latest.bars} bars ·{" "}
                <span className={latest.barsSource === "MT5_HISTORY" ? "text-emerald-400" : "text-amber-400"}>
                  {latest.barsSource === "MT5_HISTORY" ? "MT5 history" : "synthetic (labelled)"}
                </span>
              </span>
              <span className={`px-2 py-0.5 rounded-full border font-bold flex items-center gap-1 ${latest.passedGate ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>
                {latest.passedGate ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {latest.passedGate ? "GATE PASSED" : "GATE FAILED"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {[
                { label: "Trades", value: String(latest.tradesTaken) },
                { label: "Win rate", value: `${latest.winRate}%` },
                { label: "Profit factor", value: String(latest.profitFactor) },
                { label: "Max DD", value: `${latest.maxDrawdownPct}%` },
                { label: "Expectancy", value: `${latest.expectancyR}R` },
                { label: "Net P&L", value: `$${latest.netProfit}` },
              ].map((m) => (
                <div key={m.label} className="bg-slate-950/60 border border-slate-800 rounded-md p-2">
                  <div className="text-slate-400">{m.label}</div>
                  <div className="font-bold text-slate-100 font-mono">{m.value}</div>
                </div>
              ))}
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Equity curve
              </div>
              <svg viewBox="0 0 300 70" className="w-full h-20">
                <polyline
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth="1.6"
                  points={curve
                    .map((p, i) => {
                      const x = (i / Math.max(curve.length - 1, 1)) * 300;
                      const y = 68 - ((p.equity - minEq) / Math.max(maxEq - minEq, 1)) * 64;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join(" ")}
                />
              </svg>
            </div>

            {!latest.passedGate && (
              <div className="text-[11px] bg-rose-950/30 border border-rose-800/50 rounded-md p-2 text-rose-300 space-y-1">
                <div className="font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Gate blockers</div>
                {((latest.metrics as { gateFailures?: string[] })?.gateFailures ?? []).map((f, i) => (
                  <div key={i}>• {f}</div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-slate-500">
            No backtest yet. Run one before risking real capital — this is the gate that blocks live trading.
          </p>
        )}
      </div>

      {/* Go-live checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Demo → Live Checklist</h3>
              <p className="text-[11px] text-slate-400">Auto-verified from the bridge, backtest and journal where possible.</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-white">{readiness?.readinessPct ?? 0}%</div>
            <div className="text-[10px] text-slate-400">ready</div>
          </div>
        </div>

        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${readiness?.readyForLive ? "bg-emerald-500" : "bg-amber-500"}`}
            style={{ width: `${readiness?.readinessPct ?? 0}%` }}
          />
        </div>

        <div className={`text-[11px] p-2 rounded-md border flex items-center gap-2 ${readiness?.readyForLive ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300" : "bg-amber-950/20 border-amber-800/40 text-amber-300"}`}>
          <Radio className="w-3.5 h-3.5 shrink-0" />
          {readiness?.readyForLive
            ? "All gates passed. Live execution is permitted — start with minimum size."
            : "LIVE EXECUTION BLOCKED. Paper/demo only until every required gate passes."}
        </div>

        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
          {Object.entries(grouped).map(([category, tasks]) => (
            <div key={category}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${categoryMeta[category]?.color ?? "text-slate-400"}`}>
                {categoryMeta[category]?.label ?? category}
              </div>
              <div className="space-y-1">
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-start gap-2 rounded-md border p-2 ${t.completed ? "bg-emerald-950/20 border-emerald-900/40" : "bg-slate-950/60 border-slate-800"}`}
                  >
                    <button
                      onClick={() => !t.autoVerified && toggle(t.taskKey, !t.completed)}
                      disabled={t.autoVerified || busyTask === t.taskKey}
                      className={`mt-0.5 shrink-0 ${t.autoVerified ? "cursor-default" : "cursor-pointer"}`}
                      title={t.autoVerified ? "Auto-verified from live data" : "Click to confirm"}
                    >
                      {busyTask === t.taskKey ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                      ) : t.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                        <span>{t.label}</span>
                        {t.autoVerified ? (
                          <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" /> auto
                          </span>
                        ) : (
                          <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">manual</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 leading-snug">{t.evidence ?? t.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {readiness && readiness.blockers.length > 0 && (
          <div className="text-[10px] text-slate-500 flex items-start gap-1">
            {readiness.readyForDemo ? <ShieldCheck className="w-3 h-3 text-emerald-400 mt-0.5" /> : <TrendingDown className="w-3 h-3 text-amber-400 mt-0.5" />}
            <span>
              {readiness.blockers.length} outstanding item(s). Demo capability:{" "}
              <strong className={readiness.readyForDemo ? "text-emerald-400" : "text-amber-400"}>
                {readiness.readyForDemo ? "available" : "needs a live EA heartbeat"}
              </strong>.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
