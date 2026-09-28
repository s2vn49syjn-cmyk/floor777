import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fromLegacyHall} from '../tools/layout-adapter.mjs';
import {validateLayout} from '../tools/layout-validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positionsFile = id => `data/positions-${id === 'hyper-arrow-mihara' ? 'mihara' : id}.json`;
const clone = value => structuredClone(value);
const has = (result, code) => result.diagnostics.some(item => item.code === code);
const fixture = read('tests/fixtures/layout-golden.json');
const schema = read('tools/layout-schema-v3.json');
assert.equal(schema.properties.schemaVersion.const, 3);
for (const field of ['storeId', 'floors', 'verification', 'provenance', 'generation', 'confidence']) assert(schema.required.includes(field));
for (const field of ['id', 'shape', 'geometry', 'machineCount', 'machines']) assert(schema.$defs.island.required.includes(field));
assert(schema.$defs.machine.properties.number.type.includes('null'));
assert.equal(fixture.formatVersion, 1);
assert.equal(fixture.golden.length + fixture.candidates.length, 3);

const halls = fs.readdirSync(path.join(root, 'data'))
  .filter(file => file.endsWith('.json') && file !== 'halls.json' && !file.startsWith('positions-'));
assert.equal(halls.length, 19, 'The Goal 1 baseline covers all 19 existing halls');
let totalSeats = 0;
for (const file of halls) {
  const hall = read(`data/${file}`);
  const positions = read(positionsFile(hall.id));
  const beforeHall = clone(hall), beforePositions = clone(positions);
  const layout = fromLegacyHall(hall, positions);
  assert.deepEqual(hall, beforeHall, `${hall.id}: adapter mutated hall`);
  assert.deepEqual(positions, beforePositions, `${hall.id}: adapter mutated positions`);
  assert.equal(layout.storeId, hall.id);
  assert.equal(layout.floors.length, 1);
  assert.equal(layout.floors[0].islands.length, 0, 'legacy island boundaries must remain unknown');
  assert.equal(layout.confidence, null);
  assert.equal(layout.verification.status, 'unknown');
  const machines = layout.floors[0].unassignedMachines;
  assert.equal(machines.length, hall.seats.length, `${hall.id}: seat count changed`);
  assert.deepEqual(machines.map(item => item.number).sort((a, b) => a - b), hall.seats.map(item => item.seat).sort((a, b) => a - b));
  for (const machine of machines) {
    assert.deepEqual(machine.position, positions[String(machine.number)], `${hall.id}: position changed for ${machine.number}`);
    assert.equal(machine.machineName, hall.seats.find(seat => seat.seat === machine.number).machine);
  }
  const report = validateLayout(layout, {referenceNumbers: hall.seats.map(seat => seat.seat)});
  assert(report.valid, `${hall.id}: ${JSON.stringify(report.diagnostics.filter(item => item.severity === 'error').slice(0, 4))}`);
  totalSeats += machines.length;
}
assert.equal(totalSeats, 6310);

for (const record of [...fixture.golden, ...fixture.candidates]) {
  const hall = read(`data/${record.storeId}.json`), positions = read(positionsFile(record.storeId));
  const layout = fromLegacyHall(hall, positions);
  const machines = layout.floors.flatMap(floor => [...floor.unassignedMachines, ...floor.islands.flatMap(island => island.machines)]);
  const numbers = machines.map(item => item.number).sort((a, b) => a - b);
  assert.equal(machines.length, record.seatCount);
  assert.equal(hash(numbers), record.numbersHash, `${record.storeId}: number-set baseline changed`);
  assert.equal(hash(numbers.map(number => [number, machines.find(item => item.number === number).position])), record.coordinatesHash,
    `${record.storeId}: coordinate baseline changed`);
  if (record.islandStructure !== null) assert.deepEqual(layout.floors[0].islands, record.islandStructure);
}

const base = fromLegacyHall(read('data/123-kitanoda.json'), read('data/positions-123-kitanoda.json'));
const first = base.floors[0].unassignedMachines[0], second = base.floors[0].unassignedMachines[1];
const changed = edit => {const value = clone(base); edit(value); return validateLayout(value)};
assert(has(changed(value => {value.schemaVersion = 999}), 'schema_invalid'));
assert(has(changed(value => {value.floors[0].width = 'wrong'}), 'schema_invalid'));
assert(has(changed(value => {value.floors[0].unassignedMachines[1].id = first.id}), 'id_duplicate'));
assert(has(changed(value => {value.floors[0].unassignedMachines[1].number = first.number}), 'number_duplicate'));
assert(has(changed(value => {value.floors[0].unassignedMachines[1].number = null}), 'number_missing'));
assert(has(changed(value => {value.floors[0].unassignedMachines[0].position[0] = -1}), 'position_out_of_bounds'));
assert(has(changed(value => {value.floors[0].unassignedMachines[0].position[2] = 1}), 'size_unusual'));
assert(has(changed(value => {value.floors[0].unassignedMachines[1].position = [...first.position]}), 'coordinate_duplicate'));
assert(has(changed(value => {value.floors[0].unassignedMachines[1].position = [first.position[0] + 2, first.position[1] + 2, first.position[2], first.position[3]]}), 'machine_overlap'));
assert(has(validateLayout(base, {referenceNumbers: [99999]}), 'reference_number_missing'));
assert(has(validateLayout(base, {referenceNumbers: [99999]}), 'reference_number_extra'));
const islandLayout = clone(base), floor = islandLayout.floors[0];
floor.unassignedMachines = floor.unassignedMachines.slice(2);
floor.islands = [
  {id: 'island:a', shape: 'custom', geometry: {x: 0, y: 0}, machineCount: 3, machines: [clone(first)], confidence: null},
  {id: 'island:b', shape: 'custom', geometry: {x: 0, y: 0}, machineCount: 1, machines: [clone(second)], confidence: null}
];
assert(has(validateLayout(islandLayout), 'machine_count_mismatch'));
floor.islands[0].machineCount = 1;
floor.islands[0].geometry = {x: 'wrong', y: 0};
assert(has(validateLayout(islandLayout), 'schema_invalid'));
floor.islands[0].geometry = {x: 0, y: 0};
floor.islands[1].machines[0].position = [...first.position];
assert(has(validateLayout(islandLayout), 'island_overlap'));
const sparse = clone(base);
sparse.floors[0].unassignedMachines = sparse.floors[0].unassignedMachines.slice(0, 2);
assert(!has(validateLayout(sparse), 'reference_number_missing'), 'number gaps alone are not errors');
assert.throws(() => fromLegacyHall({id: 'bad', seats: [{seat: 1, machine: 'x'}]}, {}), /no position/);

console.log(`PASS: layout v3 schema/adapter/validator, ${halls.length} halls, ${totalSeats} seats, ${fixture.golden.length} golden and ${fixture.candidates.length} candidate fixtures`);
