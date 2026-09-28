import fs from 'node:fs/promises';
import path from 'node:path';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
export const date = new Date().toISOString();
export function vision(storeId = 'fixture-hall') {
  return {schemaVersion: 1, storeId, modelConfidence: 0.88, floors: [{id: 'slot-floor', width: 200, height: 100,
    category: 'slot', rentalType: '46枚', modelConfidence: 0.9, islands: [{id: 'island-1', shape: 'line',
      geometry: {x: 10, y: 10, width: 60, height: 20, rotation: 0}, estimatedMachineCount: 2,
      sourceIds: ['map'], uncertainty: [],
      modelConfidence: 0.85, machineSlots: [
        {id: 'slot-1', position: [10, 10, 20, 20], visibleNumber: 101, modelConfidence: 0.9},
        {id: 'slot-2', position: [50, 10, 20, 20], visibleNumber: 102, modelConfidence: 0.9}
      ]}]}]};
}
export async function fixture(dir, storeId = 'fixture-hall') {
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'floor.png'), png);
  await fs.writeFile(path.join(dir, 'seats.json'), JSON.stringify({seats: [{number: 101, machineName: '機種A'},
    {number: 102, machineName: '機種B'}], expectedCount: 2}));
  await fs.writeFile(path.join(dir, 'vision.json'), JSON.stringify({visionOutput: vision(storeId)}));
  const common = {observedAt: date, retrievedAt: date, floor: 'slot-floor', category: 'slot', rentalType: '46枚'};
  return {storeId, storeName: 'Fixture Hall', sources: [
    {...common, sourceId: 'map', sourceType: 'store-official', sourceUrl: 'https://example.org/floor',
      localArtifactPath: 'floor.png', structuredFacts: {imageQuality: 0.95}},
    {...common, sourceId: 'roster', sourceType: 'min-repo', sourceUrl: 'https://min-repo.com/example/',
      localArtifactPath: 'seats.json'},
    {...common, sourceId: 'observation', sourceType: 'mock-observation', sourceUrl: null,
      localArtifactPath: 'vision.json'}
  ]};
}
