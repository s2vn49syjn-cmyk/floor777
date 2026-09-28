const clamp = value => Math.max(0, Math.min(1, value));
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const score = (a, b) => 1 - Math.abs(a - b) / Math.max(a, b, 1);

export function scoreConfidence(bundle, observation, reconciliation, validation) {
  const model = observation.modelConfidence;
  const allFloors = observation.floors;
  const slotCount = allFloors.reduce((sum, floor) => sum + floor.islands.reduce((n, island) => n + island.machineSlots.length, 0), 0);
  const countValues = [...reconciliation.floors.values()].filter(floor => floor.expectedCount !== null).map(floor => score(floor.slotCount, floor.expectedCount));
  const countAgreement = average(countValues);
  const numberValues = [...reconciliation.floors.values()].filter(floor => floor.referenceNumbers.length).map(floor =>
    floor.visible.filter(number => floor.referenceNumbers.includes(number)).length / Math.max(floor.slotCount, 1));
  const visibleNumberAgreement = average(numberValues);
  const quality = average(bundle.sources.map(source => source.structuredFacts.imageQuality).filter(value => value !== null));
  // Numbering errors are reviewed separately; they do not make sound geometry score zero.
  const spatialCodes = new Set(['position_out_of_bounds', 'coordinate_duplicate', 'size_unusual', 'machine_overlap', 'island_overlap']);
  const spatialFindings = validation.diagnostics.filter(item => spatialCodes.has(item.code));
  const geometryValidation = spatialFindings.some(item => item.severity === 'error') ? 0 :
    clamp(1 - spatialFindings.length / Math.max(slotCount, 1));
  const newest = Math.max(...bundle.sources.map(source => Date.parse(source.observedAt)));
  const freshness = clamp(1 - Math.max(0, Date.now() - newest) / (180 * 86400000));
  const categoryAgreement = reconciliation.blockers.some(item => item.includes('貸出区分')) ? 0 : 1;
  const structuredSources = bundle.sources.filter(source => source.structuredFacts.seats.length || source.structuredFacts.expectedCount !== null);
  const sourceAgreement = structuredSources.length < 2 ? null :
    reconciliation.issues.some(item => item.includes('構造化資料同士')) ? 0.5 : 1;
  const factors = {model, sourceAgreement, seatCountAgreement: countAgreement,
    visibleNumberAgreement, geometryValidation, sourceFreshness: freshness,
    categoryRentalAgreement: categoryAgreement, imageQuality: quality};
  const available = Object.values(factors).filter(value => value !== null);
  let overall = average(available) ?? 0;
  if (visibleNumberAgreement === null || visibleNumberAgreement < 1) overall = Math.min(overall, 0.65);
  if (quality === null) overall = Math.min(overall, 0.7);
  return {factors, overall: Math.round(clamp(overall) * 1000) / 1000,
    geometry: Math.round(clamp(average([model, geometryValidation, quality].filter(value => value !== null)) ?? 0) * 1000) / 1000,
    count: countAgreement, number: visibleNumberAgreement, position: model === null ? null : Math.round(clamp(model * (quality ?? 0.5)) * 1000) / 1000};
}
