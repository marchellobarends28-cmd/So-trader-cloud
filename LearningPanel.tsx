"use client";

import React from "react";
import { LearningProgressItem } from "@/lib/types";
import {
  Brain,
  Play,
  Check,
  X,
  Loader2,
  Info,
  AlertTriangle,
  GitBranch,
  Percent,
  Clock3,
  BarChart3,
} from "lucide-react";

interface LearningPanelProps {
  learning: LearningProgressItem | null;
  onRunLearning: () => Promise<void>;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  running: boolean;
  authenticated: boolean;
  onRequestLogin: () => void;
}

const ConditionTable: React.FC<{ title: string; rows: { key: string; trades: number; winRatePct: number; expectancyR: number }[] }> = ({
  title,
  rows,
}) => (
  <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{title}</div>
    {rows.length === 0 ? (
      <p className="text-[10px] text-slate-500">No samples yet.</p>
    ) : (
      <div className="space-y-1">
        {rows.slice(0, 6).map((r) => (
          <div key={r.key} className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-300">{r.key}</span>
            <span className="text-slate-500">{r.trades}t</span>
            <span className="text-slate-400">{r.winRatePct}%</span>
            <span className={r.expectancyR >= 0 ? "text-emerald-400" : "text-rose-400"}>{r.expectancyR.toFixed(2)}R</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

export const LearningPanel: React.FC<LearningPanelProps> = ({
  learning,
  onRunLearning,
  onApprove,
  onReject,
  running,
  authenticated,
  onRequestLogin,
}) => {
  const pending = (learning?.proposals ?? []).filter((p) => p.status === "PENDING");
  const decided = (learning?.proposals ?? []).filter((p) => p.status !== "PENDING");

  return (
    <div className="space-y-4">
      {/* Honest labelling */}
      <div className="rounded-xl border border-blue-900/50 bg-blue-950/20 p-3 text-[11px] text-blue-200 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <strong>What this actually is:</strong> a deterministic statistical learning loop. It performs trade attribution,
          condition analysis and a bounded parameter search, then validates candidates on genuinely out-of-sample bars and
          walk-forward windows. <strong>There is no neural network and no language model making trading decisions.</strong>{" "}
          Nothing changes the live strategy without your approval.
        </div>
      </div>

      {/* Active strategy */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-xs font-bold text-white">Active strategy: {learning?.activeVersion?.label ?? "baseline"}</div>
              <div className="text-[10px] text-slate-500">
                Origin {learning?.activeVersion?.origin ?? "BASELINE"}
                {learning?.activeVersion?.approvedAt ? ` · approved ${new Date(learning.activeVersion.approvedAt).toLocaleDateString()}` : " · not yet replaced"}
              </div>
            </div>
          </div>
          <button
            onClick={authenticated ? onRunLearning : onRequestLogin}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60 px-3 py-2 text-[11px] font-bold text-white"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Testing parameters…" : "Run learning cycle"}
          </button>
        </div>

        {learning?.activeVersion?.params && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(learning.activeVersion.params)
              .filter(([k]) => !["label"].includes(k))
              .slice(0, 12)
              .map(([k, v]) => (
                <span key={k} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {k}={String(v)}
                </span>
              ))}
          </div>
        )}

        <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-1.5">
          <Clock3 className="w-3 h-3" />
          {learning?.lastRunAt
            ? `Last cycle ${new Date(learning.lastRunAt).toLocaleString()} — ${learning.lastRunSummary ?? ""}`
            : "No learning cycle has run yet on genuine data."}
        </div>
      </div>

      {/* Proposals */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-purple-400" /> Strategy proposals ({pending.length} pending)
        </h3>

        {pending.length === 0 && decided.length === 0 && (
          <p className="text-[11px] text-slate-500">
            No proposals yet. The engine only creates one when a candidate beats the active strategy out-of-sample on genuine
            MT5 data (≥300 in-sample trades, positive OOS expectancy, walk-forward majority positive).
          </p>
        )}

        {pending.map((p) => {
          const delta =
            p.oosExpectancy !== null && p.baselineOosExpectancy !== null ? p.oosExpectancy - p.baselineOosExpectancy : null;
          return (
            <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-white">{p.title}</div>
                  <div className="text-[10px] text-slate-400">
                    OOS expectancy {p.oosExpectancy?.toFixed(3) ?? "—"}R vs baseline {p.baselineOosExpectancy?.toFixed(3) ?? "—"}R
                    {delta !== null && (
                      <span className={delta > 0 ? "text-emerald-400" : "text-rose-400"}>
                        {" "}
                        ({delta > 0 ? "+" : ""}
                        {delta.toFixed(3)}R)
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 flex items-center gap-1">
                    {p.independentSupport ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" /> Independent out-of-sample support verified
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3 h-3 text-amber-400" /> Lacks independent support — cannot apply
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={authenticated ? () => onApprove(p.id) : onRequestLogin}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white"
                  >
                    <Check className="w-3 h-3" /> Approve
                  </button>
                  <button
                    onClick={authenticated ? () => onReject(p.id) : onRequestLogin}
                    className="flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {decided.length > 0 && (
          <div className="text-[10px] text-slate-500 space-y-0.5 pt-1 border-t border-slate-800">
            {decided.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <span className="truncate">{p.title}</span>
                <span className={p.status === "APPLIED" ? "text-emerald-400" : p.status === "REJECTED" ? "text-slate-400" : "text-amber-400"}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mistakes */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Recurring mistakes ({learning?.mistakes.length ?? 0})
        </h3>
        {(learning?.mistakes ?? []).length === 0 ? (
          <p className="text-[11px] text-slate-500">Not enough closed trades to attribute mistakes yet.</p>
        ) : (
          <div className="space-y-1.5">
            {learning!.mistakes.map((m) => (
              <div key={m.code} className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-200">{m.label}</span>
                  <span className="font-mono text-slate-400">
                    {m.occurrences}× · <span className={m.expectancyR >= 0 ? "text-emerald-400" : "text-rose-400"}>{m.expectancyR}R</span>
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{m.suggestion}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Learned conditions */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <BarChart3 className="w-3.5 h-3.5 text-emerald-400" /> Learned conditions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ConditionTable title="By market regime" rows={learning?.conditions.byRegime ?? []} />
          <ConditionTable title="By entry hour (UTC)" rows={learning?.conditions.byHour ?? []} />
          <ConditionTable title="By symbol" rows={learning?.conditions.bySymbol ?? []} />
          <ConditionTable title="By close reason" rows={learning?.conditions.bySetup ?? []} />
        </div>
        <p className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
          <Percent className="w-3 h-3" /> Expectancy is measured in R (risk multiples) from genuine closed trades. Small samples
          are not treated as evidence.
        </p>
      </div>
    </div>
  );
};
