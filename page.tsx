"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  MT5AccountItem,
  MarketAssetItem,
  AgentItem,
  DebateItem,
  DreadedPostMortemItem,
  TradeItem,
  AISettingsItem,
  SystemLogItem,
  BridgeStatusItem,
  BacktestRunItem,
  RiskSnapshotItem,
  RiskEventItem,
  ValidationReportItem,
  QualityReportItem,
  InstrumentSpecItem,
  LearningProgressItem,
} from "@/lib/types";
import { Header } from "@/components/Header";
import { TickerBar } from "@/components/TickerBar";
import { MainChart } from "@/components/MainChart";
import { AgentCouncilRoom } from "@/components/AgentCouncilRoom";
import { DreadMemoryBank } from "@/components/DreadMemoryBank";
import { LivePositionsTable } from "@/components/LivePositionsTable";
import { MT5BridgeModal } from "@/components/MT5BridgeModal";
import { SettingsModal } from "@/components/SettingsModal";
import { ExecutionBridgePanel } from "@/components/ExecutionBridgePanel";
import { MobileOverview } from "@/components/MobileOverview";
import { LearningPanel } from "@/components/LearningPanel";
import { ValidationPanelV4 } from "@/components/ValidationPanelV4";
import { LoginModal } from "@/components/LoginModal";
import { Activity, LayoutDashboard, Bot, Brain, ShieldCheck, Terminal, Radio, AlertTriangle } from "lucide-react";

type Tab = "OVERVIEW" | "COUNCIL" | "LEARNING" | "VALIDATION";

