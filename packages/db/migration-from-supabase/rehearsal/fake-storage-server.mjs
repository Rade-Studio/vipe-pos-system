// Stand-in for Supabase Storage public reads in the rehearsal:
//   GET|HEAD /storage/v1/object/public/<bucket>/<name>  ->  <root>/<bucket>/<name>
// Usage: node fake-storage-server.mjs <root> <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';

const [root, port] = process.argv.slice(2);
const PREFIX = '/storage/v1/object/public/';
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path.slice(PREFIX.length)));
  if (!path.startsWith(PREFIX) || !file.startsWith(normalize(root) + sep) || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    const ext = file.split('.').pop().toLowerCase();
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
  }
}).listen(Number(port), '127.0.0.1', () => console.error(`fake-storage: serving ${root} on :${port}`));
