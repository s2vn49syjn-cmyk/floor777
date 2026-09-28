import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fromLegacyHall} from './layout-adapter.mjs';
import {validateLayout} from './layout-validator.mjs';

export const MIGRATION_STORE_IDS = [
  '123-kitanoda', '123-sakai-inter', '123-senboku', 'arrow-toga',
  'harimaya-nakamozu', 'hyper-arrow-fukai', 'hyper-arrow-senboku',
  'maruhan-harayamadai', 'maruhan-komyoike', 'maruhan-megacity-sakai',
  'maruhan-orisano', 'monroe', 'rakuen-plus', 'sherra', 'sherra-part3', 'verde'
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sameRect = (a, b, tolerance) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4 &&
  a.every((value, index) => Number.isFinite(value) && Number.isFinite(b[index]) && Math.abs(value - b[index]) <= tolerance);

// Compare published data, never an inferred numbering sequence.
export function compareToLegacy(layout, hall, positions, {tolerance = 0.01} = {}) {
  const reasons = [];
  const machines = layout.floors?.flatMap(floor => [
    ...floor.unassignedMachines, ...floor.islands.flatMap(island => island.machines)
  ]) ?? [];
  const hallNumbers = hall.seats.map(seat => seat.seat).sort((a, b) => a - b);
  const positionNumbers = Object.keys(positions).map(Number).sort((a, b) => a - b);
  const layoutNumbers = machines.map(machine => machine.number).sort((a, b) => a - b);
  if (machines.length !== hall.seats.length || machines.length !== positionNumbers.length) reasons.push('machine_count_mismatch');
  if (JSON.stringify(hallNumbers) !== JSON.stringify(positionNumbers) || JSON.stringify(layoutNumbers) !== JSON.stringify(hallNumbers)) reasons.push('number_set_mismatch');
  for (const machine of machines) {
    if (!sameRect(machine.position, positions[machine.number], tolerance)) reasons.push(`position_mismatch:${machine.number}`);
  }
  return [...new Set(reasons)];
}

// Only transfer explicit project groups and points. A group is not asserted to be
// a physically verified island; every imported layout remains needs_review.
export function migrateBuilderProject({project, hall, positions, sourceHash = null, tolerance = 0.01}) {
  const fallback = () => fromLegacyHall(hall, positions);
  const deferred = reasons => ({status: 'deferred', reasons, layout: fallback()});
  if (!project || project.version !== 2 || project.id !== hall.id || !Array.isArray(project.islands) ||
    !Number.isFinite(project.width) || project.width <= 0 || !Number.isFinite(project.height) || project.height <= 0) {
    return deferred(['invalid_or_mismatched_project']);
  }
  const seats = new Map(hall.seats.map(seat => [seat.seat, seat]));
  const used = new Set();
  const islandIds = new Set();
  const islands = [];
  for (const source of project.islands) {
    const numbers = source?.numbers;
    const points = source?.points;
    if (typeof source?.key !== 'string' || !/^[a-z0-9][a-z0-9:-]*$/.test(source.key) || islandIds.has(source.key) ||
      source.shape !== 'custom' || !Number.isInteger(source.count) || source.count < 1 ||
      !Array.isArray(numbers) || !Array.isArray(points) || numbers.length !== source.count || points.length !== source.count ||
      !Number.isFinite(source.x) || !Number.isFinite(source.y)) return deferred(['incomplete_or_unsupported_island']);
    islandIds.add(source.key);
    const machines = [];
    for (let index = 0; index < numbers.length; index++) {
      const number = numbers[index];
      if (!Number.isSafeInteger(number) || number < 1 || used.has(number) || !seats.has(number) ||
        !sameRect(points[index], positions[number], tolerance)) return deferred([`unmatched_machine:${number}`]);
      used.add(number);
      machines.push({
        id: `seat:${number}`, number, machineName: seats.get(number).machine ?? null,
        position: [...positions[number]], confidence: null
      });
    }
    const geometry = {x: source.x, y: source.y, points: points.map(point => [...point])};
    for (const [oldKey, newKey] of [['angle', 'rotation'], ['size', 'size'], ['pitch', 'pitch'], ['radius', 'radius'], ['sweep', 'sweep']]) {
      if (Number.isFinite(source[oldKey])) geometry[newKey] = source[oldKey];
    }
    islands.push({id: source.key, label: typeof source.name === 'string' ? source.name : null,
      shape: 'custom', geometry, machineCount: source.count, machines, confidence: null});
  }
  if (used.size !== hall.seats.length || used.size !== Object.keys(positions).length) return deferred(['unassigned_legacy_machines']);
  const layout = {
    schemaVersion: 3, storeId: hall.id, storeName: hall.name ?? null,
    floors: [{id: 'legacy-slot', label: hall.floor ?? null, width: project.width, height: project.height,
      coordinateBasis: 'unknown', islands, unassignedMachines: [], confidence: null}],
    verification: {status: 'needs_review', notes: [
      'Imported editable island groups match legacy seat positions; physical island boundaries and numbering order are not verified.'
    ], lastVerifiedAt: null},
    provenance: {sourceType: 'builder-project-v2', sourceUrl: null, observedAt: null, retrievedAt: null, sourceHash},
    generation: null, confidence: null
  };
  const comparison = compareToLegacy(layout, hall, positions, {tolerance});
  const validation = validateLayout(layout, {referenceNumbers: hall.seats.map(seat => seat.seat)});
  if (comparison.length || !validation.valid) return deferred([...comparison, ...validation.diagnostics.filter(item => item.severity === 'error').map(item => item.code)]);
  return {status: 'migrated', reasons: [], layout};
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source-root');
  if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error('Usage: node tools/layout-migrate.mjs --source-root <store-drafts> [--write]');
  const sourceRoot = path.resolve(args[sourceIndex + 1]);
  const write = args.includes('--write');
  const outputRoot = path.join(root, 'data', 'layouts');
  if (write) fs.mkdirSync(outputRoot, {recursive: true});
  let migrated = 0, deferred = 0;
  for (const id of MIGRATION_STORE_IDS) {
    const sourceFile = path.join(sourceRoot, id, `${id}-project.json`);
    const raw = fs.readFileSync(sourceFile);
    const project = JSON.parse(raw);
    const hall = JSON.parse(fs.readFileSync(path.join(root, 'data', `${id}.json`)));
    const positions = JSON.parse(fs.readFileSync(path.join(root, 'data', `positions-${id}.json`)));
    const result = migrateBuilderProject({project, hall, positions,
      sourceHash: crypto.createHash('sha256').update(raw).digest('hex')});
    if (result.status === 'migrated') {
      migrated++;
      if (write) {
        const target = path.join(outputRoot, `${id}.json`);
        const content = `${JSON.stringify(result.layout, null, 2)}\n`;
        if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== content) throw new Error(`Refusing to overwrite changed layout: ${target}`);
        if (!fs.existsSync(target)) fs.writeFileSync(target, content);
      }
    } else deferred++;
    console.log(`${id}: ${result.status}${result.reasons.length ? ` (${result.reasons.join(', ')})` : ''}`);
  }
  console.log(`Migrated ${migrated}, deferred ${deferred}; ${write ? 'wrote' : 'dry run'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
