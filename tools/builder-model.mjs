import {validateLayout} from './layout-validator.mjs';
// Preserve the historical geometry/export API for existing builder tests and
// old project files. ReviewSession below is the schema v3 editing authority.
export * from './builder-legacy-model.mjs';

// Review operations work on schemaVersion 3 only. Source files and the original
// snapshot are never mutated; a caller must explicitly save the working copy.
export const copy = value => structuredClone(value);
const uid = prefix => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const center = position => [position[0] + position[2] / 2, position[1] + position[3] / 2];
const withCenter = (position, x, y) => [x - position[2] / 2, y - position[3] / 2, position[2], position[3]];
const moveRect = (position, dx, dy) => [position[0] + dx, position[1] + dy, position[2], position[3]];

export function findIsland(layout, islandId) {
  for (const floor of layout.floors) {
    const island = floor.islands.find(item => item.id === islandId);
    if (island) return {floor, island};
  }
  throw Error(`Island not found: ${islandId}`);
}

export function islandBounds(island) {
  const positions = island.machines.map(machine => machine.position);
  const geometry = island.geometry ?? {};
  if (!positions.length) {
    const points = Array.isArray(geometry.points) ? geometry.points : [];
    if (points.length) {
      const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
      return {x, y, width: Math.max(...points.map(p => p[0] + p[2])) - x,
        height: Math.max(...points.map(p => p[1] + p[3])) - y};
    }
    if (finite(geometry.width) && finite(geometry.height)) {
      return {x: geometry.x ?? 0, y: geometry.y ?? 0, width: geometry.width, height: geometry.height};
    }
    if (finite(geometry.radius)) {
      const size = finite(geometry.size) ? geometry.size : 0;
      return {x: (geometry.x ?? 0) - geometry.radius - size / 2,
        y: (geometry.y ?? 0) - geometry.radius - size / 2,
        width: geometry.radius * 2 + size, height: geometry.radius * 2 + size};
    }
    const size = finite(geometry.size) ? geometry.size : 20;
    return {x: (geometry.x ?? 0) - size / 2, y: (geometry.y ?? 0) - size / 2, width: size, height: size};
  }
  const x = Math.min(...positions.map(p => p[0])), y = Math.min(...positions.map(p => p[1]));
  return {x, y, width: Math.max(...positions.map(p => p[0] + p[2])) - x,
    height: Math.max(...positions.map(p => p[1] + p[3])) - y};
}

function rotateRect(position, cx, cy, degrees) {
  const [x, y] = center(position), rad = degrees * Math.PI / 180;
  const dx = x - cx, dy = y - cy;
  return withCenter(position, cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad));
}

function sampledPositions(positions, count, closed) {
  if (positions.length === 1) return Array.from({length: count}, (_, index) =>
    moveRect(positions[0], index * positions[0][2] * 1.25, 0));
  const nodes = closed ? [...positions, positions[0]] : positions;
  const centers = nodes.map(center), distance = [0];
  for (let index = 1; index < centers.length; index++) distance.push(distance.at(-1) +
    Math.hypot(centers[index][0] - centers[index - 1][0], centers[index][1] - centers[index - 1][1]));
  const total = distance.at(-1);
  return Array.from({length: count}, (_, index) => {
    const target = total * index / Math.max(1, closed ? count : count - 1);
    let next = 1;
    while (next < distance.length - 1 && distance[next] < target) next++;
    const ratio = (target - distance[next - 1]) / (distance[next] - distance[next - 1] || 1);
    const start = centers[next - 1], end = centers[next];
    return withCenter(positions[Math.min(index, positions.length - 1)],
      start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio);
  });
}

export function orderedMachines(island, {direction = 'left-right', side = 'all', ids = null} = {}) {
  if (!['left-right', 'right-left', 'top-bottom', 'bottom-top'].includes(direction)) throw Error('Invalid numbering direction');
  if (!['all', 'left', 'right', 'top', 'bottom'].includes(side)) throw Error('Invalid island side');
  const bounds = islandBounds(island), midX = bounds.x + bounds.width / 2, midY = bounds.y + bounds.height / 2;
  const allowed = ids ? new Set(ids) : null;
  const selected = island.machines.filter(machine => {
    if (allowed && !allowed.has(machine.id)) return false;
    const [x, y] = center(machine.position);
    return side === 'all' || side === 'left' && x <= midX || side === 'right' && x > midX ||
      side === 'top' && y <= midY || side === 'bottom' && y > midY;
  });
  const horizontal = direction.endsWith('right') || direction.endsWith('left');
  const sign = direction === 'left-right' || direction === 'top-bottom' ? 1 : -1;
  return selected.sort((a, b) => {
    const [ax, ay] = center(a.position), [bx, by] = center(b.position);
    return (horizontal ? sign * (ax - bx) || ay - by : sign * (ay - by) || ax - bx) || a.id.localeCompare(b.id);
  });
}

