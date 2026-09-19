// serve.js — Kabonix public website static server
// Injects runtime API and portal URLs, and rewrites the portal CTA so the
// public website and staff portal can be deployed as separate services while
// still behaving as one product.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || process.env.WEBSITE_PORT || 3001;
const API_URL = process.env.API_URL || 'http://localhost:4000';
const PORTAL_URL = process.env.PORTAL_URL || 'http://localhost:3000';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const META_INJECT = `
  <meta name="api-url" content="${escapeAttribute(API_URL)}">
  <meta name="portal-url" content="${escapeAttribute(PORTAL_URL)}">`;

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safePath(requestPath) {
  const pathname = decodeURIComponent(requestPath.split('?')[0]);
  const requested = pathname === '/' || !path.extname(pathname) ? '/index.html' : pathname;
  const filePath = path.resolve(__dirname, `.${requested}`);
  return filePath.startsWith(__dirname + path.sep) ? filePath : null;
}

http.createServer((req, res) => {
  const filePath = safePath(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    const ext = path.extname(filePath);
    let body = content;
    if (ext === '.html') {
      body = Buffer.from(
        content
          .toString()
          .replace('<head>', `<head>${META_INJECT}`)
          // The homepage originally used ../web/, which resolves against the
          // website host and breaks in production. Point it at the configured
          // portal service instead.
          .replaceAll('../web/', escapeAttribute(PORTAL_URL))
      );
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Kabonix public website → http://localhost:${PORT}`);
  console.log(`  API_URL:    ${API_URL}`);
  console.log(`  PORTAL_URL: ${PORTAL_URL}`);
});
