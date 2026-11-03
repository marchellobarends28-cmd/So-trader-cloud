
import streamlit as st
import yfinance as yf
import pandas as pd

st.set_page_config(
    page_title="SO Trader AI",
    page_icon="📈",
    layout="wide"
)

st.title("🚀 SO TRADER AI")
st.caption("Your personal AI-style trading intelligence platform")

st.sidebar.header("Trading Settings")

symbol = st.sidebar.selectbox(
    "Trading pair",
    ["EURUSD=X", "GBPUSD=X", "USDJPY=X",
     "BTC-USD", "ETH-USD", "GC=F", "XAUUSD=X"]
)

period = st.sidebar.selectbox(
    "Market history",
    ["1mo", "3mo", "6mo", "1y"]
)

st.sidebar.info("Analysis mode: Demo / Paper Trading")

@st.cache_data(ttl=60)
def get_market_data(ticker, history):
    return yf.download(
        ticker,
        period=history,
        interval="1d",
        progress=False
    )

if st.button("🔄 Scan Market"):
    st.cache_data.clear()

try:
    data = get_market_data(symbol, period)

    if data.empty:
        st.error("No market data available. Try again later.")
        st.stop()

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    data = data.dropna().copy()

    data["EMA20"] = data["Close"].ewm(span=20).mean()
    data["EMA50"] = data["Close"].ewm(span=50).mean()

    delta = data["Close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1/14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/14, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, float("nan"))
    data["RSI"] = 100 - (100 / (1 + rs))

    latest = data.iloc[-1]

    price = float(latest["Close"])
    ema20 = float(latest["EMA20"])
    ema50 = float(latest["EMA50"])
    rsi = float(latest["RSI"])

    st.subheader(f"📊 {symbol} Market Analysis")

    a, b, c = st.columns(3)

    a.metric("Market Price", f"{price:.5f}")
    b.metric("RSI", f"{rsi:.2f}")
    c.metric("EMA 20", f"{ema20:.5f}")

    st.divider()

    if ema20 > ema50 and rsi < 70:
        signal = "BUY"
        explanation = "Bullish trend with RSI below 70."
    elif ema20 < ema50 and rsi > 30:
        signal = "SELL"
        explanation = "Bearish trend with RSI above 30."
    else:
        signal = "WAIT"
        explanation = "No clear trading opportunity."

    st.subheader("🤖 Trading Intelligence")

    if signal == "BUY":
        st.success("SIGNAL: BUY 🟢")
    elif signal == "SELL":
        st.error("SIGNAL: SELL 🔴")
    else:
        st.warning("SIGNAL: WAIT 🟡")

    st.write(explanation)

    st.subheader("📈 Price Chart")

    st.line_chart(data[["Close", "EMA20", "EMA50"]])

    st.subheader("Recent Market Data")

    st.dataframe(data.tail(10), use_container_width=True)

    st.caption(
        "Educational signals only. Not financial advice. "
        "No real trades are executed."
    )

except Exception as e:
    st.error(f"Market data error: {e}")
    st.info("Please try scanning again later.")
