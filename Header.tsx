"use client";

import React from "react";
import { MT5AccountItem, AISettingsItem } from "@/lib/types";
import {
  Brain,
  Zap,
  Server,
  Sliders,
  Shield,
  Activity,
  Play,
  Pause,
  RefreshCw,
  Power,
} from "lucide-react";

interface HeaderProps {
  account: MT5AccountItem | null;
  settings: AISettingsItem | null;
  onOpenMT5Modal: () => void;
  onOpenSettingsModal: () => void;
  onToggleAutopilot: () => Promise<void>;
  onTriggerTick: () => Promise<void>;
  isTicking: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  account,
  settings,
  onOpenMT5Modal,
  onOpenSettingsModal,
  onToggleAutopilot,
  onTriggerTick,
  isTicking,
}) => {
  const isAutopilot = settings?.autopilotEnabled ?? true;

  return (
    <header className="bg-slate-950 border-b border-slate-800/80 px-4 py-3 sticky top-0 z-40 backdrop-blur-md bg-slate-950/90">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Logo & Brand */}
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            </div>
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-extrabold tracking-tight text-white flex items-center space-x-1.5">
                <span>GROK-5</span>
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-mono font-bold">
                  AUTONOMOUS MT5
                </span>
              </h1>
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-slate-400">
              <span className="flex items-center space-x-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{account?.serverName || "ICMarketsSC-Live04"}</span>
              </span>
              <span>•</span>
              <span className="font-mono">Ping: 14ms</span>
              <span>•</span>
              <span>Dread Memory Guard v2.4</span>
            </div>
          </div>
        </div>

        {/* Account Financials Widget */}
        <div className="hidden md:flex items-center space-x-4 bg-slate-900/80 border border-slate-800 px-3.5 py-1.5 rounded-xl text-xs">
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
              MT5 Account #{account?.accountNumber || "9148205"}
            </span>
            <span className="font-mono font-bold text-white text-sm">
              ${Number(account?.equity || 55710.2).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="h-7 w-[1px] bg-slate-800"></div>

          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Balance</span>
            <span className="font-mono text-slate-200 text-xs">
              ${Number(account?.balance || 54280.5).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="h-7 w-[1px] bg-slate-800"></div>

          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Free Margin</span>
            <span className="font-mono text-emerald-400 text-xs font-semibold">
              ${Number(account?.freeMargin || 54460.2).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Control Actions */}
        <div className="flex items-center space-x-2">
          {/* Autopilot Master Switch */}
          <button
            onClick={onToggleAutopilot}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
              isAutopilot
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 shadow-sm shadow-emerald-500/10"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
            }`}
          >
            <Power className={`w-3.5 h-3.5 ${isAutopilot ? "text-emerald-400" : "text-slate-400"}`} />
            <span>Autopilot: {isAutopilot ? "ENGAGED" : "PAUSED"}</span>
          </button>

          {/* Trigger Market Tick */}
          <button
            onClick={onTriggerTick}
            disabled={isTicking}
            title="Simulate MT5 Market Tick & Recalculate PnL"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isTicking ? "animate-spin text-blue-400" : ""}`} />
          </button>

          {/* MT5 Bridge Modal Button */}
          <button
            onClick={onOpenMT5Modal}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Server className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">MT5 Bridge</span>
          </button>

          {/* Brain Settings */}
          <button
            onClick={onOpenSettingsModal}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Sliders className="w-4 h-4 text-purple-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
