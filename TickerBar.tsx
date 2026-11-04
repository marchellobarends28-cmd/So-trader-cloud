"use client";

import React from "react";
import { MarketAssetItem } from "@/lib/types";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

interface TickerBarProps {
  assets: MarketAssetItem[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

export const TickerBar: React.FC<TickerBarProps> = ({
  assets,
  selectedSymbol,
  onSelectSymbol,
}) => {
  return (
    <div className="bg-slate-900/90 border-y border-slate-800/80 px-4 py-2 overflow-x-auto scrollbar-thin">
      <div className="flex items-center space-x-3 min-w-max">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider pr-2 border-r border-slate-800">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>MT5 Feeds</span>
        </div>

        {assets.map((asset) => {
          const isSelected = asset.symbol === selectedSymbol;
          const isPositive = Number(asset.change24h) >= 0;

          return (
            <button
              key={asset.symbol}
              onClick={() => onSelectSymbol(asset.symbol)}
              className={`flex items-center space-x-2.5 px-3 py-1.5 rounded-lg border text-xs transition-all duration-150 ${
                isSelected
                  ? "bg-blue-600/20 border-blue-500/60 text-white shadow-sm shadow-blue-500/10"
                  : "bg-slate-800/50 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className="flex flex-col text-left">
                <div className="flex items-center space-x-1">
                  <span className="font-bold text-slate-100">{asset.symbol}</span>
                  <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                    {asset.assetClass.slice(0, 3)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Spr: <span className="text-amber-400 font-mono">{asset.spread}</span>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="font-semibold text-slate-100">
                  {Number(asset.currentPrice).toFixed(asset.digits)}
                </div>
                <div
                  className={`flex items-center justify-end text-[10px] font-medium ${
                    isPositive ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-2.5 h-2.5 mr-0.5 inline" />
                  ) : (
                    <TrendingDown className="w-2.5 h-2.5 mr-0.5 inline" />
                  )}
                  {isPositive ? "+" : ""}
                  {Number(asset.change24h).toFixed(2)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
