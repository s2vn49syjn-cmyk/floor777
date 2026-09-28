const ID = /^[a-z0-9][a-z0-9:-]*$/;
const SHAPES = new Set(['unknown', 'line', 'arc', 'circle', 'custom']);
const STATUSES = new Set(['unknown', 'generated', 'needs_review', 'validated', 'human_corrected', 'verified']);
const BASIS = new Set(['source-map', 'legacy-position-extents', 'unknown']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const CONFIDENCE_KEYS = new Set(['overall', 'geometry', 'count', 'number', 'position']);
const confidence = value => value === null || (object(value) && Object.entries(value).every(([key, score]) =>
  CONFIDENCE_KEYS.has(key) && finite(score) && score >= 0 && score <= 1));
const optionalText = value => value === undefined || value === null || typeof value === 'string';
const geometryValid = value => value === null || (object(value) && finite(value.x) && finite(value.y) &&
  ['width', 'height', 'size', 'pitch', 'radius'].every(key => value[key] === undefined || (finite(value[key]) && value[key] > 0)) &&
  ['rotation', 'sweep'].every(key => value[key] === undefined || finite(value[key])) && optionalText(value.side) &&
  (value.points === undefined || (Array.isArray(value.points) && value.points.every(point =>
    Array.isArray(point) && point.length === 4 && point.every(finite) && point[2] > 0 && point[3] > 0))));

function overlapArea(a, b) {
  return Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
}

// The report is independent of the UI and can be consumed by the future editor.
// Warnings do not make a layout invalid; errors do.
export function validateLayout(layout, {referenceNumbers = null} = {}) {
  const diagnostics = [];
  const emit = (code, severity, message, ids = {}) => diagnostics.push({code, severity, message, storeId: layout?.storeId ?? null, floorId: null, islandId: null, machineId: null, ...ids});
  const schema = (message, ids) => emit('schema_invalid', 'error', message, ids);
  if (!object(layout)) {
    schema('Layout must be an object');
    return {valid: false, diagnostics};
  }
  if (layout.schemaVersion !== 3) schema('Unsupported schemaVersion');
  if (typeof layout.storeId !== 'string' || !ID.test(layout.storeId)) schema('Invalid storeId');
  if (!optionalText(layout.storeName)) schema('Invalid storeName');
  if (!Array.isArray(layout.floors) || !layout.floors.length) schema('At least one floor is required');
  if (!confidence(layout.confidence)) schema('Invalid store confidence');
  if (!(layout.generation === null || (object(layout.generation) &&
    ['source', 'version', 'generatedAt'].every(key => typeof layout.generation[key] === 'string')))) schema('Invalid generation metadata');
  if (!object(layout.verification) || !STATUSES.has(layout.verification.status) || !Array.isArray(layout.verification.notes) ||
    !layout.verification.notes.every(note => typeof note === 'string') ||
    (layout.verification.lastVerifiedAt !== null && typeof layout.verification.lastVerifiedAt !== 'string')) schema('Invalid verification');
  if (!object(layout.provenance) || !['sourceType', 'sourceUrl', 'observedAt', 'retrievedAt', 'sourceHash'].every(key =>
    layout.provenance[key] === null || typeof layout.provenance[key] === 'string')) schema('Invalid provenance');
  if (!Array.isArray(layout.floors)) return {valid: false, diagnostics};

  const ids = new Set();
  const numbers = new Map();
  const allMachines = [];
  for (const floor of layout.floors) {
    const floorId = floor?.id ?? null;
    const ctx = {floorId};
    if (!object(floor) || typeof floor.id !== 'string' || !ID.test(floor.id) || !optionalText(floor.label) || !finite(floor.width) || floor.width <= 0 ||
      !finite(floor.height) || floor.height <= 0 || !BASIS.has(floor.coordinateBasis) || !Array.isArray(floor.islands) ||
      !Array.isArray(floor.unassignedMachines) || !confidence(floor.confidence)) {
      schema('Invalid floor structure', ctx);
      continue;
    }
    if (ids.has(`floor:${floor.id}`)) emit('id_duplicate', 'error', `Duplicate floor ID ${floor.id}`, ctx);
    ids.add(`floor:${floor.id}`);
    const floorMachines = [];
    const groups = [{id: null, machines: floor.unassignedMachines}];
    for (const island of floor.islands) {
      const islandId = island?.id ?? null;
      const islandCtx = {floorId, islandId};
      if (!object(island) || typeof island.id !== 'string' || !ID.test(island.id) || !SHAPES.has(island.shape) ||
        !geometryValid(island.geometry) ||
        (island.shape !== 'unknown' && island.geometry === null) ||
        !Number.isInteger(island.machineCount) || island.machineCount < 0 ||
        !Array.isArray(island.machines) || !confidence(island.confidence)) {
        schema('Invalid island structure', islandCtx);
        continue;
      }
      if (ids.has(`island:${floor.id}:${island.id}`)) emit('id_duplicate', 'error', `Duplicate island ID ${island.id}`, islandCtx);
      ids.add(`island:${floor.id}:${island.id}`);
      if (island.machineCount !== island.machines.length) emit('machine_count_mismatch', 'error', `Island count ${island.machineCount} differs from ${island.machines.length} frames`, islandCtx);
      groups.push({id: island.id, machines: island.machines});
    }
    for (const group of groups) {
      for (const machine of group.machines) {
        const machineId = machine?.id ?? null;
        const machineCtx = {floorId, islandId: group.id, machineId};
        if (!object(machine) || typeof machine.id !== 'string' || !ID.test(machine.id) ||
          !(machine.number === null || (Number.isSafeInteger(machine.number) && machine.number > 0)) ||
          !(machine.machineName === null || typeof machine.machineName === 'string') ||
          !Array.isArray(machine.position) || machine.position.length !== 4 || !machine.position.every(finite) ||
          !confidence(machine.confidence)) {
          schema('Invalid machine structure', machineCtx);
          continue;
        }
        if (ids.has(`machine:${machine.id}`)) emit('id_duplicate', 'error', `Duplicate machine ID ${machine.id}`, machineCtx);
        ids.add(`machine:${machine.id}`);
        if (machine.number === null) emit('number_missing', 'warning', 'Machine number is unknown', machineCtx);
        else if (numbers.has(machine.number)) emit('number_duplicate', 'error', `Duplicate machine number ${machine.number}`, machineCtx);
        else numbers.set(machine.number, machineCtx);
        const p = machine.position;
        if (p[2] <= 0 || p[3] <= 0 || p[0] < 0 || p[1] < 0 || p[0] + p[2] > floor.width + 1e-6 || p[1] + p[3] > floor.height + 1e-6) {
          emit('position_out_of_bounds', 'error', 'Machine frame is outside floor bounds', machineCtx);
        }
        if (p[2] < 4 || p[3] < 4 || p[2] > 300 || p[3] > 300 || Math.max(p[2] / p[3], p[3] / p[2]) > 10) {
          emit('size_unusual', 'warning', 'Machine frame size is unusual', machineCtx);
        }
        floorMachines.push({machine, islandId: group.id, ctx: machineCtx});
      }
    }
    // Spatial sweep: compare only rectangles whose horizontal ranges can touch.
    floorMachines.sort((a, b) => a.machine.position[0] - b.machine.position[0]);
    for (let i = 0; i < floorMachines.length; i++) {
      const a = floorMachines[i], p = a.machine.position;
      for (let j = i + 1; j < floorMachines.length && floorMachines[j].machine.position[0] < p[0] + p[2]; j++) {
        const b = floorMachines[j], q = b.machine.position;
        if (p.every((value, index) => value === q[index])) emit('coordinate_duplicate', 'error', `Same rectangle as ${a.machine.id}`, b.ctx);
        const ratio = overlapArea(p, q) / Math.min(p[2] * p[3], q[2] * q[3]);
        if (ratio > 0.2) {
          emit('machine_overlap', 'warning', `Machine frames overlap (${a.machine.id}, ${b.machine.id})`, b.ctx);
          if (a.islandId !== null && b.islandId !== null && a.islandId !== b.islandId) {
            emit('island_overlap', 'warning', `Island frames overlap (${a.islandId}, ${b.islandId})`, b.ctx);
          }
        }
      }
    }
    allMachines.push(...floorMachines);
  }
  if (referenceNumbers !== null) {
    const expected = Array.isArray(referenceNumbers) ? referenceNumbers : null;
    if (!expected || expected.some(value => !Number.isSafeInteger(value) || value < 1) || new Set(expected).size !== expected.length) {
      schema('referenceNumbers must be a unique positive-integer array');
    } else {
      for (const number of expected) if (!numbers.has(number)) emit('reference_number_missing', 'error', `Reference number ${number} is not placed`);
      const expectedSet = new Set(expected);
      for (const [number, ctx] of numbers) if (!expectedSet.has(number)) emit('reference_number_extra', 'error', `Placed number ${number} is absent from reference`, ctx);
    }
  }
  return {valid: !diagnostics.some(item => item.severity === 'error'), diagnostics, machineCount: allMachines.length};
}
