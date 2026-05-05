import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerEnv, proxyGroqRequest } from './server-utils.js';

loadServerEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/status') {
    sendJson(res, 200, { groqConfigured: Boolean(process.env.GROQ_API_KEY) });
    return;
  }

  if (req.url === '/api/groq') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const result = await proxyGroqRequest(JSON.parse((await readBody(req)) || '{}'));
      sendJson(res, result.status, result.body);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  const requestedPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  const safePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.normalize(path.join(distDir, safePath));

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const finalPath = fs.existsSync(filePath) ? filePath : path.join(distDir, 'index.html');
  const ext = path.extname(finalPath);

  res.writeHead(200, {
    'Content-Type': contentTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(finalPath).pipe(res);
});

server.listen(port, () => {
  console.log(`AuraRAG server running at http://127.0.0.1:${port}`);
});
