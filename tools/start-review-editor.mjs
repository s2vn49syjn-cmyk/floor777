import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.indexOf('--port');
const port = requested < 0 ? 8781 : Number(process.argv[requested + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'};
const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {response.writeHead(405).end(); return;}
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const reviewDraft = /^\/review-drafts\/([a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{16})\.json$/.exec(pathname);
    if ((!reviewDraft && !/^\/(tools|data|assets)\//.test(pathname)) || pathname.split('/').some(segment => segment.startsWith('.'))) {
      response.writeHead(403).end(); return;
    }
    let target = reviewDraft ? path.join(root, 'work/review-drafts', `${reviewDraft[1]}.json`) : path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) {response.writeHead(403).end(); return;}
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    response.writeHead(200, {'Content-Type': `${types[path.extname(target).toLowerCase()] || 'application/octet-stream'}; charset=utf-8`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(target).pipe(response);
  } catch {response.writeHead(404).end('Not found');}
});
server.listen(port, '127.0.0.1', () => console.log(`Review Editor: http://127.0.0.1:${port}/tools/layout-review.html`));
