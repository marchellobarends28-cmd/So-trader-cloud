# SO TRADER AI V4.0 — source audit and repair notes

This package is a source-code repair of the uploaded project. It is **not** a claim that the system is profitable or ready for live funds.

## Repairs applied

- Private dashboard/API data is no longer returned to anonymous visitors. Dashboard data bootstrap now returns only sign-in state until a session is established; private read endpoints require authentication.
- The dashboard no longer has a public hard-coded fallback password. `DASHBOARD_PASSWORD` must be configured in the hosting environment.
- The MT5 EA download endpoint requires an authenticated dashboard session and no longer falls back to a hard-coded bridge key. EA download responses are marked `no-store`.
- Newly seeded bridge keys are cryptographically random. Known placeholder keys are rotated on the next authenticated bootstrap.
- A newly seeded account is visibly disconnected with zero balance/equity, rather than appearing to be a real funded broker account.
- Bridge status now requires a recent heartbeat from a connected MT5 EA; the EA heartbeat version was aligned to 4.00.
- The bridge status panel now interprets `LIVE` / `SIMULATION` correctly instead of expecting an `ONLINE` response that the API never returned.
- Trading input validation no longer silently converts an invalid direction or missing/zero lot size into a BUY/minimum-lot order.
- Entry risk checks use ask for BUY and bid for SELL, and reject non-finite SL/TP values.
- Risk checks reject broker volume sizes that would be rounded differently at execution, include pending orders in aggregate risk/position limits, and enforce a hard 0.5% maximum configured risk per trade.
- Real orders now require a fresh MT5 quote for the specific symbol and broker-reported instrument specifications; fallback specifications cannot authorize a real order.
- Seeded paper trades are excluded from broker risk calculations once an MT5 EA is connected.
- A 30-day demo run cannot be started unless an actually connected MT5 demo account is present. Validation only counts broker-ticket fills opened during the matching demo run.
- A per-symbol backtest now uses the same 300-trade minimum as the overall validation gate.

## Verification performed

- ZIP extracted successfully and all 56 TypeScript/TSX source files were syntax-transpiled with zero syntax diagnostics.
- Full dependency installation timed out in this environment. Therefore the complete TypeScript typecheck, Next.js production build, and ESLint run could not be completed.
- MetaEditor/MQL5 compilation was not available here.
- No MT5 terminal or broker demo account was connected, so live bridge heartbeat, history import, order execution, broker acknowledgements, and stop/close controls remain untested.
- No genuine historical data was supplied with the project, so no profitability claim or backtest result is established.

## Required before deployment

1. Configure a unique strong `DASHBOARD_PASSWORD` environment variable.
2. Configure a PostgreSQL `DATABASE_URL` and apply the Drizzle schema (`npx drizzle-kit push`) before first login.
3. Deploy to HTTPS hosting.
4. Sign in, then download a fresh generated EA. The generated EA contains the private bridge key; do not share it.
5. Compile the EA in MetaEditor and attach it only to an MT5 demo account.
6. Confirm live heartbeat and broker symbol specifications, import genuine history, and run demo validation.

**Live trading remains disabled/not approved.** The project still uses deterministic rule-based agents and statistical parameter search, not a trained neural network. The 30-day run currently measures elapsed time and matching account identity; it does not yet prove uninterrupted connectivity for every second of the period. A future change should add heartbeat-gap telemetry before treating the demo period as continuous.
