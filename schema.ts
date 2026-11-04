import { pgTable, text, serial, timestamp, numeric, boolean, integer, jsonb, bigint, uniqueIndex } from "drizzle-orm/pg-core";

export const mt5Accounts = pgTable("mt5_accounts", {
  id: serial("id").primaryKey(),
  accountNumber: text("account_number").notNull().default("8821940"),
  broker: text("broker").notNull().default("MetaQuotes Software Corp / IC Markets"),
  serverName: text("server_name").notNull().default("ICMarketsSC-Live02"),
  currency: text("currency").notNull().default("USD"),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("50000.00"),
  equity: numeric("equity", { precision: 12, scale: 2 }).notNull().default("50000.00"),
  margin: numeric("margin", { precision: 12, scale: 2 }).notNull().default("0.00"),
  freeMargin: numeric("free_margin", { precision: 12, scale: 2 }).notNull().default("50000.00"),
  marginLevel: numeric("margin_level", { precision: 8, scale: 2 }).notNull().default("0.00"),
  leverage: integer("leverage").notNull().default(100),
  isDemo: boolean("is_demo").notNull().default(true),
  isConnected: boolean("is_connected").notNull().default(true),
  bridgeMode: text("bridge_mode").notNull().default("mql5_ea"), // "mql5_ea" | "direct_api" | "python_bridge" | "simulation"
  apiKey: text("api_key").notNull().default(""),
  eaVersion: text("ea_version").notNull().default("0.0.0"),
  tradeAllowedByEa: boolean("trade_allowed_by_ea").notNull().default(false),
  eaRiskProfile: jsonb("ea_risk_profile").notNull().default({}),
  lastHeartbeat: timestamp("last_heartbeat").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull().unique(), // e.g. "grok_sentiment", "smc_quant", "risk_sentinel", "execution_sniper", "post_mortem_critic"
  name: text("name").notNull(),
  role: text("role").notNull(),
  avatar: text("avatar").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("active"), // "active" | "debating" | "analyzing" | "reflecting" | "idle"
  confidence: integer("confidence").notNull().default(88), // 0 - 100
  accuracyScore: numeric("accuracy_score", { precision: 5, scale: 2 }).notNull().default("78.50"),
  tradesEvaluated: integer("trades_evaluated").notNull().default(142),
  winsApproved: integer("wins_approved").notNull().default(98),
  lossesVetoed: integer("losses_vetoed").notNull().default(34),
  dreadWarningsTriggered: integer("dread_warnings_triggered").notNull().default(27),
  color: text("color").notNull().default("#3b82f6"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const marketAssets = pgTable("market_assets", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(), // "EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "US30", "NAS100"
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull().default("FOREX"), // "FOREX" | "COMMODITIES" | "CRYPTO" | "INDICES"
  currentPrice: numeric("current_price", { precision: 12, scale: 5 }).notNull(),
  change24h: numeric("change_24h", { precision: 6, scale: 2 }).notNull().default("0.00"),
  high24h: numeric("high_24h", { precision: 12, scale: 5 }).notNull(),
  low24h: numeric("low_24h", { precision: 12, scale: 5 }).notNull(),
  spread: numeric("spread", { precision: 6, scale: 1 }).notNull().default("1.2"),
  digits: integer("digits").notNull().default(5),
  pipSize: numeric("pip_size", { precision: 8, scale: 5 }).notNull().default("0.00010"),
  sentimentScore: integer("sentiment_score").notNull().default(65), // 0-100 (50 neutral)
  trend4h: text("trend_4h").notNull().default("BULLISH"), // "BULLISH" | "BEARISH" | "RANGE"
  trend15m: text("trend_15m").notNull().default("BULLISH"),
  rsi14: numeric("rsi_14", { precision: 5, scale: 2 }).notNull().default("54.20"),
  candles: jsonb("candles").notNull().default([]), // array of { time, open, high, low, close, volume }
  dataSource: text("data_source").notNull().default("SIMULATION"), // "MT5_LIVE" | "SIMULATION"
  bid: numeric("bid", { precision: 12, scale: 5 }),
  ask: numeric("ask", { precision: 12, scale: 5 }),
  lastTickAt: timestamp("last_tick_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agentDebates = pgTable("agent_debates", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull().default("15m"),
  action: text("action").notNull(), // "BUY" | "SELL" | "HOLD" | "VETOED"
  confidenceScore: integer("confidence_score").notNull().default(75),
  proposedLot: numeric("proposed_lot", { precision: 6, scale: 2 }).notNull().default("0.50"),
  proposedEntry: numeric("proposed_entry", { precision: 12, scale: 5 }).notNull(),
  proposedSL: numeric("proposed_sl", { precision: 12, scale: 5 }).notNull(),
  proposedTP: numeric("proposed_tp", { precision: 12, scale: 5 }).notNull(),
  riskReward: numeric("risk_reward", { precision: 5, scale: 2 }).notNull().default("2.50"),
  dreadWarningActive: boolean("dread_warning_active").notNull().default(false),
  dreadWarningDetails: text("dread_warning_details"),
  historicalLossMatchId: integer("historical_loss_match_id"), // links to dreaded_post_mortems
  messages: jsonb("messages").notNull().default([]), // array of { agentId, agentName, avatar, role, stance, message, timestamp }
  synthesis: text("synthesis").notNull(),
  executedTradeId: integer("executed_trade_id"),
  status: text("status").notNull().default("CONCLUDED"), // "CONCLUDED" | "ACTIVE" | "REJECTED"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dreadedPostMortems = pgTable("dreaded_post_mortems", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id"),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // "BUY" | "SELL"
  entryPrice: numeric("entry_price", { precision: 12, scale: 5 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 12, scale: 5 }).notNull(),
  pnl: numeric("pnl", { precision: 10, scale: 2 }).notNull(),
  pnlPercent: numeric("pnl_percent", { precision: 6, scale: 2 }).notNull(),
  lossCategory: text("loss_category").notNull(), // "LIQUIDITY_TRAP" | "FOMO_CHASE" | "NEWS_SLIPPAGE" | "COUNTER_TREND" | "EARLY_BE_STOP" | "SPREAD_WIDENING"
  whatWentWrong: text("what_went_wrong").notNull(),
  theDreadedSin: text("the_dreaded_sin").notNull(), // Grok-style scathing diagnosis
  rootCause: text("root_cause").notNull(),
  ruleLearned: text("rule_learned").notNull(), // The new rule committed to neural playbook
  preventedCount: integer("prevented_count").notNull().default(0), // Times this rule saved money later
  severity: text("severity").notNull().default("HIGH"), // "CRITICAL" | "HIGH" | "MEDIUM"
  patternSignature: jsonb("pattern_signature").notNull().default({}), // Indicators, session, timeframe at time of loss
  aiReflectionScore: integer("ai_reflection_score").notNull().default(92), // 0 - 100 quality of learning
  isMemoryActive: boolean("is_memory_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  ticket: integer("ticket").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // "BUY" | "SELL"
  lotSize: numeric("lot_size", { precision: 6, scale: 2 }).notNull().default("0.50"),
  entryPrice: numeric("entry_price", { precision: 12, scale: 5 }).notNull(),
  currentPrice: numeric("current_price", { precision: 12, scale: 5 }).notNull(),
  stopLoss: numeric("stop_loss", { precision: 12, scale: 5 }).notNull(),
  takeProfit1: numeric("take_profit_1", { precision: 12, scale: 5 }).notNull(),
  takeProfit2: numeric("take_profit_2", { precision: 12, scale: 5 }),
  takeProfit3: numeric("take_profit_3", { precision: 12, scale: 5 }),
  closePrice: numeric("close_price", { precision: 12, scale: 5 }),
  pnl: numeric("pnl", { precision: 10, scale: 2 }).notNull().default("0.00"),
  pnlPercent: numeric("pnl_percent", { precision: 6, scale: 2 }).notNull().default("0.00"),
  commission: numeric("commission", { precision: 6, scale: 2 }).notNull().default("0.00"),
  swap: numeric("swap", { precision: 6, scale: 2 }).notNull().default("0.00"),
  status: text("status").notNull().default("OPEN"), // "OPEN" | "CLOSED" | "BE_ACTIVE" | "CANCELLED"
  riskReward: numeric("risk_reward", { precision: 5, scale: 2 }).notNull().default("2.50"),
  strategy: text("strategy").notNull().default("SMC Order Block & Liquidity Sweep"),
  dreadChecked: boolean("dread_checked").notNull().default(true),
  dreadCheckSummary: text("dread_check_summary"),
  openTime: timestamp("open_time").defaultNow().notNull(),
  closeTime: timestamp("close_time"),
  closeReason: text("close_reason"), // "TP1_HIT" | "TP2_HIT" | "SL_HIT" | "TRAILING_HIT" | "MANUAL" | "PANIC_CLOSE"
  // Execution provenance: simulated rows are paper trades, broker rows come from a real MT5 fill.
  isSimulated: boolean("is_simulated").notNull().default(true),
  commandId: text("command_id"),
  externalTicket: text("external_ticket"),
  brokerFillPrice: numeric("broker_fill_price", { precision: 12, scale: 5 }),
  slippagePoints: numeric("slippage_points", { precision: 8, scale: 2 }),
});

// Durable command queue polled by the MT5 Expert Advisor (EXECUTE_TRADE / MODIFY / CLOSE / CLOSE_ALL ...)
export const mt5Commands = pgTable("mt5_commands", {
  id: serial("id").primaryKey(),
  commandId: text("command_id").notNull().unique(),
  type: text("type").notNull(), // "EXECUTE_TRADE" | "MODIFY_POSITION" | "CLOSE_POSITION" | "CLOSE_ALL" | "PING"
  symbol: text("symbol"),
  direction: text("direction"), // "BUY" | "SELL"
  lot: numeric("lot", { precision: 8, scale: 2 }),
  stopLoss: numeric("stop_loss", { precision: 12, scale: 5 }),
  takeProfit: numeric("take_profit", { precision: 12, scale: 5 }),
  ticket: text("ticket"),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("PENDING"), // PENDING | SENT | ACKED | FAILED | EXPIRED
  attempts: integer("attempts").notNull().default(0),
  source: text("source").notNull().default("AGENT"), // AGENT | MANUAL | RISK
  resultText: text("result_text"),
  brokerTicket: text("broker_ticket"),
  fillPrice: numeric("fill_price", { precision: 12, scale: 5 }),
  errorCode: integer("error_code"),
  localTradeId: integer("local_trade_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
  ackedAt: timestamp("acked_at"),
});

// Mirror of live broker positions reported by the EA (source of truth when live)
export const mt5Positions = pgTable("mt5_positions", {
  id: serial("id").primaryKey(),
  ticket: text("ticket").notNull().unique(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  volume: numeric("volume", { precision: 8, scale: 2 }).notNull(),
  priceOpen: numeric("price_open", { precision: 12, scale: 5 }).notNull(),
  priceCurrent: numeric("price_current", { precision: 12, scale: 5 }).notNull(),
  stopLoss: numeric("stop_loss", { precision: 12, scale: 5 }),
  takeProfit: numeric("take_profit", { precision: 12, scale: 5 }),
  profit: numeric("profit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  swap: numeric("swap", { precision: 10, scale: 2 }).notNull().default("0.00"),
  commission: numeric("commission", { precision: 10, scale: 2 }).notNull().default("0.00"),
  magic: integer("magic").notNull().default(0),
  comment: text("comment"),
  isOpen: boolean("is_open").notNull().default(true),
  reportedAt: timestamp("reported_at").defaultNow().notNull(),
});

export const backtestRuns = pgTable("backtest_runs", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull().default("15m"),
  bars: integer("bars").notNull().default(1500),
  barsSource: text("bars_source").notNull().default("MT5_HISTORY"), // "MT5_HISTORY" | "SYNTHETIC"
  startingEquity: numeric("starting_equity", { precision: 12, scale: 2 }).notNull().default("10000.00"),
  riskPerTradePct: numeric("risk_per_trade_pct", { precision: 5, scale: 2 }).notNull().default("0.50"),
  tradesTaken: integer("trades_taken").notNull().default(0),
  winRate: numeric("win_rate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  profitFactor: numeric("profit_factor", { precision: 6, scale: 2 }).notNull().default("0.00"),
  maxDrawdownPct: numeric("max_drawdown_pct", { precision: 6, scale: 2 }).notNull().default("0.00"),
  netProfit: numeric("net_profit", { precision: 12, scale: 2 }).notNull().default("0.00"),
  expectancyR: numeric("expectancy_r", { precision: 6, scale: 2 }).notNull().default("0.00"),
  metrics: jsonb("metrics").notNull().default({}),
  equityCurve: jsonb("equity_curve").notNull().default([]),
  passedGate: boolean("passed_gate").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Demo-account go-live checklist (Claude's demo test plan, persisted)
export const demoPlanTasks = pgTable("demo_plan_tasks", {
  id: serial("id").primaryKey(),
  taskKey: text("task_key").notNull().unique(),
  label: text("label").notNull(),
  detail: text("detail").notNull(),
  category: text("category").notNull().default("SETUP"), // SETUP | BRIDGE | RISK | VALIDATION | DEMO
  required: boolean("required").notNull().default(true),
  completed: boolean("completed").notNull().default(false),
  autoVerified: boolean("auto_verified").notNull().default(false),
  evidence: text("evidence"),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiSettings = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  autopilotEnabled: boolean("autopilot_enabled").notNull().default(true),
  autonomousMode: text("autonomous_mode").notNull().default("AUTONOMOUS"), // "AUTONOMOUS" | "SEMI_AUTONOMOUS" | "PAPER_SIMULATION"
  maxDailyDrawdownPct: numeric("max_daily_drawdown_pct", { precision: 5, scale: 2 }).notNull().default("3.00"),
  riskPerTradePct: numeric("risk_per_trade_pct", { precision: 5, scale: 2 }).notNull().default("1.00"),
  maxOpenTrades: integer("max_open_trades").notNull().default(4),
  minRiskReward: numeric("min_risk_reward", { precision: 5, scale: 2 }).notNull().default("2.00"),
  grokTone: text("grok_tone").notNull().default("unfiltered"), // "unfiltered" | "professional" | "cynical"
  preferredSessions: text("preferred_sessions").notNull().default("LONDON_AND_NY"),
  postMortemFrequency: text("post_mortem_frequency").notNull().default("IMMEDIATE_ON_CLOSE"),
  minConsensusQuorum: integer("min_consensus_quorum").notNull().default(3), // 3 of 4 agents must agree
  dreadThresholdPct: integer("dread_threshold_pct").notNull().default(70), // If pattern similarity > 70% to previous loss, veto or adapt
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("INFO"), // "INFO" | "WARN" | "ERROR" | "DREAD_ALERT" | "TRADE_EXEC" | "AGENT_VETO"
  source: text("source").notNull().default("System"),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ================================================================== *
 * SO TRADER AI V4.0 additions
 * ================================================================== */

// Broker instrument specifications used for sizing, costs and SL/TP validation.
export const symbolSpecs = pgTable("symbol_specs", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  digits: integer("digits").notNull().default(5),
  point: numeric("point", { precision: 12, scale: 8 }).notNull().default("0.00001"),
  contractSize: numeric("contract_size", { precision: 14, scale: 4 }).notNull().default("100000"),
  tickSize: numeric("tick_size", { precision: 12, scale: 8 }).notNull().default("0.00001"),
  tickValue: numeric("tick_value", { precision: 12, scale: 4 }).notNull().default("1"),
  minLot: numeric("min_lot", { precision: 8, scale: 2 }).notNull().default("0.01"),
  maxLot: numeric("max_lot", { precision: 8, scale: 2 }).notNull().default("100"),
  lotStep: numeric("lot_step", { precision: 8, scale: 2 }).notNull().default("0.01"),
  stopsLevelPoints: integer("stops_level_points").notNull().default(10),
  freezeLevelPoints: integer("freeze_level_points").notNull().default(5),
  commissionPerLot: numeric("commission_per_lot", { precision: 8, scale: 2 }).notNull().default("7"),
  slippagePoints: integer("slippage_points").notNull().default(8),
  typicalSpreadPoints: numeric("typical_spread_points", { precision: 8, scale: 1 }).notNull().default("10"),
  source: text("source").notNull().default("DEFAULT"), // "BROKER" | "DEFAULT"
  verifiedAt: timestamp("verified_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Genuine OHLC bars imported from the MT5 terminal (never synthetic).
export const marketBars = pgTable(
  "market_bars",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull().default("M15"),
    time: bigint("time", { mode: "number" }).notNull(), // unix seconds (broker server time)
    open: numeric("open", { precision: 14, scale: 5 }).notNull(),
    high: numeric("high", { precision: 14, scale: 5 }).notNull(),
    low: numeric("low", { precision: 14, scale: 5 }).notNull(),
    close: numeric("close", { precision: 14, scale: 5 }).notNull(),
    volume: integer("volume").notNull().default(0),
    source: text("source").notNull().default("MT5_HISTORY"), // "MT5_HISTORY" | "MT5_LIVE" | "SIMULATION"
    importedAt: timestamp("imported_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("market_bars_symbol_tf_time_idx").on(t.symbol, t.timeframe, t.time),
  })
);

export const dataQualityReports = pgTable("data_quality_reports", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  bars: integer("bars").notNull().default(0),
  firstBarTime: bigint("first_bar_time", { mode: "number" }),
  lastBarTime: bigint("last_bar_time", { mode: "number" }),
  duplicates: integer("duplicates").notNull().default(0),
  outOfOrder: integer("out_of_order").notNull().default(0),
  gaps: integer("gaps").notNull().default(0),
  largestGapMinutes: integer("largest_gap_minutes").notNull().default(0),
  invalidOhlc: integer("invalid_ohlc").notNull().default(0),
  futureBars: integer("future_bars").notNull().default(0),
  staleMinutes: integer("stale_minutes").notNull().default(0),
  priceDeviationPct: numeric("price_deviation_pct", { precision: 8, scale: 3 }),
  passed: boolean("passed").notNull().default(false),
  issues: jsonb("issues").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Versioned strategy parameters. Only one version is active at a time.
export const strategyVersions = pgTable("strategy_versions", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  params: jsonb("params").notNull(),
  status: text("status").notNull().default("CANDIDATE"), // "CANDIDATE" | "ACTIVE" | "RETIRED" | "REJECTED"
  origin: text("origin").notNull().default("BASELINE"), // "BASELINE" | "LEARNING" | "MANUAL"
  inSample: jsonb("in_sample").notNull().default({}),
  outOfSample: jsonb("out_of_sample").notNull().default({}),
  walkForward: jsonb("walk_forward").notNull().default({}),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Self-learning proposals. Live strategy never changes without explicit approval.
export const learningProposals = pgTable("learning_proposals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  hypothesis: text("hypothesis").notNull(),
  rationale: text("rationale").notNull(),
  changes: jsonb("changes").notNull().default({}),
  evidence: jsonb("evidence").notNull().default({}),
  independentSupport: boolean("independent_support").notNull().default(false),
  status: text("status").notNull().default("PENDING"), // "PENDING" | "APPROVED" | "APPLIED" | "REJECTED"
  generatedBy: text("generated_by").notNull().default("LEARNING_ENGINE"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  appliedVersionId: integer("applied_version_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Per-trade learning record (deterministic statistical attribution).
export const tradeLearnings = pgTable("trade_learnings", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id"),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  regime: text("regime"),
  setupTag: text("setup_tag"),
  rsiAtEntry: numeric("rsi_at_entry", { precision: 5, scale: 2 }),
  atrPctAtEntry: numeric("atr_pct_at_entry", { precision: 6, scale: 3 }),
  entryHourUtc: integer("entry_hour_utc"),
  riskReward: numeric("risk_reward", { precision: 5, scale: 2 }),
  outcome: text("outcome").notNull(), // "WIN" | "LOSS" | "BREAKEVEN"
  rMultiple: numeric("r_multiple", { precision: 6, scale: 2 }),
  pnl: numeric("pnl", { precision: 10, scale: 2 }),
  mistakeTags: jsonb("mistake_tags").notNull().default([]),
  conditions: jsonb("conditions").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const riskEvents = pgTable("risk_events", {
  id: serial("id").primaryKey(),
  severity: text("severity").notNull().default("WARN"), // "INFO" | "WARN" | "CRITICAL"
  type: text("type").notNull(), // DAILY_DD | WEEKLY_DD | AGGREGATE_RISK | DUPLICATE | SL_TP_INVALID | LOT_INVALID | STALE_DATA | EMERGENCY_STOP | DEMO_LOCK
  message: text("message").notNull(),
  symbol: text("symbol"),
  tradeId: integer("trade_id"),
  metadata: jsonb("metadata").notNull().default({}),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Key/value system state (emergency stop, demo lock, dashboard auth, forward-test clock).
export const systemState = pgTable("system_state", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const demoForwardRuns = pgTable("demo_forward_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  accountNumber: text("account_number"),
  isDemo: boolean("is_demo").notNull().default(true),
  daysRequired: integer("days_required").notNull().default(30),
  tradesDuringRun: integer("trades_during_run").notNull().default(0),
  criticalErrors: integer("critical_errors").notNull().default(0),
  status: text("status").notNull().default("RUNNING"), // "RUNNING" | "PASSED" | "FAILED"
  notes: text("notes"),
});
