"use client";

import React, { useState } from "react";
import { AgentItem, DebateItem } from "@/lib/types";
import { Bot, Shield, Brain, Zap, Target, AlertTriangle, CheckCircle2, Play, RefreshCw, XCircle } from "lucide-react";

interface AgentCouncilRoomProps {
  agents: AgentItem[];
  debates: DebateItem[];
  selectedSymbol: string;
  onTriggerAgentCycle: (symbol: string) => Promise<void>;
  isLoading: boolean;
}

export const AgentCouncilRoom: React.FC<AgentCouncilRoomProps> = ({
  agents,
  debates,
  selectedSymbol,
  onTriggerAgentCycle,
  isLoading,
}) => {
  const [selectedDebateId, setSelectedDebateId] = useState<number | null>(
    debates.length > 0 ? debates[0].id : null
  );

  const activeDebate = debates.find((d) => d.id === selectedDebateId) || debates[0];

  const getAgentIcon = (agentId: string) => {
    switch (agentId) {
      case "grok_sentiment":
        return <Zap className="w-4 h-4 text-amber-400" />;
      case "smc_quant":
        return <Bot className="w-4 h-4 text-blue-400" />;
      case "risk_sentinel":
        return <Shield className="w-4 h-4 text-emerald-400" />;
      case "execution_sniper":
        return <Target className="w-4 h-4 text-purple-400" />;
      case "post_mortem_critic":
        return <Brain className="w-4 h-4 text-rose-400" />;
      default:
        return <Bot className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <span>Autonomous Multi-Agent Council</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                5 Agents Quorum
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Grok sentiment scanner + SMC OrderFlow + Self-reflective dread memory guard
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onTriggerAgentCycle(selectedSymbol)}
            disabled={isLoading}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all ${
              isLoading
                ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/20 active:scale-95"
            }`}
          >
            {isLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isLoading ? "Deliberating..." : `Debate ${selectedSymbol} Setup`}</span>
          </button>
        </div>
      </div>

      {/* Agents Roster Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
        {agents.map((ag) => (
          <div
            key={ag.agentId}
            className="bg-slate-800/40 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between hover:border-slate-700/80 transition-colors"
          >
            <div className="flex items-center space-x-2 mb-1.5">
              <span className="text-base">{ag.avatar}</span>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-200 truncate">{ag.name.split(" ")[0]}</div>
                <div className="text-[10px] text-slate-400 truncate">{ag.role}</div>
              </div>
            </div>

            <div className="mt-1 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Acc: <strong className="text-slate-200">{ag.accuracyScore}%</strong></span>
              <span className="text-slate-400">
                Vetoed: <strong className="text-rose-400">{ag.lossesVetoed}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Debate Selector Strip (if multiple debates available) */}
      {debates.length > 1 && (
        <div className="flex items-center space-x-2 overflow-x-auto pb-2 mb-3 scrollbar-thin">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">
            Recent Debates:
          </span>
          {debates.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDebateId(d.id)}
              className={`px-2.5 py-1 rounded text-xs shrink-0 border transition-all ${
                activeDebate?.id === d.id
                  ? "bg-slate-800 border-indigo-500/60 text-white font-medium"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>{d.symbol}</span>{" "}
              <span
                className={`font-bold ml-1 ${
                  d.action === "BUY"
                    ? "text-emerald-400"
                    : d.action === "SELL"
                    ? "text-rose-400"
                    : "text-amber-400"
                }`}
              >
                {d.action}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Active Debate Transcript */}
      {activeDebate ? (
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 flex flex-col flex-1">
          {/* Debate Meta Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white">{activeDebate.symbol}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                TF: {activeDebate.timeframe}
              </span>
              <div
                className={`flex items-center space-x-1 text-xs px-2 py-0.5 rounded-full font-bold ${
                  activeDebate.action === "BUY"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : activeDebate.action === "SELL"
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                }`}
              >
                {activeDebate.action === "BUY" && <CheckCircle2 className="w-3.5 h-3.5" />}
                {activeDebate.action === "SELL" && <CheckCircle2 className="w-3.5 h-3.5" />}
                {activeDebate.action === "VETOED" && <XCircle className="w-3.5 h-3.5" />}
                <span>DECISION: {activeDebate.action}</span>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-xs text-slate-400">
              <span>
                Confidence: <strong className="text-white">{activeDebate.confidenceScore}%</strong>
              </span>
              <span>
                R:R <strong className="text-blue-400">{activeDebate.riskReward}:1</strong>
              </span>
              <span>
                Entry: <strong className="text-slate-200">{activeDebate.proposedEntry}</strong>
              </span>
            </div>
          </div>

          {/* Dread Warning Banner (if triggered) */}
          {activeDebate.dreadWarningActive && (
            <div className="mb-3 p-2.5 rounded-lg bg-rose-950/40 border border-rose-700/50 flex items-start space-x-2.5 text-xs text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <strong className="text-rose-300 uppercase tracking-wide">
                  ⚠️ Dread Memory Guard Intervened:
                </strong>
                <p className="mt-0.5 text-rose-200/90 leading-relaxed">
                  {activeDebate.dreadWarningDetails ||
                    "Pattern matches a previously catastrophic trade failure. Agents adapted or vetoed to protect equity."}
                </p>
              </div>
            </div>
          )}

          {/* Messages Stream */}
          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
            {activeDebate.messages.map((m, idx) => {
              const isGrok = m.agentId === "grok_sentiment";
              const isCritic = m.agentId === "post_mortem_critic";
              const isVeto = m.stance === "VETO";

              return (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg border transition-all ${
                    isCritic && isVeto
                      ? "bg-rose-950/20 border-rose-800/50"
                      : isGrok
                      ? "bg-amber-950/20 border-amber-800/40"
                      : "bg-slate-900/60 border-slate-800/80"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-base">{m.avatar}</span>
                      <span className="text-xs font-bold text-slate-200">{m.agentName}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                        {m.role}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 text-[10px]">
                      <span
                        className={`font-bold px-1.5 py-0.5 rounded ${
                          m.stance === "BULLISH"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : m.stance === "BEARISH"
                            ? "bg-rose-500/10 text-rose-400"
                            : m.stance === "VETO"
                            ? "bg-rose-500/20 text-rose-300 font-extrabold"
                            : "bg-amber-500/10 text-amber-300"
                        }`}
                      >
                        {m.stance}
                      </span>
                      <span className="text-slate-500 font-mono">{m.timestamp}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-sans">{m.message}</p>

                  {m.dreadWarningRef && (
                    <div className="mt-1.5 text-[10px] text-rose-400 font-mono flex items-center space-x-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Referenced: {m.dreadWarningRef}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Consensus Synthesis Footer */}
          <div className="mt-3 pt-2 border-t border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
            <span className="truncate pr-2">
              <strong className="text-slate-300">Council Synthesis:</strong> {activeDebate.synthesis}
            </span>
            <span className="text-slate-500 shrink-0">
              {activeDebate.executedTradeId
                ? `Dispatched to MT5 (Trade #${activeDebate.executedTradeId})`
                : "No MT5 order placed"}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-slate-500">
          No agent debates recorded yet. Click "Debate Setup" above to start autonomous council.
        </div>
      )}
    </div>
  );
};
