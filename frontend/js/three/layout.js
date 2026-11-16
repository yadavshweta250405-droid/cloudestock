// World layout (metres). Pure data + functions, no WebGL: unit-tested in tests/layout.test.js.
// Camera looks from +x/+z towards the origin, so the dock-side (z = +10) faces the viewer like in the reference video.
export const DOCK_X = [-31, -21, -11, -1];     // centre of each loading door on the hall's front wall
export const HALL = { x0: -38, x1: 2, z0: -20, z1: 10, wall: 6, thick: 0.5 };
export const OFFICE = { x0: 14, x1: 30, z0: -2, z1: 10, h: 7.5, doorX: 22 };
export const WALK_Z = 11.7;                    // pedestrian walkway in front of the docks
export const TRUCK_DOCK_Z = 17.75;             // centre of a truck backed up to a dock
export const LANES = { yard: 28.5, out: 34.5, in: 39.5, roadCenter: 37, roadWidth: 13 };
export const RACK = { len: 4.4, depth: 1.5, h: 4.2, pitch: 4.4 };
export const PALLET = { len: 1.8, depth: 1.1, maxUnits: 200, maxBoxes: 8 };
export const PARKING = { x0: 14, step: 5.5, z: 22.5, slots: 8, waitX: 58 };
export const ROAD_END = { west: -80, east: 80 };

const COL0 = { indoor0: -35, indoor1: -14.2, outdoor: 38.2 };
const ROW_Z = { indoor: (r) => -16 + (r - 1) * 5, outdoor: (r) => -2 + (r - 1) * 8 };
export const AISLE_Z = { 1: -13.5, 2: -8.5, 3: -3.5 };   // walking line in front of each indoor row
export const YARD_AISLE_Z = 2;
export const CROSS_X = -18;

/** Which physical area a section occupies: the 3D building has two indoor halls and one outdoor yard. */
export function sectionSlot(sections, section) {
  if (section.zone === 'outdoor') return 'outdoor';
  const indoor = sections.filter((s) => s.zone === 'indoor').sort((a, b) => a.id - b.id);
  return `indoor${Math.min(1, indoor.findIndex((s) => s.id === section.id))}`;
}

export function rackPlacement(rack, slot) {
  const outdoor = slot === 'outdoor';
  const x = COL0[slot] + (rack.col - 1) * RACK.pitch;
  const z = outdoor ? ROW_Z.outdoor(rack.row) : ROW_Z.indoor(rack.row);
  const aisleZ = outdoor ? YARD_AISLE_Z : AISLE_Z[rack.row];
  return { x, z, aisleZ, approach: { x, z: aisleZ }, outdoor };
}

/** Pallet position i (0..5) inside a rack: 2 bays across, 3 levels up. Offsets are relative to the rack centre. */
export function palletOffset(i) {
  const bay = i % 2; const level = Math.floor(i / 2);
  return { x: (bay - 0.5) * 2.2, y: 0.28 + level * 1.3, z: 0 };
}
export const boxesForQty = (q) => Math.max(1, Math.min(PALLET.maxBoxes, Math.ceil((q / PALLET.maxUnits) * PALLET.maxBoxes)));
export const parkingSpot = (slot) => ({ x: PARKING.x0 + slot * PARKING.step, z: PARKING.z });
export const dockSpot = (i) => ({ x: DOCK_X[i], z: TRUCK_DOCK_Z });
export const officeDoor = () => ({ x: OFFICE.doorX, z: WALK_Z });

// ---------------------------------------------------------------------------------------------- graphs
export class Graph {
  constructor() { this.nodes = new Map(); this.adj = new Map(); }
  node(id, x, z) { this.nodes.set(id, { id, x, z }); if (!this.adj.has(id)) this.adj.set(id, []); return id; }
  edge(a, b, directed = false) {
    if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error(`edge ${a}->${b}: unknown node`);
    this.adj.get(a).push(b);
    if (!directed) this.adj.get(b).push(a);
  }
  chain(ids, directed = false) { for (let i = 0; i < ids.length - 1; i++) this.edge(ids[i], ids[i + 1], directed); }
  dist(a, b) { const p = this.nodes.get(a); const q = this.nodes.get(b); return Math.hypot(p.x - q.x, p.z - q.z); }
  nearest(x, z) {
    let best = null; let bd = Infinity;
    for (const n of this.nodes.values()) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n.id; } }
    return best;
  }
  /** Dijkstra over (possibly directed) edges. Returns node ids or null. */
  path(from, to) {
    if (from === to) return [from];
    const dist = new Map([[from, 0]]); const prev = new Map(); const open = new Set([from]);
    while (open.size) {
      let cur = null; let cd = Infinity;
      for (const id of open) { const d = dist.get(id); if (d < cd) { cd = d; cur = id; } }
      open.delete(cur);
      if (cur === to) break;
      for (const nx of this.adj.get(cur) || []) {
        const nd = cd + this.dist(cur, nx);
        if (nd < (dist.get(nx) ?? Infinity)) { dist.set(nx, nd); prev.set(nx, cur); open.add(nx); }
      }
    }
    if (!prev.has(to)) return null;
    const out = [to]; while (out[0] !== from) out.unshift(prev.get(out[0]));
    return out;
  }
  points(ids) { return ids.map((id) => ({ x: this.nodes.get(id).x, z: this.nodes.get(id).z })); }
}

