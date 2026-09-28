import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveFloorModel} from '../assets/floor-layout.mjs';
import {renderExistingHall, renderHallPage} from '../tools/hall-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const ids = fs.readdirSync(path.join(root, 'halls')).filter(id =>
  fs.existsSync(path.join(root, 'halls', id, 'index.html'))).sort();
assert.equal(ids.length, 19);
let legacyCount = 0, v3Count = 0;
for (const id of ids) {
  const hall = read(`data/${id}.json`);
  const positionName = id === 'hyper-arrow-mihara' ? 'mihara' : id;
  const positions = read(`data/positions-${positionName}.json`);
  const layoutFile = path.join(root, 'data', 'layouts', `${id}.json`);
  const candidate = fs.existsSync(layoutFile) ? JSON.parse(fs.readFileSync(layoutFile, 'utf8')) : null;
  const model = resolveFloorModel(hall, positions, candidate);
  assert.equal(model.source, candidate ? 'v3' : 'legacy', id);
  assert.equal(Object.keys(model.positions).length, hall.seats.length, id);
  assert.equal(model.fallbackReason, null, id);
  if (candidate) {
    v3Count++;
    assert.equal(model.floor.islands.length, candidate.floors[0].islands.length);
    assert.equal(model.islandByNumber.size, hall.seats.length);
    assert.equal(candidate.verification.status, 'needs_review');
  } else {
    legacyCount++;
    assert.equal(model.floor.islands.length, 0);
  }
  const currentHTML = fs.readFileSync(path.join(root, 'halls', id, 'index.html'), 'utf8');
  // Git may check out LF on Linux and CRLF on Windows; compare page content,
  // leaving line-ending conversion outside the shared-template regression.
  assert.equal(renderExistingHall(id).replace(/\r\n/g, '\n'), currentHTML.replace(/\r\n/g, '\n'),
    `${id}: shared template changed page contents`);
  assert(currentHTML.includes(`data-hall-file="${id}.json"`));
  assert(currentHTML.includes(`https://floor777.com/halls/${id}/`));
  if (candidate) assert(currentHTML.includes('noindex,nofollow'), `${id}: draft must remain unpublished`);
}
assert.equal(legacyCount, 3);
assert.equal(v3Count, 16);

const hall = read('data/123-senboku.json');
const positions = read('data/positions-123-senboku.json');
const good = read('data/layouts/123-senboku.json');
const broken = structuredClone(good);
broken.floors[0].islands[0].machines[0].position[0] += 20;
const fallback = resolveFloorModel(hall, positions, broken);
assert.equal(fallback.source, 'legacy');
assert.equal(fallback.islandByNumber.size, 0);
assert.equal(Object.keys(fallback.positions).length, hall.seats.length);
assert(fallback.fallbackReason);
assert.equal(resolveFloorModel(hall, positions, null).source, 'legacy');
const newOnly = resolveFloorModel(hall, null, good);
assert.equal(newOnly.source, 'v3');
assert.equal(Object.keys(newOnly.positions).length, hall.seats.length);
assert.equal(resolveFloorModel(hall, {'1': [1, 1, 1, 1]}, good).source, 'v3');
assert.throws(() => resolveFloorModel(hall, null, {...good, storeId: 'wrong'}), /No usable floor layout/);
assert.throws(() => renderHallPage({...hall, id: '../bad'}), /Invalid store ID/);
console.log(`PASS: shared page template exact for ${ids.length} URLs; ${legacyCount} legacy + ${v3Count} v3 floors; v3-only load and invalid/missing v3 fallback`);
