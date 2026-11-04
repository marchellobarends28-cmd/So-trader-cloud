# SO TRADER AI V4.0

Autonomous MT5 trading system with a deterministic learning loop, a seven-agent council, hard risk limits and a mobile-first control dashboard.

> **Reality check.** This is not a neural network and it cannot guarantee profit. The trading model is deterministic. The "learning" engine is statistics plus a bounded parameter search validated out-of-sample. Live trading is locked until every validation gate passes on genuine MT5 data.

---

## 1. What is in the stack

| Layer | Technology | Cost |
|---|---|---|
| App + API | Next.js 16 (App Router), TypeScript, Tailwind | free |
| Database | PostgreSQL + Drizzle ORM | free tier (Neon / Supabase) |
| Broker bridge | MQL5 Expert Advisor (WebRequest) | free (comes with MT5) |
| Auth | HMAC-signed HttpOnly cookie + bridge API key | free |
| Hosting | Vercel free tier + Neon free tier | free |

No paid APIs, no subscriptions, no external AI services are required.

## 2. Environment variables

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `DASHBOARD_PASSWORD` | **required** | Strong dashboard password. Sign-in is disabled until this is configured. |
| `PUBLIC_APP_URL` | optional | Public HTTPS origin printed in the generated EA (defaults to the request origin) |

## 3. Deploy (free, iPhone-friendly)

1. Create a free PostgreSQL database (Neon or Supabase) and copy its connection string.
2. Push this repo to GitHub.
3. Import the repo in Vercel (free Hobby plan). Add `DATABASE_URL` and a unique, strong `DASHBOARD_PASSWORD` in *Project → Settings → Environment Variables*. Do not use a shared/default password.
4. Deploy, then open the URL with `psql "$DATABASE_URL"` once to confirm connectivity. Tables are created by `npx drizzle-kit push` (run locally against the same `DATABASE_URL`).
5. Open the deployed URL on your iPhone.

### Install on the iPhone home screen

1. Safari → open your deployment URL.
2. Share → **Add to Home Screen**.
3. Launch from the icon, tap **🔒 Sign in to trade**, and enter `DASHBOARD_PASSWORD`.
4. The bottom navigation gives you Overview / Council / Learning / Validation. The Overview tab contains equity, floating P&L, open risk, drawdown, emergency stop, close-all, live prices, AI decisions and learning/validation progress.

## 4. Connect MetaTrader 5 (demo first)

1. Open your deployment, go to the overview **MT5 Bridge** panel (`Server` icon) and copy:
   - Heartbeat URL: `https://YOUR-APP/api/mt5/bridge`
   - ACK URL: `https://YOUR-APP/api/mt5/bridge/ack`
   - History URL: `https://YOUR-APP/api/mt5/history`
   - The bridge API key.
2. Download **GrokBot_MT5_Bridge.mq5** from that panel.
3. On a desktop MT5 (Windows, or Mac via a wrapper/VPS): **File → Open Data Folder → MQL5 → Experts**, paste the file, open it in MetaEditor and press **F7** to compile.
4. MT5 → **Tools → Options → Expert Advisors** → tick *Allow WebRequest for listed URL* and add all three URLs above.
5. Open a **demo account**, drag the EA onto any chart, enable **Algo Trading**. A phone/tablet MT5 app cannot run EAs.
6. Within a couple of seconds the dashboard should switch to **LIVE MT5** and show the real account number, broker, equity and quotes.
7. In **Validation**, press **Sync history from EA** (queues `SYNC_HISTORY`; the EA uploads M15 + H1 bars for all six symbols), then **Re-audit**.

### Validation before any live capital

Press **Run all symbols** in Validation, then **Run learning cycle** in Learning, then **Start / restart 30-day run**. Live approval stays disabled until:

- ≥3 symbols pass the data-integrity audit (≥300 clean bars each, no duplicates/invalid OHLC/future bars, low deviation)
- ≥300 historical trades on genuine `MT5_HISTORY` bars
- average profit factor > 1.25
- positive out-of-sample expectancy
- max drawdown < 10%
- walk-forward majority positive
- ≥30 continuous days of demo forward testing
- ≥20 broker-confirmed fills
- zero critical risk/execution errors

Only then does **Approve live** become enabled.

## 5. Safety architecture

- **Server risk gate** (`src/lib/risk.ts`): 0.5% per trade, 2% daily, 4% weekly, 1% aggregate open risk, max 3 positions, duplicate-order prevention, SL/TP vs broker stops level, lot step/min/max validation, martingale guard, emergency stop, close-all.
- **EA-side hard limits** (generated MQL5): local daily-loss breaker with optional flatten, absolute lot cap, max positions, spread cap, R:R floor, trading window, margin check, structural SL/TP validation.
- **Execution integrity**: commands are delivered exactly once, acknowledged with the real broker ticket/fill price or rejection code, and expired if not acknowledged. The server never invents a fill.
- **Demo mandatory**: a live account is locked (`demo_lock`) until gates pass and a live override is approved.

## 6. Honest limitations

- The strategy is a conservative trend-pullback model; on most genuine data it will **fail** the 300-trade / PF 1.25 gate. That is the gate working, not a bug.
- Learning proposals require ≥300 in-sample trades, ≥40 OOS trades, positive OOS expectancy above baseline and walk-forward support. On small samples it will correctly produce nothing.
- No ML model is used. Agents are deterministic; the learning engine is statistical.
- Dashboard sign-in is disabled if `DASHBOARD_PASSWORD` is missing. The MT5 bridge key is generated randomly when the database is first seeded; re-download the EA after rotating it.
- Backtest results on any dataset are not a forecast of future returns.
