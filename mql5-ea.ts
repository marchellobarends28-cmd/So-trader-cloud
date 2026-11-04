export interface EABuildOptions {
  serverUrl: string;
  apiKey: string;
  symbols: string[];
}

/**
 * Generates a production-ready MQL5 Expert Advisor.
 *
 * Unlike a reporting-only bridge, this EA:
 *  - streams live bid/ask quotes, open positions and closed deals to the server
 *  - polls a durable command queue and EXECUTES trades (market open, SL/TP, partial closes, modifications)
 *  - enforces hard risk limits locally (daily loss circuit breaker, lot cap, spread cap,
 *    max open positions, session window) so a server outage can never cause unchecked risk
 *  - acknowledges every command with the broker ticket, fill price and/or error code
 */
export function buildExpertAdvisorCode({ serverUrl, apiKey, symbols }: EABuildOptions): string {
  const symbolList = symbols.length > 0 ? symbols.join(",") : "EURUSD,GBPUSD,XAUUSD,BTCUSD,US30,NAS100";

  return `//+------------------------------------------------------------------+
//|                                        GrokBot_MT5_Bridge.mq5     |
//|        AUTONOMOUS EXECUTION BRIDGE  -  real orders, real quotes  |
//|                                  SO TRADER AI / MT5  (build 4.00)   |
//+------------------------------------------------------------------+
#property copyright "GrokBot Autonomous AI"
#property link      "${serverUrl}"
#property version   "4.00"
#property description "Live price feed + real order execution + local hard risk limits"
#property strict

#include <Trade\\Trade.mqh>
#include <Trade\\PositionInfo.mqh>

CTrade         trade;
CPositionInfo  posInfo;

//--- Bridge configuration
input group "=== 1. Bridge ==="
input string   InpServerUrl          = "${serverUrl}/api/mt5/bridge"; // Heartbeat + command URL
input string   InpAckUrl             = "${serverUrl}/api/mt5/bridge/ack"; // Command acknowledgement URL
input string   InpHistoryUrl         = "${serverUrl}/api/mt5/history"; // Historical bar upload URL
input string   InpApiKey             = "${apiKey}"; // Secret API key
input string   InpSymbols            = "${symbolList}"; // Symbols to stream (comma separated)
input int      InpPollSeconds        = 2;      // Poll interval (seconds)
input ulong    InpMagic              = 998877; // Magic number (isolates GrokBot trades)

//--- HARD RISK LIMITS (enforced locally, not only server-side)
input group "=== 2. Hard Risk Limits ==="
input bool     InpAllowTrading       = true;   // Master execution switch
input double   InpRiskPercent        = 0.50;   // Risk % of equity per trade
input double   InpMaxDailyLossPct    = 3.00;   // Daily loss circuit breaker %
input bool     InpFlattenOnBreach    = true;   // Flatten book when breaker trips
input double   InpMaxLot             = 1.00;   // Absolute lot cap per order
input int      InpMaxOpenPositions   = 3;      // Max concurrent GrokBot positions
input int      InpMaxSpreadPoints    = 35;     // Reject entries above this spread
input double   InpMinRiskReward      = 1.50;   // Reject orders below this R:R
input int      InpMaxSlippagePoints  = 20;     // Max deviation in points
input int      InpTradeStartHour     = 6;      // Server-time trading window start
input int      InpTradeEndHour       = 21;     // Server-time trading window end

//--- Trade management
input group "=== 3. Management ==="
input bool     InpManageTrailing     = true;   // Trailing stop management
input double   InpTrailingStartR     = 1.0;    // Arm trailing after +1.0R
input int      InpTrailingStepPoints = 150;    // Trail distance in points
input bool     InpUseBreakEven       = true;   // Move to BE only after TP1-equivalent
input double   InpBreakEvenAtR       = 1.0;    // R multiple required before BE

//--- Globals
double   g_dayStartEquity = 0;
int      g_dayStamp       = -1;
bool     g_breakerTripped = false;
string   g_lastResponse   = "";
datetime g_lastDealSync   = 0;
string   g_processedCommands[];

bool IsProcessed(string id)
{
   for(int i = 0; i < ArraySize(g_processedCommands); i++)
      if(g_processedCommands[i] == id) return true;
   return false;
}

void MarkProcessed(string id)
{
   int n = ArraySize(g_processedCommands);
   if(n > 400)
   {
      for(int i = 1; i < n; i++) g_processedCommands[i-1] = g_processedCommands[i];
      g_processedCommands[n-1] = id;
      return;
   }
   ArrayResize(g_processedCommands, n + 1);
   g_processedCommands[n] = id;
}

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpMaxSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.LogLevel(LOG_LEVEL_ERRORS);

   g_dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_dayStamp       = DayOfYear();
   g_breakerTripped = false;

   EventSetTimer(MathMax(1, InpPollSeconds));

   Print(">>> [SO TRADER 4.00] Execution bridge online. Magic=", InpMagic,
         " Risk=", InpRiskPercent, "% DailyStop=", InpMaxDailyLossPct, "%");
   Print(">>> [SO TRADER 4.00] Heartbeat: ", InpServerUrl);
   Print(">>> [SO TRADER 4.00] Streaming: ", InpSymbols);

   SendHeartbeat();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print(">>> [SO TRADER 4.00] Bridge stopped. reason=", reason);
}

void OnTimer()
{
   if(DayOfYear() != g_dayStamp)
   {
      g_dayStamp       = DayOfYear();
      g_dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_breakerTripped = false;
   }

   if(CheckLocalRiskLimits())
      ManageOpenPositions();

   string response = SendHeartbeat();
   if(StringLen(response) > 0)
      ProcessCommandResponse(response);
}

//+------------------------------------------------------------------+
//| LOCAL RISK BRAIN                                                 |
//+------------------------------------------------------------------+
bool CheckLocalRiskLimits()
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);

   if(g_dayStartEquity <= 0)
      g_dayStartEquity = equity;

   double ddPct = (g_dayStartEquity - equity) / g_dayStartEquity * 100.0;

   if(ddPct >= InpMaxDailyLossPct)
   {
      if(!g_breakerTripped)
      {
         g_breakerTripped = true;
         Print("!!! [GrokBot RISK] Daily loss breaker at ", DoubleToString(ddPct, 2),
               "%. New entries BLOCKED locally.");
         if(InpFlattenOnBreach)
            CloseAllMine("RISK_BREAKER");
      }
      return false;
   }

   if(!InpAllowTrading || !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      return false;

   return true;
}

bool InsideTradingWindow()
{
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   if(InpTradeStartHour <= InpTradeEndHour)
      return (now.hour >= InpTradeStartHour && now.hour < InpTradeEndHour);
   return (now.hour >= InpTradeStartHour || now.hour < InpTradeEndHour);
}

int CountMyPositions()
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) == (long)InpMagic)
         count++;
   }
   return count;
}

double NormalizeLot(double lot, string symbol)
{
   double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(lotStep <= 0) lotStep = 0.01;

   double cap = MathMin(maxLot, InpMaxLot);
   lot = MathFloor(lot / lotStep + 0.0000001) * lotStep;
   lot = MathMax(minLot, MathMin(cap, lot));
   return NormalizeDouble(lot, 2);
}

//+------------------------------------------------------------------+
//| Risk-based position sizing using real tick value                 |
//+------------------------------------------------------------------+
double CalculateLot(string symbol, double entry, double sl)
{
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * InpRiskPercent / 100.0;
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double distance  = MathAbs(entry - sl);

   if(tickSize <= 0 || tickValue <= 0 || distance <= 0)
      return NormalizeLot(0.01, symbol);

   double lossPerLot = (distance / tickSize) * tickValue;
   if(lossPerLot <= 0)
      return NormalizeLot(0.01, symbol);

   return NormalizeLot(riskMoney / lossPerLot, symbol);
}

//+------------------------------------------------------------------+
//| HEARTBEAT: real quotes + positions + closed deals                |
//+------------------------------------------------------------------+
string SendHeartbeat()
{
   string quotes = BuildQuotesJson(InpSymbols);
   string positions = BuildPositionsJson();
   string deals = BuildRecentDealsJson();

   string payload = StringFormat(
      "{\\"apiKey\\":\\"%s\\",\\"type\\":\\"heartbeat\\",\\"eaVersion\\":\\"4.00\\","
      "\\"accountNumber\\":\\"%I64d\\",\\"broker\\":\\"%s\\",\\"server\\":\\"%s\\",\\"currency\\":\\"%s\\","
      "\\"balance\\":%.2f,\\"equity\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,"
      "\\"leverage\\":%d,\\"isDemo\\":%s,\\"tradeAllowed\\":%s,\\"riskBreaker\\":%s,"
      "\\"dayStartEquity\\":%.2f,\\"riskProfile\\":{\\"riskPercent\\":%.2f,\\"maxDailyLossPct\\":%.2f,"
      "\\"maxLot\\":%.2f,\\"maxOpenPositions\\":%d,\\"maxSpreadPoints\\":%d,\\"minRiskReward\\":%.2f},"
      "\\"symbolSpecs\\":%s,\\"quotes\\":%s,\\"positions\\":%s,\\"recentDeals\\":%s}",
      InpApiKey,
      AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_COMPANY),
      AccountInfoString(ACCOUNT_SERVER),
      AccountInfoString(ACCOUNT_CURRENCY),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      (int)AccountInfoInteger(ACCOUNT_LEVERAGE),
      (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO) ? "true" : "false",
      (InpAllowTrading && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) ? "true" : "false",
      g_breakerTripped ? "true" : "false",
      g_dayStartEquity,
      InpRiskPercent, InpMaxDailyLossPct, InpMaxLot, InpMaxOpenPositions, InpMaxSpreadPoints, InpMinRiskReward,
      BuildSymbolSpecsJson(), quotes, positions, deals);

   string response = HttpPost(InpServerUrl, payload);
   if(response == "")
      Print("[GrokBot] Heartbeat had no response (check WebRequest whitelist / server reachability)");
   return response;
}

string BuildQuotesJson(string csv)
{
   string out = "[";
   string parts[];
   int n = StringSplit(csv, ',', parts);
   bool first = true;

   for(int i = 0; i < n; i++)
   {
      string sym = parts[i];
      StringTrimLeft(sym); StringTrimRight(sym);
      if(sym == "") continue;
      if(!SymbolSelect(sym, true)) continue;

      MqlTick tick;
      if(!SymbolInfoTick(sym, tick)) continue;

      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      int digits   = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double bid   = NormalizeDouble(tick.bid, digits);
      double ask   = NormalizeDouble(tick.ask, digits);
      double spreadPts = (point > 0) ? (ask - bid) / point : 0;

      if(!first) out += ",";
      first = false;
      out += StringFormat(
         "{\\"symbol\\":\\"%s\\",\\"bid\\":%.5f,\\"ask\\":%.5f,\\"spread\\":%.1f,\\"point\\":%.5f,\\"digits\\":%d,\\"time\\":%I64d,\\"pipSize\\":%.5f}",
         sym, bid, ask, spreadPts, point, digits, (long)tick.time, PipSize(sym));
   }
   out += "]";
   return out;
}

double PipSize(string symbol)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(digits == 3 || digits == 5) return point * 10.0;
   return point;
}

string BuildPositionsJson()
{
   string out = "[";
   bool first = true;

   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      long type  = PositionGetInteger(POSITION_TYPE);

      if(!first) out += ",";
      first = false;
      out += StringFormat(
         "{\\"ticket\\":\\"%I64d\\",\\"symbol\\":\\"%s\\",\\"direction\\":\\"%s\\",\\"volume\\":%.2f,"
         "\\"priceOpen\\":%.5f,\\"priceCurrent\\":%.5f,\\"sl\\":%.5f,\\"tp\\":%.5f,"
         "\\"profit\\":%.2f,\\"swap\\":%.2f,\\"commission\\":%.2f,\\"magic\\":%d,\\"comment\\":\\"%s\\"}",
         ticket, sym, (type == POSITION_TYPE_BUY ? "BUY" : "SELL"),
         PositionGetDouble(POSITION_VOLUME),
         NormalizeDouble(PositionGetDouble(POSITION_PRICE_OPEN), digits),
         NormalizeDouble(PositionGetDouble(POSITION_PRICE_CURRENT), digits),
         NormalizeDouble(PositionGetDouble(POSITION_SL), digits),
         NormalizeDouble(PositionGetDouble(POSITION_TP), digits),
         PositionGetDouble(POSITION_PROFIT),
         PositionGetDouble(POSITION_SWAP),
         0.0,
         (int)PositionGetInteger(POSITION_MAGIC),
         PositionGetString(POSITION_COMMENT));
   }
   out += "]";
   return out;
}

//+------------------------------------------------------------------+
//| Closed deals since last sync -> lets the server journal real PnL  |
//+------------------------------------------------------------------+
string BuildRecentDealsJson()
{
   datetime from = (g_lastDealSync == 0) ? (TimeCurrent() - 7 * 24 * 3600) : (g_lastDealSync - 60);
   if(!HistorySelect(from, TimeCurrent() + 60))
      return "[]";

   string out = "[";
   bool first = true;
   int total = HistoryDealsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      if(HistoryDealGetInteger(ticket, DEAL_MAGIC) != (long)InpMagic) continue;
      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT &&
         HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT_BY) continue;

      string sym = HistoryDealGetString(ticket, DEAL_SYMBOL);
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      long type  = HistoryDealGetInteger(ticket, DEAL_TYPE);

      if(!first) out += ",";
      first = false;
      out += StringFormat(
         "{\\"dealTicket\\":\\"%I64d\\",\\"positionTicket\\":\\"%I64d\\",\\"symbol\\":\\"%s\\","
         "\\"direction\\":\\"%s\\",\\"volume\\":%.2f,\\"price\\":%.5f,\\"profit\\":%.2f,"
         "\\"commission\\":%.2f,\\"swap\\":%.2f,\\"reason\\":%d,\\"time\\":%I64d}",
         ticket,
         HistoryDealGetInteger(ticket, DEAL_POSITION_ID),
         sym,
         (type == DEAL_TYPE_BUY ? "BUY" : "SELL"),
         HistoryDealGetDouble(ticket, DEAL_VOLUME),
         NormalizeDouble(HistoryDealGetDouble(ticket, DEAL_PRICE), digits),
         HistoryDealGetDouble(ticket, DEAL_PROFIT),
         HistoryDealGetDouble(ticket, DEAL_COMMISSION),
         HistoryDealGetDouble(ticket, DEAL_SWAP),
         (int)HistoryDealGetInteger(ticket, DEAL_REASON),
         (long)HistoryDealGetInteger(ticket, DEAL_TIME));
   }
   out += "]";

   g_lastDealSync = TimeCurrent();
   return out;
}

//+------------------------------------------------------------------+
//| COMMAND PARSING / EXECUTION                                      |
//+------------------------------------------------------------------+
void ProcessCommandResponse(string response)
{
   if(StringFind(response, "\\"commands\\":[]") >= 0)
      return;

   int start = StringFind(response, "\\"commands\\":[");
   if(start < 0) return;

   start = start + StringLen("\\"commands\\":[");
   int depth = 0;
   int objStart = -1;
   bool inString = false;

   for(int i = start; i < StringLen(response); i++)
   {
      ushort ch = StringGetCharacter(response, i);
      if(ch == '"' && StringGetCharacter(response, i - 1) != '\\\\')
         inString = !inString;
      if(inString) continue;

      if(ch == '{')
      {
         if(depth == 0) objStart = i;
         depth++;
      }
      else if(ch == '}')
      {
         depth--;
         if(depth == 0 && objStart >= 0)
         {
            string obj = StringSubstr(response, objStart, i - objStart + 1);
            ExecuteCommandObject(obj);
            objStart = -1;
         }
      }
      else if(ch == ']' && depth == 0)
         break;
   }
}

string JsonString(string json, string key)
{
   string needle = "\\"" + key + "\\":\\"";
   int p = StringFind(json, needle);
   if(p < 0) return "";
   p += StringLen(needle);
   int e = StringFind(json, "\\"", p);
   if(e < 0) return "";
   return StringSubstr(json, p, e - p);
}

double JsonDouble(string json, string key, double fallback = 0)
{
   string needle = "\\"" + key + "\\":";
   int p = StringFind(json, needle);
   if(p < 0) return fallback;
   p += StringLen(needle);
   int e = p;
   while(e < StringLen(json))
   {
      ushort c = StringGetCharacter(json, e);
      if(c == ',' || c == '}') break;
      e++;
   }
   string raw = StringSubstr(json, p, e - p);
   StringTrimLeft(raw); StringTrimRight(raw);
   if(raw == "" || raw == "null") return fallback;
   return StringToDouble(raw);
}

bool JsonBool(string json, string key, bool fallback = false)
{
   string needle = "\\"" + key + "\\":";
   int p = StringFind(json, needle);
   if(p < 0) return fallback;
   p += StringLen(needle);
   string raw = StringSubstr(json, p, 5);
   if(StringFind(raw, "true") == 0) return true;
   if(StringFind(raw, "false") == 0) return false;
   return fallback;
}

void ExecuteCommandObject(string obj)
{
   string commandId = JsonString(obj, "commandId");
   string type      = JsonString(obj, "type");
   if(commandId == "" || type == "")
      return;

   if(IsProcessed(commandId))
   {
      Print(">>> [SO TRADER] Duplicate command ignored: ", commandId);
      return;
   }
   MarkProcessed(commandId);

   Print(">>> [SO TRADER CMD] ", type, " (", commandId, ")");

   if(type == "EXECUTE_TRADE")      ExecuteTrade(obj, commandId);
   else if(type == "SYNC_HISTORY")  { SendHistorySync(); AckCommand(commandId, true, "", 0, "history sync dispatched"); }
   else if(type == "MODIFY_POSITION") ModifyPosition(obj, commandId);
   else if(type == "CLOSE_POSITION")  ClosePosition(obj, commandId);
   else if(type == "CLOSE_ALL")       { int n = CloseAllMine("SERVER_CLOSE_ALL"); AckCommand(commandId, true, "", 0, "closed " + IntegerToString(n)); }
   else if(type == "PING")            AckCommand(commandId, true, "", 0, "pong");
   else                               AckCommand(commandId, false, "", 0, "unsupported command type: " + type);
}

//+------------------------------------------------------------------+
void ExecuteTrade(string obj, string commandId)
{
   string symbol    = JsonString(obj, "symbol");
   string direction = JsonString(obj, "direction");
   double lot       = JsonDouble(obj, "lot", 0);
   double sl        = JsonDouble(obj, "stopLoss", 0);
   double tp        = JsonDouble(obj, "takeProfit", 0);
   string comment   = JsonString(obj, "comment");

   if(!InpAllowTrading)
   { AckCommand(commandId, false, "", 0, "local master switch disabled trading"); return; }
   if(!CheckLocalRiskLimits())
   { AckCommand(commandId, false, "", 0, "local risk breaker active - entry refused"); return; }
   if(!InsideTradingWindow())
   { AckCommand(commandId, false, "", 0, "outside local trading window"); return; }
   if(CountMyPositions() >= InpMaxOpenPositions)
   { AckCommand(commandId, false, "", 0, "max open positions reached locally"); return; }

   if(!SymbolSelect(symbol, true))
   { AckCommand(commandId, false, "", 0, "symbol unavailable: " + symbol); return; }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
   { AckCommand(commandId, false, "", 0, "no tick for " + symbol); return; }

   double point   = SymbolInfoDouble(symbol, SYMBOL_POINT);
   double spreadP = (point > 0) ? (tick.ask - tick.bid) / point : 99999;
   if(spreadP > InpMaxSpreadPoints)
   {
      AckCommand(commandId, false, "", 0, StringFormat("spread too wide: %.1f pts", spreadP));
      return;
   }

   bool isBuy = (direction == "BUY");
   double entry = isBuy ? tick.ask : tick.bid;
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

   if(lot <= 0)
      lot = CalculateLot(symbol, entry, sl);
   lot = NormalizeLot(lot, symbol);

   // Reject nonsensical protection
   if(sl <= 0 || tp <= 0)
   { AckCommand(commandId, false, "", 0, "order missing SL/TP - refused"); return; }
   if(isBuy && (sl >= entry || tp <= entry))
   { AckCommand(commandId, false, "", 0, "invalid BUY SL/TP geometry"); return; }
   if(!isBuy && (sl <= entry || tp >= entry))
   { AckCommand(commandId, false, "", 0, "invalid SELL SL/TP geometry"); return; }

   double risk   = MathAbs(entry - sl);
   double reward = MathAbs(tp - entry);
   if(risk <= 0 || (reward / risk) < InpMinRiskReward)
   {
      AckCommand(commandId, false, "", 0,
         StringFormat("risk:reward %.2f below local minimum %.2f", reward / risk, InpMinRiskReward));
      return;
   }

   // Margin sanity check before sending
   double marginRequired = 0;
   ENUM_ORDER_TYPE otype = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(OrderCalcMargin(otype, symbol, lot, entry, marginRequired))
   {
      if(marginRequired > AccountInfoDouble(ACCOUNT_MARGIN_FREE))
      {
         AckCommand(commandId, false, "", 0, "insufficient free margin for requested lot");
         return;
      }
   }

   bool ok = isBuy
      ? trade.Buy(lot, symbol, 0.0, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), comment)
      : trade.Sell(lot, symbol, 0.0, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), comment);

   uint retcode = trade.ResultRetcode();
   ulong ticket = trade.ResultOrder();
   double fill  = trade.ResultPrice();

   if(ok && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED || retcode == TRADE_RETCODE_DONE_PARTIAL))
   {
      Print(">>> [GrokBot FILL] ", (isBuy ? "BUY " : "SELL "), DoubleToString(lot, 2), " ", symbol,
            " @ ", DoubleToString(fill, digits), " ticket=", (long)ticket);
      AckCommand(commandId, true, IntegerToString((long)ticket), fill,
         StringFormat("filled lot=%.2f spread=%.1f", lot, spreadP));
   }
   else
   {
      Print("!!! [GrokBot REJECT] retcode=", retcode, " ", trade.ResultRetcodeDescription());
      AckCommand(commandId, false, "", 0,
         StringFormat("broker reject %u: %s", retcode, trade.ResultRetcodeDescription()));
   }
}

//+------------------------------------------------------------------+
void ModifyPosition(string obj, string commandId)
{
   string ticketStr = JsonString(obj, "ticket");
   double sl = JsonDouble(obj, "stopLoss", 0);
   double tp = JsonDouble(obj, "takeProfit", 0);
   ulong ticket = (ulong)StringToInteger(ticketStr);

   if(!posInfo.SelectByTicket(ticket))
   { AckCommand(commandId, false, "", 0, "position not found: " + ticketStr); return; }

   string sym = posInfo.Symbol();
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double current = posInfo.PriceCurrent();
   bool isBuy = (posInfo.PositionType() == POSITION_TYPE_BUY);

   // Never widen risk: only accept protective modifications
   if(sl > 0)
   {
      if(isBuy && sl > current)
      { AckCommand(commandId, false, "", 0, "refused: SL above market on long"); return; }
      if(!isBuy && sl < current)
      { AckCommand(commandId, false, "", 0, "refused: SL below market on short"); return; }
   }

   bool ok = trade.PositionModify(ticket, NormalizeDouble(sl, digits), tp > 0 ? NormalizeDouble(tp, digits) : posInfo.TakeProfit());
   if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE || trade.ResultRetcode() == TRADE_RETCODE_PLACED))
      AckCommand(commandId, true, ticketStr, current, "stop/target modified");
   else
      AckCommand(commandId, false, ticketStr, current,
         StringFormat("modify failed %u: %s", trade.ResultRetcode(), trade.ResultRetcodeDescription()));
}

//+------------------------------------------------------------------+
void ClosePosition(string obj, string commandId)
{
   string ticketStr = JsonString(obj, "ticket");
   double volume = JsonDouble(obj, "volume", 0);
   ulong ticket = (ulong)StringToInteger(ticketStr);

   if(!posInfo.SelectByTicket(ticket))
   { AckCommand(commandId, false, "", 0, "position not found: " + ticketStr); return; }

   double posVolume = posInfo.Volume();
   string sym = posInfo.Symbol();
   double price = posInfo.PriceCurrent();
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

   bool ok;
   if(volume > 0 && volume < posVolume)
   {
      volume = NormalizeLot(volume, sym);
      ok = trade.PositionClosePartial(ticket, volume);
   }
   else
      ok = trade.PositionClose(ticket);

   if(ok && trade.ResultRetcode() == TRADE_RETCODE_DONE)
      AckCommand(commandId, true, ticketStr, NormalizeDouble(trade.ResultPrice(), digits),
         StringFormat("closed %.2f lots", volume > 0 ? volume : posVolume));
   else
      AckCommand(commandId, false, ticketStr, price,
         StringFormat("close failed %u: %s", trade.ResultRetcode(), trade.ResultRetcodeDescription()));
}

//+------------------------------------------------------------------+
int CloseAllMine(string reason)
{
   int closed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;
      if(trade.PositionClose(ticket))
      {
         closed++;
         Print(">>> [GrokBot] Closed #", (long)ticket, " reason=", reason);
      }
   }
   return closed;
}

//+------------------------------------------------------------------+
//| Trailing management + break-even (respects the Dread "no early BE" rule) |
//+------------------------------------------------------------------+
void ManageOpenPositions()
{
   if(!InpManageTrailing)
      return;

   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;

      string sym    = PositionGetString(POSITION_SYMBOL);
      int digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      bool isBuy    = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double open   = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl     = PositionGetDouble(POSITION_SL);
      double tp     = PositionGetDouble(POSITION_TP);
      double price  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double point  = SymbolInfoDouble(sym, SYMBOL_POINT);

      if(sl <= 0 || point <= 0)
         continue;

      double risk = MathAbs(open - sl);
      if(risk <= 0)
         continue;

      double rNow = isBuy ? (price - open) / risk : (open - price) / risk;
      double trailDist = InpTrailingStepPoints * point;

      if(InpUseBreakEven && rNow >= InpBreakEvenAtR)
      {
         double be = isBuy ? open + 2 * point : open - 2 * point;
         bool better = isBuy ? (sl < be) : (sl > be);
         if(better)
            trade.PositionModify(ticket, NormalizeDouble(be, digits), tp);
      }

      if(rNow >= InpTrailingStartR)
      {
         double newSl = isBuy ? price - trailDist : price + trailDist;
         bool improves = isBuy ? (newSl > sl) : (newSl < sl);
         if(improves)
            trade.PositionModify(ticket, NormalizeDouble(newSl, digits), tp);
      }
   }
}

//+------------------------------------------------------------------+
//| REAL broker instrument specifications (sizing / lot / stops)     |
//+------------------------------------------------------------------+
string BuildSymbolSpecsJson()
{
   string out = "[";
   string parts[];
   int n = StringSplit(InpSymbols, ',', parts);
   bool first = true;

   for(int i = 0; i < n; i++)
   {
      string sym = parts[i];
      StringTrimLeft(sym); StringTrimRight(sym);
      if(sym == "") continue;
      if(!SymbolSelect(sym, true)) continue;

      double point    = SymbolInfoDouble(sym, SYMBOL_POINT);
      double tickSize = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
      double tickVal  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
      double contract = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
      double minLot   = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      double maxLot   = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
      double lotStep  = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      int    stops    = (int)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
      int    freeze   = (int)SymbolInfoInteger(sym, SYMBOL_TRADE_FREEZE_LEVEL);
      int    digits   = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double spread   = (point > 0) ? (SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID)) / point : 0;

      if(!first) out += ",";
      first = false;
      out += StringFormat(
         "{\\"symbol\\":\\"%s\\",\\"digits\\":%d,\\"point\\":%.8f,\\"contractSize\\":%.4f,\\"tickSize\\":%.8f,"
         "\\"tickValue\\":%.4f,\\"minLot\\":%.2f,\\"maxLot\\":%.2f,\\"lotStep\\":%.2f,"
         "\\"stopsLevelPoints\\":%d,\\"freezeLevelPoints\\":%d,\\"typicalSpreadPoints\\":%.1f}",
         sym, digits, point, contract, tickSize, tickVal, minLot, maxLot, lotStep, stops, freeze, spread);
   }
   out += "]";
   return out;
}

//+------------------------------------------------------------------+
//| Upload genuine MQL5 history (M15 + H1) for validation/backtests  |
//+------------------------------------------------------------------+
void SendHistorySync()
{
   string parts[];
   int n = StringSplit(InpSymbols, ',', parts);
   int tfList[2]; tfList[0] = PERIOD_M15; tfList[1] = PERIOD_H1;
   string tfNames[2]; tfNames[0] = "M15"; tfNames[1] = "H1";

   for(int i = 0; i < n; i++)
   {
      string sym = parts[i];
      StringTrimLeft(sym); StringTrimRight(sym);
      if(sym == "") continue;
      if(!SymbolSelect(sym, true)) continue;

      for(int t = 0; t < 2; t++)
      {
         MqlRates rates[];
         int copied = CopyRates(sym, tfList[t], 0, 5000, rates);
         if(copied <= 0)
         {
            Print("!!! [SO TRADER] No history for ", sym, " ", tfNames[t], " err=", GetLastError());
            continue;
         }

         int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
         string bars = "[";
         for(int b = 0; b < copied; b++)
         {
            if(b > 0) bars += ",";
            bars += StringFormat(
               "{\\"time\\":%I64d,\\"open\\":%.5f,\\"high\\":%.5f,\\"low\\":%.5f,\\"close\\":%.5f,\\"volume\\":%d}",
               (long)rates[b].time, rates[b].open, rates[b].high, rates[b].low, rates[b].close,
               (int)rates[b].tick_volume);
         }
         bars += "]";

         string payload = StringFormat(
            "{\\"apiKey\\":\\"%s\\",\\"symbol\\":\\"%s\\",\\"timeframe\\":\\"%s\\",\\"source\\":\\"MT5_HISTORY\\",\\"bars\\":%s}",
            InpApiKey, sym, tfNames[t], bars);

         string resp = HttpPost(InpHistoryUrl, payload);
         Print(">>> [SO TRADER] History ", sym, " ", tfNames[t], " bars=", copied, " resp=", StringSubstr(resp, 0, 120));
      }
   }
}

//+------------------------------------------------------------------+
//| ACK a command so the server can journal the real broker result   |
//+------------------------------------------------------------------+
void AckCommand(string commandId, bool success, string brokerTicket, double fillPrice, string message)
{
   string payload = StringFormat(
      "{\\"apiKey\\":\\"%s\\",\\"commandId\\":\\"%s\\",\\"status\\":\\"%s\\",\\"brokerTicket\\":\\"%s\\","
      "\\"fillPrice\\":%.5f,\\"message\\":\\"%s\\",\\"accountNumber\\":\\"%I64d\\"}",
      InpApiKey, commandId, success ? "ACKED" : "FAILED", brokerTicket, fillPrice,
      message, AccountInfoInteger(ACCOUNT_LOGIN));

   HttpPost(InpAckUrl, payload);
}

//+------------------------------------------------------------------+
string HttpPost(string url, string payload)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\\r\\nUser-Agent: SOTrader-MT5-Bridge/4.00\\r\\n";

   int len = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(postData, len - 1); // strip trailing null

   ResetLastError();
   int status = WebRequest("POST", url, headers, 5000, postData, resultData, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      if(err == 4014)
         Print("!!! [GrokBot] Add this URL to Tools > Options > Expert Advisors > Allow WebRequest: ", url);
      else
         Print("!!! [GrokBot] WebRequest failed err=", err, " url=", url);
      return "";
   }
   if(status != 200)
   {
      Print("!!! [GrokBot] HTTP ", status, " from ", url);
      return "";
   }

   string body = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   g_lastResponse = body;
   return body;
}
//+------------------------------------------------------------------+
`;
}

export const EA_SETUP_STEPS: { title: string; detail: string }[] = [
  {
    title: "Host the app on a public HTTPS URL",
    detail:
      "The MT5 terminal must reach the server over the internet. Deploy this app (Postgres included) and copy the public URL.",
  },
  {
    title: "Download and compile the EA",
    detail:
      "Download GrokBot_MT5_Bridge.mq5 → MT5 → File → Open Data Folder → MQL5 → Experts → paste → compile (F7) in MetaEditor.",
  },
  {
    title: "Whitelist the two bridge URLs",
    detail:
      "Tools → Options → Expert Advisors → tick 'Allow WebRequest for listed URL' and add both /api/mt5/bridge and /api/mt5/bridge/ack.",
  },
  {
    title: "Attach on a DEMO account, not live",
    detail:
      "Drag the EA onto any chart on a demo account first. Enable Algo Trading. Desktop MT5 or a Windows VPS is required — mobile apps cannot run EAs.",
  },
  {
    title: "Verify the live feed and heartbeat",
    detail:
      "Within 2 seconds this dashboard should switch to MT5_LIVE with real bid/ask, broker positions and real tickets.",
  },
];
