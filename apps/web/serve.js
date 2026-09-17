// serve.js — Kabonix staff portal static server
// Injects <meta> tags for API_URL and WEBSITE_URL at runtime.
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PORT       = process.env.PORT || process.env.WEB_PORT || 3000;
const API_URL    = process.env.API_URL    || 'http://localhost:4000';
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:3001';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
};

const META_INJECT = `
  <meta name="api-url"     content="${API_URL}">
  <meta name="website-url" content="${WEBSITE_URL}">`;

http.createServer((req, res) => {
  let p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(__dirname, p);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    let body = content;
    if (ext === '.html') {
      body = Buffer.from(content.toString().replace('<head>', `<head>${META_INJECT}`));
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Kabonix staff portal → http://localhost:${PORT}`);
  console.log(`  API_URL:     ${API_URL}`);
  console.log(`  WEBSITE_URL: ${WEBSITE_URL}`);
});
