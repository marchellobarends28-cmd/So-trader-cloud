export type AssetClass = "FOREX" | "COMMODITIES" | "CRYPTO" | "INDICES";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketAssetItem {
  id: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currentPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  spread: number;
  digits: number;
  pipSize: number;
  sentimentScore: number;
  trend4h: "BULLISH" | "BEARISH" | "RANGE";
  trend15m: "BULLISH" | "BEARISH" | "RANGE";
  rsi14: number;
  candles: Candle[];
  dataSource?: "MT5_LIVE" | "SIMULATION";
  bid?: number | null;
  ask?: number | null;
  lastTickAt?: string | null;
  updatedAt: string;
}

export interface AgentItem {
  id: number;
  agentId: string;
  name: string;
  role: string;
  avatar: string;
  description: string;
  status: "active" | "debating" | "analyzing" | "reflecting" | "idle";
  confidence: number;
  accuracyScore: number;
  tradesEvaluated: number;
  winsApproved: number;
  lossesVetoed: number;
  dreadWarningsTriggered: number;
  color: string;
  updatedAt: string;
}

export interface DebateMessage {
  agentId: string;
  agentName: string;
  avatar: string;
  role: string;
  stance: "BULLISH" | "BEARISH" | "NEUTRAL" | "VETO" | "ADJUST";
  message: string;
  confidence: number;
  timestamp: string;
  dreadWarningRef?: string;
}

export interface DebateItem {
  id: number;
  symbol: string;
  timeframe: string;
  action: "BUY" | "SELL" | "HOLD" | "VETOED";
  confidenceScore: number;
  proposedLot: number;
  proposedEntry: number;
  proposedSL: number;
  proposedTP: number;
  riskReward: number;
  dreadWarningActive: boolean;
  dreadWarningDetails: string | null;
  historicalLossMatchId: number | null;
  messages: DebateMessage[];
  synthesis: string;
  executedTradeId: number | null;
  status: "CONCLUDED" | "ACTIVE" | "REJECTED";
  createdAt: string;
}

export interface DreadedPostMortemItem {
  id: number;
  tradeId?: number | null;
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  lossCategory:
    | "LIQUIDITY_TRAP"
    | "FOMO_CHASE"
    | "NEWS_SLIPPAGE"
    | "COUNTER_TREND"
    | "EARLY_BE_STOP"
    | "SPREAD_WIDENING"
    | "KEY_RESISTANCE_BLINDNESS";
  whatWentWrong: string;
  theDreadedSin: string;
  rootCause: string;
  ruleLearned: string;
  preventedCount: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  patternSignature: {
    rsi?: number;
    trend?: string;
    session?: string;
    distanceToKeyLevelPips?: number;
    spreadAtEntry?: number;
    timeframe?: string;
  };
  aiReflectionScore: number;
  isMemoryActive: boolean;
  createdAt: string;
}

export interface TradeItem {
  id: number;
  ticket: number;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  closePrice?: number | null;
  pnl: number;
  pnlPercent: number;
  commission: number;
  swap: number;
  status: "OPEN" | "CLOSED" | "BE_ACTIVE" | "PENDING" | "CANCELLED";
  riskReward: number;
  strategy: string;
  dreadChecked: boolean;
  dreadCheckSummary: string | null;
  openTime: string;
  closeTime?: string | null;
  closeReason?: string | null;
  isSimulated?: boolean;
  commandId?: string | null;
  externalTicket?: string | null;
  brokerFillPrice?: number | null;
}

export interface MT5AccountItem {
  id: number;
  accountNumber: string;
  broker: string;
  serverName: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  isDemo: boolean;
  isConnected: boolean;
  bridgeMode: "mql5_ea" | "direct_api" | "python_bridge" | "simulation";
  apiKey: string;
  eaVersion: string;
  tradeAllowedByEa: boolean;
  eaRiskProfile: Record<string, unknown>;
  lastHeartbeat: string;
  updatedAt: string;
}

export interface AISettingsItem {
  id: number;
  autopilotEnabled: boolean;
  autonomousMode: "AUTONOMOUS" | "SEMI_AUTONOMOUS" | "PAPER_SIMULATION";
  maxDailyDrawdownPct: number;
  riskPerTradePct: number;
  maxOpenTrades: number;
  minRiskReward: number;
  grokTone: "unfiltered" | "professional" | "cynical";
  preferredSessions: string;
  postMortemFrequency: string;
  minConsensusQuorum: number;
  dreadThresholdPct: number;
  updatedAt: string;
}

