// 零依赖静态服务器，用于本地直接预览源码（无需先打包）。
// 会把 /builda-sdk.js 映射到 .builda-agent 里的官方 SDK，方便没有 Builda App 时也能跑通 whoami/KV。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2'
};

/**
 * 起一个静态服务器。
 * @param {object} opts
 * @param {string} [opts.root]  要服务的根目录，默认 dist/（存在）否则仓库根
 * @param {number} [opts.port]  0 表示随机端口
 * @returns {Promise<{server, port, url}>}
 */
export function startServer(opts) {
  opts = opts || {};
  const root = opts.root || process.cwd();
  const sdk = join(root, '.builda-agent', 'sdk', 'web', 'builda-sdk.js');
  const port = opts.port == null ? 5173 : opts.port;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (path === '/') path = '/index.html';

      if (path === '/builda-sdk.js') {
        const data = await readFile(sdk);
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
        res.end(data);
        return;
      }

      // 不服务点目录（.builda-agent / .git / .agents 等）
      if (path.split('/').some((seg) => seg.startsWith('.') && seg.length > 1)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 ' + path);
        return;
      }

      const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
      const file = join(root, safe);
      if (!file.startsWith(root)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 ' + path);
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(data);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('500 ' + (err && err.message ? err.message : err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, port: p, url: 'http://127.0.0.1:' + p + '/' });
    });
  });
}

// 直接运行时才起服务（被 smoke.mjs import 时不动）
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const port = Number(process.env.PORT || 5173);
  const { url } = await startServer({ root: process.cwd(), port });
  console.log('[dev] ' + url + '?autostart=1');
  console.log('[dev] ' + url + '?cam=top&autostart=1   (俯视检查地图)');
}
