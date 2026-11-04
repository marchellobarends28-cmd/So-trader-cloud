"use client";

import React from "react";
import {
  MT5AccountItem,
  MarketAssetItem,
  RiskSnapshotItem,
  ValidationReportItem,
  LearningProgressItem,
  BridgeStatusItem,
  TradeItem,
  DebateItem,
} from "@/lib/types";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  WifiOff,
  Activity,
  Brain,
  Ban,
  CircleDollarSign,
  Gauge,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from "lucide-react";

interface MobileOverviewProps {
  account: MT5AccountItem | null;
  assets: MarketAssetItem[];
  risk: RiskSnapshotItem | null;
  validation: ValidationReportItem | null;
  learning: LearningProgressItem | null;
  bridge: BridgeStatusItem | null;
  trades: TradeItem[];
  debates: DebateItem[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onEmergencyStop: () => Promise<void>;
  onCloseAll: () => Promise<void>;
  busy: boolean;
}

function money(n: number | undefined) {
  return `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: "up" | "down" | "neutral"; icon?: React.ReactNode }> = ({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}) => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
      <span>{label}</span>
      {icon}
    </div>
    <div
      className={`mt-1 font-mono font-bold text-base ${
        tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "text-white"
      }`}
    >
      {value}
    </div>
    {sub ? <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div> : null}
  </div>
);

export const MobileOverview: React.FC<MobileOverviewProps> = ({
  account,
  assets,
  risk,
  validation,
  learning,
  bridge,
  trades,
  debates,
  selectedSymbol,
  onSelectSymbol,
  onEmergencyStop,
  onCloseAll,
  busy,
}) => {
  const live = Boolean(bridge?.isLive);
  const lastDecision = debates[0];

  return (
    <div className="space-y-4">
      {/* Connection + mode strip */}
      <div
        className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2 text-[11px] ${
          live ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300" : "bg-amber-950/25 border-amber-800/40 text-amber-300"
        }`}
      >
        <div className="flex items-center gap-2">
          {live ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          <span>
            <strong>{live ? "MT5 connected" : "MT5 offline"}</strong>
            {account ? ` · ${account.accountNumber} · ${account.serverName}` : ""}
            {account ? ` · ${account.isDemo ? "DEMO" : "LIVE"}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {live ? `tick ${risk?.priceAgeSeconds ?? 0}s ago` : "no live ticks"}
          </span>
          <span className={risk?.emergencyStop ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
            {risk?.emergencyStop ? "EMERGENCY STOP" : "TRADING ARMED"}
          </span>
        </div>
      </div>

      {/* Account + P&L cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Equity"
          value={money(Number(account?.equity))}
          sub={`Balance ${money(Number(account?.balance))}`}
          icon={<Wallet className="w-3.5 h-3.5 text-blue-400" />}
        />
        <Stat
          label="Floating P&L"
          value={`${Number(risk?.floatingPnl ?? 0) >= 0 ? "+" : ""}${money(risk?.floatingPnl)}`}
          sub={`${trades.filter((t) => t.status === "OPEN").length} open position(s)`}
          tone={Number(risk?.floatingPnl ?? 0) >= 0 ? "up" : "down"}
          icon={<CircleDollarSign className="w-3.5 h-3.5 text-emerald-400" />}
        />
        <Stat
          label="Open risk"
          value={`${(risk?.openRiskPct ?? 0).toFixed(2)}%`}
          sub={`cap ${risk?.maxAggregateOpenRiskPct ?? 1}% · ${money(risk?.openRiskUsd)} at stop`}
          tone={(risk?.openRiskPct ?? 0) > (risk?.maxAggregateOpenRiskPct ?? 1) ? "down" : "neutral"}
          icon={<Gauge className="w-3.5 h-3.5 text-amber-400" />}
        />
        <Stat
          label="Daily drawdown"
          value={`${(risk?.dailyDrawdownPct ?? 0).toFixed(2)}%`}
          sub={`limit ${risk?.maxDailyDrawdownPct ?? 2}% · weekly ${(risk?.weeklyDrawdownPct ?? 0).toFixed(2)}% / ${risk?.maxWeeklyDrawdownPct ?? 4}%`}
          tone={(risk?.dailyDrawdownPct ?? 0) >= (risk?.maxDailyDrawdownPct ?? 2) ? "down" : "up"}
          icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
        />
      </div>

      {/* Emergency controls */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onEmergencyStop}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-bold text-sm py-3 shadow-lg shadow-rose-600/20 active:scale-[0.99]"
        >
          <Ban className="w-4 h-4" />
          {risk?.emergencyStop ? "Re-arm trading" : "Emergency stop"}
        </button>
        <button
          onClick={onCloseAll}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-rose-300 font-bold text-sm py-3 active:scale-[0.99]"
        >
          <ShieldAlert className="w-4 h-4" />
          Close all positions
        </button>
      </div>

      {risk && risk.breakers.length > 0 && (
        <div className="rounded-xl border border-rose-800/50 bg-rose-950/25 p-3 text-[11px] text-rose-200 space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" /> Risk blockers ({risk.breakers.length})
          </div>
          {risk.breakers.slice(0, 4).map((b, i) => (
            <div key={i}>• {b}</div>
          ))}
        </div>
      )}

      {/* Live prices */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" /> Live market prices
          </h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${live ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}`}>
            {live ? "MT5 LIVE" : "SIMULATED"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {assets.map((a) => {
            const up = Number(a.change24h) >= 0;
            return (
              <button
                key={a.symbol}
                onClick={() => onSelectSymbol(a.symbol)}
                className={`text-left rounded-lg border p-2 transition ${
                  a.symbol === selectedSymbol ? "border-blue-500/60 bg-blue-600/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white">{a.symbol}</span>
                  {up ? <ArrowUpRight className="w-3 h-3 text-emerald-400" /> : <ArrowDownRight className="w-3 h-3 text-rose-400" />}
                </div>
                <div className="font-mono text-xs text-slate-100 mt-0.5">{Number(a.currentPrice).toFixed(a.digits)}</div>
                <div className="flex items-center justify-between text-[9px] mt-0.5">
                  <span className="text-slate-500">spr {a.spread}</span>
                  <span className={up ? "text-emerald-400" : "text-rose-400"}>{up ? "+" : ""}{Number(a.change24h).toFixed(2)}%</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Progress: learning + validation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 font-bold text-slate-200">
              <Brain className="w-3.5 h-3.5 text-purple-400" /> Learning progress
            </span>
            <span>{learning?.tradesAnalyzed ?? 0} trades analysed</span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500"
              style={{ width: `${Math.min(100, ((learning?.tradesAnalyzed ?? 0) / 100) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-slate-500">
            {learning?.proposals.filter((p) => p.status === "PENDING").length ?? 0} proposal(s) awaiting your approval · strategy v
            {learning?.activeVersion?.label ?? "4.0"}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 font-bold text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Validation gates
            </span>
            <span>
              {validation?.gates.filter((g) => g.passed).length ?? 0}/{validation?.gates.length ?? 0}
            </span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${validation?.passed ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${((validation?.gates.filter((g) => g.passed).length ?? 0) / Math.max(validation?.gates.length ?? 1, 1)) * 100}%` }}
            />
          </div>
          <div className={`mt-1.5 text-[10px] ${validation?.liveAllowed ? "text-emerald-400" : "text-amber-400"}`}>
            {validation?.liveAllowed ? "Live trading approved" : `Live locked · demo required · ${validation?.demoDaysElapsed ?? 0}d of 30`}
          </div>
        </div>
      </div>

      {/* Latest AI decision */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" /> Latest AI decision
          </h3>
          {lastDecision && (
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                lastDecision.action === "BUY"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : lastDecision.action === "SELL"
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/30"
              }`}
            >
              {lastDecision.symbol} · {lastDecision.action}
            </span>
          )}
        </div>
        {lastDecision ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-300 leading-relaxed">{lastDecision.synthesis}</p>
            <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-3">
              <span>Confidence {lastDecision.confidenceScore}%</span>
              <span>R:R {lastDecision.riskReward}</span>
              <span>Entry {lastDecision.proposedEntry}</span>
              <span>{new Date(lastDecision.createdAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">No council decisions yet.</p>
        )}
      </div>

      {/* Open positions (compact) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <TrendingDown className="w-3.5 h-3.5 text-rose-400" /> Open positions ({trades.length})
        </h3>
        {trades.length === 0 ? (
          <p className="text-[11px] text-slate-500">Flat. No open positions.</p>
        ) : (
          <div className="space-y-1.5">
            {trades.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[11px]">
                <div className="min-w-0">
                  <div className="font-bold text-white">
                    {t.symbol} <span className={t.direction === "BUY" ? "text-emerald-400" : "text-rose-400"}>{t.direction}</span>{" "}
                    <span className="text-slate-500 font-mono">{t.lotSize}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {t.externalTicket ? `#${t.externalTicket}` : t.status === "PENDING" ? "queued to EA" : "paper"} · SL {t.stopLoss} · TP {t.takeProfit1}
                  </div>
                </div>
                <div className={`font-mono font-bold ${Number(t.pnl) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {Number(t.pnl) >= 0 ? "+" : ""}
                  {money(Number(t.pnl))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
