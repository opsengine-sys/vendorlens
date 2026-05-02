const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 5000);
const EXTRACT_PORT = 5001;
const HOST = '0.0.0.0';
const ROOT = process.cwd();

// ── Spawn LangExtract Python service ────────────────────────────────────────
const PYTHON = '/home/runner/workspace/.pythonlibs/bin/python3';
const pyProc = spawn(PYTHON, ['extract-service.py'], {
  env: { ...process.env, EXTRACT_PORT: String(EXTRACT_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
pyProc.stdout.on('data', d => process.stdout.write('[langextract] ' + d));
pyProc.stderr.on('data', d => process.stderr.write('[langextract] ' + d));
pyProc.on('exit', (code) => console.log(`[langextract] process exited (${code})`));

// ── Helpers ──────────────────────────────────────────────────────────────────
function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js'))   return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css'))  return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

const SCRAPE_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function fetchUrl(rawUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error('invalid_url')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return reject(new Error('invalid_protocol'));

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': SCRAPE_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      timeout: 20000,
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        try { return resolve(fetchUrl(new URL(res.headers.location, rawUrl).href, redirectsLeft - 1)); }
        catch { return reject(new Error('bad_redirect')); }
      }
      if (res.statusCode >= 400) return reject(new Error('http_' + res.statusCode));
      const chunks = []; let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) { req.destroy(); return reject(new Error('body_too_large')); }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), status: res.statusCode }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// Proxy a request body to the local Python service
function proxyToExtract(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const pyReq = http.request({
      hostname: '127.0.0.1',
      port: EXTRACT_PORT,
      path: '/extract',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (pyRes) => {
      res.writeHead(pyRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      pyRes.pipe(res);
    });
    pyReq.on('timeout', () => { pyReq.destroy(); res.writeHead(504); res.end(JSON.stringify({error:'langextract_timeout'})); });
    pyReq.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({error: e.message})); });
    pyReq.write(body);
    pyReq.end();
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Server ───────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // ── /api/scrape?url=… ──────────────────────────────────────────────────
  if (reqUrl.pathname === '/api/scrape') {
    const target = reqUrl.searchParams.get('url') || '';
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'missing url param' }));
    }
    try {
      const { body } = await fetchUrl(target);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Scraper': 'vendorlens-local' });
      return res.end(body);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message || 'fetch_failed' }));
    }
  }

  // ── /api/proxy-ai  (POST → relay AI calls server-side to avoid CORS) ──
  if (reqUrl.pathname === '/api/proxy-ai' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
      const { url: targetUrl, method = 'POST', headers: fwdHeaders = {}, body: fwdBody } = payload;
      if (!targetUrl || !/^https?:\/\//.test(targetUrl)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'missing or invalid url' }));
      }
      let parsed;
      try { parsed = new URL(targetUrl); } catch {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid url' }));
      }
      const bodyStr = typeof fwdBody === 'string' ? fwdBody : JSON.stringify(fwdBody);
      const lib2 = parsed.protocol === 'https:' ? https : http;
      const outHeaders = { ...fwdHeaders, 'Content-Length': Buffer.byteLength(bodyStr) };
      const proxyReq = lib2.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: outHeaders,
        timeout: 120000,
      }, proxyRes => {
        let respBody = '';
        proxyRes.on('data', c => respBody += c);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(respBody);
        });
      });
      proxyReq.on('timeout', () => { proxyReq.destroy(); res.writeHead(504); res.end(JSON.stringify({ error: 'upstream_timeout' })); });
      proxyReq.on('error', e => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
      proxyReq.write(bodyStr);
      proxyReq.end();
    });
    return;
  }

  // ── /api/extract  (POST → Python LangExtract service) ─────────────────
  if (reqUrl.pathname === '/api/extract' && req.method === 'POST') {
    return proxyToExtract(req, res);
  }

  // ── /api/extract/health ─────────────────────────────────────────────────
  if (reqUrl.pathname === '/api/extract/health') {
    const pyReq = http.request({ hostname: '127.0.0.1', port: EXTRACT_PORT, path: '/health', timeout: 3000 }, pyRes => {
      let d = ''; pyRes.on('data', c => d += c); pyRes.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(d);
      });
    });
    pyReq.on('error', () => { res.writeHead(503); res.end(JSON.stringify({ status: 'unavailable' })); });
    return pyReq.end();
  }

  // ── /api/health ─────────────────────────────────────────────────────────
  if (reqUrl.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', scraper: 'vendorlens-local', version: '1.0' }));
  }

  // ── static files ─────────────────────────────────────────────────────────
  let urlPath = decodeURIComponent(reqUrl.pathname);
  if (urlPath === '/') urlPath = '/vendor-intel.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': contentType(file) });
    res.end(body);
  });
}).listen(PORT, HOST, () => {
  console.log(`VendorLens on http://${HOST}:${PORT}  |  scraper:/api/scrape  |  langextract:/api/extract`);
});
