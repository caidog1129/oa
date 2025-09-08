import { useEffect, useState } from 'react';

interface PriceMap {
  [ticker: string]: string;
}

export default function Home() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [input, setInput] = useState('');
  const [prices, setPrices] = useState<PriceMap>({});

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString());
      setPrices((p) => ({ ...p, [data.ticker]: data.price }));
    };
    setSocket(ws);
    return () => ws.close();
  }, []);

  const addTicker = () => {
    const t = input.toUpperCase();
    if (socket && t) {
      socket.send(JSON.stringify({ type: 'subscribe', ticker: t }));
    }
    setInput('');
  };

  const removeTicker = (t: string) => {
    if (socket) socket.send(JSON.stringify({ type: 'unsubscribe', ticker: t }));
    setPrices((p) => {
      const n = { ...p };
      delete n[t];
      return n;
    });
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
      <ul>
        {sorted.map((t) => (
          <li key={t}>
            {t}: {prices[t]} <button onClick={() => removeTicker(t)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