export const rackCols = (slot) => [0, 1, 2, 3].map((c) => COL0[slot] + c * RACK.pitch);

/** Pedestrian graph: dock walkway, door crossings, hall aisles, office, break area and the yard racks. */
export function buildWalkGraph() {
  const g = new Graph();
  const walk = DOCK_X.map((x, i) => g.node(`walk${i}`, x, WALK_Z));
  const mid = g.node('walkMid', 8, WALK_Z); const od = g.node('officeDoor', OFFICE.doorX, WALK_Z);
  const brk = g.node('break', 27, WALK_Z + 1); const gate = g.node('yardGate', 34, WALK_Z);
  g.chain([...walk, mid, od, brk, gate]);
  // through the dock doors and along the staging line inside the hall
  const inside = DOCK_X.map((x, i) => g.node(`in${i}`, x, 4));
  const crossIn = g.node('crossIn', CROSS_X, 4);
  DOCK_X.forEach((_, i) => g.edge(walk[i], inside[i]));
  g.chain([inside[0], inside[1], crossIn, inside[2], inside[3]]);
  // aisles in front of each indoor rack row, joined by the cross aisle between the two halls
  const cross = [crossIn];
  for (const row of [1, 2, 3]) {
    const z = AISLE_Z[row];
    const ids = [...rackCols('indoor0').map((x) => g.node(`ai${row}:${x}`, x, z)), g.node(`ai${row}:x`, CROSS_X, z), ...rackCols('indoor1').map((x) => g.node(`ai${row}:${x}`, x, z))];
    g.chain(ids);
    cross.push(`ai${row}:x`);
  }
  g.chain([cross[0], cross[3], cross[2], cross[1]]);   // z = 4, -3.5, -8.5, -13.5 ordered by row 3,2,1
  // yard
  const yAisle = g.node('yardAisle0', 34, YARD_AISLE_Z);
  g.edge(gate, yAisle);
  g.chain([yAisle, ...rackCols('outdoor').map((x) => g.node(`yard:${x}`, x, YARD_AISLE_Z))]);
  return g;
}

/** Vehicle graph: yard lane in front of the docks/parking, ramps, and the one-way road. */
export function buildRoadGraph() {
  const g = new Graph();
  const lane = LANES.yard;
  const xs = new Set([-58, 62, PARKING.waitX, ...DOCK_X]);
  for (let s = 0; s < PARKING.slots; s++) xs.add(parkingSpot(s).x);
  const sorted = [...xs].sort((a, b) => a - b);
  const laneIds = sorted.map((x) => g.node(`yl:${x}`, x, lane));
  g.chain(laneIds);
  DOCK_X.forEach((x, i) => { g.node(`dock${i}`, x, TRUCK_DOCK_Z); g.edge(`yl:${x}`, `dock${i}`); });
  for (let s = 0; s < PARKING.slots; s++) { const p = parkingSpot(s); g.node(`slot${s}`, p.x, p.z); g.edge(`yl:${p.x}`, `slot${s}`); }
  g.node('wait', PARKING.waitX, PARKING.z); g.edge(`yl:${PARKING.waitX}`, 'wait');
  // one-way road: leave via the west ramp onto the outbound lane; come back on the inbound lane to the east ramp
  g.node('outW', -58, LANES.out); g.node('outE', ROAD_END.east, LANES.out);
  g.edge('yl:-58', 'outW', true); g.edge('outW', 'outE', true);
  g.node('inE', ROAD_END.east, LANES.in); g.node('inRamp', 62, LANES.in);
  g.edge('inE', 'inRamp', true); g.edge('inRamp', 'yl:62', true);
  return g;
}
