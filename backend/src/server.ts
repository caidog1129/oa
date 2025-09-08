import { WebSocketServer, WebSocket } from 'ws';
import { chromium, Browser, Page } from 'playwright';

interface Watcher {
  ticker: string;
  page: Page;
  connections: Set<WebSocket>;
}

const watchers = new Map<string, Watcher>();
let browser: Browser | undefined;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: false });
  }
  return browser;
}

async function startWatcher(ticker: string): Promise<Watcher> {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.goto(`https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="price-container"], .tv-symbol-price-quote__value');


  const watcher: Watcher = { ticker, page, connections: new Set() };

  async function loop() {
    while (watchers.get(ticker) === watcher) {
      try {
        const price = await page.evaluate(() => {
          const el =
            document.querySelector('[data-testid="price-container"]') ||
            document.querySelector('.tv-symbol-price-quote__value');
          return el ? (el.textContent || '').trim() : null;
        });
        if (price) {
          for (const ws of watcher.connections) {
            ws.send(JSON.stringify({ ticker, price }));
          }
        } else {
          console.error('price fetch error: price element not found');
        }
      } catch (e) {
        console.error('price fetch error', e);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  loop();
  watchers.set(ticker, watcher);
  return watcher;
}

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', async (msg) => {
    let data: any;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }
    const ticker = (data.ticker || '').toUpperCase();
    if (data.type === 'subscribe') {
      const watcher = watchers.get(ticker) ?? (await startWatcher(ticker));
      watcher.connections.add(ws);
    } else if (data.type === 'unsubscribe') {
      const watcher = watchers.get(ticker);
      if (watcher) {
        watcher.connections.delete(ws);
        if (watcher.connections.size === 0) {
          await watcher.page.close();
          watchers.delete(ticker);
        }
      }
    }
  });

  ws.on('close', async () => {
    for (const [ticker, watcher] of watchers) {
      if (watcher.connections.delete(ws) && watcher.connections.size === 0) {
        await watcher.page.close();
        watchers.delete(ticker);
      }
    }
  });
});

process.on('SIGINT', async () => {
  for (const watcher of watchers.values()) {
    await watcher.page.close();
  }
  if (browser) await browser.close();
  process.exit(0);
});

console.log('Backend server running on ws://localhost:8080');
