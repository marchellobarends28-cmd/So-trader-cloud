"use client";

import React, { useState } from "react";
import { AISettingsItem } from "@/lib/types";
import { Settings, Shield, Sliders, X, Check, Brain, Zap } from "lucide-react";

interface SettingsModalProps {
  settings: AISettingsItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: Partial<AISettingsItem>) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
}) => {
  const [autopilot, setAutopilot] = useState(settings?.autopilotEnabled ?? true);
  const [autonomousMode, setAutonomousMode] = useState(settings?.autonomousMode || "AUTONOMOUS");
  const [riskPerTrade, setRiskPerTrade] = useState(settings?.riskPerTradePct || 1.0);
  const [maxDrawdown, setMaxDrawdown] = useState(settings?.maxDailyDrawdownPct || 3.0);
  const [minRR, setMinRR] = useState(settings?.minRiskReward || 2.5);
  const [dreadThreshold, setDreadThreshold] = useState(settings?.dreadThresholdPct || 70);
  const [grokTone, setGrokTone] = useState<"unfiltered" | "professional" | "cynical">(
    (settings?.grokTone as "unfiltered" | "professional" | "cynical") || "unfiltered"
  );
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        autopilotEnabled: autopilot,
        autonomousMode,
        riskPerTradePct: riskPerTrade,
        maxDailyDrawdownPct: maxDrawdown,
        minRiskReward: minRR,
        dreadThresholdPct: dreadThreshold,
        grokTone,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Autonomous Trading Brain Settings</h3>
              <p className="text-xs text-slate-400">Risk boundaries, Grok persona, and Dread memory sensitivity</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs scrollbar-thin">
          {/* Autopilot Mode */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-200 block">Master Autonomous Autopilot</span>
                <span className="text-[11px] text-slate-400">
                  Allow agents to dispatch orders directly to MetaTrader 5
                </span>
              </div>
              <input
                type="checkbox"
                checked={autopilot}
                onChange={(e) => setAutopilot(e.target.checked)}
                className="w-5 h-5 accent-blue-600 rounded cursor-pointer"
              />
            </div>
          </div>

          {/* Mode Selector */}
          <div>
            <label className="text-slate-300 font-semibold block mb-1">Execution Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "AUTONOMOUS", label: "Full Autopilot" },
                { id: "SEMI_AUTONOMOUS", label: "Semi-Auto (1-Click)" },
                { id: "PAPER_SIMULATION", label: "Paper Sim" },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setAutonomousMode(m.id as "AUTONOMOUS" | "SEMI_AUTONOMOUS" | "PAPER_SIMULATION")}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    autonomousMode === m.id
                      ? "bg-blue-600/20 border-blue-500 text-white font-bold"
                      : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Risk parameters */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Risk Per Trade ({riskPerTrade}%)
              </label>
              <input
                type="range"
                min="0.25"
                max="3.0"
                step="0.25"
                value={riskPerTrade}
                onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <span className="text-[10px] text-slate-400">Computed via dynamic lot sizing</span>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Max Daily DD ({maxDrawdown}%)
              </label>
              <input
                type="range"
                min="1.0"
                max="6.0"
                step="0.5"
                value={maxDrawdown}
                onChange={(e) => setMaxDrawdown(Number(e.target.value))}
                className="w-full accent-rose-500"
              />
              <span className="text-[10px] text-slate-400">Emergency hard circuit breaker</span>
            </div>
          </div>

          {/* Dread Threshold Sensitivity */}
          <div className="bg-rose-950/20 p-3 rounded-xl border border-rose-900/40 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-rose-300 flex items-center space-x-1.5">
                <Brain className="w-4 h-4 text-rose-400" />
                <span>Dread Memory Veto Threshold</span>
              </span>
              <span className="font-mono font-bold text-rose-400">{dreadThreshold}%</span>
            </div>
            <p className="text-[11px] text-slate-300">
              If an incoming trade matches past catastrophic loss patterns by &gt; {dreadThreshold}%, the Dread Arbiter triggers a mandatory veto or stop widening.
            </p>
            <input
              type="range"
              min="50"
              max="90"
              step="5"
              value={dreadThreshold}
              onChange={(e) => setDreadThreshold(Number(e.target.value))}
              className="w-full accent-rose-500"
            />
          </div>

          {/* Grok Persona Tone */}
          <div>
            <label className="text-slate-300 font-semibold block mb-1 flex items-center space-x-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Grok Persona & Debate Tone</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "unfiltered", label: "Unfiltered / Witty" },
                { id: "cynical", label: "Hyper-Cynical" },
                { id: "professional", label: "Wall St Quant" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setGrokTone(t.id as "unfiltered" | "cynical" | "professional")}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    grokTone === t.id
                      ? "bg-amber-600/20 border-amber-500 text-white font-bold"
                      : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center space-x-1.5 shadow-lg shadow-blue-600/20"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isSaving ? "Saving..." : "Save Configuration"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
