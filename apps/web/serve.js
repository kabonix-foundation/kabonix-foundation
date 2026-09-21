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
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const META_INJECT = `
  <meta name="api-url"     content="${escapeAttribute(API_URL)}">
  <meta name="website-url" content="${escapeAttribute(WEBSITE_URL)}">`;

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent((requestUrl || '/').split('?')[0]);
  } catch {
    return null;
  }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(__dirname, `.${requested}`);
  return filePath.startsWith(__dirname + path.sep) ? filePath : null;
}

http.createServer((req, res) => {
  const filePath = safePath(req.url);
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
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
