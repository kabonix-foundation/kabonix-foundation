// serve.js — static server for the Kabonix public website (port 3001)
// In production this is a CDN + object storage bucket (Section 7).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WEBSITE_PORT || 3001;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.ico':'image/x-icon' };

http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const filePath = path.join(__dirname, p);
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(content);
  });
}).listen(PORT, () => console.log(`Kabonix public website → http://localhost:${PORT}`));
