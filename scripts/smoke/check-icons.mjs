/* Read each PNG's IHDR and confirm its pixel size + colour type. usage: node scripts/smoke/check-icons.mjs [repoRoot] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')), 'web', 'icon');
const want = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 };
let bad = 0;
for (const [f, n] of Object.entries(want)) {
  const b = fs.readFileSync(path.join(dir, f));
  const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && b.subarray(12, 16).toString() === 'IHDR';
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
  const ok = sig && w === n && h === n;
  if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + ' ' + w + 'x' + h + ' colourType=' + ct + ' (' + b.length + ' bytes)');
}
process.exit(bad ? 1 : 0);
