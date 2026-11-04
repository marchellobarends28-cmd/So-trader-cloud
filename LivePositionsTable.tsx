"use client";

import React, { useState } from "react";
import { TradeItem } from "@/lib/types";
import {
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  CheckCircle,
  X,
  History,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
} from "lucide-react";

interface LivePositionsTableProps {
  openTrades: TradeItem[];
  closedTrades: TradeItem[];
  onCloseTrade: (tradeId: number) => Promise<void>;
  onPanicCloseAll: () => Promise<void>;
  isClosingId: number | null;
  isPanicClosing: boolean;
}

export const LivePositionsTable: React.FC<LivePositionsTableProps> = ({
  openTrades,
  closedTrades,
  onCloseTrade,
  onPanicCloseAll,
  isClosingId,
  isPanicClosing,
}) => {
  const [activeTab, setActiveTab] = useState<"OPEN" | "CLOSED">("OPEN");
  const [showPanicModal, setShowPanicModal] = useState(false);

  const totalFloatingPnl = openTrades.reduce((acc, t) => acc + Number(t.pnl), 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg space-y-3">
      {/* Table Header / Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="flex rounded-lg bg-slate-800/80 p-0.5 border border-slate-700/60 text-xs">
            <button
              onClick={() => setActiveTab("OPEN")}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === "OPEN"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Live Positions ({openTrades.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("CLOSED")}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === "CLOSED"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Trade History ({closedTrades.length})</span>
            </button>
          </div>

          {activeTab === "OPEN" && (
            <div className="text-xs font-mono ml-2">
              <span className="text-slate-400">Floating PnL: </span>
              <span
                className={`font-bold ${
                  totalFloatingPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {totalFloatingPnl >= 0 ? "+" : ""}${totalFloatingPnl.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Emergency Kill Switch Button */}
        {openTrades.length > 0 && activeTab === "OPEN" && (
          <button
            onClick={() => setShowPanicModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600 hover:text-white transition-all shadow-sm"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Panic Close All ({openTrades.length})</span>
          </button>
        )}
      </div>

      {/* OPEN POSITIONS TABLE */}
      {activeTab === "OPEN" ? (
        openTrades.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-500">
            No active positions open in MetaTrader 5. The autonomous council will scan and dispatch orders when setups pass the Dread filter.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Ticket</th>
                  <th className="py-2.5 px-3">Symbol</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Volume</th>
                  <th className="py-2.5 px-3">Entry</th>
                  <th className="py-2.5 px-3">Current</th>
                  <th className="py-2.5 px-3">Stop Loss</th>
                  <th className="py-2.5 px-3">Take Profit</th>
                  <th className="py-2.5 px-3">PnL ($)</th>
                  <th className="py-2.5 px-3">Dread Guard</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {openTrades.map((t) => {
                  const pnlNum = Number(t.pnl);
                  const isPositive = pnlNum >= 0;

                  return (
                    <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-400 font-semibold">
                        <div className="flex items-center gap-1.5">
                          <span>{t.externalTicket ? `#${t.externalTicket}` : `#${t.ticket}`}</span>
                          <span
                            className={`text-[9px] px-1 py-0.5 rounded border font-bold ${
                              t.status === "PENDING"
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                : t.isSimulated === false
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : "bg-slate-700/40 text-slate-300 border-slate-600/50"
                            }`}
                          >
                            {t.status === "PENDING" ? "QUEUED" : t.isSimulated === false ? "LIVE" : "PAPER"}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-white">{t.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.direction === "BUY"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {t.direction === "BUY" ? (
                            <ArrowUpRight className="w-3 h-3 mr-0.5" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3 mr-0.5" />
                          )}
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{t.lotSize}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{t.entryPrice}</td>
                      <td className="py-2.5 px-3 font-mono text-white font-medium">
                        {t.currentPrice}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-rose-400">{t.stopLoss}</td>
                      <td className="py-2.5 px-3 font-mono text-emerald-400">{t.takeProfit1}</td>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        <span className={isPositive ? "text-emerald-400" : "text-rose-400"}>
                          {isPositive ? "+" : ""}${pnlNum.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          title={t.dreadCheckSummary || "Checked against memory bank"}
                          className="inline-flex items-center space-x-1 text-[11px] text-emerald-400/90 cursor-help"
                        >
                          <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="truncate max-w-[120px]">
                            {t.dreadCheckSummary?.slice(0, 22) || "Protected"}...
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => onCloseTrade(t.id)}
                          disabled={isClosingId === t.id || t.status === "PENDING"}
                          className="px-2.5 py-1 text-[11px] rounded bg-slate-800 text-rose-300 hover:bg-rose-600 hover:text-white border border-slate-700 transition-colors"
                        >
                          {isClosingId === t.id ? "Closing..." : t.status === "PENDING" ? "Awaiting EA" : "Close"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* CLOSED TRADES TABLE */
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Ticket</th>
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Direction</th>
                <th className="py-2.5 px-3">Volume</th>
                <th className="py-2.5 px-3">Entry</th>
                <th className="py-2.5 px-3">Close Price</th>
                <th className="py-2.5 px-3">Realized PnL</th>
                <th className="py-2.5 px-3">Reason</th>
                <th className="py-2.5 px-3">Strategy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {closedTrades.map((t) => {
                const pnlNum = Number(t.pnl);
                const isPositive = pnlNum >= 0;

                return (
                  <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-400">
                      <span className="mr-1">{t.externalTicket ? `#${t.externalTicket}` : `#${t.ticket}`}</span>
                      <span className={`text-[9px] px-1 py-0.5 rounded border font-bold ${t.isSimulated === false ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-slate-700/40 text-slate-300 border-slate-600/50"}`}>
                        {t.isSimulated === false ? "LIVE" : "PAPER"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">{t.symbol}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.direction === "BUY"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{t.lotSize}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{t.entryPrice}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{t.closePrice || "—"}</td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      <span className={isPositive ? "text-emerald-400" : "text-rose-400"}>
                        {isPositive ? "+" : ""}${pnlNum.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {t.closeReason || "CLOSED"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 truncate max-w-[160px]">
                      {t.strategy}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Panic Close Confirmation Modal */}
      {showPanicModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-600/50 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400 pb-2 border-b border-slate-800">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h4 className="text-base font-bold text-white">Emergency Panic Close All?</h4>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This will instantaneously liquidate all <strong className="text-white">{openTrades.length} open MT5 positions</strong> at market price, cancel all pending orders, and reset margin.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowPanicModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowPanicModal(false);
                  await onPanicCloseAll();
                }}
                disabled={isPanicClosing}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30"
              >
                {isPanicClosing ? "Liquidating..." : "Yes, Liquidate All Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
