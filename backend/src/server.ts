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
    // Launch the browser in headed mode so price scraping is visible
    browser = await chromium.launch({ headless: false });
  }
  return browser;
}

async function startWatcher(ticker: string): Promise<Watcher | null> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    const resp = await page.goto(
      `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`,
      { waitUntil: 'domcontentloaded' }
    );
    if (!resp || !resp.ok()) {
      throw new Error(`failed to load page: status ${resp ? resp.status() : 'unknown'}`);
    }
    // Ensure the price element is present before streaming
    await page.waitForSelector(
      '[data-testid="price-container"], .tv-symbol-price-quote__value',
      { timeout: 15000 }
    );
  } catch (e) {
    console.error(`failed to initialize watcher for ${ticker}`, e);
    await page.close();
    return null;
  }

  const watcher: Watcher = { ticker, page, connections: new Set() };

  // Forward price updates from the page to all subscribed clients
  await page.exposeFunction('notifyPrice', (price: string) => {
    for (const ws of watcher.connections) {
      ws.send(JSON.stringify({ ticker, price }));
    }
  });

  await page.evaluate(() => {
    const el =
      document.querySelector('[data-testid="price-container"]') ||
      document.querySelector('.tv-symbol-price-quote__value');
    if (!el) return;
    const send = (p: string) => (window as any).notifyPrice(p);
    send((el.textContent || '').trim());
    new MutationObserver(() => send((el.textContent || '').trim())).observe(el, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });

  page.on('close', () => {
    watchers.delete(ticker);
  });

  watchers.set(ticker, watcher);
  console.log(`watcher started for ${ticker}`);
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
      if (watcher) {
        watcher.connections.add(ws);
        console.log(`client subscribed to ${ticker} (${watcher.connections.size} listeners)`);
      }
    } else if (data.type === 'unsubscribe') {
      const watcher = watchers.get(ticker);
      if (watcher) {
        watcher.connections.delete(ws);
        console.log(`client unsubscribed from ${ticker} (${watcher.connections.size} remaining)`);
        if (watcher.connections.size === 0) {
          await watcher.page.close();
          watchers.delete(ticker);
          console.log(`watcher closed for ${ticker}`);
        }
      }
    }
  });

  ws.on('close', async () => {
    for (const [ticker, watcher] of watchers) {
      if (watcher.connections.delete(ws) && watcher.connections.size === 0) {
        await watcher.page.close();
        watchers.delete(ticker);
        console.log(`watcher closed for ${ticker}`);
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
