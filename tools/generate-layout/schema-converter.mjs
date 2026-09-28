import {materializePlaceholders} from './placeholders.mjs';

export function toLayoutV3(bundle, observation, reconciliation, provider, version, now = new Date().toISOString()) {
  // The vision provider observes fractions of the source map. The editor uses
  // fixed logical units, not source-image pixels, so scale only at this edge.
  const scale = provider.coordinateSpace === 'normalized' ? 1000 : 1;
  const position = point => point.map(value => value * scale);
  const geometry = value => value === null ? null : Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'points' ? item.map(position) : ['x', 'y', 'width', 'height', 'size', 'pitch', 'radius'].includes(key) ? item * scale : item]));
  const primary = bundle.sources.find(source => ['png', 'jpeg', 'pdf'].includes(source.format)) ?? bundle.sources[0];
  const floors = observation.floors.map(floor => {
    const {roster, referenceNumbers} = reconciliation.floors.get(floor.id);
    return {id: floor.id, label: `${floor.category} / ${floor.rentalType}`, width: floor.width * scale, height: floor.height * scale,
      coordinateBasis: 'source-map', confidence: floor.modelConfidence === null ? null : {overall: floor.modelConfidence},
      unassignedMachines: [], islands: floor.islands.map(island => ({
        id: island.id, label: null, shape: island.shape, geometry: geometry(island.geometry),
        machineCount: island.estimatedMachineCount,
        confidence: island.modelConfidence === null ? null : {overall: island.modelConfidence},
        machines: island.machineSlots.map(slot => ({id: `${island.id}:${slot.id}`,
          number: slot.visibleNumber, machineName: slot.visibleMachineName?.trim() ||
            (slot.visibleNumber === null ? null : roster.get(slot.visibleNumber) ?? null),
          position: position(slot.position), confidence: slot.modelConfidence === null ? null : {position: slot.modelConfidence,
            number: slot.visibleNumber === null ? 0 : referenceNumbers.length ? Number(roster.has(slot.visibleNumber)) : slot.modelConfidence}}))
      }))};
  });
  return materializePlaceholders({schemaVersion: 3, storeId: bundle.storeId, storeName: bundle.storeName, floors,
    verification: {status: reconciliation.issues.length ? 'needs_review' : 'generated',
      notes: reconciliation.issues, lastVerifiedAt: null},
    generation: {source: 'ai', version, generatedAt: now},
    provenance: {sourceType: primary.sourceType, sourceUrl: primary.sourceUrl,
      observedAt: primary.observedAt, retrievedAt: primary.retrievedAt, sourceHash: primary.contentHash},
    confidence: null, review: {originalSourceType: 'ai', humanModified: false, modifiedAt: null}}).layout;
}
