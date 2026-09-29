import assert from 'node:assert/strict';
import {normalizeFloorLink, chooseSlotFloorLink, chooseInlineFloorImage} from '../tools/nationwide/source-browser-collector.mjs';

const base = 'https://www.p-world.co.jp/hall/floor_maps/59fe3ef3f46e';
assert.equal(normalizeFloorLink(`${base}?map_id=2`), `${base}?map_id=2`);
assert.equal(normalizeFloorLink('https://example.com/floor_maps/nope'), null);
assert.equal(normalizeFloorLink('http://www.p-world.co.jp/hall/floor_maps/nope'), null);

const jump = 'https://www.p-world.co.jp/jump.cgi?url=https%3A%2F%2Fwww.maruhan.co.jp%2Fparts%2Fhall%2F1865%2Ffloor.png%3Fsize%3Dorigin';
assert.equal(normalizeFloorLink(jump), 'https://www.maruhan.co.jp/parts/hall/1865/floor.png?size=origin');

assert.equal(chooseSlotFloorLink([
  `${base}?map_id=1`, base, `${base}?map_id=2`,
  `${base}?machine_id=123&input_price=100`
]), `${base}?map_id=2`);

assert.equal(chooseSlotFloorLink([
  base, jump
]), 'https://www.maruhan.co.jp/parts/hall/1865/floor.png?size=origin');

assert.equal(chooseSlotFloorLink([base]), base);
assert.equal(chooseSlotFloorLink([]), null);
assert.deepEqual(chooseInlineFloorImage(1000, [
  {index: 2, y: 900, width: 300, height: 300},
  {index: 7, y: 1150, width: 640, height: 450},
  {index: 9, y: 1400, width: 640, height: 900}
]), {index: 7, y: 1150, width: 640, height: 450});
assert.equal(chooseInlineFloorImage(null, []), null);

console.log('PASS: rendered source collector selects slot smart-floor links and safely unwraps P-WORLD jump targets');
