// Read-only bridge for the published seat list and positions map. In particular,
// a collection of nearby rectangles is not evidence of an island boundary.
export function fromLegacyHall(hall, positions) {
  if (!hall || typeof hall !== 'object' || typeof hall.id !== 'string' || !Array.isArray(hall.seats)) {
    throw new TypeError('Invalid legacy hall data');
  }
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
    throw new TypeError('Invalid legacy positions data');
  }
  const seats = new Map();
  for (const seat of hall.seats) {
    if (!Number.isSafeInteger(seat?.seat) || seat.seat < 1 || seats.has(seat.seat)) {
      throw new TypeError(`Invalid or duplicate legacy seat: ${seat?.seat}`);
    }
    seats.set(seat.seat, seat);
  }
  const machines = [];
  for (const [key, raw] of Object.entries(positions)) {
    const number = Number(key);
    if (!Number.isSafeInteger(number) || number < 1 || String(number) !== key || !Array.isArray(raw) || raw.length !== 4 || !raw.every(Number.isFinite)) {
      throw new TypeError(`Invalid legacy position: ${key}`);
    }
    const seat = seats.get(number);
    // An orphan position still represents a real rectangle and must not vanish.
    machines.push({
      id: `seat:${number}`,
      number,
      machineName: seat ? seat.machine ?? null : null,
      position: [...raw],
      confidence: null
    });
  }
  for (const number of seats.keys()) {
    if (!Object.hasOwn(positions, String(number))) throw new TypeError(`Legacy seat has no position: ${number}`);
  }
  const width = Math.max(1, ...machines.map(machine => machine.position[0] + machine.position[2]));
  const height = Math.max(1, ...machines.map(machine => machine.position[1] + machine.position[3]));
  return {
    schemaVersion: 3,
    storeId: hall.id,
    storeName: typeof hall.name === 'string' ? hall.name : null,
    floors: [{
      id: 'legacy-slot',
      label: typeof hall.floor === 'string' ? hall.floor : null,
      width,
      height,
      coordinateBasis: 'legacy-position-extents',
      islands: [],
      unassignedMachines: machines,
      confidence: null
    }],
    verification: {status: 'unknown', notes: [], lastVerifiedAt: null},
    provenance: {
      sourceType: 'legacy-hall-data',
      sourceUrl: typeof hall.source?.url === 'string' && hall.source.url ? hall.source.url : null,
      observedAt: null,
      retrievedAt: null,
      sourceHash: null
    },
    generation: null,
    confidence: null
  };
}
