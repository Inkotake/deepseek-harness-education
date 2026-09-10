import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, log } from './common.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg'
};

export async function previewArtifact(args) {
  const root = findProjectRoot();
  if (!root) throw new Error('Not inside a teacher-artifact project.');
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('dist/index.html not found. Run teacher-artifact build first.');
  }

  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 0;
  const open = args.includes('--open');

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const filePath = path.normalize(path.join(dist, pathname));
      if (!filePath.startsWith(path.normalize(dist))) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500); res.end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  const url = `http://127.0.0.1:${actual}`;
  log('Previewing ' + dist);
  log('URL: ' + url);
  log('Press Ctrl+C to stop.');

  if (open) {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? 'cmd' : 'open';
    const args = process.platform === 'win32' ? ['/c', 'start', url] : [url];
    spawn(cmd, args, { stdio: 'ignore', shell: true });
  }

  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
  return 0;
}