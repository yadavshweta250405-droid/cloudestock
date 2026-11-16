import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../frontend/js/three/layout.js';

test('rack placements: unique, inside their areas, aisles are free of racks', () => {
  const sections = [{ id: 1, zone: 'indoor' }, { id: 2, zone: 'indoor' }, { id: 3, zone: 'outdoor' }];
  const seen = new Set();
  for (const s of sections) {
    const slot = L.sectionSlot(sections, s);
    const rows = slot === 'outdoor' ? 2 : 3;
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= 4; c++) {
      const p = L.rackPlacement({ row: r, col: c }, slot);
      const key = `${p.x},${p.z}`; assert.ok(!seen.has(key), 'duplicate ' + key); seen.add(key);
      if (!p.outdoor) { assert.ok(p.x - 2.2 >= L.HALL.x0 + L.HALL.thick && p.x + 2.2 <= L.HALL.x1, 'inside hall x'); assert.ok(p.z - 0.75 > L.HALL.z0); assert.ok(p.z < L.HALL.z1 - 4); }
      else assert.ok(p.x - 2.2 > L.OFFICE.x1 + 3, 'yard clear of office');
      assert.ok(Math.abs(p.aisleZ - p.z) >= 2, 'aisle is clear of the rack');
    }
  }
  assert.equal(seen.size, 32);
  assert.equal(L.sectionSlot(sections, sections[1]), 'indoor1');
});
test('cross aisle (x=-18) separates the two halls and truck/dock geometry fits', () => {
  assert.ok(L.rackCols('indoor0').at(-1) + 2.2 < L.CROSS_X - 1 && L.rackCols('indoor1')[0] - 2.2 > L.CROSS_X + 1);
  L.DOCK_X.forEach((x) => assert.ok(x > L.HALL.x0 && x < L.HALL.x1));
  assert.ok(L.TRUCK_DOCK_Z - 4.5 > L.WALK_Z + 1, 'walkway stays clear of docked trucks');
  assert.ok(L.parkingSpot(7).x < L.PARKING.waitX);
});
test('pallet positions: 6 distinct slots; box counts scale with quantity', () => {
  const pos = new Set([0, 1, 2, 3, 4, 5].map((i) => JSON.stringify(L.palletOffset(i))));
  assert.equal(pos.size, 6);
  assert.equal(L.boxesForQty(1), 1); assert.equal(L.boxesForQty(100), 4); assert.equal(L.boxesForQty(200), 8); assert.equal(L.boxesForQty(999), 8);
});
test('walk graph: everything is reachable from the office door and routes avoid teleporting', () => {
  const g = L.buildWalkGraph();
  for (const id of g.nodes.keys()) assert.ok(g.path('officeDoor', id), `unreachable ${id}`);
  const rack = L.rackPlacement({ row: 1, col: 4 }, 'indoor1');
  const to = g.nearest(rack.approach.x, rack.approach.z);
  assert.equal(g.nodes.get(to).x, rack.approach.x);
  const p = g.path('officeDoor', to);
  assert.ok(p.includes('walk3') && p.includes('in3'), 'enters the hall through a dock door');
  let prev = null; for (const pt of g.points(p)) { if (prev) assert.ok(Math.hypot(pt.x - prev.x, pt.z - prev.z) < 30, 'no huge jumps'); prev = pt; }
  const yard = g.nearest(L.rackPlacement({ row: 2, col: 3 }, 'outdoor').approach.x, L.YARD_AISLE_Z);
  assert.ok(g.path('walk0', yard).includes('yardGate'));
});
test('road graph: parked -> dock -> out onto the road; in from the east -> parking; one-way lanes', () => {
  const g = L.buildRoadGraph();
  const toDock = g.path('slot3', 'dock1'); assert.ok(toDock && toDock.includes('yl:-21'));
  const leave = g.path('dock1', 'outE'); assert.ok(leave.includes('outW'));
  const back = g.path('inE', 'slot5'); assert.ok(back && back.includes('inRamp'));
  assert.equal(g.path('outE', 'outW'), null, 'road is one-way');
  assert.equal(g.path('inRamp', 'inE'), null);
  for (let s = 0; s < L.PARKING.slots; s++) assert.ok(g.path('wait', `slot${s}`));
  assert.ok(g.path('inE', 'wait'));
});
