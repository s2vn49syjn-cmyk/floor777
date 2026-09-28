import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MIGRATION_STORE_IDS, migrateBuilderProject, compareToLegacy} from '../tools/layout-migrate.mjs';
import {validateLayout} from '../tools/layout-validator.mjs';
import {fromLegacyHall} from '../tools/layout-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const files = fs.readdirSync(path.join(root, 'data', 'layouts')).filter(file => file.endsWith('.json'));
assert.deepEqual(files.sort(), MIGRATION_STORE_IDS.map(id => `${id}.json`).sort());
let totalMachines = 0;
for (const id of MIGRATION_STORE_IDS) {
  const hall = read(`data/${id}.json`);
  const positions = read(`data/positions-${id}.json`);
  const layout = read(`data/layouts/${id}.json`);
  assert.equal(layout.storeId, id);
  assert.equal(layout.verification.status, 'needs_review');
  assert.equal(layout.confidence, null);
  assert.equal(layout.floors[0].confidence, null);
  assert(layout.floors[0].islands.length > 0);
  assert(layout.floors[0].islands.every(island => island.confidence === null && island.machines.every(machine => machine.confidence === null)));
  assert.deepEqual(compareToLegacy(layout, hall, positions, {tolerance: 0}), [], `${id}: legacy data changed`);
  const report = validateLayout(layout, {referenceNumbers: hall.seats.map(seat => seat.seat)});
  assert.equal(report.valid, true, `${id}: ${JSON.stringify(report.diagnostics.filter(item => item.severity === 'error'))}`);
  assert.equal(report.machineCount, hall.seats.length);
  totalMachines += report.machineCount;
  const text = fs.readFileSync(path.join(root, 'data', 'layouts', `${id}.json`), 'utf8');
  assert(!text.includes('data:image/') && !text.includes('base64,') && !text.includes('draftEvidence'));
}

// A broken or incomplete project must never invent islands: the legacy adapter
// remains the read-only fallback and the reason is retained in the result.
const id = MIGRATION_STORE_IDS[0];
const hall = read(`data/${id}.json`);
const positions = read(`data/positions-${id}.json`);
const published = read(`data/layouts/${id}.json`);
const source = {version: 2, id, width: published.floors[0].width, height: published.floors[0].height,
  islands: published.floors[0].islands.map(island => ({
    key: island.id, name: island.label, shape: island.shape,
    x: island.geometry.x, y: island.geometry.y, angle: island.geometry.rotation,
    size: island.geometry.size, pitch: island.geometry.pitch, radius: island.geometry.radius,
    sweep: island.geometry.sweep, count: island.machineCount,
    numbers: island.machines.map(machine => machine.number),
    points: island.geometry.points.map(point => [...point])
  }))};
const migrated = migrateBuilderProject({project: source, hall, positions});
assert.equal(migrated.status, 'migrated');
assert.deepEqual(compareToLegacy(migrated.layout, hall, positions, {tolerance: 0}), []);
const incomplete = structuredClone(source);
incomplete.islands[0].points.pop();
const deferred = migrateBuilderProject({project: incomplete, hall, positions});
assert.equal(deferred.status, 'deferred');
assert(deferred.reasons.length > 0);
assert.deepEqual(deferred.layout, fromLegacyHall(hall, positions));
assert.equal(deferred.layout.floors[0].islands.length, 0);

// Goal 1's frozen human-verified baselines are deliberately not updated here.
await import('./layout-v3.mjs');
console.log(`Layout migration: ${MIGRATION_STORE_IDS.length} layouts, ${totalMachines} seats, fallback and Golden regression passed`);
