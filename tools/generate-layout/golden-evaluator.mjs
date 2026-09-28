import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fromLegacyHall} from '../layout-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/layout-golden.json'), 'utf8'));
const machines = layout => layout.floors.flatMap(floor => [...floor.unassignedMachines, ...floor.islands.flatMap(island => island.machines)]);
const bounds = list => list.length ? {
  x: Math.min(...list.map(machine => machine.position[0])), y: Math.min(...list.map(machine => machine.position[1])),
  right: Math.max(...list.map(machine => machine.position[0] + machine.position[2])),
  bottom: Math.max(...list.map(machine => machine.position[1] + machine.position[3]))} : null;

export function loadGoldenLayout(storeId) {
  const record = fixtures.golden.find(item => item.storeId === storeId);
  if (!record) throw Error(`${storeId} is not a Golden Fixture`);
  const hall = JSON.parse(fs.readFileSync(path.join(root, `data/${storeId}.json`), 'utf8'));
  const name = storeId === 'hyper-arrow-mihara' ? 'mihara' : storeId;
  const positions = JSON.parse(fs.readFileSync(path.join(root, `data/positions-${name}.json`), 'utf8'));
  return {record, layout: fromLegacyHall(hall, positions)};
}

export function evaluateAgainstGolden(candidate, storeId = candidate.storeId) {
  const {record, layout: golden} = loadGoldenLayout(storeId);
  const actual = machines(candidate), expected = machines(golden), actualByNumber = new Map(actual.filter(m => m.number !== null).map(m => [m.number, m]));
  const expectedByNumber = new Map(expected.map(m => [m.number, m]));
  const missingNumbers = [...expectedByNumber.keys()].filter(number => !actualByNumber.has(number));
  const extraNumbers = [...actualByNumber.keys()].filter(number => !expectedByNumber.has(number));
  const distances = [...expectedByNumber].filter(([number]) => actualByNumber.has(number)).map(([number, machine]) => {
    const a = machine.position, b = actualByNumber.get(number).position;
    if (JSON.stringify(a) === JSON.stringify(b)) return 0;
    return Math.hypot(a[0] + a[2] / 2 - b[0] - b[2] / 2, a[1] + a[3] / 2 - b[1] - b[3] / 2);
  });
  const exactPositions = [...expectedByNumber].filter(([number, machine]) =>
    actualByNumber.has(number) && JSON.stringify(machine.position) === JSON.stringify(actualByNumber.get(number).position)).length;
  const goldBounds = bounds(expected), candidateBounds = bounds(actual);
  const boundDifference = candidateBounds ? Object.fromEntries(Object.keys(goldBounds).map(key => [key, candidateBounds[key] - goldBounds[key]])) : null;
  return {storeId, goldenSeatCount: record.seatCount, candidateSeatCount: actual.length,
    seatCountDifference: actual.length - record.seatCount,
    goldenIslandCount: record.islandStructure === null ? null : golden.floors.reduce((sum, floor) => sum + floor.islands.length, 0),
    candidateIslandCount: candidate.floors.reduce((sum, floor) => sum + floor.islands.length, 0),
    missingNumbers, extraNumbers, numberingMatch: missingNumbers.length === 0 && extraNumbers.length === 0 && exactPositions === expected.length,
    comparedPositions: distances.length, exactPositions,
    meanCoordinateDistance: distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : null,
    maxCoordinateDistance: distances.length ? Math.max(...distances) : null,
    boundingBoxDifference: boundDifference,
    islandGeometryDifference: record.islandStructure === null ? null : 'requires island matching'};
}
