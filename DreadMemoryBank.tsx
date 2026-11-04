"use client";

import React, { useState } from "react";
import { DreadedPostMortemItem } from "@/lib/types";
import {
  Brain,
  ShieldCheck,
  AlertOctagon,
  Sparkles,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  Skull,
  RotateCcw,
  Zap,
} from "lucide-react";

interface DreadMemoryBankProps {
  postMortems: DreadedPostMortemItem[];
  onToggleRule: (ruleId: number, isActive: boolean) => Promise<void>;
  onTriggerReflection: (tradeData: {
    symbol: string;
    direction: "BUY" | "SELL";
    entryPrice: number;
    exitPrice: number;
    pnl: number;
  }) => Promise<void>;
}

export const DreadMemoryBank: React.FC<DreadMemoryBankProps> = ({
  postMortems,
  onToggleRule,
  onTriggerReflection,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [isSimulatingReflection, setIsSimulatingReflection] = useState(false);
  const [showSimModal, setShowSimModal] = useState(false);

  // Simulation form state
  const [simSymbol, setSimSymbol] = useState("XAUUSD");
  const [simDirection, setSimDirection] = useState<"BUY" | "SELL">("SELL");
  const [simEntry, setSimEntry] = useState(2740);
  const [simExit, setSimExit] = useState(2758);
  const [simPnl, setSimPnl] = useState(-550);

  // Calculate high-level stats
  const totalPrevented = postMortems.reduce((acc, p) => acc + (p.preventedCount || 0), 0);
  const activeCount = postMortems.filter((p) => p.isMemoryActive).length;
  const avgReflectionScore =
    postMortems.length > 0
      ? Math.round(postMortems.reduce((acc, p) => acc + (p.aiReflectionScore || 90), 0) / postMortems.length)
      : 95;

  // Estimated capital saved
  const avgLoss = 460;
  const capitalSaved = totalPrevented * avgLoss;

  // Filter items
  const filtered = postMortems.filter((p) => {
    if (selectedCategory === "ALL") return true;
    return p.lossCategory === selectedCategory;
  });

  const handleSimulate = async () => {
    setIsSimulatingReflection(true);
    try {
      await onTriggerReflection({
        symbol: simSymbol,
        direction: simDirection,
        entryPrice: simEntry,
        exitPrice: simExit,
        pnl: simPnl,
      });
      setShowSimModal(false);
    } finally {
      setIsSimulatingReflection(false);
    }
  };

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case "LIQUIDITY_TRAP":
        return <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">Liquidity Trap</span>;
      case "NEWS_SLIPPAGE":
        return <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold">News Slippage</span>;
      case "COUNTER_TREND":
        return <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-bold">Counter-Trend</span>;
      case "EARLY_BE_STOP":
        return <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold">Premature BE</span>;
      case "SPREAD_WIDENING":
        return <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-bold">Spread Widening</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-bold">{cat}</span>;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <span>The Dreaded Hall of Failures</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">
                Self-Reflective Playbook
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              The AI rigorously dissects its previous catastrophic trades, analyzes why it was wrong, and commits preventative rules so it never repeats the dreaded sin.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowSimModal(true)}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 transition-all active:scale-95"
        >
          <Skull className="w-3.5 h-3.5" />
          <span>Simulate Post-Mortem Dissection</span>
        </button>
      </div>

      {/* Quantitative Self-Improvement Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Dreaded Sins Memorized</span>
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1">
            {postMortems.length}{" "}
            <span className="text-xs text-emerald-400 font-normal">({activeCount} Active Guards)</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Enforced before every MT5 execution</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Disasters Prevented</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 mt-1 flex items-center space-x-1.5">
            <span>{totalPrevented}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400">
              +12 this week
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Trades vetoed by the Dread Critic</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Capital Preserved</span>
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-blue-400 mt-1">
            ${capitalSaved.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Estimated losses averted by memory</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Self-Reflection Score</span>
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-purple-400 mt-1">
            {avgReflectionScore}%
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Quality of algorithmic learning</div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-thin text-xs">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0 pr-1">
          Filter Sins:
        </span>
        {[
          { id: "ALL", label: "All Sins" },
          { id: "LIQUIDITY_TRAP", label: "Liquidity Traps" },
          { id: "NEWS_SLIPPAGE", label: "News Slippage" },
          { id: "COUNTER_TREND", label: "Counter-Trend" },
          { id: "EARLY_BE_STOP", label: "Premature BE" },
          { id: "SPREAD_WIDENING", label: "Spread Widening" },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-2.5 py-1 rounded-md shrink-0 border transition-colors ${
              selectedCategory === cat.id
                ? "bg-slate-800 border-slate-600 text-white font-medium"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* List of Dreaded Post-Mortems */}
      <div className="space-y-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`border rounded-xl p-4 transition-all duration-200 ${
              item.isMemoryActive
                ? "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                : "bg-slate-950/40 border-slate-900 opacity-60"
            }`}
          >
            {/* Card Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800/80">
              <div className="flex items-center space-x-2.5">
                <span className="text-xs font-bold text-white bg-slate-800 px-2 py-0.5 rounded">
                  #{item.id} {item.symbol} {item.direction}
                </span>
                {getCategoryBadge(item.lossCategory)}
                <span className="text-xs font-mono font-bold text-rose-400">
                  {Number(item.pnl) < 0 ? `-$${Math.abs(Number(item.pnl)).toFixed(2)}` : `+$${Number(item.pnl).toFixed(2)}`}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  ({item.pnlPercent}%)
                </span>
              </div>

              <div className="flex items-center space-x-3">
                {/* Prevented Counter Badge */}
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Saved {item.preventedCount} trades</span>
                </div>

                {/* Toggle Guard Button */}
                <button
                  onClick={() => onToggleRule(item.id, !item.isMemoryActive)}
                  title={item.isMemoryActive ? "Deactivate Guard Rule" : "Activate Guard Rule"}
                  className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white"
                >
                  {item.isMemoryActive ? (
                    <ToggleRight className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="w-6 h-6 text-slate-600" />
                  )}
                  <span className="text-[11px]">{item.isMemoryActive ? "Active" : "Muted"}</span>
                </button>
              </div>
            </div>

            {/* Grok's Scathing Sin Diagnosis */}
            <div className="mb-2.5 bg-rose-950/20 border border-rose-900/30 rounded-lg p-2.5">
              <div className="text-[11px] font-bold text-rose-400 flex items-center space-x-1.5 uppercase tracking-wider mb-1">
                <Skull className="w-3.5 h-3.5" />
                <span>The Dreaded Sin (Grok Diagnosis)</span>
              </div>
              <p className="text-xs text-rose-200/90 italic font-serif leading-relaxed">
                "{item.theDreadedSin}"
              </p>
            </div>

            {/* What Went Wrong vs Root Cause */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mb-3">
              <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  What Went Wrong:
                </div>
                <p className="text-slate-300 leading-relaxed">{item.whatWentWrong}</p>
              </div>

              <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Root Cause Flaw:
                </div>
                <p className="text-slate-300 leading-relaxed">{item.rootCause}</p>
              </div>
            </div>

            {/* The Rule Learned & Committed into Neural Playbook */}
            <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-2.5 flex items-start space-x-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  Neural Rule Committed to Memory Bank:
                </div>
                <p className="text-xs font-mono text-emerald-200 font-semibold mt-0.5">
                  {item.ruleLearned}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Simulation Modal for User to Experience Real-Time Self-Reflection */}
      {showSimModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Brain className="w-5 h-5 text-rose-400" />
                <h4 className="text-base font-bold text-white">
                  Simulate Catastrophic Loss Dissection
                </h4>
              </div>
              <button
                onClick={() => setShowSimModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Input any trade parameters or test scenario. The Grok Post-Mortem Critic will analyze what went wrong, rip the flaw to shreds, and synthesize a permanent rule for the memory bank!
            </p>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Symbol</label>
                  <select
                    value={simSymbol}
                    onChange={(e) => setSimSymbol(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white"
                  >
                    <option value="EURUSD">EURUSD</option>
                    <option value="GBPUSD">GBPUSD</option>
                    <option value="XAUUSD">XAUUSD</option>
                    <option value="BTCUSD">BTCUSD</option>
                    <option value="US30">US30</option>
                    <option value="NAS100">NAS100</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Direction</label>
                  <select
                    value={simDirection}
                    onChange={(e) => setSimDirection(e.target.value as "BUY" | "SELL")}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white"
                  >
                    <option value="BUY">BUY (Long)</option>
                    <option value="SELL">SELL (Short)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Entry Price</label>
                  <input
                    type="number"
                    value={simEntry}
                    onChange={(e) => setSimEntry(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Exit Price (SL)</label>
                  <input
                    type="number"
                    value={simExit}
                    onChange={(e) => setSimExit(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Loss Amount ($)</label>
                  <input
                    type="number"
                    value={simPnl}
                    onChange={(e) => setSimPnl(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-rose-400 font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowSimModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSimulate}
                disabled={isSimulatingReflection}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center space-x-1.5 shadow-lg shadow-rose-600/20"
              >
                {isSimulatingReflection ? (
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>{isSimulatingReflection ? "Dissecting Failure..." : "Execute AI Self-Reflection"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