export default function Home() {
  const [account, setAccount] = useState<MT5AccountItem | null>(null);
  const [assets, setAssets] = useState<MarketAssetItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [debates, setDebates] = useState<DebateItem[]>([]);
  const [postMortems, setPostMortems] = useState<DreadedPostMortemItem[]>([]);
  const [openTrades, setOpenTrades] = useState<TradeItem[]>([]);
  const [closedTrades, setClosedTrades] = useState<TradeItem[]>([]);
  const [settings, setSettings] = useState<AISettingsItem | null>(null);
  const [logs, setLogs] = useState<SystemLogItem[]>([]);
  const [bridge, setBridge] = useState<BridgeStatusItem | null>(null);
  const [backtests, setBacktests] = useState<BacktestRunItem[]>([]);
  const [risk, setRisk] = useState<RiskSnapshotItem | null>(null);
  const [riskEvents, setRiskEvents] = useState<RiskEventItem[]>([]);
  const [validation, setValidation] = useState<ValidationReportItem | null>(null);
  const [quality, setQuality] = useState<QualityReportItem[]>([]);
  const [specs, setSpecs] = useState<Record<string, InstrumentSpecItem>>({});
  const [learning, setLearning] = useState<LearningProgressItem | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [usingDefaultPassword, setUsingDefaultPassword] = useState(false);

  const [selectedSymbol, setSelectedSymbol] = useState("EURUSD");
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [isLoading, setIsLoading] = useState(true);
  const [isCouncilRunning, setIsCouncilRunning] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [isClosingId, setIsClosingId] = useState<number | null>(null);
  const [isPanicClosing, setIsPanicClosing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const notify = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 6000);
  };

  const refreshAll = useCallback(async () => {
    const res = await fetch("/api/bootstrap");
    const data = await res.json();
    if (data.success) {
      setAccount(data.account);
      setAssets(data.assets ?? []);
      setAgents(data.agents ?? []);
      setDebates(data.debates ?? []);
      setPostMortems(data.postMortems ?? []);
      setOpenTrades(data.openTrades ?? []);
      setClosedTrades(data.closedTrades ?? []);
      setSettings(data.settings);
      setLogs(data.logs ?? []);
      setBridge(data.bridge ?? null);
      setBacktests(data.backtests ?? []);
      setRisk(data.risk ?? null);
      setRiskEvents(data.riskEvents ?? []);
      setValidation(data.validation ?? null);
      setQuality(data.quality ?? []);
      setSpecs(data.specs ?? {});
      setLearning(data.learning ?? null);
      setAuthenticated(Boolean(data.authenticated));
      setUsingDefaultPassword(Boolean(data.usingDefaultPassword));
      if (!data.authenticated) setIsLoginOpen(true);
    }
    return data;
  }, []);

  useEffect(() => {
    refreshAll().finally(() => setIsLoading(false));
  }, [refreshAll]);

  const tick = useCallback(async () => {
    if (!authenticated) return;
    setIsTicking(true);
    try {
      const res = await fetch("/api/market/tick", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (data.assets) setAssets(data.assets);
        if (data.openTrades) setOpenTrades(data.openTrades);
        if (data.account) setAccount(data.account);
      }
    } finally {
      setIsTicking(false);
    }
  }, [authenticated]);

  useEffect(() => {
    const t = setInterval(tick, 6000);
    const r = setInterval(refreshAll, 20000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [tick, refreshAll]);

  /** Mutating call: handles 401 by opening the login sheet. */
  const mutate = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setAuthenticated(false);
        setIsLoginOpen(true);
        notify(false, "Sign in required for trading controls.");
      }
      return data as { success?: boolean; error?: string; [k: string]: unknown };
    },
    []
  );

  const triggerCouncil = async (symbol: string) => {
    setIsCouncilRunning(true);
    try {
      const data = await mutate("/api/agents/cycle", { symbol });
      if (data.success) {
        const d = data.decision as { action?: string; executionMode?: string; vetoes?: string[] } | undefined;
        notify(
          true,
          d ? `Council: ${d.action} (${d.executionMode ?? "NONE"})${d.vetoes && d.vetoes.length ? ` · veto: ${d.vetoes[0]}` : ""}` : "Council cycle complete."
        );
      }
      await refreshAll();
    } finally {
      setIsCouncilRunning(false);
    }
  };

  const closeTrade = async (tradeId: number) => {
    setIsClosingId(tradeId);
    try {
      const data = await mutate("/api/trades", { action: "CLOSE_TRADE", tradeId, reason: "MANUAL_CLOSE" });
      notify(Boolean(data.success), String(data.message ?? data.error ?? "Close requested."));
      await refreshAll();
    } finally {
      setIsClosingId(null);
    }
  };

  const closeAll = async () => {
    setIsPanicClosing(true);
    try {
      const data = await fetch("/api/mt5/panic-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      notify(Boolean(data.success), String(data.message ?? data.error ?? "Close-all dispatched."));
      await refreshAll();
    } finally {
      setIsPanicClosing(false);
    }
  };

  const emergency = async () => {
    setIsBusy(true);
    try {
      const action = risk?.emergencyStop ? "CLEAR_STOP" : "EMERGENCY_STOP";
      const data = await mutate("/api/risk", { action, reason: "iPhone dashboard emergency control" });
      notify(Boolean(data.success), String(data.message ?? data.error ?? "Risk action processed."));
      await refreshAll();
    } finally {
      setIsBusy(false);
    }
  };

  const toggleRule = async (ruleId: number, isActive: boolean) => {
    await mutate("/api/dread/post-mortem", { action: "TOGGLE_RULE", ruleId, isActive });
    setPostMortems((prev) => prev.map((p) => (p.id === ruleId ? { ...p, isMemoryActive: isActive } : p)));
  };

  const simulateReflection = async (tradeData: {
    symbol: string;
    direction: "BUY" | "SELL";
    entryPrice: number;
    exitPrice: number;
    pnl: number;
  }) => {
    const data = await mutate("/api/dread/post-mortem", { action: "GENERATE_CUSTOM_POST_MORTEM", ...tradeData });
    if (data.success && data.created) setPostMortems((prev) => [data.created as DreadedPostMortemItem, ...prev]);
  };

  const toggleAutopilot = async () => {
    if (!settings) return;
    const data = await mutate("/api/settings", { autopilotEnabled: !settings.autopilotEnabled });
    if (data.success && data.settings) setSettings(data.settings as AISettingsItem);
    await refreshAll();
  };

  const saveSettings = async (updated: Partial<AISettingsItem>) => {
    const data = await mutate("/api/settings", updated as Record<string, unknown>);
    if (data.success && data.settings) setSettings(data.settings as AISettingsItem);
  };

  const runBacktestAll = async () => {
    setIsRunningBacktest(true);
    try {
      const data = await mutate("/api/backtest", { symbol: "ALL", riskPerTradePct: 0.5, timeframe: "M15" });
      if (data.success) {
        notify(true, `Backtests completed for ${(data.results as unknown[])?.length ?? 0} genuine symbol(s).`);
      } else {
        const skipped = (data.skipped as { symbol: string; reason: string }[]) ?? [];
        notify(false, String(skipped[0]?.reason ?? data.error ?? "No genuine data available for backtesting."));
      }
      await refreshAll();
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const auditData = async () => {
    setIsAuditing(true);
    try {
      const data = await mutate("/api/validation", { action: "AUDIT_DATA" });
      notify(Boolean(data.success), data.success ? "Stored bars audited." : String(data.error ?? "Audit failed."));
      await refreshAll();
    } finally {
      setIsAuditing(false);
    }
  };

  const syncHistory = async () => {
    setIsSyncing(true);
    try {
      const data = await mutate("/api/mt5/commands", { action: "SYNC_HISTORY" });
      notify(Boolean(data.success), String(data.message ?? data.error ?? "History sync requested."));
    } finally {
      setIsSyncing(false);
    }
  };

  const startDemo = async () => {
    const data = await mutate("/api/validation", { action: "START_DEMO_RUN" });
    notify(Boolean(data.success), data.success ? "30-day demo forward run started." : String(data.error ?? "Could not start demo run."));
    await refreshAll();
  };

  const approveLive = async () => {
    const data = await mutate("/api/validation", { action: "APPROVE_LIVE" });
    notify(Boolean(data.success), data.success ? "Live override approved." : String(data.error ?? "Gates not passed."));
    await refreshAll();
  };

  const revokeLive = async () => {
    const data = await mutate("/api/validation", { action: "REVOKE_LIVE" });
    notify(Boolean(data.success), data.success ? "Live override revoked." : String(data.error ?? "Failed."));
    await refreshAll();
  };

  const runLearning = async () => {
    setIsLearning(true);
    try {
      const data = await mutate("/api/learning", { action: "RUN" });
      const result = data.result as { ran?: boolean; reason?: string; proposalsCreated?: number } | undefined;
      notify(
        Boolean(data.success) && Boolean(result?.ran),
        result?.ran
          ? `Learning cycle complete · ${result?.proposalsCreated ?? 0} new proposal(s).`
          : String(result?.reason ?? data.error ?? "Learning cycle did not run.")
      );
      await refreshAll();
    } finally {
      setIsLearning(false);
    }
  };

  const decideProposal = async (id: number, approve: boolean) => {
    const data = await mutate("/api/learning", { action: approve ? "APPROVE" : "REJECT", proposalId: id });
    notify(Boolean(data.success), data.success ? (approve ? "Proposal approved and applied." : "Proposal rejected.") : String(data.error ?? "Failed."));
    await refreshAll();
  };

  const login = async (password: string) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      setAuthenticated(true);
      await refreshAll();
      return { ok: true };
    }
    return { ok: false, error: data.error };
  };

  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthenticated(false);
  };

  const currentAsset = assets.find((a) => a.symbol === selectedSymbol) || assets[0];
  const isLive = Boolean(bridge?.isLive);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="mb-4 w-14 h-14 rounded-2xl bg-indigo-600 animate-pulse flex items-center justify-center shadow-2xl shadow-indigo-500/50">
          <Activity className="w-8 h-8 animate-spin" />
        </div>
        <h2 className="text-base font-bold">SO TRADER AI V4.0 booting…</h2>
        <p className="text-xs text-slate-400 mt-1">Loading bridge, risk engine, validation gates and learning state</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "OVERVIEW", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: "COUNCIL", label: "Council", icon: <Bot className="w-4 h-4" /> },
    { id: "LEARNING", label: "Learning", icon: <Brain className="w-4 h-4" /> },
    { id: "VALIDATION", label: "Validation", icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white pb-20 sm:pb-0">
      <Header
        account={account}
        settings={settings}
        onOpenMT5Modal={() => setIsBridgeOpen(true)}
        onOpenSettingsModal={() => setIsSettingsOpen(true)}
        onToggleAutopilot={toggleAutopilot}
        onTriggerTick={tick}
        isTicking={isTicking}
      />

      {/* Auth + mode strip */}
      <div className={`px-3 py-1.5 text-[11px] flex flex-wrap items-center justify-between gap-2 border-b ${isLive ? "bg-emerald-950/40 border-emerald-900/50 text-emerald-300" : "bg-amber-950/30 border-amber-900/40 text-amber-300"}`}>
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5" />
          {isLive ? (
            <span>
              <strong>LIVE MT5</strong> · EA v{bridge?.account.eaVersion} · heartbeat {bridge?.heartbeatAgeSeconds}s · real fills only
            </span>
          ) : (
            <span>
              <strong>DEMO/SIM</strong> · no EA heartbeat: prices are simulated and real orders are disabled
            </span>
          )}
        </div>
        <button
          onClick={() => setIsLoginOpen(true)}
          className={`px-2 py-0.5 rounded border font-bold ${authenticated ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-200"}`}
        >
          {authenticated ? "🔓 Trading unlocked" : "🔒 Sign in to trade"}
        </button>
      </div>

      <TickerBar assets={assets} selectedSymbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} />

      {/* Desktop tabs */}
      <div className="hidden sm:block max-w-7xl w-full mx-auto px-4 pt-4">
        <div className="flex items-center gap-1.5 bg-slate-900/70 border border-slate-800 rounded-xl p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === t.id ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <span className="ml-2 text-[10px] text-slate-500 flex items-center gap-1">
            <Terminal className="w-3 h-3" /> SO TRADER AI V4.0
          </span>
        </div>
      </div>

      {flash && (
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-4 pt-3">
          <div className={`text-[11px] rounded-lg border p-2 ${flash.ok ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300" : "bg-rose-950/30 border-rose-800/50 text-rose-300"}`}>
            {flash.text}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6 space-y-4">
        {tab === "OVERVIEW" && (
          <MobileOverview
            account={account}
            assets={assets}
            risk={risk}
            validation={validation}
            learning={learning}
            bridge={bridge}
            trades={openTrades}
            debates={debates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            onEmergencyStop={emergency}
            onCloseAll={closeAll}
            busy={isBusy || isPanicClosing}
          />
        )}

        {tab === "COUNCIL" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 space-y-4">
              {currentAsset && <MainChart asset={currentAsset} trades={openTrades} />}
              <LivePositionsTable
                openTrades={openTrades}
                closedTrades={closedTrades}
                onCloseTrade={closeTrade}
                onPanicCloseAll={closeAll}
                isClosingId={isClosingId}
                isPanicClosing={isPanicClosing}
              />
            </div>
            <div className="lg:col-span-5 space-y-4">
              <ExecutionBridgePanel bridge={bridge} assets={assets} selectedSymbol={selectedSymbol} onRefresh={refreshAll} />
              <AgentCouncilRoom
                agents={agents}
                debates={debates}
                selectedSymbol={selectedSymbol}
                onTriggerAgentCycle={triggerCouncil}
                isLoading={isCouncilRunning}
              />
            </div>
          </div>
        )}

        {tab === "LEARNING" && (
          <div className="space-y-4">
            <LearningPanel
              learning={learning}
              onRunLearning={runLearning}
              onApprove={(id) => decideProposal(id, true)}
              onReject={(id) => decideProposal(id, false)}
              running={isLearning}
              authenticated={authenticated}
              onRequestLogin={() => setIsLoginOpen(true)}
            />
            <DreadMemoryBank
              postMortems={postMortems}
              onToggleRule={toggleRule}
              onTriggerReflection={simulateReflection}
            />
          </div>
        )}

        {tab === "VALIDATION" && (
          <ValidationPanelV4
            validation={validation}
            quality={quality}
            backtests={backtests}
            specs={specs}
            onRunBacktest={runBacktestAll}
            onAuditData={auditData}
            onSyncHistory={syncHistory}
            isSyncing={isSyncing}
            onStartDemo={startDemo}
            onApproveLive={approveLive}
            onRevokeLive={revokeLive}
            isRunningBacktest={isRunningBacktest}
            isAuditing={isAuditing}
            authenticated={authenticated}
            onRequestLogin={() => setIsLoginOpen(true)}
          />
        )}

        {validation && !validation.liveAllowed && (
          <div className="flex items-start gap-2 text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/40 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Live trading locked.</strong> {validation.blockers.slice(0, 3).join(" · ") || "Validation incomplete."} Demo
              mode is mandatory until every gate passes.
            </span>
          </div>
        )}

        {/* Audit trail */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-1.5 mb-1.5">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" /> Audit trail
            </span>
            <span className="text-slate-500">{isTicking ? "syncing…" : `${logs.length} entries`}</span>
          </div>
          <div className="space-y-0.5 font-mono text-[10px] max-h-28 overflow-y-auto scrollbar-thin">
            {logs.map((l) => (
              <div key={l.id} className="flex gap-1.5">
                <span className="text-slate-600 shrink-0">[{new Date(l.createdAt).toLocaleTimeString()}]</span>
                <span
                  className={`shrink-0 font-semibold ${
                    l.level === "ERROR" || l.level === "DREAD_ALERT"
                      ? "text-rose-400"
                      : l.level === "WARN"
                      ? "text-amber-400"
                      : l.level === "TRADE_EXEC"
                      ? "text-emerald-400"
                      : "text-blue-400"
                  }`}
                >
                  [{l.source}]
                </span>
                <span className="text-slate-300 truncate">{l.message}</span>
              </div>
            ))}
          </div>
          {riskEvents.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-800 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
              {riskEvents.slice(0, 3).map((e) => (
                <span key={e.id} className={e.severity === "CRITICAL" ? "text-rose-400" : "text-amber-400"}>
                  {e.type}: {e.message.slice(0, 60)}
                </span>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800 grid grid-cols-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${tab === t.id ? "text-blue-400" : "text-slate-500"}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <MT5BridgeModal account={account} isOpen={isBridgeOpen} onClose={() => setIsBridgeOpen(false)} />
      <SettingsModal settings={settings} isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onSave={saveSettings} />
      <LoginModal
        open={isLoginOpen}
        authenticated={authenticated}
        usingDefaultPassword={usingDefaultPassword}
        onClose={() => setIsLoginOpen(false)}
        onLogin={login}
        onLogout={logout}
      />
    </div>
  );
}
