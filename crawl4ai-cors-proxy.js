const http = require('http');

const PORT = Number(process.env.PORT || 8787);
const TARGET = (process.env.CRAWL4AI_URL || 'http://localhost:11235').replace(/\/$/, '');
const MAX_BYTES = Number(process.env.MAX_BODY_MB || 100) * 1024 * 1024;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': type
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BYTES) {
        reject(new Error(`request_too_large: body exceeded ${Math.round(MAX_BYTES / 1024 / 1024)} MB. Lower the app batch size or raise MAX_BODY_MB.`));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function forward(req, res, path) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const upstream = await fetch(TARGET + path, {
    method: req.method,
    headers: {'Content-Type': req.headers['content-type'] || 'application/json'},
    body
  });
  const text = await upstream.text();
  send(res, upstream.status, text, upstream.headers.get('content-type') || 'application/json');
}

async function checkTarget() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const upstream = await fetch(TARGET + '/health', {signal: controller.signal});
    clearTimeout(t);
    return {reachable: upstream.ok, status: upstream.status};
  } catch (e) {
    return {reachable: false, error: e.message || String(e)};
  }
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.url === '/health' && req.method === 'GET') {
      const target = await checkTarget();
      return send(res, 200, JSON.stringify({ok: true, proxy: true, target: TARGET, targetReachable: target.reachable, targetStatus: target.status || null, targetError: target.error || null}));
    }
    if (req.url === '/crawl' && req.method === 'POST') return forward(req, res, '/crawl');
    send(res, 404, JSON.stringify({error: 'not_found'}));
  } catch (e) {
    send(res, 502, JSON.stringify({error: e.message || String(e), target: TARGET}));
  }
}).listen(PORT, () => {
  console.log(`Crawl4AI CORS proxy listening on http://localhost:${PORT}`);
  console.log(`Forwarding to ${TARGET}`);
  console.log(`Max body size ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
});
