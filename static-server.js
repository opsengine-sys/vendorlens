const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';
const ROOT = process.cwd();

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

const SCRAPE_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SCRAPE_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB cap

function fetchUrl(rawUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch (e) { return reject(new Error('invalid_url')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return reject(new Error('invalid_protocol'));

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': SCRAPE_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      timeout: SCRAPE_TIMEOUT_MS,
    };

    const req = lib.request(options, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        try {
          const next = new URL(res.headers.location, rawUrl).href;
          return resolve(fetchUrl(next, redirectsLeft - 1));
        } catch (e) { return reject(new Error('bad_redirect')); }
      }
      if (res.statusCode >= 400) return reject(new Error('http_' + res.statusCode));

      const chunks = [];
      let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) { req.destroy(); return reject(new Error('body_too_large')); }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), status: res.statusCode, contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // ── /api/scrape?url=… ──────────────────────────────────────────────────────
  if (reqUrl.pathname === '/api/scrape') {
    const target = reqUrl.searchParams.get('url') || '';
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'missing url param' }));
    }
    try {
      const { body, contentType: ct } = await fetchUrl(target);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Scraper': 'vendorlens-local' });
      return res.end(body);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message || 'fetch_failed' }));
    }
  }

  // ── /api/health ────────────────────────────────────────────────────────────
  if (reqUrl.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', scraper: 'vendorlens-local', version: '1.0' }));
  }

  // ── static files ───────────────────────────────────────────────────────────
  let urlPath = decodeURIComponent(reqUrl.pathname);
  if (urlPath === '/') urlPath = '/vendor-intel.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': contentType(file) });
    res.end(body);
  });
}).listen(PORT, HOST, () => {
  console.log(`VendorLens server on http://${HOST}:${PORT}  |  scraper: /api/scrape?url=…`);
});
