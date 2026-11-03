
import numpy as np
import pandas as pd
import feedparser

def build_features(data):
    df = data.copy()

    df["ema20"] = df["Close"].ewm(span=20, adjust=False).mean()
    df["ema50"] = df["Close"].ewm(span=50, adjust=False).mean()

    delta = df["Close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = -delta.clip(upper=0).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    previous_close = df["Close"].shift(1)
    tr = pd.concat([
        df["High"] - df["Low"],
        (df["High"] - previous_close).abs(),
        (df["Low"] - previous_close).abs()
    ], axis=1).max(axis=1)

    df["atr"] = tr.rolling(14).mean()
    df["atr_pct"] = df["atr"] / df["Close"]

    df["return_1"] = df["Close"].pct_change()
    df["return_5"] = df["Close"].pct_change(5)
    df["volume_change"] = df["Volume"].pct_change()

    df = df.replace([np.inf, -np.inf], np.nan)

    columns = [
        "ema20", "ema50", "rsi", "atr_pct",
        "return_1", "return_5", "volume_change"
    ]

    return df, columns


def fetch_news(asset):
    try:
        url = (
            "https://news.google.com/rss/search?q="
            + asset.replace(" ", "%20")
            + "&hl=en-US&gl=US&ceid=US:en"
        )

        feed = feedparser.parse(url)

        articles = []
        for entry in feed.entries[:8]:
            articles.append({
                "title": entry.get("title", "Untitled"),
                "source": entry.get("source", {}).get("title", "News"),
                "published": entry.get("published", "Unknown date"),
                "link": entry.get("link", "")
            })

        return articles

    except Exception:
        return []


def run_agent_council(asset, df, news, rr=2.0, risk_pct=0.25):
    latest = df.iloc[-1]
    price = float(latest["Close"])
    atr = float(latest["atr"])
    rsi = float(latest["rsi"])

    agents = []

    # Agent 1: Market scanner
    market_ok = (
        np.isfinite(atr)
        and atr > 0
        and np.isfinite(rsi)
    )

    agents.append({
        "agent": "1. Market Scanner",
        "status": "PASS" if market_ok else "VETO",
        "reason": "Market data and volatility checked."
    })

    # Agent 2: News analyst
    news_ok = len(news) > 0

    agents.append({
        "agent": "2. News Analyst",
        "status": "PASS" if news_ok else "VETO",
        "reason": (
            f"Found {len(news)} news articles."
            if news_ok else "News unavailable; trading blocked."
        )
    })

    # Agent 3: Strategy analyst
    bullish = (
        latest["ema20"] > latest["ema50"]
        and rsi > 50
        and rsi < 70
    )

    bearish = (
        latest["ema20"] < latest["ema50"]
        and rsi < 50
        and rsi > 30
    )

    direction = "BUY" if bullish else "SELL" if bearish else "WAIT"

    strategy_ok = direction != "WAIT"

    agents.append({
        "agent": "3. Strategy Analyst",
        "status": "PASS" if strategy_ok else "VETO",
        "reason": f"EMA and RSI direction: {direction}."
    })

    # Agent 4: Timing analyst
    timing_ok = (
        market_ok
        and atr / price < 0.03
        and 30 < rsi < 70
    )

    agents.append({
        "agent": "4. Timing Analyst",
        "status": "PASS" if timing_ok else "VETO",
        "reason": "Volatility and RSI timing filter checked."
    })

    # Agent 5: Risk manager
    risk_ok = (
        0 < risk_pct <= 0.5
        and rr >= 1.5
        and market_ok
    )

    agents.append({
        "agent": "5. Risk Manager",
        "status": "PASS" if risk_ok else "VETO",
        "reason": f"Risk set to {risk_pct:.2f}% per trade."
    })

    # Agent 6: Performance analyst
    performance_ok = False

    agents.append({
        "agent": "6. Performance Analyst",
        "status": "VETO",
        "reason": "Automation locked until a broker-specific demo record is reviewed."
    })

    # Agent 7: Execution manager
    execution_ok = False

    agents.append({
        "agent": "7. Execution Manager",
        "status": "VETO",
        "reason": "Live execution is disabled. No orders will be sent."
    })

    all_ok = all([
        market_ok,
        news_ok,
        strategy_ok,
        timing_ok,
        risk_ok,
        performance_ok,
        execution_ok
    ])

    plan = None

    if all_ok:
        stop_distance = atr * 1.5
        reward_distance = stop_distance * rr

        if direction == "BUY":
            stop = price - stop_distance
            target = price + reward_distance
        else:
            stop = price + stop_distance
            target = price - reward_distance

        plan = {
            "entry": price,
            "stop_loss": stop,
            "take_profit": target
        }

    decision = direction if all_ok else "WAIT"

    return {
        "decision": decision,
        "agents": agents,
        "plan": plan
    }


def make_backtest(df):
    data = df.copy()

    data["fast"] = data["Close"].ewm(span=20).mean()
    data["slow"] = data["Close"].ewm(span=50).mean()

    data["signal"] = np.where(
        data["fast"] > data["slow"], 1, -1
    )

    data["position"] = data["signal"].shift(1)
    data["market_return"] = data["Close"].pct_change()

    data["strategy_return"] = (
        data["position"] * data["market_return"]
    )

    data = data.dropna()

    if len(data) < 30:
        return None

    equity = (1 + data["strategy_return"]).cumprod()
    drawdown = equity / equity.cummax() - 1

    total_return = (equity.iloc[-1] - 1) * 100
    max_drawdown = abs(drawdown.min()) * 100
    trades = int(data["position"].diff().abs().fillna(0).sum() / 2)

    return {
        "return_pct": float(total_return),
        "max_drawdown_pct": float(max_drawdown),
        "trades": trades,
        "equity": equity
    }
