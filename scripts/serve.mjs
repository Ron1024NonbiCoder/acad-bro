/* Dev server: static files from ../web, no dependencies.
   PORT env (default 5180); if that port is taken it tries the next ones and
   logs the port it actually bound. PORT=0 lets the OS pick. */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

async function handle(req, res) {
  try {
    var pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    var file = path.normalize(path.join(ROOT, pathname));
    /* stay inside web/ */
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    var s = await stat(file).catch(function () { return null; });
    if (s && s.isDirectory()) { file = path.join(file, 'index.html'); s = await stat(file).catch(function () { return null; }); }
    if (!s) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    var body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
}

var start = process.env.PORT === undefined || process.env.PORT === '' ? 5180 : Number(process.env.PORT);
if (!Number.isInteger(start) || start < 0 || start > 65535) {
  console.error('PORT must be a whole number from 0 to 65535 (got "' + process.env.PORT + '").');
  process.exit(1);
}

function listen(port, triesLeft) {
  var server = http.createServer(handle);
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && triesLeft > 0 && port !== 0) {
      console.log('Port ' + port + ' is busy, trying ' + (port + 1) + '...');
      listen(port + 1, triesLeft - 1);
    } else {
      console.error('Could not start the server: ' + err.message);
      process.exit(1);
    }
  });
  server.listen(port, function () {
    console.log('AcadBro serving ' + ROOT + ' at http://localhost:' + server.address().port + '/');
  });
}
listen(start, 10);