export interface SystemLogItem {
  id: number;
  level: "INFO" | "WARN" | "ERROR" | "DREAD_ALERT" | "TRADE_EXEC" | "AGENT_VETO";
  source: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/* ---- Real-execution bridge, validation & go-live types ---- */

export interface BridgeCommandItem {
  id: number;
  commandId: string;
  type: "EXECUTE_TRADE" | "MODIFY_POSITION" | "CLOSE_POSITION" | "CLOSE_ALL" | "PING";
  symbol: string | null;
  direction: "BUY" | "SELL" | null;
  lot: number | string | null;
  stopLoss: number | string | null;
  takeProfit: number | string | null;
  ticket: string | null;
  status: "PENDING" | "SENT" | "ACKED" | "FAILED" | "EXPIRED";
  attempts: number;
  source: "AGENT" | "MANUAL" | "RISK";
  resultText: string | null;
  brokerTicket: string | null;
  fillPrice: number | string | null;
  createdAt: string;
  ackedAt: string | null;
}

export interface BridgeStatusItem {
  isLive: boolean;
  heartbeatAgeSeconds: number;
  dataSource: "MT5_LIVE" | "SIMULATION";
  pendingCommands: BridgeCommandItem[];
  recentAcks: BridgeCommandItem[];
  account: MT5AccountItem;
}

export interface BacktestRunItem {
  id: number;
  symbol: string;
  timeframe: string;
  bars: number;
  barsSource: "MT5_HISTORY" | "SYNTHETIC";
  startingEquity: number | string;
  riskPerTradePct: number | string;
  tradesTaken: number;
  winRate: number | string;
  profitFactor: number | string;
  maxDrawdownPct: number | string;
  netProfit: number | string;
  expectancyR: number | string;
  metrics: Record<string, unknown>;
  equityCurve: { index: number; equity: number }[];
  passedGate: boolean;
  createdAt: string;
}

export interface DemoPlanTaskItem {
  id: number;
  taskKey: string;
  label: string;
  detail: string;
  category: "SETUP" | "BRIDGE" | "RISK" | "VALIDATION" | "DEMO";
  required: boolean;
  completed: boolean;
  autoVerified: boolean;
  evidence: string | null;
  sortOrder: number;
}

export interface ReadinessItem {
  tasks: DemoPlanTaskItem[];
  readinessPct: number;
  readyForDemo: boolean;
  readyForLive: boolean;
  blockers: string[];
  autoEvidence: Record<string, { passed: boolean; evidence: string }>;
}

export interface BrokerPositionItem {
  id: number;
  ticket: string;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number | string;
  priceOpen: number | string;
  priceCurrent: number | string;
  stopLoss: number | string | null;
  takeProfit: number | string | null;
  profit: number | string;
  isOpen: boolean;
  reportedAt: string;
}

/* ---- V4 risk / validation / learning types ---- */

export interface RiskSnapshotItem {
  equity: number;
  balance: number;
  floatingPnl: number;
  openPositions: number;
  openRiskPct: number;
  openRiskUsd: number;
  dailyPnlUsd: number;
  dailyDrawdownPct: number;
  weeklyDrawdownPct: number;
  maxDailyDrawdownPct: number;
  maxWeeklyDrawdownPct: number;
  maxAggregateOpenRiskPct: number;
  riskPerTradePct: number;
  emergencyStop: boolean;
  emergencyReason: string | null;
  priceAgeSeconds: number;
  dataFresh: boolean;
  breakers: string[];
  canOpenNewTrades: boolean;
  isDemo: boolean;
  marginLevelPct: number;
}

export interface RiskEventItem {
  id: number;
  severity: "INFO" | "WARN" | "CRITICAL";
  type: string;
  message: string;
  symbol: string | null;
  createdAt: string;
}

export interface GateItem {
  id: string;
  label: string;
  target: string;
  actual: string;
  passed: boolean;
  required: boolean;
  evidence: string;
}

export interface ValidationReportItem {
  gates: GateItem[];
  passed: boolean;
  blockers: string[];
  liveAllowed: boolean;
  demoRequired: boolean;
  criticalErrors: number;
  demoDaysElapsed: number;
  generatedAt: string;
}

export interface QualityReportItem {
  symbol: string;
  timeframe: string;
  bars: number;
  duplicates: number;
  gaps: number;
  invalidOhlc: number;
  futureBars: number;
  staleMinutes: number;
  priceDeviationPct: number | null;
  passed: boolean;
  issues: string[];
  source: string;
}

export interface InstrumentSpecItem {
  symbol: string;
  digits: number;
  contractSize: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  stopsLevelPoints: number;
  commissionPerLot: number;
  typicalSpreadPoints: number;
  source?: string;
}

export interface ConditionStatItem {
  key: string;
  trades: number;
  wins: number;
  winRatePct: number;
  expectancyR: number;
}

export interface MistakeItem {
  code: string;
  label: string;
  occurrences: number;
  expectancyR: number;
  suggestion: string;
}

export interface LearningProposalItem {
  id: number;
  title: string;
  status: string;
  independentSupport: boolean;
  oosExpectancy: number | null;
  baselineOosExpectancy: number | null;
  createdAt: string;
}

export interface LearningProgressItem {
  tradesAnalyzed: number;
  mistakes: MistakeItem[];
  conditions: {
    byRegime: ConditionStatItem[];
    byHour: ConditionStatItem[];
    bySymbol: ConditionStatItem[];
    bySetup: ConditionStatItem[];
  };
  proposals: LearningProposalItem[];
  activeVersion: {
    id: number;
    label: string;
    params: Record<string, unknown>;
    origin: string;
    approvedAt: string | null;
  } | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
}
