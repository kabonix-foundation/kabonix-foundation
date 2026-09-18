// serve.js — Kabonix public website static server
// Injects <meta> tags for API_URL and PORTAL_URL so the same index.html
// works locally and on Render without a build step.
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PORT        = process.env.PORT || process.env.WEBSITE_PORT || 3001;
const API_URL     = process.env.API_URL     || 'http://localhost:4000';
const PORTAL_URL  = process.env.PORTAL_URL  || 'http://localhost:3000';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const META_INJECT = `
  <meta name="api-url"     content="${API_URL}">
  <meta name="portal-url"  content="${PORTAL_URL}">`;

http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const filePath = path.join(__dirname, p);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const ct  = MIME[ext] || 'text/plain';
    let body  = content;
    // Inject meta tags into HTML so JS can read runtime config
    if (ext === '.html') {
      body = Buffer.from(content.toString().replace('<head>', `<head>${META_INJECT}`));
    }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(body);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Kabonix public website → http://localhost:${PORT}`);
  console.log(`  API_URL:    ${API_URL}`);
  console.log(`  PORTAL_URL: ${PORTAL_URL}`);
});
