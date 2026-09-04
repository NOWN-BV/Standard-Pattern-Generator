// Static file server for the pattern-generator harness, plus a single
// read/write endpoint so saved designs live on DISK instead of in the browser.
//
// WHY: saves were in localStorage, which is scoped to the browser profile. The
// preview pane gets a fresh profile each session, so every saved design was
// lost on restart. Writing them to designs.json next to the prototype makes
// them survive the browser, the machine, and a reboot - and lets them be
// committed and shared like any other file.
//
// Bound to 127.0.0.1 deliberately: the previous server listened on 0.0.0.0,
// exposing the generator (and the DXF writer inside it) to the office network.
//
//   node serve.mjs <root-dir> [port]

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 5600);

// The ONLY path this server will write. Anything else is read-only, so a stray
// request cannot overwrite the engine sources it is serving.
const DESIGNS = 'designs.json';
const designsPath = join(root, DESIGNS);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.dxf': 'application/dxf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const readBody = (req) =>
  new Promise((res, rej) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      // Designs are small; refuse anything that looks like an accident.
      if (data.length > 4_000_000) rej(new Error('too large'));
    });
    req.on('end', () => res(data));
    req.on('error', rej);
  });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);

    // ── saved designs ────────────────────────────────────────────────────
    if (rel === '/' + DESIGNS) {
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readBody(req);
        // Validate before writing: a corrupt file would lose every design.
        JSON.parse(body);
        await writeFile(designsPath, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
        return;
      }
      // GET: an absent file is an empty library, not an error.
      let body = '{}';
      try {
        body = await readFile(designsPath, 'utf8');
      } catch {
        body = '{}';
      }
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(body);
      return;
    }

    // ── static ───────────────────────────────────────────────────────────
    if (rel === '/') rel = '/preview.html';
    const target = join(root, normalize(rel).replace(/^([/\\])+/, ''));
    if (!target.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    const code = err instanceof SyntaxError ? 400 : 404;
    res.writeHead(code).end(code === 400 ? 'bad json' : 'not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root}`);
  console.log(`designs -> ${designsPath}`);
  console.log(`http://localhost:${port}/preview.html`);
});
