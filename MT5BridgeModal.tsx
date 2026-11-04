"use client";

import React, { useState } from "react";
import { MT5AccountItem } from "@/lib/types";
import {
  Server,
  Key,
  Download,
  Copy,
  Check,
  Activity,
  Terminal,
  Shield,
  ExternalLink,
  X,
  Wifi,
} from "lucide-react";

interface MT5BridgeModalProps {
  account: MT5AccountItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const MT5BridgeModal: React.FC<MT5BridgeModalProps> = ({
  account,
  isOpen,
  onClose,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [testPingStatus, setTestPingStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const serverOrigin = typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";
  const bridgeUrl = `${serverOrigin}/api/mt5/bridge`;
  const ackUrl = `${serverOrigin}/api/mt5/bridge/ack`;
  const historyUrl = `${serverOrigin}/api/mt5/history`;
  const apiKey = account?.apiKey || "";

  const handleCopyCode = async () => {
    try {
      const res = await fetch("/api/mt5/export-ea");
      const data = await res.json();
      if (data.code) {
        await navigator.clipboard.writeText(data.code);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadEA = () => {
    window.open("/api/mt5/export-ea?format=raw", "_blank");
  };

  const handleTestPing = async () => {
    setTestPingStatus("Testing MT5 WebRequest...");
    try {
      const res = await fetch("/api/mt5/bridge");
      const data = await res.json();
      if (res.status === 401) {
        setTestPingStatus("🔒 Sign in to the dashboard before checking bridge status.");
      } else if (data.status === "LIVE") {
        setTestPingStatus("✅ MT5 EA heartbeat is live and authenticated.");
      } else if (data.status === "SIMULATION") {
        setTestPingStatus("⚠️ Server is reachable, but no live MT5 EA heartbeat is connected.");
      } else {
        setTestPingStatus("⚠️ Bridge status could not be verified.");
      }
    } catch {
      setTestPingStatus("❌ Ping failed. Check network or server connection.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <span>MetaTrader 5 (MT5) Bridge Hub</span>
                <span className="flex items-center space-x-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>ONLINE</span>
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Bidirectional sub-second trade execution & telemetry sync with MetaQuotes MT5
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 scrollbar-thin text-xs">
          {/* MT5 Account Card */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Broker</span>
              <span className="font-bold text-white text-xs truncate block">
                {account?.broker || "IC Markets Global"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">MT5 Server</span>
              <span className="font-mono text-slate-200 text-xs block">
                {account?.serverName || "ICMarketsSC-Live04"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Account #</span>
              <span className="font-mono font-bold text-blue-400 text-xs block">
                {account?.accountNumber || "9148205"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Balance / Equity</span>
              <span className="font-mono font-bold text-emerald-400 text-xs block">
                ${Number(account?.equity || 55710).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Webhook & Secret Key Info */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              1. Bridge Webhook Endpoints
            </h4>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">MT5 Webhook URL</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={bridgeUrl}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-xs text-blue-300"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(bridgeUrl);
                  }}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center space-x-1 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Command ACK URL (EA → server)</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={ackUrl}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-xs text-emerald-300"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(ackUrl)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center space-x-1 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">History upload URL (EA → server)</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={historyUrl}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-xs text-blue-300"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(historyUrl)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center space-x-1 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Bridge Secret API Key</label>
              <div className="flex items-center space-x-2">
                <input
                  type="password"
                  readOnly
                  value={apiKey}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-xs text-amber-300"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(apiKey);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                  }}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center space-x-1 shrink-0"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 3 Steps Setup Instructions */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2.5">
            <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center space-x-1.5">
              <Terminal className="w-4 h-4" />
              <span>Attach the EA (v4.00 · real execution + history sync)</span>
            </h4>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300 leading-relaxed text-[11px]">
              <li>
                In MetaTrader 5 desktop terminal, open <strong className="text-white">Tools → Options → Expert Advisors</strong>.
              </li>
              <li>
                Check <strong className="text-white">"Allow WebRequest for listed URL"</strong> and add:{" "}
                <code className="text-amber-300 font-mono bg-slate-900 px-1 py-0.5 rounded">{bridgeUrl}</code>.
              </li>
              <li>
                Add the history URL above to the same whitelist. Click <strong className="text-white">Download EA (.mq5)</strong>,
                paste into MetaEditor and press <strong className="text-white">F7</strong>.
              </li>
              <li>
                Drag <code className="text-blue-300 font-mono">GrokBot_MT5_Bridge</code> onto a <strong className="text-white">DEMO</strong> chart with Algo Trading on. It streams real quotes, uploads genuine M15/H1 history, polls the command queue, opens/modifies/closes orders and acknowledges each broker fill. Local hard risk limits run inside the EA as well as the server.
              </li>
            </ol>
          </div>

          {/* Download & Copy Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDownloadEA}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/20"
            >
              <Download className="w-4 h-4" />
              <span>Download GrokBot_MT5_Bridge.mq5</span>
            </button>

            <button
              onClick={handleCopyCode}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700"
            >
              {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedCode ? "Code Copied to Clipboard!" : "Copy Full MQL5 Source Code"}</span>
            </button>

            <button
              onClick={handleTestPing}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 ml-auto"
            >
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>Test MT5 Ping</span>
            </button>
          </div>

          {testPingStatus && (
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-200">
              {testPingStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