export function createIsland({shape = 'line', x = 80, y = 80, count = 8, size = 24,
  pitch = 36, rotation = 0, radius = 120, sweep = 180, label = '新しい島'} = {}) {
  if (!['line', 'arc', 'circle', 'custom'].includes(shape) || !Number.isInteger(count) || count < 1 || count > 1000 ||
    ![x, y, size, pitch, rotation, radius, sweep].every(finite) || size <= 0 || pitch <= 0 || radius <= 0) throw Error('Invalid island settings');
  const geometry = {x, y, rotation, size, pitch, radius, sweep, points: []};
  for (let index = 0; index < count; index++) {
    const degrees = shape === 'circle' ? rotation + 360 * index / count :
      shape === 'arc' ? rotation + sweep * index / Math.max(1, count - 1) : rotation;
    const radians = degrees * Math.PI / 180;
    geometry.points.push(shape === 'arc' || shape === 'circle'
      ? [x + radius * Math.cos(radians) - size / 2, y + radius * Math.sin(radians) - size / 2, size, size]
      : [x + index * pitch * Math.cos(radians), y + index * pitch * Math.sin(radians), size, size]);
  }
  return {id: uid('island'), label, shape, geometry, machineCount: count,
    machines: geometry.points.map(position => ({id: uid('machine'), number: null, machineName: null,
      position: [...position], confidence: null})), confidence: null};
}

