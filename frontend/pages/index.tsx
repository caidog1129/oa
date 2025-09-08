import { useEffect, useState } from 'react';

interface PriceMap {
  [ticker: string]: string;
}

export default function Home() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [input, setInput] = useState('');
  const [prices, setPrices] = useState<PriceMap>({});
  const [tickers, setTickers] = useState<string[]>([]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => console.log('connected to backend');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString());
      console.log('price update', data);
      setPrices((p) => ({ ...p, [data.ticker]: data.price }));
    };
    setSocket(ws);
    return () => ws.close();
  }, []);

  // Load saved tickers on first render.
  useEffect(() => {
    const stored = localStorage.getItem('tickers');
    if (stored) setTickers(JSON.parse(stored));
  }, []);

  // Persist tickers whenever they change.
  useEffect(() => {
    localStorage.setItem('tickers', JSON.stringify(tickers));
  }, [tickers]);

  // Subscribe to all tickers when the socket connects or tickers list updates.
  useEffect(() => {
    if (!socket) return;

    const subscribeAll = () => {
      for (const t of tickers) {
        socket.send(JSON.stringify({ type: 'subscribe', ticker: t }));
      }
    };

    if (socket.readyState === WebSocket.OPEN) {
      subscribeAll();
    } else {
      socket.addEventListener('open', subscribeAll, { once: true });
      return () => socket.removeEventListener('open', subscribeAll);
    }
  }, [socket, tickers]);

  const addTicker = () => {
    const t = input.toUpperCase();
    if (t && !tickers.includes(t)) {
      if (socket?.readyState === WebSocket.OPEN) {
        console.log('subscribing to', t);
        socket.send(JSON.stringify({ type: 'subscribe', ticker: t }));
      }
      setTickers((prev) => [...prev, t]);
    }
    setInput('');
  };

  const removeTicker = (t: string) => {
    console.log('unsubscribing from', t);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'unsubscribe', ticker: t }));
    }
    setPrices((p) => {
      const n = { ...p };
      delete n[t];
      return n;
    });
    setTickers((prev) => prev.filter((x) => x !== t));
  };
  const sorted = Object.keys(prices).sort();

  return (
    <div>
      <h1>Crypto Prices</h1>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ticker e.g. BTCUSD"
      />
      <button onClick={addTicker}>Add</button>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '1rem' }}>
        {sorted.map((t) => (
          <div
            key={t}
            style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
          >
            {t}: {prices[t]}
            <button style={{ marginLeft: 4 }} onClick={() => removeTicker(t)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
