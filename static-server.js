const http = require('http');
const fs = require('fs');
const path = require('path');

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

http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
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
    res.writeHead(200, {'Content-Type': contentType(file)});
    res.end(body);
  });
}).listen(PORT, HOST, () => {
  console.log(`Static server listening on http://${HOST}:${PORT}/vendor-intel.html`);
});
