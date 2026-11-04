"use client";

import React, { useState } from "react";
import { MarketAssetItem, TradeItem, Candle } from "@/lib/types";
import { Maximize2, Layers, BarChart2 } from "lucide-react";

interface MainChartProps {
  asset: MarketAssetItem;
  trades: TradeItem[];
}

export const MainChart: React.FC<MainChartProps> = ({ asset, trades }) => {
  const [timeframe, setTimeframe] = useState<"5m" | "15m" | "1h" | "4h">("15m");
  const [showFVG, setShowFVG] = useState(true);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

  const candles = (asset.candles as Candle[]) || [];
  const currentPrice = Number(asset.currentPrice);

  // Filter trades for this symbol
  const activeTrade = trades.find((t) => t.symbol === asset.symbol && t.status === "OPEN");

  // Chart dimensions
  const svgWidth = 800;
  const svgHeight = 360;
  const padding = { top: 25, right: 75, bottom: 30, left: 15 };

  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  // Take the most recent 40 candles
  const visibleCandles = candles.slice(-42);

  // Calculate min and max price
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  visibleCandles.forEach((c) => {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  });

  if (activeTrade) {
    minPrice = Math.min(minPrice, Number(activeTrade.stopLoss));
    maxPrice = Math.max(maxPrice, Number(activeTrade.takeProfit1));
  }

  // Add 10% breathing room
  const priceRange = maxPrice - minPrice || 1;
  const chartMin = minPrice - priceRange * 0.08;
  const chartMax = maxPrice + priceRange * 0.08;
  const effectiveRange = chartMax - chartMin;

  const getY = (val: number) => {
    return padding.top + chartHeight - ((val - chartMin) / effectiveRange) * chartHeight;
  };

  const candleWidth = Math.max(4, chartWidth / Math.max(visibleCandles.length, 1) - 3);

  // Price ticks on right axis
  const priceTicks = [
    chartMin + effectiveRange * 0.15,
    chartMin + effectiveRange * 0.35,
    chartMin + effectiveRange * 0.55,
    chartMin + effectiveRange * 0.75,
    chartMin + effectiveRange * 0.95,
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg shadow-black/20">
      {/* Chart Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-2 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white tracking-wide">{asset.symbol}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                {asset.assetClass}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                  asset.dataSource === "MT5_LIVE"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                }`}
                title={asset.dataSource === "MT5_LIVE" ? "Bid/ask streamed from the MetaTrader 5 terminal" : "Synthetic simulation feed - not broker data"}
              >
                {asset.dataSource === "MT5_LIVE" ? "MT5 LIVE FEED" : "SIMULATED FEED"}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  asset.trend15m === "BULLISH"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}
              >
                15m {asset.trend15m}
              </span>
            </div>
            <div className="text-xs text-slate-400 flex items-center space-x-3 mt-0.5">
              <span>{asset.name}</span>
              <span>•</span>
              <span>
                Spread: <strong className="text-amber-400">{asset.spread}</strong> pips
              </span>
              <span>•</span>
              <span>
                RSI(14): <strong className="text-violet-400">{asset.rsi14}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Timeframe & Overlay Toggles */}
        <div className="flex items-center space-x-2">
          <div className="flex rounded-lg bg-slate-800/80 p-0.5 border border-slate-700/60 text-xs">
            {(["5m", "15m", "1h", "4h"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  timeframe === tf
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowFVG(!showFVG)}
            className={`flex items-center space-x-1 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              showFVG
                ? "bg-purple-900/30 border-purple-500/50 text-purple-300"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>SMC Zones</span>
          </button>
        </div>
      </div>

      {/* Hover Info bar */}
      <div className="h-6 flex items-center space-x-4 text-xs font-mono text-slate-400 px-1 mb-1">
        {hoveredCandle ? (
          <>
            <span>
              O: <strong className="text-white">{hoveredCandle.open.toFixed(asset.digits)}</strong>
            </span>
            <span>
              H: <strong className="text-white">{hoveredCandle.high.toFixed(asset.digits)}</strong>
            </span>
            <span>
              L: <strong className="text-white">{hoveredCandle.low.toFixed(asset.digits)}</strong>
            </span>
            <span>
              C: <strong className="text-white">{hoveredCandle.close.toFixed(asset.digits)}</strong>
            </span>
            <span>
              Vol: <strong className="text-slate-300">{hoveredCandle.volume}</strong>
            </span>
          </>
        ) : (
          <span className="text-slate-500">Hover over any candle to inspect multi-timeframe OHLC data</span>
        )}
      </div>

      {/* SVG Interactive Chart */}
      <div className="relative w-full overflow-hidden bg-slate-950/60 rounded-lg border border-slate-800/80">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto select-none"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="fvgGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="bullishOrderBlock" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {priceTicks.map((tick, i) => {
            const y = getY(tick);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  stroke="#334155"
                  strokeWidth="0.8"
                  strokeDasharray="3,3"
                />
                <text
                  x={svgWidth - padding.right + 6}
                  y={y + 3.5}
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {tick.toFixed(asset.digits)}
                </text>
              </g>
            );
          })}

          {/* SMC Fair Value Gap Zone Overlay */}
          {showFVG && visibleCandles.length > 20 && (
            <g>
              <rect
                x={padding.left + chartWidth * 0.45}
                y={getY(visibleCandles[visibleCandles.length - 12]?.high || chartMax)}
                width={chartWidth * 0.45}
                height={Math.max(
                  8,
                  Math.abs(
                    getY(visibleCandles[visibleCandles.length - 12]?.high || chartMax) -
                      getY(visibleCandles[visibleCandles.length - 14]?.low || chartMin)
                  )
                )}
                fill="url(#fvgGradient)"
                stroke="#a855f7"
                strokeWidth="0.8"
                strokeDasharray="2,2"
              />
              <text
                x={padding.left + chartWidth * 0.46}
                y={getY(visibleCandles[visibleCandles.length - 12]?.high || chartMax) + 12}
                fill="#d8b4fe"
                fontSize="9"
                fontWeight="bold"
              >
                15m Bullish FVG (Mitigation Zone)
              </text>
            </g>
          )}

          {/* Candlesticks */}
          {visibleCandles.map((c, idx) => {
            const x =
              padding.left +
              (idx / (visibleCandles.length - 1 || 1)) * (chartWidth - candleWidth);
            const isBullish = c.close >= c.open;
            const top = getY(Math.max(c.open, c.close));
            const bottom = getY(Math.min(c.open, c.close));
            const height = Math.max(1.5, bottom - top);
            const highY = getY(c.high);
            const lowY = getY(c.low);
            const candleColor = isBullish ? "#10b981" : "#f43f5e";

            return (
              <g
                key={idx}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseEnter={() => setHoveredCandle(c)}
                onMouseLeave={() => setHoveredCandle(null)}
              >
                {/* Wick */}
                <line
                  x1={x + candleWidth / 2}
                  y1={highY}
                  x2={x + candleWidth / 2}
                  y2={lowY}
                  stroke={candleColor}
                  strokeWidth="1.2"
                />
                {/* Body */}
                <rect
                  x={x}
                  y={top}
                  width={candleWidth}
                  height={height}
                  fill={candleColor}
                  rx="1"
                />
              </g>
            );
          })}

          {/* Current Live Price Line */}
          <line
            x1={padding.left}
            y1={getY(currentPrice)}
            x2={svgWidth - padding.right}
            y2={getY(currentPrice)}
            stroke="#38bdf8"
            strokeWidth="1.2"
            strokeDasharray="4,2"
          />
          <rect
            x={svgWidth - padding.right}
            y={getY(currentPrice) - 8}
            width={72}
            height={16}
            fill="#0284c7"
            rx="3"
          />
          <text
            x={svgWidth - padding.right + 4}
            y={getY(currentPrice) + 3.5}
            fill="#ffffff"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {currentPrice.toFixed(asset.digits)}
          </text>

          {/* Active MT5 Trade Overlays */}
          {activeTrade && (
            <g>
              {/* Entry Price Line */}
              <line
                x1={padding.left}
                y1={getY(Number(activeTrade.entryPrice))}
                x2={svgWidth - padding.right}
                y2={getY(Number(activeTrade.entryPrice))}
                stroke="#06b6d4"
                strokeWidth="1.5"
              />
              <rect
                x={padding.left + 5}
                y={getY(Number(activeTrade.entryPrice)) - 9}
                width={100}
                height={18}
                fill="#083344"
                stroke="#06b6d4"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={padding.left + 9}
                y={getY(Number(activeTrade.entryPrice)) + 3}
                fill="#67e8f9"
                fontSize="9"
                fontWeight="bold"
              >
                ENTRY {activeTrade.direction} #{activeTrade.ticket}
              </text>

              {/* Stop Loss Line */}
              <line
                x1={padding.left}
                y1={getY(Number(activeTrade.stopLoss))}
                x2={svgWidth - padding.right}
                y2={getY(Number(activeTrade.stopLoss))}
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="5,3"
              />
              <rect
                x={padding.left + 5}
                y={getY(Number(activeTrade.stopLoss)) - 9}
                width={85}
                height={18}
                fill="#450a0a"
                stroke="#ef4444"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={padding.left + 9}
                y={getY(Number(activeTrade.stopLoss)) + 3}
                fill="#fca5a5"
                fontSize="9"
                fontWeight="bold"
              >
                SL {Number(activeTrade.stopLoss).toFixed(asset.digits)}
              </text>

              {/* Take Profit 1 Line */}
              <line
                x1={padding.left}
                y1={getY(Number(activeTrade.takeProfit1))}
                x2={svgWidth - padding.right}
                y2={getY(Number(activeTrade.takeProfit1))}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="5,3"
              />
              <rect
                x={padding.left + 5}
                y={getY(Number(activeTrade.takeProfit1)) - 9}
                width={85}
                height={18}
                fill="#064e3b"
                stroke="#10b981"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={padding.left + 9}
                y={getY(Number(activeTrade.takeProfit1)) + 3}
                fill="#6ee7b7"
                fontSize="9"
                fontWeight="bold"
              >
                TP1 {Number(activeTrade.takeProfit1).toFixed(asset.digits)}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Chart Footer Indicator Status */}
      <div className="flex items-center justify-between text-xs text-slate-400 mt-2 px-1">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            <span>Live Feed</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
            <span>SMC Mitigation Zone</span>
          </span>
          {activeTrade && (
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-emerald-400 font-medium">
                Active Position #{activeTrade.ticket} ({activeTrade.direction})
              </span>
            </span>
          )}
        </div>
        <div>
          <span>
            Server Time: <strong className="text-slate-300 font-mono">GMT+2 (IC Markets)</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
