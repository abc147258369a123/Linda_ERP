/**
 * 极简静态预览服务器（仅用于开发期实时预览）
 * 正式部署（树莓派）请使用 nginx 或 python3 -m http.server，本文件不属于运行时代码。
 *
 * 用法：node tools/dev-server.js [port]
 *   - 默认监听 http://127.0.0.1:8090/
 *   - /__version 返回站点文件指纹，前端 js/dev-reload.js 据此自动刷新预览
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', 'frontend');
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const IGNORED_DIRS = new Set(['node_modules', '.git', '.dsh-tmp', '.dsh', 'dist']);

function walk(dir, list) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return list;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(full, list);
    } else if (/\.(html|css|js|json|svg)$/i.test(entry.name)) {
      try {
        const st = fs.statSync(full);
        list.push(full + '|' + st.mtimeMs + '|' + st.size);
      } catch (e) { /* ignore */ }
    }
  }
  return list;
}

let versionCache = { at: 0, value: '' };
function siteVersion() {
  const now = Date.now();
  if (now - versionCache.at < 400) return versionCache.value;
  const list = walk(ROOT, []).sort();
  const hash = crypto.createHash('sha1');
  for (const item of list) hash.update(item + ';');
  versionCache = { at: now, value: hash.digest('hex') };
  return versionCache.value;
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (pathname === '/__version') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(siteVersion());
    return;
  }

  if (pathname === '/') pathname = '/login.html';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>404</title>' +
        '<body style="font-family:system-ui;padding:40px"><h1>404</h1><p>' +
        String(pathname).replace(/</g, '&lt;') + ' 不存在</p><p><a href="/login.html">返回登录页</a></p></body>');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log('[preview] serving ' + ROOT);
  console.log('[preview] http://' + HOST + ':' + PORT + '/  (root -> login.html)');
});
