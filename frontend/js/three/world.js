import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as L from './layout.js';
import * as M from './models.js';
import { Mover } from './sim.js';

const FLOOR_IN = 0.2; const FLOOR_OUT = 0.1; const ROAD_Y = 0.14;
const HOME = {
  Receiving: [[L.DOCK_X[0], L.WALK_Z], [L.DOCK_X[1], L.WALK_Z]], Shipping: [[L.DOCK_X[2], L.WALK_Z], [L.DOCK_X[3], L.WALK_Z]],
  Picking: [[L.rackCols('indoor0')[1], L.AISLE_Z[2]], [L.rackCols('indoor1')[2], L.AISLE_Z[1]]], Inventory: [[L.rackCols('indoor0')[2], L.AISLE_Z[3]]],
  Maintenance: [[8, L.WALK_Z]], Management: [[L.OFFICE.doorX, L.WALK_Z]],
};
const rackColor = { empty: '#8ea8e8', ok: '#2f5bd6', near_full: '#f97316', full: '#ef4444' };
const inHall = (x, z) => x > L.HALL.x0 && x < L.HALL.x1 && z > L.HALL.z0 && z < L.HALL.z1 + 0.5;

export function createWorld(container, handlers = {}) {
  // ------------------------------------------------------------------ renderer, scene, camera
  const lowPower = Math.min(innerWidth, innerHeight) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowPower ? 1.25 : 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#dce7fb');
  const canvas = renderer.domElement; canvas.setAttribute('aria-label', '3D warehouse'); canvas.tabIndex = 0;
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dce7fb'); scene.fog = new THREE.Fog('#dce7fb', 190, 460);
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 900);
  const HOME_TARGET = new THREE.Vector3(18, 0, 6); const HOME_DIR = new THREE.Vector3(1, 0.86, 1).normalize(); const HOME_DIST = 165;
  camera.position.copy(HOME_TARGET).addScaledVector(HOME_DIR, HOME_DIST);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, rotateSpeed: 0.55, zoomSpeed: 0.9, minDistance: 18, maxDistance: 280, maxPolarAngle: 1.3, minPolarAngle: 0.25, screenSpacePanning: false });
  controls.target.copy(HOME_TARGET); controls.update();
  controls.addEventListener('change', () => { const t = controls.target; t.x = Math.max(-75, Math.min(95, t.x)); t.z = Math.max(-45, Math.min(55, t.z)); t.y = 0; });

  scene.add(new THREE.HemisphereLight('#ffffff', '#c9d6f2', 1.0));
  const sun = new THREE.DirectionalLight('#fff6e8', 1.9); sun.position.set(70, 110, 60); sun.castShadow = true;
  sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 10, far: 320 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  sun.target.position.set(8, 0, 6); scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight('#b7c7f0', 0.25));

  // ------------------------------------------------------------------ static world
  const walk = L.buildWalkGraph(); const road = L.buildRoadGraph();
  scene.add(M.buildGround());
  const hall = M.buildHall(); scene.add(hall);
  const office = M.buildOffice(); scene.add(office);
  const riverside = M.buildRiversideHub(); scene.add(riverside);
  const skybridges = M.buildConnectingBridges(); scene.add(skybridges);
  const container3 = M.buildContainer(); container3.position.set(-52, 0.1, 14); container3.rotation.y = 0.25; scene.add(container3);
  // Trees strictly along outer park perimeters and north fence (never inside buildings, parking or roads)
  const treeSpots = [
    [-60, -30], [-48, -30], [-36, -30], [-24, -30], [-12, -30], [0, -30], [12, -30], [26, -30], [40, -30], [54, -30], [68, -30], [80, -30],
    [-62, -16], [-64, 0], [-62, 14], [-72, 28],
    [84, -18], [86, -2], [84, 14], [86, 26]
  ];
  treeSpots.forEach(([x, z], i) => { const t = M.buildTree(i); t.position.set(x, 0.1, z); t.scale.setScalar(0.9 + (i % 3) * 0.12); scene.add(t); });
  // decorative stacks in dedicated staging zones
  [[-48, 8], [-44, 8], [-52, 11], [-48, 11], [74, 10], [74, 13], [74, 16]].forEach(([x, z], i) => { const s = M.buildPalletStack(4 + (i % 4), M.COLORS.wood); s.position.set(x, 0.1, z); s.rotation.y = (i % 2) * 0.4; scene.add(s); });

  const hu = hall.userData;
  const ru = riverside.userData;
  const pickables = []; // static pickable meshes
  pickables.push(
    ...M.tagEntity(hall, { type: 'warehouse', id: 1 }),
    ...M.tagEntity(riverside, { type: 'warehouse', id: 2 }),
    ...M.tagEntity(office, { type: 'office', id: 1 }),
    ...M.tagEntity(skybridges, { type: 'office', id: 1 })
  );

  // ------------------------------------------------------------------ racks (instanced frames + invisible pick boxes) and pallets (instanced)
  const MAX_RACKS = 40;
  const frameMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.25 });
  const beamMat = new THREE.MeshStandardMaterial({ color: '#f4a62a', roughness: 0.6, metalness: 0.2 });
  const uprights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 4.2, 0.15), frameMat, MAX_RACKS * 6);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.13, 0.13), beamMat, MAX_RACKS * 8);
  const BIG = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 900);
  const inst = (mesh, count) => { mesh.count = count; mesh.frustumCulled = false; mesh.boundingSphere = BIG.clone(); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
  [uprights, beams].forEach((m) => { inst(m, 0); scene.add(m); });
  const MAX_PAL = MAX_RACKS * 6;
  const palBase = inst(new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.15, 1.1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), MAX_PAL), 0);
  const palBox = inst(new THREE.InstancedMesh(new RoundedBoxGeometry(0.82, 0.48, 0.52, 2, 0.05), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), MAX_PAL * 8), 0);
  const palTag = inst(new THREE.InstancedMesh(new THREE.BoxGeometry(0.58, 0.07, 0.34), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), MAX_PAL), 0);
  palTag.castShadow = false; scene.add(palBase, palBox, palTag);
  const rackPick = new THREE.Group(); scene.add(rackPick);
  const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const rackPickGeo = new THREE.BoxGeometry(4.5, 4.4, 1.7);
  const sectionSprites = new Map(); const warnSprites = new Map(); const beacons = [];
  const placeOf = new Map(); let rackSig = ''; let palletMap = []; let boxOwner = []; let baseOwner = []; let tagOwner = []; let prevQty = new Map();
  const fx = [];
  const tmpM = new THREE.Matrix4(); const tmpC = new THREE.Color(); const q0 = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);

  function rebuildRacks(data) {
    rackPick.children.slice().forEach((c) => rackPick.remove(c));
    for (const s of sectionSprites.values()) scene.remove(s); sectionSprites.clear();
    for (const s of warnSprites.values()) scene.remove(s); warnSprites.clear();
    for (let i = pickables.length - 1; i >= 0; i--) if (pickables[i].userData.entity?.type === 'rackbox' || pickables[i].userData.entity?.type === 'section') pickables.splice(i, 1);
    placeOf.clear();
    const secById = new Map(data.sections.map((s) => [s.id, s]));
    data.racks.slice(0, MAX_RACKS).forEach((r, ri) => {
      const sec = secById.get(r.sectionId); const slot = L.sectionSlot(data.sections, sec); const p = L.rackPlacement(r, slot);
      const floor = p.outdoor ? FLOOR_OUT : FLOOR_IN; placeOf.set(r.id, { ...p, floor, slot, ri });
      for (let f = 0; f < 3; f++) for (let s = 0; s < 2; s++) { tmpM.compose(new THREE.Vector3(p.x + (f - 1) * 2.15, floor + 2.1, p.z + (s ? 0.65 : -0.65)), q0, one); uprights.setMatrixAt(ri * 6 + f * 2 + s, tmpM); }
      for (let lv = 0; lv < 4; lv++) for (let s = 0; s < 2; s++) { tmpM.compose(new THREE.Vector3(p.x, floor + 0.2 + lv * 1.3, p.z + (s ? 0.65 : -0.65)), q0, one); beams.setMatrixAt(ri * 8 + lv * 2 + s, tmpM); }
      const pk = new THREE.Mesh(rackPickGeo, pickMat); pk.position.set(p.x, floor + 2.2, p.z); pk.userData.entity = { type: 'rackbox', id: r.id }; pk.userData.isPick = true; rackPick.add(pk); pickables.push(pk);
    });
    uprights.count = Math.min(data.racks.length, MAX_RACKS) * 6; beams.count = Math.min(data.racks.length, MAX_RACKS) * 8;
    uprights.instanceMatrix.needsUpdate = true; beams.instanceMatrix.needsUpdate = true;
    // one floating label per section
    data.sections.forEach((s) => {
      const slot = L.sectionSlot(data.sections, s);
      const sp = M.textSprite(`${s.code} · 0%`, { bg: '#ffffff', fg: '#1e44b4', border: '#2f5bd6', scale: 0.03, font: '800 38px Inter, system-ui, sans-serif' });
      const pos = slot === 'indoor0' ? [-27, 9.2, -6] : slot === 'indoor1' ? [-9, 9.2, -6] : [45.5, 6.8, 2];
      sp.position.set(...pos); sp.userData.entity = { type: 'section', id: s.id }; scene.add(sp); sectionSprites.set(s.id, sp); pickables.push(sp);
    });
    rackSig = sigOf(data);
  }
  const sigOf = (data) => data.racks.map((r) => `${r.id}:${r.sectionId}:${r.row}:${r.col}`).join(',') + '|' + data.sections.map((s) => `${s.id}${s.zone}`).join(',');

  function applyRacks(data) {
    const secById = new Map(data.sections.map((s) => [s.id, s]));
    // rack frame colours reflect fill status
    data.racks.slice(0, MAX_RACKS).forEach((r, ri) => { tmpC.set(rackColor[r.status] || rackColor.ok); for (let k = 0; k < 6; k++) uprights.setColorAt(ri * 6 + k, tmpC); tmpC.set(r.status === 'full' ? '#ef4444' : '#f4a62a'); for (let k = 0; k < 8; k++) beams.setColorAt(ri * 8 + k, tmpC); });
    if (uprights.instanceColor) uprights.instanceColor.needsUpdate = true; if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
    // pallets
    let nb = 0; let nba = 0; let nt = 0; palletMap = []; boxOwner = []; baseOwner = []; tagOwner = []; const nowQty = new Map();
    for (const r of data.racks.slice(0, MAX_RACKS)) {
      const p = placeOf.get(r.id); if (!p) continue;
      r.pallets.slice(0, 6).forEach((pal, i) => {
        const off = L.palletOffset(i); const wx = p.x + off.x; const wy = p.floor + off.y; const wz = p.z; const pi = palletMap.length;
        palletMap.push({ rackId: r.id, inventoryId: pal.inventoryId, pallet: pal, pos: new THREE.Vector3(wx, wy + 0.6, wz) });
        nowQty.set(pal.inventoryId, pal.quantity);
        tmpM.compose(new THREE.Vector3(wx, wy + 0.075, wz), q0, one); palBase.setMatrixAt(nba, tmpM); tmpC.set(M.COLORS.wood); palBase.setColorAt(nba, tmpC); baseOwner[nba++] = pi;
        const n = L.boxesForQty(pal.quantity);
        for (let k = 0; k < n; k++) {
          const layer = Math.floor(k / 4); const ix = k % 2; const iz = Math.floor((k % 4) / 2);
          tmpM.compose(new THREE.Vector3(wx + (ix - 0.5) * 0.88, wy + 0.15 + 0.24 + layer * 0.5, wz + (iz - 0.5) * 0.55), q0, one); palBox.setMatrixAt(nb, tmpM);
          tmpC.set(M.COLORS.cardboard[(pal.inventoryId + k) % 4]); palBox.setColorAt(nb, tmpC); boxOwner[nb++] = pi;
        }
        const layers = Math.ceil(n / 4);
        tmpM.compose(new THREE.Vector3(wx, wy + 0.15 + layers * 0.5 + 0.06, wz), q0, one); palTag.setMatrixAt(nt, tmpM);
        tmpC.set(pal.status === 'out' ? '#ef4444' : pal.status === 'low' ? '#f59e0b' : (pal.color || '#2f5bd6')); palTag.setColorAt(nt, tmpC); tagOwner[nt++] = pi;
      });
    }
    palBase.count = nba; palBox.count = nb; palTag.count = nt;
    [palBase, palBox, palTag].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    // flash pallets whose quantity changed (stock movement feedback)
    if (prevQty.size) for (const pm of palletMap) { const before = prevQty.get(pm.inventoryId); if (before === undefined) flash(pm.pos, '#16a34a'); else if (before !== pm.pallet.quantity) flash(pm.pos, pm.pallet.quantity > before ? '#16a34a' : '#2f5bd6'); }
    prevQty = nowQty;
    // warnings + section labels
    for (const r of data.racks) {
      const p = placeOf.get(r.id); if (!p) continue;
      const warn = r.lowStock || r.status === 'full';
      let sp = warnSprites.get(r.id);
      if (warn && !sp) { sp = M.textSprite(r.status === 'full' ? 'FULL' : '!', { bg: r.status === 'full' ? '#ef4444' : '#f59e0b', fg: '#fff', scale: 0.03, height: 64, padX: 20, depthTest: false }); sp.position.set(p.x, p.floor + 5.6, p.z); sp.userData.baseY = p.floor + 5.6; scene.add(sp); warnSprites.set(r.id, sp); }
      if (sp) { sp.visible = warn; if (warn) M.setSpriteText(sp, r.status === 'full' ? 'FULL' : '!', { bg: r.status === 'full' ? '#ef4444' : '#f59e0b', fg: '#fff', height: 64, padX: 20 }); }
    }
    for (const s of data.sections) { const sp = sectionSprites.get(s.id); if (sp) M.setSpriteText(sp, `${s.code} · ${Math.round(s.utilization * 100)}%`, { bg: s.status === 'full' ? '#fee2e2' : s.status === 'near_full' ? '#fef3c7' : '#ffffff', fg: s.status === 'full' ? '#b91c1c' : '#1e44b4', border: s.status === 'full' ? '#ef4444' : '#2f5bd6', font: '800 38px Inter, system-ui, sans-serif' }); }
    void secById;
  }
  function flash(pos, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y -= 0.5; scene.add(m); fx.push({ m, t: 0, dur: 1.4 });
  }

  // ------------------------------------------------------------------ docks (beacons)
  L.DOCK_X.forEach((x, i) => {
    const pole = M.cyl(0.08, 0.08, 1.7, '#475569', { x: x + 3.7, y: 0.85, z: L.HALL.z1 + 1.9, seg: 8 }); scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: '#16a34a', emissive: '#16a34a', emissiveIntensity: 0.9 })); lamp.position.set(x + 3.7, 1.85, L.HALL.z1 + 1.9); scene.add(lamp); beacons.push(lamp);
  });
  L.RIVERSIDE_DOCKS_X.forEach((x, i) => {
    const pole = M.cyl(0.08, 0.08, 1.7, '#475569', { x: x + 3.7, y: 0.85, z: L.RIVERSIDE.z1 + 1.9, seg: 8 }); scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: '#0ea5e9', emissive: '#0ea5e9', emissiveIntensity: 0.9 })); lamp.position.set(x + 3.7, 1.85, L.RIVERSIDE.z1 + 1.9); scene.add(lamp); beacons.push(lamp);
  });

  // Steel Dock Leveler Ramps (Visible bridging when truck is docked)
  const dockRamps = new Map();
  [...L.DOCK_X, ...L.RIVERSIDE_DOCKS_X].forEach((x) => {
    const ramp = M.box(3.2, 0.12, 4.4, '#334155', { x, y: 0.28, z: 12.2, r: 0.04, flat: true });
    ramp.rotation.x = 0.06;
    ramp.visible = false;
    scene.add(ramp);
    dockRamps.set(x, ramp);
  });

  // ------------------------------------------------------------------ vehicles, shipments, workers, forklifts
  const vehicles = new Map(); const workers = new Map(); const fork = [];
  let data = null; let selected = null; let hovered = null; let paused = false; let raf = 0; let last = performance.now(); let time = 0; let pickDirty = true; let pickCache = [];

  function addVehicleView(key, entity, model, speed = 7) {
    const obj = new THREE.Group(); obj.add(model); scene.add(obj);
    const label = M.textSprite(entity.label || '', { bg: 'rgba(15,27,61,0.86)', fg: '#fff', scale: 0.02, font: '700 36px Inter, system-ui, sans-serif', height: 58, padX: 18, depthTest: false });
    label.position.y = entity.van ? 4.6 : 5.6; obj.add(label);
    const mv = new Mover(obj, { speed, turnRate: 4 }); const view = { key, entity, obj, model, mover: mv, wheels: model.userData.wheels || [], planKey: null, label, mode: 'idle', pick: M.tagEntity(model, entity) };
    vehicles.set(key, view); pickDirty = true; return view;
  }
  const spotFor = (id) => road.nodes.get(id);
  function planVehicle(view, plan) {
    if (view.planKey === plan.key) return;
    const first = view.planKey === null; view.planKey = plan.key; const mv = view.mover; view.mode = plan.kind;
    const startNode = () => road.nearest(view.obj.position.x, view.obj.position.z);
    const driveTo = (nodeId, from = startNode(), done) => { const ids = road.path(from, nodeId); if (!ids) { mv.teleport(spotFor(nodeId), 0); done?.(); return; } mv.setPath(road.points(ids), done); };
    if (plan.kind === 'park' || plan.kind === 'dock') {
      if (first) { mv.teleport(spotFor(plan.node), 0); view.obj.rotation.y = 0; return; }
      const from = view.fromRoad ? 'inE' : startNode();
      if (view.fromRoad) { mv.teleport(spotFor('inE'), -Math.PI / 2); view.fromRoad = false; }
      driveTo(plan.node, from, () => { view.obj.rotation.y = 0; });
    } else if (plan.kind === 'patrol') {
      const loop = () => { mv.teleport({ x: L.ROAD_END.west + 4, z: L.LANES.out }, Math.PI / 2); mv.setPath([{ x: L.ROAD_END.east, z: L.LANES.out }], loop); };
      if (first) { mv.teleport({ x: -60 + (view.entity.id * 37) % 120, z: L.LANES.out }, Math.PI / 2); mv.setPath([{ x: L.ROAD_END.east, z: L.LANES.out }], loop); mv.speed = 9; return; }
      mv.speed = 9; driveTo('outE', startNode(), loop); view.fromRoad = true;
    } else if (plan.kind === 'return') {
      mv.teleport(spotFor('inE'), -Math.PI / 2); view.fromRoad = false; mv.speed = 8; driveTo('wait', 'inE', () => { view.obj.rotation.y = 0; });
    } else if (plan.kind === 'leave') {
      driveTo('outE', startNode(), () => { scene.remove(view.obj); vehicles.delete(view.key); pickDirty = true; if (selected && selected.type === view.entity.type && selected.id === view.entity.id) deselect(); });
    }
  }
  function syncVehicles(d) {
    const docks = d.docks.slice().sort((a, b) => a.number - b.number); const dockIdx = (id) => Math.max(0, docks.findIndex((x) => x.id === id));
    const seen = new Set();
    for (const v of d.vehicles) {
      const key = `v${v.id}`; seen.add(key); let view = vehicles.get(key);
      const entity = { type: 'vehicle', id: v.id, label: v.code, van: v.type === 'van' };
      if (!view) view = addVehicleView(key, entity, M.buildTruck({ cab: v.color, van: v.type === 'van', code: v.code }), 7);
      view.entity.label = v.code; if (view.label.userData.text !== v.code) M.setSpriteText(view.label, v.code, { bg: 'rgba(15,27,61,0.86)', fg: '#fff', font: '700 36px Inter, system-ui, sans-serif', height: 58, padX: 18 });
      const plan = v.status === 'loading' ? { kind: 'dock', node: `dock${dockIdx(v.dockId)}`, key: `dock${v.dockId}` } : v.status === 'on_route' ? { kind: 'patrol', key: 'patrol' }
        : v.status === 'returning' ? { kind: 'return', key: 'return' } : { kind: 'park', node: `slot${Math.min(L.PARKING.slots - 1, v.parkingSlot ?? 0)}`, key: `park${v.parkingSlot}` };
      planVehicle(view, plan); view.data = v;
    }
    for (const s of d.inboundShipments) {
      const key = `s${s.id}`; seen.add(key); let view = vehicles.get(key);
      if (!view) { view = addVehicleView(key, { type: 'shipment', id: s.id, label: s.ref }, M.buildTruck({ cab: '#e2e8f0', accent: '#f59e0b', boxColor: '#ffffff', brand: 'Supplier' }), 7); view.fromRoad = true; view.firstDock = true; }
      const idx = Math.max(0, docks.findIndex((x) => x.id === s.dockId));
      if (view.planKey === null) { view.planKey = ''; view.mover.teleport(spotFor('inE'), -Math.PI / 2); }
      planVehicle(view, { kind: 'dock', node: `dock${idx}`, key: `dock${s.dockId}` }); if (view.fromRoad) view.fromRoad = false; view.data = s;
    }
    for (const [key, view] of vehicles) if (!seen.has(key) && view.mode !== 'leave') { view.planKey = null; planVehicle(view, { kind: 'leave', key: 'leave' }); view.planKey = 'leave'; }
  }

  function workerPlan(e, d) {
    if (e.status === 'off_duty') return { hidden: true, key: 'off' };
    const t = e.task;
    if (e.status === 'busy' && t) {
      if (t.targetType === 'rack') { const p = placeOf.get(t.targetId); if (p) return { key: `rack${t.targetId}`, x: p.approach.x, z: p.approach.z, face: p.outdoor ? Math.PI : Math.PI, work: true }; }
      if (t.targetType === 'dock') { const docks = d.docks.slice().sort((a, b) => a.number - b.number); const i = Math.max(0, docks.findIndex((x) => x.id === t.targetId)); return { key: `dock${t.targetId}`, x: L.DOCK_X[i] + 2.2, z: L.WALK_Z + 0.2, face: 0, work: true }; }
      if (t.targetType === 'section') { const s = d.sections.find((x) => x.id === t.targetId); if (s) { const slot = L.sectionSlot(d.sections, s); const x = slot === 'outdoor' ? L.rackCols('outdoor')[1] : L.rackCols(slot)[1]; return { key: `sec${s.id}`, x, z: slot === 'outdoor' ? L.YARD_AISLE_Z : L.AISLE_Z[2], face: Math.PI, work: true }; } }
      if (t.targetType === 'office') return { key: 'office', x: L.OFFICE.doorX, z: L.WALK_Z, face: 0, work: true };
      const h = HOME[e.department]?.[0] || [8, L.WALK_Z]; return { key: `home${e.department}`, x: h[0] + 0.8, z: h[1], face: 0, work: true };
    }
    if (e.status === 'on_break') return { key: 'break', x: 27, z: L.WALK_Z + 1, face: 0, idle: true };
    const spots = HOME[e.department] || HOME.Maintenance; return { key: `idle${e.department}`, spots, idle: true, wander: true };
  }
  let initialBootDone = false;
  function addWorker(e) {
    const obj = M.buildWorker(e.department, e.id); scene.add(obj);
    const view = { id: e.id, obj, mover: new Mover(obj, { speed: 2.6, turnRate: 9 }), planKey: null, work: false, wanderT: 4 + Math.random() * 8, pick: M.tagEntity(obj, { type: 'worker', id: e.id }), seed: e.id };
    workers.set(e.id, view); pickDirty = true;
    if (initialBootDone) {
      // Dynamic spawn: walks out of the Management Office door to their assigned station
      view.mover.teleport({ x: L.OFFICE.doorX, z: L.WALK_Z }, 0);
    }
    return view;
  }
  function sendWorker(view, x, z, face, work) {
    const g = walk; const from = g.nearest(view.obj.position.x, view.obj.position.z); const to = g.nearest(x, z);
    const ids = g.path(from, to) || [to]; const pts = g.points(ids);
    // Lateral offset so workers walk in separate lanes without head-on overlap
    const lateral = ((view.seed * 11) % 5 - 2) * 0.18;
    const finalPts = pts.map((p, idx) => ({ x: p.x + (idx === 0 ? 0 : lateral), z: p.z }));
    finalPts.push({ x, z });
    view.work = false; view.mover.setPath(finalPts, () => { view.obj.rotation.y = face ?? view.obj.rotation.y; view.work = !!work; });
  }
  function syncWorkers(d) {
    const seen = new Set();
    for (const e of d.employees) {
      seen.add(e.id); let view = workers.get(e.id); const plan = workerPlan(e, d);
      if (!view) view = addWorker(e);
      view.data = e; view.obj.visible = !plan.hidden;
      const planKey = `${plan.key}`;
      if (view.planKey === planKey) continue;
      const first = view.planKey === null; view.planKey = planKey; if (plan.hidden) { view.mover.teleport({ x: L.OFFICE.doorX, z: L.WALK_Z }); continue; }
      view.wanderT = 3 + Math.random() * 8;
      const spot = plan.spots ? plan.spots[view.seed % plan.spots.length] : [plan.x, plan.z]; const jx = ((view.seed * 7) % 5) * 0.35 - 0.7;
      if (first && !initialBootDone) { view.mover.teleport({ x: spot[0] + jx, z: spot[1] + (plan.work ? 0 : 0.6) }, plan.face ?? ((view.seed % 8) * 0.8)); view.work = !!plan.work; }
      else sendWorker(view, spot[0] + (plan.work ? 0 : jx), spot[1], plan.face, plan.work);
    }
    for (const [id, view] of workers) if (!seen.has(id)) { scene.remove(view.obj); workers.delete(id); pickDirty = true; }
    initialBootDone = true;
  }
  // Gate-Loading Forklifts: Strictly travel through roll-up dock door gates into parked trucks and reverse out
  // Forklift 0 services WareTrack docks (L.DOCK_X: -31, -21, -11, -1)
  // Forklift 1 services Riverside docks (L.RIVERSIDE_DOCKS_X: 48, 58, 68)
  const forkConfigs = [
    { hub: 'waretrack', defaultX: -31, docks: L.DOCK_X },
    { hub: 'riverside', defaultX: 48, docks: L.RIVERSIDE_DOCKS_X }
  ];
  forkConfigs.forEach((cfg, i) => {
    const f = M.buildForklift(); f.position.set(cfg.defaultX, FLOOR_IN, 4.2); scene.add(f);
    const view = {
      obj: f,
      mover: new Mover(f, { speed: 2.8, turnRate: 8 }),
      cfg,
      currentDockX: cfg.defaultX,
      pts: [[cfg.defaultX, 4.2], [cfg.defaultX, 10.0], [cfg.defaultX, 15.2], [cfg.defaultX, 10.0]],
      i: 0,
      wait: 1.5 + i * 2,
      carry: false
    };
    fork.push(view);
  });

  function getParkedTruckAt(dockX) {
    for (const v of vehicles.values()) {
      if (v.obj.visible && Math.abs(v.obj.position.x - dockX) < 3.2 && v.obj.position.z >= 13.5) {
        return v;
      }
    }
    return null;
  }

  function updateForklifts(dt) {
    // Update steel dock ramps visibility: active only when a truck is backed up to that bay
    [...L.DOCK_X, ...L.RIVERSIDE_DOCKS_X].forEach((x) => {
      const r = dockRamps.get(x);
      if (r) r.visible = !!getParkedTruckAt(x);
    });

    for (const v of fork) {
      // Find which dock in this warehouse hub actually has a truck parked
      let targetDockX = null;
      let parkedTruck = null;
      for (const dx of v.cfg.docks) {
        const t = getParkedTruckAt(dx);
        if (t) {
          targetDockX = dx;
          parkedTruck = t;
          break;
        }
      }

      // If NO truck is parked at any dock in this hub:
      if (!parkedTruck) {
        v.carry = false;
        v.obj.userData.carry.visible = false;
        // Park inside safely at indoor staging pad
        if (v.obj.position.z > 4.6 || Math.abs(v.obj.position.x - v.cfg.defaultX) > 0.5) {
          v.mover.setPath([{ x: v.obj.position.x, z: 4.2 }, { x: v.cfg.defaultX, z: 4.2 }]);
        }
        v.mover.update(dt);
        // Firmly grounded on floor - zero flying or floating in mid-air
        v.obj.position.y = FLOOR_IN;
        v.obj.userData.wheels.forEach((w) => { if (v.mover.moving) w.rotation.x += dt * 6; });
        continue;
      }

      // A truck IS parked at targetDockX!
      if (v.currentDockX !== targetDockX) {
        v.currentDockX = targetDockX;
        v.pts = [[targetDockX, 4.2], [targetDockX, 10.0], [targetDockX, 15.2], [targetDockX, 10.0]];
        v.i = 0;
        v.mover.teleport({ x: targetDockX, z: 4.2 }, 0);
      }

      if (v.mover.idle) {
        v.wait -= dt;
        if (v.wait <= 0) {
          v.i = (v.i + 1) % v.pts.length;
          // Carry pallet only when driving out to truck (i=1) and inside truck (i=2)
          v.carry = v.i === 1 || v.i === 2;
          v.obj.userData.carry.visible = v.carry;
          v.wait = v.i === 2 ? 1.8 : 0.8;
          const p = v.pts[v.i];
          v.mover.setPath([{ x: p[0], z: p[1] }]);
        }
      }
      v.mover.update(dt);

      // Height physics: stays firmly grounded on the floor and smooth ramp into truck bed
      if (v.obj.position.z > 10.0) {
        const rampK = Math.min(1, Math.max(0, (v.obj.position.z - 10.0) / 4.8));
        v.obj.position.y = FLOOR_IN + rampK * 0.35;
      } else {
        v.obj.position.y = FLOOR_IN;
      }
      v.obj.userData.wheels.forEach((w) => { if (v.mover.moving) w.rotation.x += dt * 6; });
    }
  }

  // ------------------------------------------------------------------ selection, hover, picking
  const hiMat = new THREE.MeshBasicMaterial({ color: '#2f5bd6', transparent: true, opacity: 0.16, depthWrite: false });
  const selBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hiMat); const selEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#2f5bd6' }));
  const hovBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#7aa2ff', transparent: true, opacity: 0.1, depthWrite: false }));
  const pin = new THREE.Group(); const pinCone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 16), new THREE.MeshStandardMaterial({ color: '#2f5bd6', emissive: '#2f5bd6', emissiveIntensity: 0.5 })); pinCone.rotation.x = Math.PI; pinCone.position.y = 0.6;
  const pinBall = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: '#2f5bd6', emissive: '#2f5bd6', emissiveIntensity: 0.5 })); pinBall.position.y = 1.5; const pinDot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff' })); pinDot.position.y = 1.5;
  pin.add(pinCone, pinBall, pinDot); [selBox, selEdges, hovBox, pin].forEach((o) => { o.visible = false; o.renderOrder = 5; scene.add(o); });
  const bTmp = new THREE.Box3(); const bVec = new THREE.Vector3();

  // Smart 3D Pick-Path Optimization (Shortest Route Glowing Ribbon)
  const pickPathGroup = new THREE.Group(); pickPathGroup.renderOrder = 6; pickPathGroup.visible = false; scene.add(pickPathGroup);
  const pickLineMat = new THREE.LineDashedMaterial({ color: '#10b981', dashSize: 0.8, gapSize: 0.4, transparent: true, opacity: 0.95 });
  const pickLineGeo = new THREE.BufferGeometry();
  const pickPathLine = new THREE.Line(pickLineGeo, pickLineMat); pickPathGroup.add(pickPathLine);
  const wpGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16);
  const wpMat = new THREE.MeshBasicMaterial({ color: '#10b981', transparent: true, opacity: 0.8 });
  const pickWaypoints = [];
  for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(wpGeo, wpMat); m.visible = false; pickPathGroup.add(m); pickWaypoints.push(m); }

  function boundsOf(ref) {
    if (!ref) return null; const b = new THREE.Box3();
    switch (ref.type) {
      case 'rack': { const p = placeOf.get(ref.id); if (!p) return null; return b.setFromCenterAndSize(new THREE.Vector3(p.x, p.floor + 2.2, p.z), new THREE.Vector3(4.7, 4.5, 1.9)); }
      case 'pallet': { const pm = palletMap.find((x) => x.inventoryId === ref.id); if (!pm) return null; return b.setFromCenterAndSize(pm.pos.clone(), new THREE.Vector3(2.0, 1.4, 1.3)); }
      case 'vehicle': case 'shipment': { const v = vehicles.get(ref.type === 'vehicle' ? `v${ref.id}` : `s${ref.id}`); return v ? b.setFromObject(v.model) : null; }
      case 'worker': { const w = workers.get(ref.id); return w && w.obj.visible ? b.setFromObject(w.obj) : null; }
      case 'dock': { const docks = data?.docks.slice().sort((a, c) => a.number - c.number) || []; const i = docks.findIndex((x) => x.id === ref.id); if (i < 0) return null; return b.setFromCenterAndSize(new THREE.Vector3(L.DOCK_X[i], 2.4, L.HALL.z1 + 0.6), new THREE.Vector3(7.2, 4.8, 2.2)); }
      case 'warehouse':
        if (ref.id === 2) return b.set(new THREE.Vector3(L.RIVERSIDE.x0, 0, L.RIVERSIDE.z0), new THREE.Vector3(L.RIVERSIDE.x1, L.RIVERSIDE.wall + 1, L.RIVERSIDE.z1));
        return b.set(new THREE.Vector3(L.HALL.x0, 0, L.HALL.z0), new THREE.Vector3(L.HALL.x1, L.HALL.wall + 1, L.HALL.z1));
      case 'office': return b.set(new THREE.Vector3(L.OFFICE.x0, 0, L.OFFICE.z0), new THREE.Vector3(L.OFFICE.x1, L.OFFICE.h + 0.6, L.OFFICE.z1));
      case 'section': { const rs = data?.racks.filter((r) => r.sectionId === ref.id) || []; if (!rs.length) return null; for (const r of rs) { const p = placeOf.get(r.id); if (p) b.expandByPoint(new THREE.Vector3(p.x - 2.2, 0, p.z - 0.9)).expandByPoint(new THREE.Vector3(p.x + 2.2, 4.4, p.z + 0.9)); } return b; }
      default: return null;
    }
  }
  function placeBox(mesh, b, pad = 0.15) { b.getSize(bVec); mesh.scale.set(bVec.x + pad, bVec.y + pad, bVec.z + pad); b.getCenter(mesh.position); }
  function refreshHighlights() {
    const sb = selected && boundsOf(selected);
    selBox.visible = selEdges.visible = pin.visible = !!sb;
    if (sb) { placeBox(selBox, sb); selEdges.scale.copy(selBox.scale); selEdges.position.copy(selBox.position); pin.position.set(selBox.position.x, sb.max.y + 1.1 + Math.sin(time * 3) * 0.25, selBox.position.z); }
    const hb = hovered && !(selected && same(hovered, selected)) && boundsOf(hovered); hovBox.visible = !!hb; if (hb) placeBox(hovBox, hb, 0.1);

    // Smart 3D Pick-Path calculation: shortest walking route from dock staging to rack/pallet
    if (selected && (selected.type === 'rack' || selected.type === 'pallet')) {
      const rackId = selected.type === 'rack' ? selected.id : selected.rackId;
      const p = placeOf.get(rackId);
      if (p && p.approach) {
        const floorY = (p.floor ?? FLOOR_IN) + 0.08;
        const from = walk.nearest(0, L.WALK_Z);
        const to = walk.nearest(p.approach.x, p.approach.z);
        const ids = walk.path(from, to) || [to];
        const pts = walk.points(ids);
        const allPts = [{ x: 0, z: L.WALK_Z }, ...pts, { x: p.approach.x, z: p.approach.z }];
        const lineVectors = allPts.map((pt) => new THREE.Vector3(pt.x, floorY, pt.z));
        pickLineGeo.setFromPoints(lineVectors);
        pickPathLine.computeLineDistances();
        pickWaypoints.forEach((w) => { w.visible = false; });
        allPts.forEach((pt, idx) => {
          if (idx < pickWaypoints.length) {
            pickWaypoints[idx].position.set(pt.x, floorY, pt.z);
            pickWaypoints[idx].visible = true;
          }
        });
        pickPathGroup.visible = true;
      } else {
        pickPathGroup.visible = false;
      }
    } else {
      pickPathGroup.visible = false;
    }
    void bTmp;
  }
  const same = (a, b) => a && b && a.type === b.type && a.id === b.id;
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function pickList() {
    if (pickDirty) { pickCache = []; for (const v of vehicles.values()) pickCache.push(...v.pick); for (const w of workers.values()) pickCache.push(...w.pick); pickDirty = false; }
    return [...pickables, palBase, palBox, palTag, ...pickCache];
  }
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
  function pickAt(ev) {
    const r = canvas.getBoundingClientRect(); ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(pickList(), false).filter((h) => h.object.isSprite ? shown(h.object) && h.object.material.opacity > 0 : shown(h.object));
    const palletRef = (h) => { const arr = h.object === palBox ? boxOwner : h.object === palBase ? baseOwner : tagOwner; const pm = palletMap[arr[h.instanceId]]; return pm ? { type: 'pallet', id: pm.inventoryId, rackId: pm.rackId } : null; };
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]; if (h.object === palBox || h.object === palBase || h.object === palTag) { const p = palletRef(h); if (p) return p; continue; }
      const ent = h.object.userData.entity; if (!ent) continue;
      if (ent.type === 'rackbox') { for (let j = i + 1; j < hits.length; j++) { const hj = hits[j]; if (hj.object === palBox || hj.object === palBase || hj.object === palTag) { const p = palletRef(hj); if (p && p.rackId === ent.id) return p; } } return { type: 'rack', id: ent.id }; }
      return { type: ent.type, id: ent.id };
    }
    return null;
  }
  function select(ref, { focus = false, silent = false } = {}) {
    selected = ref && boundsOf(ref) ? { type: ref.type, id: ref.id, rackId: ref.rackId } : null;
    if (selected && (selected.type === 'rack' || selected.type === 'pallet')) { const p = placeOf.get(selected.type === 'rack' ? selected.id : selected.rackId); if (p && !p.outdoor) setInterior(true); }
    if (focus && selected) focusOn(selected);
    refreshHighlights(); if (!silent) handlers.onSelect?.(selected);
  }
  const deselect = () => select(null);
  function focusOn(ref) {
    const b = boundsOf(ref); if (!b) return; const c = b.getCenter(new THREE.Vector3()); const size = b.getSize(new THREE.Vector3()); c.y = Math.min(c.y, 2);
    const dist = Math.max(32, Math.min(95, Math.max(size.x, size.z) * 2.4 + 22));
    startTween(c, dist);
  }
  let tween = null;
  function startTween(toT, toD, toDir = null) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    tween = { t: 0, dur: 0.95, fromT: controls.target.clone(), toT, fromD: camera.position.distanceTo(controls.target), toD, fromDir: dir, toDir: toDir || dir.clone() };
  }
  const ease = (k) => 1 - (1 - k) ** 3;

  // pointer handling: click vs. drag
  let down = null; let hoverPending = false; let lastMove = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const dt = performance.now() - down.t; down = null;
    if (moved < 6 && dt < 600) { const ref = pickAt(e); ref ? select(ref) : deselect(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    lastMove = e; if (hoverPending || e.buttons) return; hoverPending = true;
    requestAnimationFrame(() => { hoverPending = false; if (!lastMove) return; const ref = pickAt(lastMove); if (!same(ref, hovered) || ref) { hovered = ref; canvas.style.cursor = ref ? 'pointer' : 'grab'; refreshHighlights(); handlers.onHover?.(ref, { x: lastMove.clientX, y: lastMove.clientY }); } });
  });
  canvas.addEventListener('pointerleave', () => { lastMove = null; if (hovered) { hovered = null; refreshHighlights(); handlers.onHover?.(null); } });
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') deselect(); });

  // ------------------------------------------------------------------ interior view (roof lifts, front walls drop)
  let interior = false; let interiorT = 0;
  function setInterior(on) { if (interior === on) return; interior = on; handlers.onInterior?.(on); }

  // ------------------------------------------------------------------ resize, quality, LOD
  const resize = () => { const w = container.clientWidth || 1; const h = container.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  let lod = 'near';
  function updateLod() {
    const d = camera.position.distanceTo(controls.target); const next = d > 165 ? 'far' : 'near'; if (next === lod) return; lod = next;
    palTag.visible = lod === 'near';
    for (const w of workers.values()) w.obj.traverse((o) => { if (o.isMesh) o.castShadow = lod === 'near'; });
    palBox.castShadow = lod === 'near';
  }
  function setQuality(q) { const low = q === 'low'; renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = !low; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); resize(); }

  // ------------------------------------------------------------------ frame loop
  const lookV = new THREE.Vector3();
  function update(dt) {
    time += dt;
    for (const v of vehicles.values()) {
      v.mover.update(dt); const y = v.obj.position.z > 29 ? ROAD_Y : FLOOR_OUT; v.obj.position.y = y;
      if (v.mover.moving) { const spin = (v.mover.speed * dt) / 0.55; v.wheels.forEach((w) => { w.rotation.x += spin; }); }
      v.label.visible = lod === 'near' || same(selected, v.entity);
    }
    for (const w of workers.values()) {
      w.mover.update(dt); const p = w.obj.position; p.y = inHall(p.x, p.z) ? FLOOR_IN : FLOOR_OUT;
      const legs = w.obj.userData.legs; const swing = w.mover.moving ? Math.sin(time * 9 + w.seed) * 0.7 : 0;
      legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
      if (w.work) w.obj.position.y += Math.abs(Math.sin(time * 5 + w.seed)) * 0.08; else if (w.mover.moving) w.obj.position.y += Math.abs(Math.sin(time * 9 + w.seed)) * 0.05;
      if (!w.mover.moving && !w.work && w.data?.status === 'available') {
        w.wanderT -= dt;
        if (w.wanderT <= 0) { w.wanderT = 7 + Math.random() * 9; const spots = HOME[w.data.department] || HOME.Maintenance; const s = spots[Math.floor(Math.random() * spots.length)]; sendWorker(w, s[0] + (Math.random() - 0.5) * 3, s[1], undefined, false); }
      }
    }
    // Worker-to-worker anti-collision repulsion (prevents avatars clipping through each other)
    const activeWorkers = Array.from(workers.values()).filter((w) => w.obj.visible && !w.work);
    for (let i = 0; i < activeWorkers.length; i++) {
      for (let j = i + 1; j < activeWorkers.length; j++) {
        const wa = activeWorkers[i].obj.position; const wb = activeWorkers[j].obj.position;
        const dx = wb.x - wa.x; const dz = wb.z - wa.z;
        const dist = Math.hypot(dx, dz);
        const MIN_DIST = 1.15;
        if (dist < MIN_DIST && dist > 0.001) {
          const push = (MIN_DIST - dist) * 0.5;
          const nx = dx / dist; const nz = dz / dist;
          wa.x -= nx * push; wa.z -= nz * push;
          wb.x += nx * push; wb.z += nz * push;
        }
      }
    }
    updateForklifts(dt);
    if (pickPathGroup.visible) pickLineMat.dashOffset -= dt * 2.8;
    for (const sp of warnSprites.values()) if (sp.visible) sp.position.y = sp.userData.baseY + Math.sin(time * 3) * 0.25;
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += dt; const k = f.t / f.dur; f.m.scale.setScalar(1 + k * 1.8); f.m.material.opacity = Math.max(0, 0.9 * (1 - k)); if (k >= 1) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); fx.splice(i, 1); } }
    // roof lift animation
    const target = interior ? 1 : 0; interiorT += (target - interiorT) * Math.min(1, dt * 5); if (Math.abs(target - interiorT) < 0.004) interiorT = target;
    hu.roof.position.y = interiorT * 14; hu.roof.visible = interiorT < 0.97; hu.near.scale.y = 1 - 0.86 * interiorT; hu.doorGear.visible = interiorT < 0.5;
    if (ru?.roof) { ru.roof.position.y = interiorT * 14; ru.roof.visible = interiorT < 0.97; ru.near.scale.y = 1 - 0.86 * interiorT; ru.doorGear.visible = interiorT < 0.5; }
    if (tween) { tween.t += dt; const k = ease(Math.min(1, tween.t / tween.dur)); controls.target.lerpVectors(tween.fromT, tween.toT, k); lookV.copy(tween.fromDir).lerp(tween.toDir, k).normalize(); camera.position.copy(controls.target).addScaledVector(lookV, tween.fromD + (tween.toD - tween.fromD) * k); if (tween.t >= tween.dur) tween = null; }
    if (selected || hovered) refreshHighlights();
    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) updateLod();
  }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt); controls.update(); renderer.render(scene, camera);
  }
  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!paused) start(); });

  // ------------------------------------------------------------------ public API
  const api = {
    applyData(d) {
      data = d;
      if (sigOf(d) !== rackSig) rebuildRacks(d);
      applyRacks(d);
      const docks = d.docks.slice().sort((a, b) => a.number - b.number);
      docks.forEach((k, i) => { const lamp = beacons[i]; if (lamp) { const c = k.status === 'free' ? '#16a34a' : k.status === 'occupied' ? '#f59e0b' : '#94a3b8'; lamp.material.color.set(c); lamp.material.emissive.set(c); } });
      syncVehicles(d); syncWorkers(d);
      if (selected && !boundsOf(selected)) deselect(); else refreshHighlights();
      handlers.onData?.(d);
    },
    select: (ref, o) => select(ref, o), focus: (ref) => { select(ref, { focus: true }); }, deselect,
    setInterior, get interior() { return interior; },
    resetCamera() { startTween(HOME_TARGET.clone(), HOME_DIST); },
    zoom(f) { const off = camera.position.clone().sub(controls.target); const d = Math.max(controls.minDistance, Math.min(controls.maxDistance, off.length() * f)); startTween(controls.target.clone(), d); },
    rotate(deg) { const off = camera.position.clone().sub(controls.target); const d = off.length(); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180); startTween(controls.target.clone(), d, off.normalize()); },
    setPaused(p) { paused = p; if (p) stop(); else start(); },
    setQuality, boundsOf, start, stop,
    dispose() { stop(); ro.disconnect(); controls.dispose(); renderer.dispose(); canvas.remove(); },
    debug: { scene, camera, vehicles, workers, palletMap: () => palletMap, stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }) },
  };
  start();
  return api;
}
