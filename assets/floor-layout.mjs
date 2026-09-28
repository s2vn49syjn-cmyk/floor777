import {fromLegacyHall} from '../tools/layout-adapter.mjs';
import {validateLayout} from '../tools/layout-validator.mjs';

// Preserve the established view for older stores while keeping their source
// rectangles untouched in the read-only adapter.
export function compactPositions(raw) {
  const entries = Object.entries(raw).map(([seat, position]) => [seat, position.map(Number)]);
  const intervals = entries.map(([, position]) => [position[1], position[1] + position[3]]).sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return {};
  let edge = intervals[0][0];
  const gaps = [];
  for (const [start, end] of intervals) {
    if (start - edge > 24) gaps.push([edge, start, start - edge - 24]);
    edge = Math.max(edge, end);
  }
  const minX = Math.min(...entries.map(([, position]) => position[0]));
  const minY = intervals[0][0];
  const out = {};
  for (const [seat, position] of entries) {
    const [x, y, width, height] = position;
    const cut = gaps.filter(([, end]) => y >= end).reduce((sum, gap) => sum + gap[2], 0);
    out[seat] = [x - minX + 12, y - minY + 62 - cut, width, height];
  }
  return out;
}

const allMachines = floor => [
  ...floor.unassignedMachines,
  ...floor.islands.flatMap(island => island.machines)
];

// Both formats become the same render model. A bad/missing v3 candidate never
// replaces a working legacy floor. Candidate status does not imply publication.
export function resolveFloorModel(hall, rawPositions, candidate = null) {
  let legacy = null;
  let fallbackReason = null;
  if (rawPositions !== null) {
    try { legacy = fromLegacyHall(hall, rawPositions); }
    catch (error) { fallbackReason = `Legacy positions invalid: ${error.message}`; }
  }
  let layout = legacy;
  let source = legacy ? 'legacy' : null;
  if (candidate !== null) {
    try {
      if (candidate.storeId !== hall.id || candidate.floors?.length !== 1) throw Error('Store or floor mismatch');
      const expected = hall.seats.map(seat => seat.seat);
      const result = validateLayout(candidate, {referenceNumbers: expected});
      if (!result.valid) throw Error('Invalid layout');
      const machines = allMachines(candidate.floors[0]);
      if (machines.length !== expected.length || (legacy !== null && machines.some(machine => {
        const previous = rawPositions[String(machine.number)];
        return !previous || machine.position.some((value, index) => Math.abs(value - previous[index]) > 0.01);
      }))) throw Error('Layout differs from published positions');
      layout = candidate;
      source = 'v3';
      fallbackReason = null;
    } catch (error) {
      fallbackReason = error.message;
    }
  }
  if (!layout) throw Error(`No usable floor layout for ${hall.id}${fallbackReason ? `: ${fallbackReason}` : ''}`);
  const floor = layout.floors[0];
  const positions = source === 'legacy' && !hall.preserve_layout
    ? compactPositions(rawPositions)
    : Object.fromEntries(allMachines(floor).map(machine => [String(machine.number), [...machine.position]]));
  const islandByNumber = new Map();
  for (const island of floor.islands) for (const machine of island.machines) {
    islandByNumber.set(machine.number, island.id);
  }
  return {layout, floor, positions, islandByNumber, source, fallbackReason};
}
