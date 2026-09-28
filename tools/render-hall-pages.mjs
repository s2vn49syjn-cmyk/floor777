import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderExistingHall} from './hall-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const ids = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'tools', 'hall-page-meta.json'), 'utf8')));
let changed = 0;
for (const id of ids) {
  const target = path.join(root, 'halls', id, 'index.html');
  if (!fs.existsSync(target)) throw Error(`Missing existing page: ${id}`);
  const rendered = renderExistingHall(id);
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') === rendered.replace(/\r\n/g, '\n')) continue;
  changed++;
  if (write) fs.writeFileSync(target, rendered);
  console.log(`${id}: ${write ? 'updated' : 'needs regeneration'}`);
}
console.log(`${ids.length} store pages checked; ${changed} ${write ? 'updated' : 'different'}`);
if (changed && !write) process.exitCode = 1;
