import fs from 'node:fs/promises';
import path from 'node:path';
import {checkLayoutSchema} from '../publish-workflow/schema-check.mjs';
import {validateLayout} from '../layout-validator.mjs';
import {sourceReadiness} from './evidence.mjs';

const exists = file => fs.access(file).then(() => true, () => false);
const allMachines = layout => layout.floors.flatMap(floor => [...floor.unassignedMachines, ...floor.islands.flatMap(island => island.machines)]);
const sorted = numbers => [...numbers].sort((a, b) => a - b);

export async function validateRolloutDraft(root, record, layout, audit = null, {reviewed = false} = {}) {
  const blockedReasons = [], warnings = [];
  const schema = checkLayoutSchema(layout);
  if (!schema.valid) return {status: 'blocked', blockedReasons: schema.errors, warnings, diagnostics: [], unresolvedCount: 0, existingDiff: null};
  if (layout.storeId !== record.hallId) blockedReasons.push('store_id_mismatch');
  if (layout.floors.length !== 1) blockedReasons.push('unsupported_multi_floor');
  const readiness = sourceReadiness(record);
  blockedReasons.push(...readiness.reasons);
  if (!layout.provenance?.sourceType || !layout.provenance?.sourceHash || !layout.provenance?.observedAt) blockedReasons.push('provenance_incomplete');
  if (audit?.sourceHashes?.length && !audit.sourceHashes.some(item => item.contentHash === layout.provenance.sourceHash)) {
    blockedReasons.push('provenance_hash_mismatch');
  }
  const hallFile = path.join(root, 'data', `${record.hallId}.json`);
  const hall = await exists(hallFile) ? JSON.parse(await fs.readFile(hallFile, 'utf8')) : null;
  const referenceNumbers = hall?.seats?.map(seat => seat.seat) ?? null;
  const validation = validateLayout(layout, {referenceNumbers});
  for (const diagnostic of validation.diagnostics) {
    if (diagnostic.severity === 'error') blockedReasons.push(diagnostic.code);
    else warnings.push(diagnostic.code);
  }
  const placed = allMachines(layout);
  const unknownNumbers = placed.filter(machine => machine.number === null).length;
  if (unknownNumbers) warnings.push('unresolved_machine_numbers');
  const notes = layout.verification?.notes ?? [];
  const auditNotes = audit?.reasons ?? [];
  const unresolvedCount = unknownNumbers + (reviewed ? 0 : notes.length + auditNotes.length);
  if (unresolvedCount) warnings.push('unresolved_notes');
  let existingDiff = null;
  if (hall) {
    const expected = new Set(referenceNumbers);
    const actual = new Set(placed.map(machine => machine.number).filter(number => number !== null));
    const addedNumbers = sorted([...actual].filter(number => !expected.has(number)));
    const missingNumbers = sorted([...expected].filter(number => !actual.has(number)));
    existingDiff = {expectedSeatCount: hall.seats.length, layoutSeatCount: placed.length,
      seatCountDifference: placed.length - hall.seats.length, addedNumbers, missingNumbers,
      movedSeats: null, maxCoordinateDistance: null};
    if (existingDiff.seatCountDifference || addedNumbers.length || missingNumbers.length) blockedReasons.push('existing_number_set_mismatch');
    const positionName = record.hallId === 'hyper-arrow-mihara' ? 'mihara' : record.hallId;
    const positionsFile = path.join(root, 'data', `positions-${positionName}.json`);
    if (await exists(positionsFile)) {
      const positions = JSON.parse(await fs.readFile(positionsFile, 'utf8'));
      const distances = placed.filter(machine => machine.number !== null && positions[String(machine.number)]).map(machine => {
        const old = positions[String(machine.number)], next = machine.position;
        return Math.hypot(old[0] - next[0], old[1] - next[1], old[2] - next[2], old[3] - next[3]);
      });
      existingDiff.movedSeats = distances.filter(value => value > 0.01).length;
      existingDiff.maxCoordinateDistance = distances.length ? Math.max(...distances) : null;
      if (existingDiff.movedSeats) warnings.push('existing_position_difference');
      if (existingDiff.movedSeats > hall.seats.length * 0.2) blockedReasons.push('large_existing_position_change');
    }
  }
  const status = blockedReasons.length ? 'blocked' : warnings.length ? 'needs_review' : 'validated';
  return {status, blockedReasons: [...new Set(blockedReasons)], warnings: [...new Set(warnings)],
    diagnostics: validation.diagnostics, unresolvedCount, existingDiff,
    machineCount: placed.length, islandCount: layout.floors.reduce((sum, floor) => sum + floor.islands.length, 0)};
}
