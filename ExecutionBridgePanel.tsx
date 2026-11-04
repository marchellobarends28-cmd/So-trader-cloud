"use client";

import React, { useMemo, useState } from "react";
import { BridgeStatusItem, MarketAssetItem, BridgeCommandItem } from "@/lib/types";
import {
  Radio,
  RadioTower,
  Send,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Cpu,
  ListOrdered,
} from "lucide-react";

interface ExecutionBridgePanelProps {
  bridge: BridgeStatusItem | null;
  assets: MarketAssetItem[];
  selectedSymbol: string;
  onRefresh: () => Promise<void>;
}

const statusStyle: Record<BridgeCommandItem["status"], string> = {
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  SENT: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  ACKED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  FAILED: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  EXPIRED: "bg-slate-600/20 text-slate-400 border-slate-600/40",
};

export const ExecutionBridgePanel: React.FC<ExecutionBridgePanelProps> = ({
  bridge,
  assets,
  selectedSymbol,
  onRefresh,
}) => {
  const [symbol, setSymbol] = useState(selectedSymbol);
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [lot, setLot] = useState("0.10");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const isLive = Boolean(bridge?.isLive);
  const asset = useMemo(() => assets.find((a) => a.symbol === symbol), [assets, symbol]);
  const price = asset ? Number(asset.currentPrice) : 0;

  const prefill = () => {
    if (!asset) return;
    const digits = asset.digits;
    const dist = price * (asset.assetClass === "FOREX" ? 0.0018 : 0.006);
    const dir = direction === "BUY" ? 1 : -1;
    setStopLoss((price - dir * dist).toFixed(digits));
    setTakeProfit((price + dir * dist * 2).toFixed(digits));
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mt5/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EXECUTE_TRADE",
          symbol,
          direction,
          lot: Number(lot),
          stopLoss: Number(stopLoss),
          takeProfit: Number(takeProfit),
        }),
      });
      const data = await res.json();
      setMessage({ ok: Boolean(data.success), text: data.message || data.error || "Unknown response" });
      await onRefresh();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const ping = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/mt5/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PING" }),
      });
      const data = await res.json();
      setMessage({ ok: Boolean(data.success), text: data.error || `PING queued (${data.commandId})` });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const riskProfile = (bridge?.account?.eaRiskProfile ?? {}) as Record<string, unknown>;
  const pending = bridge?.pendingCommands ?? [];
  const acks = bridge?.recentAcks ?? [];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center space-x-2.5">
          <div className={`p-2 rounded-lg border ${isLive ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}>
            {isLive ? <RadioTower className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Execution Bridge</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${isLive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                {isLive ? "LIVE · REAL ORDERS" : "SIMULATION · PAPER ONLY"}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {isLive
                ? `EA v${bridge?.account.eaVersion} · heartbeat ${bridge?.heartbeatAgeSeconds}s ago · real broker fill (ack) required`
                : "No EA heartbeat. Prices are simulated and orders are blocked — attach the EA to trade for real."}
            </p>
          </div>
        </div>
        <button
          onClick={ping}
          disabled={busy || !isLive}
          className="text-[11px] px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 hover:text-white"
        >
          Ping EA
        </button>
      </div>

      {/* Feed + risk facts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2">
          <div className="text-slate-400">Price feed</div>
          <div className={`font-bold ${isLive ? "text-emerald-400" : "text-amber-400"}`}>
            {isLive ? "MT5 LIVE" : "Synthetic"}
          </div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2">
          <div className="text-slate-400">EA trading flag</div>
          <div className={`font-bold flex items-center gap-1 ${bridge?.account.tradeAllowedByEa ? "text-emerald-400" : "text-rose-400"}`}>
            {bridge?.account.tradeAllowedByEa ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
            {bridge?.account.tradeAllowedByEa ? "Allowed" : "Blocked"}
          </div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2">
          <div className="text-slate-400">Local daily stop</div>
          <div className="font-bold text-slate-200">{String(riskProfile.maxDailyLossPct ?? "—")}%</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2">
          <div className="text-slate-400">Lot / spread caps</div>
          <div className="font-bold text-slate-200">
            {String(riskProfile.maxLot ?? "—")} / {String(riskProfile.maxSpreadPoints ?? "—")}pts
          </div>
        </div>
      </div>

      {/* Manual order ticket */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
            <Send className="w-3 h-3" /> Real order ticket
          </span>
          <span className="text-[10px] font-mono text-slate-500">{asset ? `${price.toFixed(asset.digits)}` : "—"}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-md p-1.5 text-white"
          >
            {assets.map((a) => (
              <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => setDirection("BUY")}
              className={`rounded-md p-1.5 font-bold border ${direction === "BUY" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" : "bg-slate-900 border-slate-700 text-slate-400"}`}
            >
              BUY
            </button>
            <button
              onClick={() => setDirection("SELL")}
              className={`rounded-md p-1.5 font-bold border ${direction === "SELL" ? "bg-rose-500/20 border-rose-500/50 text-rose-300" : "bg-slate-900 border-slate-700 text-slate-400"}`}
            >
              SELL
            </button>
          </div>
          <input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            placeholder="Lot"
            className="bg-slate-900 border border-slate-700 rounded-md p-1.5 text-white font-mono"
          />
          <button onClick={prefill} className="rounded-md p-1.5 bg-slate-800 border border-slate-700 text-slate-300 hover:text-white">
            Autofill SL/TP
          </button>
          <input
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="Stop loss"
            className="bg-slate-900 border border-slate-700 rounded-md p-1.5 text-rose-300 font-mono"
          />
          <input
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="Take profit"
            className="bg-slate-900 border border-slate-700 rounded-md p-1.5 text-emerald-300 font-mono"
          />
        </div>

        <button
          onClick={submit}
          disabled={busy || !isLive}
          className={`w-full flex items-center justify-center gap-2 rounded-md p-2 text-xs font-bold transition ${
            isLive ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-slate-800 text-slate-500 cursor-not-allowed"
          }`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {isLive ? "Queue real order to EA" : "Blocked: no live EA"}
        </button>

        {message && (
          <div className={`text-[11px] p-2 rounded-md border flex items-start gap-1.5 ${message.ok ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300" : "bg-rose-950/30 border-rose-800/50 text-rose-300"}`}>
            {message.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
            <span>{message.text}</span>
          </div>
        )}
      </div>

      {/* Command queue / acks */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 uppercase tracking-wider">
          <span className="flex items-center gap-1"><ListOrdered className="w-3 h-3" /> Command queue</span>
          <span className="text-slate-500 font-normal">{pending.length} pending</span>
        </div>

        <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-1">
          {pending.length === 0 && acks.length === 0 && (
            <p className="text-[11px] text-slate-500 py-1">No commands yet. The council queues EXECUTE_TRADE when the strategy finds an edge.</p>
          )}
          {[...pending, ...acks].map((cmd) => (
            <div key={cmd.id} className="flex items-center justify-between gap-2 text-[11px] bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${statusStyle[cmd.status]}`}>{cmd.status}</span>
                <span className="text-slate-300 truncate">
                  {cmd.type.replace("_", " ")}
                  {cmd.symbol ? ` · ${cmd.symbol}` : ""}
                  {cmd.direction ? ` ${cmd.direction}` : ""}
                  {cmd.lot ? ` ${cmd.lot}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {cmd.status === "ACKED" && cmd.brokerTicket && (
                  <span className="text-emerald-400 font-mono text-[10px]">#{cmd.brokerTicket}</span>
                )}
                {cmd.status === "FAILED" && (
                  <span className="text-rose-400 text-[10px] max-w-[130px] truncate" title={cmd.resultText ?? ""}>
                    {cmd.resultText}
                  </span>
                )}
                <span className="text-slate-600 font-mono text-[10px] flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {new Date(cmd.createdAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-slate-500 leading-relaxed flex items-start gap-1">
          <Cpu className="w-3 h-3 mt-0.5 shrink-0" />
          Every command is acknowledged by the EA with the broker ticket, fill price or rejection reason. No fill is ever invented server-side.
        </p>
      </div>
    </div>
  );
};