export class ReviewSession {
  constructor(layout, {referenceNumbers = null} = {}) {
    if (layout?.schemaVersion !== 3) throw Error('Review Editor requires schemaVersion 3');
    this.original = copy(layout);
    this.layout = copy(layout);
    this.layout.review ??= {originalSourceType: layout.provenance?.sourceType ?? null, humanModified: false, modifiedAt: null};
    this.referenceNumbers = referenceNumbers;
    this.undoStack = [];
    this.redoStack = [];
  }
  get diagnostics() { return validateLayout(this.layout, {referenceNumbers: this.referenceNumbers}); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  change(action, {verification = false} = {}) {
    const before = copy(this.layout);
    try { action(this.layout); }
    catch (error) { this.layout = before; throw error; }
    if (JSON.stringify(before) === JSON.stringify(this.layout)) return false;
    this.layout.review ??= {originalSourceType: this.original.provenance?.sourceType ?? null, humanModified: false, modifiedAt: null};
    this.layout.review.humanModified = true;
    this.layout.review.modifiedAt = new Date().toISOString();
    if (!verification) {
      this.layout.verification.status = 'human_corrected';
      this.layout.verification.lastVerifiedAt = null;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }
  undo() { if (!this.canUndo) return false; this.redoStack.push(copy(this.layout)); this.layout = this.undoStack.pop(); return true; }
  redo() { if (!this.canRedo) return false; this.undoStack.push(copy(this.layout)); this.layout = this.redoStack.pop(); return true; }
  moveIsland(id, dx, dy) {
    if (![dx, dy].every(finite)) throw Error('Invalid displacement');
    return this.change(layout => {
      const {island} = findIsland(layout, id);
      island.geometry.x += dx; island.geometry.y += dy;
      if (island.geometry.points) island.geometry.points = island.geometry.points.map(p => moveRect(p, dx, dy));
      for (const machine of island.machines) machine.position = moveRect(machine.position, dx, dy);
    });
  }
  rotateIsland(id, degrees) {
    if (!finite(degrees) || Math.abs(degrees) > 360) throw Error('Rotation must be within ±360°');
    return this.change(layout => {
      const {island} = findIsland(layout, id), bounds = islandBounds(island);
      const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
      island.machines.forEach(machine => { machine.position = rotateRect(machine.position, cx, cy, degrees); });
      if (island.geometry.points) island.geometry.points = island.geometry.points.map(p => rotateRect(p, cx, cy, degrees));
      const [gx, gy] = [island.geometry.x, island.geometry.y], radians = degrees * Math.PI / 180;
      island.geometry.x = cx + (gx - cx) * Math.cos(radians) - (gy - cy) * Math.sin(radians);
      island.geometry.y = cy + (gx - cx) * Math.sin(radians) + (gy - cy) * Math.cos(radians);
      island.geometry.rotation = (island.geometry.rotation ?? 0) + degrees;
    });
  }
  scaleIsland(id, factor) {
    if (!finite(factor) || factor < 0.2 || factor > 5) throw Error('Scale must be 0.2–5');
    return this.change(layout => {
      const {island} = findIsland(layout, id), bounds = islandBounds(island);
      const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
      const scale = p => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor, p[2] * factor, p[3] * factor];
      island.machines.forEach(machine => {machine.position = scale(machine.position);});
      if (island.geometry.points) island.geometry.points = island.geometry.points.map(scale);
      island.geometry.x = cx + (island.geometry.x - cx) * factor;
      island.geometry.y = cy + (island.geometry.y - cy) * factor;
      for (const key of ['width', 'height', 'size', 'pitch', 'radius']) if (finite(island.geometry[key])) island.geometry[key] *= factor;
    });
  }
  addIsland(floorId, settings = {}) {
    const floor = this.layout.floors.find(item => item.id === floorId);
    if (!floor) throw Error(`Floor not found: ${floorId}`);
    const island = createIsland(settings);
    this.change(layout => layout.floors.find(item => item.id === floorId).islands.push(island));
    return island.id;
  }
  deleteIsland(id) {
    return this.change(layout => {const {floor} = findIsland(layout, id);
      floor.islands.splice(floor.islands.findIndex(island => island.id === id), 1);});
  }
  setMachineCount(id, count) {
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw Error('Count must be 1–1000');
    return this.change(layout => {
      const {island} = findIsland(layout, id);
      if (island.machineCount === count) return;
      const positions = sampledPositions(island.machines.map(machine => machine.position), count, island.shape === 'circle');
      const previous = island.machines;
      island.machines = positions.map((position, index) => previous[index]
        ? {...previous[index], position} : {id: uid('machine'), number: null, machineName: null, position, confidence: null});
      island.machineCount = count;
      island.geometry.points = positions.map(p => [...p]);
    });
  }
  assignSequential(id, {start, count = null, end = null, direction = 'left-right', side = 'all', ids = null, exclude = []} = {}) {
    if (!Number.isSafeInteger(start) || start < 1 || start > 99999) throw Error('Invalid start number');
    const targets = orderedMachines(findIsland(this.layout, id).island, {direction, side, ids});
    const limit = count === null ? targets.length : count;
    if (!Number.isInteger(limit) || limit < 1 || limit > targets.length) throw Error('Invalid target count');
    const omitted = new Set(exclude);
    if ([...omitted].some(number => !Number.isSafeInteger(number) || number < 1)) throw Error('Invalid excluded number');
    const step = end !== null && end < start ? -1 : 1;
    const values = [];
    for (let number = start; values.length < limit; number += step) {
      if (number < 1 || number > 99999 || Math.abs(number - start) > 3000 || end !== null && (step > 0 ? number > end : number < end)) throw Error('End number does not fit selected machines');
      if (!omitted.has(number)) values.push(number);
    }
    if (end !== null && values.at(-1) !== end) throw Error('End number does not match selected machine count');
    return this.change(layout => {
      const machines = new Map(findIsland(layout, id).island.machines.map(machine => [machine.id, machine]));
      targets.slice(0, limit).forEach((machine, index) => {machines.get(machine.id).number = values[index];});
    });
  }
  reverseNumbers(id, {direction = 'left-right', side = 'all', ids = null} = {}) {
    const targets = orderedMachines(findIsland(this.layout, id).island, {direction, side, ids});
    const values = targets.map(machine => machine.number).reverse();
    return this.change(layout => {const machines = new Map(findIsland(layout, id).island.machines.map(machine => [machine.id, machine]));
      targets.forEach((machine, index) => {machines.get(machine.id).number = values[index];});});
  }
  clearNumbers(id, ids = null) {
    return this.change(layout => {const island = findIsland(layout, id).island, selected = ids ? new Set(ids) : null;
      for (const machine of island.machines) if (!selected || selected.has(machine.id)) machine.number = null;});
  }
  setMachineNumber(machineId, number) {
    if (number !== null && (!Number.isSafeInteger(number) || number < 1 || number > 99999)) throw Error('Invalid machine number');
    return this.change(layout => {
      for (const floor of layout.floors) for (const machine of [...floor.unassignedMachines, ...floor.islands.flatMap(island => island.machines)]) {
        if (machine.id === machineId) {machine.number = number; return;}
      }
      throw Error(`Machine not found: ${machineId}`);
    });
  }
  verify() {
    const report = this.diagnostics;
    if (!report.valid || report.diagnostics.length) throw Error('Resolve all diagnostics before verification');
    this.change(layout => {layout.verification.status = 'verified'; layout.verification.lastVerifiedAt = new Date().toISOString();},
      {verification: true});
  }
}
